package mcp

import (
	"context"
	"fmt"
	"strings"
	"time"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/google/uuid"
	"orcasql/internal/history"
	"orcasql/internal/query"
	"orcasql/internal/schema"
)

// registerTools MCP 서버에 PoC 도구 5개를 등록한다.
//
// 모든 도구는 Server 메서드로 구현되어 token / policy / deps 에 접근 가능하다.
// 응답은 mcp.NewToolResultStructured 로 구조화된 JSON + 폴백 텍스트를 반환.
func (s *Server) registerTools(m *server.MCPServer) {
	m.AddTool(toolListConnections(), s.handleListConnections)
	m.AddTool(toolListDatabases(), s.handleListDatabases)
	m.AddTool(toolListTables(), s.handleListTables)
	m.AddTool(toolDescribeTable(), s.handleDescribeTable)
	m.AddTool(toolExecuteQuery(), s.handleExecuteQuery)
}

// ─── tool 정의 ───────────────────────────────────────────────────────────────

func toolListConnections() mcpgo.Tool {
	return mcpgo.NewTool("list_connections",
		mcpgo.WithDescription(
			"List MySQL connections available through OrcaSQL. "+
				"Returns id, name, host, default database, and whether the connection is currently active. "+
				"Only connections explicitly allowlisted in OrcaSQL settings are visible. Passwords are never returned.",
		),
	)
}

func toolListDatabases() mcpgo.Tool {
	return mcpgo.NewTool("list_databases",
		mcpgo.WithDescription("List databases (schemas) on a MySQL connection. The connection must be active and allowlisted."),
		mcpgo.WithString("connID", mcpgo.Required(), mcpgo.Description("Connection ID returned by list_connections")),
	)
}

func toolListTables() mcpgo.Tool {
	return mcpgo.NewTool("list_tables",
		mcpgo.WithDescription("List tables and views in a database with row count and size."),
		mcpgo.WithString("connID", mcpgo.Required(), mcpgo.Description("Connection ID")),
		mcpgo.WithString("database", mcpgo.Required(), mcpgo.Description("Database (schema) name")),
	)
}

func toolDescribeTable() mcpgo.Tool {
	return mcpgo.NewTool("describe_table",
		mcpgo.WithDescription("Return columns, indexes, and CREATE TABLE DDL for a table."),
		mcpgo.WithString("connID", mcpgo.Required(), mcpgo.Description("Connection ID")),
		mcpgo.WithString("database", mcpgo.Required(), mcpgo.Description("Database name")),
		mcpgo.WithString("table", mcpgo.Required(), mcpgo.Description("Table name")),
	)
}

func toolExecuteQuery() mcpgo.Tool {
	return mcpgo.NewTool("execute_query",
		mcpgo.WithDescription(
			"Execute a single SQL statement on the given connection. "+
				"By default only SELECT/SHOW/EXPLAIN are allowed. "+
				"INSERT/UPDATE/DELETE require AllowWrite, and CREATE/ALTER/DROP/TRUNCATE require AllowDDL — "+
				"both are toggled in OrcaSQL settings. "+
				"All executions (success and failure) are recorded in OrcaSQL query history with source=mcp.",
		),
		mcpgo.WithString("connID", mcpgo.Required(), mcpgo.Description("Connection ID")),
		mcpgo.WithString("database", mcpgo.Description("Database name (optional, for history bookkeeping)")),
		mcpgo.WithString("sql", mcpgo.Required(), mcpgo.Description("Single SQL statement (no trailing semicolon required)")),
	)
}

// ─── 핸들러 ──────────────────────────────────────────────────────────────────

// connectionSummary list_connections 응답 항목 — 자격증명 0%.
type connectionSummary struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Database string `json:"database"`
	Color    string `json:"color,omitempty"`
	Active   bool   `json:"active"`         // 현재 *sql.DB 가 살아있는지
	UseSSH   bool   `json:"useSSH,omitempty"`
	UseProxy bool   `json:"useProxy,omitempty"`
}

func (s *Server) handleListConnections(ctx context.Context, _ mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	cfg := s.CurrentPolicy()
	saved, err := s.deps.LoadSavedConnections(ctx)
	if err != nil {
		return mcpgo.NewToolResultErrorf("load saved connections: %v", err), nil
	}

	// BugFix-DA: ConnectAsNewSession 경로에서 runtime ID 와 cfgId 가 분리되므로,
	// active 매핑은 영구 cfgId(`info.CfgID`) 로 키잉해야 한다. 과거엔 info.ID(휘발 UUID) 로
	// 매핑한 탓에 list_connections 가 항상 active=false 를 반환했다(BugFix-CX 의 dedup 가 잡지 못한 잔여 버그).
	active := map[string]struct{}{}
	for _, info := range s.deps.ConnManager.ListConnections() {
		key := info.CfgID
		if key == "" {
			key = info.ID // unsaved 연결 등 cfgId 가 없는 경우 fallback
		}
		active[key] = struct{}{}
	}

	out := make([]connectionSummary, 0, len(saved))
	for _, c := range saved {
		if !cfg.IsConnAllowed(c.ID) {
			continue
		}
		_, isActive := active[c.ID]
		out = append(out, connectionSummary{
			ID:       c.ID,
			Name:     c.Name,
			Host:     c.Host,
			Port:     c.Port,
			User:     c.User,
			Database: c.Database,
			Color:    c.Color,
			Active:   isActive,
			UseSSH:   c.UseSSH,
			UseProxy: c.UseProxy,
		})
	}

	return mcpgo.NewToolResultStructured(
		map[string]any{"connections": out, "count": len(out)},
		summarizeConnections(out),
	), nil
}

func (s *Server) handleListDatabases(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	connID, err := req.RequireString("connID")
	if err != nil {
		return mcpgo.NewToolResultError(err.Error()), nil
	}
	if err := s.assertConnAllowedAndActive(connID); err != nil {
		return mcpgo.NewToolResultError(err.Error()), nil
	}

	dbs, err := s.deps.SchemaInsp.ListDatabases(ctx, connID)
	if err != nil {
		return mcpgo.NewToolResultErrorf("list databases: %v", err), nil
	}
	if dbs == nil {
		dbs = []string{}
	}
	return mcpgo.NewToolResultStructured(
		map[string]any{"databases": dbs, "count": len(dbs)},
		fmt.Sprintf("%d databases", len(dbs)),
	), nil
}

func (s *Server) handleListTables(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	connID, err := req.RequireString("connID")
	if err != nil {
		return mcpgo.NewToolResultError(err.Error()), nil
	}
	database, err := req.RequireString("database")
	if err != nil {
		return mcpgo.NewToolResultError(err.Error()), nil
	}
	if err := s.assertConnAllowedAndActive(connID); err != nil {
		return mcpgo.NewToolResultError(err.Error()), nil
	}

	tables, err := s.deps.SchemaInsp.ListTables(ctx, connID, database)
	if err != nil {
		return mcpgo.NewToolResultErrorf("list tables: %v", err), nil
	}
	if tables == nil {
		tables = []schema.TableInfo{}
	}
	return mcpgo.NewToolResultStructured(
		map[string]any{
			"database": database,
			"tables":   tables,
			"count":    len(tables),
		},
		fmt.Sprintf("%d tables in %s", len(tables), database),
	), nil
}

type tableDescription struct {
	Database string              `json:"database"`
	Table    string              `json:"table"`
	Columns  []schema.ColumnInfo `json:"columns"`
	Indexes  []schema.IndexInfo  `json:"indexes"`
	DDL      string              `json:"ddl"`
}

func (s *Server) handleDescribeTable(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	connID, err := req.RequireString("connID")
	if err != nil {
		return mcpgo.NewToolResultError(err.Error()), nil
	}
	database, err := req.RequireString("database")
	if err != nil {
		return mcpgo.NewToolResultError(err.Error()), nil
	}
	table, err := req.RequireString("table")
	if err != nil {
		return mcpgo.NewToolResultError(err.Error()), nil
	}
	if err := s.assertConnAllowedAndActive(connID); err != nil {
		return mcpgo.NewToolResultError(err.Error()), nil
	}

	cols, err := s.deps.SchemaInsp.ListColumns(ctx, connID, database, table)
	if err != nil {
		return mcpgo.NewToolResultErrorf("list columns: %v", err), nil
	}
	idxs, err := s.deps.SchemaInsp.ListIndexes(ctx, connID, database, table)
	if err != nil {
		return mcpgo.NewToolResultErrorf("list indexes: %v", err), nil
	}
	ddl, err := s.deps.SchemaInsp.GetTableDDL(ctx, connID, database, table)
	if err != nil {
		return mcpgo.NewToolResultErrorf("get table ddl: %v", err), nil
	}
	if cols == nil {
		cols = []schema.ColumnInfo{}
	}
	if idxs == nil {
		idxs = []schema.IndexInfo{}
	}

	desc := tableDescription{
		Database: database,
		Table:    table,
		Columns:  cols,
		Indexes:  idxs,
		DDL:      ddl,
	}
	return mcpgo.NewToolResultStructured(
		desc,
		fmt.Sprintf("%s.%s — %d columns, %d indexes", database, table, len(cols), len(idxs)),
	), nil
}

// executeQueryResult MCP execute_query 응답 — 프론트의 QueryResult 와는 별도로
// LLM 친화적인 평탄 구조 (rows 를 object 배열로 변환).
type executeQueryResult struct {
	Columns    []query.ColumnMeta `json:"columns"`
	Rows       []map[string]any   `json:"rows"`
	RowCount   int                `json:"rowCount"`
	Affected   int64              `json:"affected,omitempty"`
	LastID     int64              `json:"lastInsertId,omitempty"`
	DurationMs int64              `json:"durationMs"`
	Truncated  bool               `json:"truncated,omitempty"`
	SQL        string             `json:"sql"`
}

func (s *Server) handleExecuteQuery(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
	connID, err := req.RequireString("connID")
	if err != nil {
		return mcpgo.NewToolResultError(err.Error()), nil
	}
	sqlStr, err := req.RequireString("sql")
	if err != nil {
		return mcpgo.NewToolResultError(err.Error()), nil
	}
	database := req.GetString("database", "")
	cfg := s.CurrentPolicy()

	// 검사 순서: allowlist → policy → active conn.
	// allowlist 와 policy 는 정적 검사이므로 먼저 실행해 DB 로 가는 라운드트립을 절약.
	// 감사 기록은 정책 거부에 대해서만 — allowlist 거부는 connID 자체가 의미 없을 수 있어 잡음.
	if !cfg.IsConnAllowed(connID) {
		return mcpgo.NewToolResultErrorf(
			"connection %q is not allowlisted in OrcaSQL MCP settings", connID), nil
	}
	if perr := CheckExecutePolicy(cfg, sqlStr); perr != nil {
		s.recordHistory(connID, database, sqlStr, history.Entry{
			HasError: true,
			ErrorMsg: perr.Error(),
		})
		return mcpgo.NewToolResultError(perr.Error()), nil
	}
	if _, err := s.deps.ConnManager.GetDB(connID); err != nil {
		return mcpgo.NewToolResultErrorf(
			"connection %q is not active — open it in OrcaSQL UI first (%v)", connID, err), nil
	}

	start := time.Now()
	// cancelKey 는 "mcp:connID" — UI 의 탭 cancelKey 네임스페이스와 충돌 방지
	res, execErr := s.deps.QueryExecutor.Execute(ctx, connID, "mcp:"+connID, database, sqlStr)
	dur := time.Since(start)

	entry := history.Entry{
		HasError: execErr != nil,
		Duration: dur,
	}
	if execErr != nil {
		entry.ErrorMsg = execErr.Error()
	} else {
		entry.RowCount = int64(len(res.Rows))
		entry.Affected = res.Affected
	}
	s.recordHistory(connID, database, sqlStr, entry)

	if execErr != nil {
		return mcpgo.NewToolResultErrorf("execute: %v", execErr), nil
	}

	flat := flattenRows(res.Columns, res.Rows)
	out := executeQueryResult{
		Columns:    res.Columns,
		Rows:       flat,
		RowCount:   len(flat),
		Affected:   res.Affected,
		LastID:     res.LastID,
		DurationMs: dur.Milliseconds(),
		Truncated:  res.Truncated,
		SQL:        sqlStr,
	}
	return mcpgo.NewToolResultStructured(
		out,
		fmt.Sprintf("rows=%d affected=%d duration=%dms truncated=%v",
			out.RowCount, out.Affected, out.DurationMs, out.Truncated),
	), nil
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

// assertConnAllowedAndActive allowlist + 활성 *sql.DB 둘 다 검사.
// 활성 아님 → "user must connect via UI first" 에러.
func (s *Server) assertConnAllowedAndActive(connID string) error {
	cfg := s.CurrentPolicy()
	if !cfg.IsConnAllowed(connID) {
		return fmt.Errorf("connection %q is not allowlisted in OrcaSQL MCP settings", connID)
	}
	if _, err := s.deps.ConnManager.GetDB(connID); err != nil {
		return fmt.Errorf("connection %q is not active — open it in OrcaSQL UI first (%w)", connID, err)
	}
	return nil
}

// recordHistory MCP 호출 기록을 history.Store 에 추가한다.
// 기본 필드(ID/SQL/ConnName/Database/ExecutedAt/Source) 를 채우고
// caller 가 넘긴 entry 의 결과 필드(Duration/RowCount/Affected/HasError/ErrorMsg) 와 병합.
func (s *Server) recordHistory(connID, dbName, sqlStr string, base history.Entry) {
	connName := s.lookupConnName(context.Background(), connID)
	base.ID = uuid.New().String()
	base.SQL = sqlStr
	base.ConnName = connName
	base.Database = dbName
	base.ExecutedAt = time.Now()
	base.Source = history.SourceMCP
	if err := s.deps.HistoryStore.Add(base); err != nil {
		s.logger.Warn("history save failed (mcp)", "error", err, "connID", connID)
	}
}

// lookupConnName 활성 연결 정보에서 사람이 읽는 이름을 찾고,
// 없으면 저장된 설정에서 fallback. 둘 다 실패하면 connID 자체 반환.
//
// BugFix-DA: MCP 가 받는 connID 는 영구 cfgId 이므로 활성 정보 검색도 CfgID 매칭을 함께 시도한다.
func (s *Server) lookupConnName(ctx context.Context, connID string) string {
	for _, info := range s.deps.ConnManager.ListConnections() {
		if (info.ID == connID || info.CfgID == connID) && info.Name != "" {
			return info.Name
		}
	}
	saved, _ := s.deps.LoadSavedConnections(ctx)
	for _, c := range saved {
		if c.ID == connID && c.Name != "" {
			return c.Name
		}
	}
	return connID
}

// flattenRows [][]any → []map[string]any — LLM 이 읽기 쉬운 형태.
// 컬럼이 비어 있어도 빈 배열을 반환 (nil X).
func flattenRows(cols []query.ColumnMeta, rows [][]any) []map[string]any {
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		obj := make(map[string]any, len(cols))
		for i, c := range cols {
			if i < len(row) {
				obj[c.Name] = row[i]
			} else {
				obj[c.Name] = nil
			}
		}
		out = append(out, obj)
	}
	return out
}

// summarizeConnections list_connections 텍스트 폴백 — LLM 이 structured 를 못 읽을 때 대비.
func summarizeConnections(conns []connectionSummary) string {
	if len(conns) == 0 {
		return "no connections allowlisted for MCP — add one in OrcaSQL settings"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%d connections:\n", len(conns))
	for _, c := range conns {
		state := "inactive"
		if c.Active {
			state = "active"
		}
		fmt.Fprintf(&b, "  - %s [%s] %s@%s:%d/%s (%s)\n",
			c.Name, c.ID, c.User, c.Host, c.Port, c.Database, state)
	}
	return b.String()
}
