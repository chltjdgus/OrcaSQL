package main

// ─── MCP 서버 (Phase 43 PoC) ───────────────────────────────────────────────
//
// 환경설정 → MCP 탭에서 호출되는 Wails 바인딩들. 자세한 설계는
// .claude/plans/phase-43-mcp-server.md 참조.
//
// 보안: 토큰은 OS 키체인 보관, RevealMCPToken 만 평문 노출 (UI "복사" 버튼용).
// GetMCPConfig 응답에는 토큰이 포함되지 않는다.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	mcppkg "orcasql/internal/mcp"
)

// TestMCPResult 자가 헬스체크 결과 — 환경설정 패널의 "연결 테스트" 버튼이 받음.
type TestMCPResult struct {
	Success    bool   `json:"success"`
	DurationMs int64  `json:"durationMs"`
	Endpoint   string `json:"endpoint,omitempty"`
	Message    string `json:"message,omitempty"` // 실패 시 사용자에게 보여줄 짧은 문구
}

// GetMCPConfig 현재 디스크에 저장된 MCP 설정을 반환한다 (토큰 제외).
func (a *App) GetMCPConfig(_ context.Context) (mcppkg.Config, error) {
	if a.mcpConfigStore == nil {
		return mcppkg.DefaultConfig(), nil
	}
	cfg, err := a.mcpConfigStore.Load()
	if err != nil {
		return mcppkg.DefaultConfig(), fmt.Errorf("load mcp config: %w", err)
	}
	return cfg, nil
}

// UpdateMCPConfig 설정을 저장하고 필요 시 서버를 재시작한다.
//   - Enabled false → 실행 중이면 Stop
//   - Enabled true  → 재시작 (Stop → Start)
//
// 포트나 권한 변경은 재시작을 통해 반영된다.
func (a *App) UpdateMCPConfig(ctx context.Context, cfg mcppkg.Config) error {
	if a.mcpConfigStore == nil || a.mcpServer == nil {
		return fmt.Errorf("MCP not initialized")
	}
	if err := a.mcpConfigStore.Save(cfg); err != nil {
		return fmt.Errorf("save mcp config: %w", err)
	}
	if !cfg.Enabled {
		return a.mcpServer.Stop(ctx)
	}
	return a.mcpServer.Restart(ctx)
}

// StartMCPServer 수동 시작 — Config.Enabled=true 여야 함.
func (a *App) StartMCPServer(ctx context.Context) error {
	if a.mcpServer == nil {
		return fmt.Errorf("MCP not initialized")
	}
	if err := a.mcpServer.Start(ctx); err != nil {
		if errors.Is(err, mcppkg.ErrAlreadyRunning) {
			return nil
		}
		return err
	}
	return nil
}

// StopMCPServer 수동 중지 — graceful shutdown (5초 이내).
func (a *App) StopMCPServer(ctx context.Context) error {
	if a.mcpServer == nil {
		return nil
	}
	return a.mcpServer.Stop(ctx)
}

// GetMCPStatus 서버 상태 — UI 의 라이브 표시기에 쓰임.
func (a *App) GetMCPStatus(_ context.Context) mcppkg.Status {
	if a.mcpServer == nil {
		return mcppkg.Status{}
	}
	return a.mcpServer.Status()
}

// RegenerateMCPToken 토큰 강제 재발급 — 기존 클라이언트는 다음 호출 시 401.
// 서버가 실행 중이면 자동 재시작하여 새 토큰을 적용.
func (a *App) RegenerateMCPToken(ctx context.Context) (string, error) {
	if a.mcpConfigStore == nil {
		return "", fmt.Errorf("MCP not initialized")
	}
	tok, err := a.mcpConfigStore.RegenerateToken()
	if err != nil {
		return "", err
	}
	if a.mcpServer != nil {
		st := a.mcpServer.Status()
		if st.Running {
			if err := a.mcpServer.Restart(ctx); err != nil {
				slog.Warn("mcp restart after token regen failed", "error", err)
			}
		}
	}
	return tok, nil
}

// RevealMCPToken 평문 토큰을 1회 반환한다 — UI 의 "토큰 복사" 버튼에서만 호출.
// 토큰이 아직 없으면 자동 발급.
func (a *App) RevealMCPToken(_ context.Context) (string, error) {
	if a.mcpConfigStore == nil {
		return "", fmt.Errorf("MCP not initialized")
	}
	return a.mcpConfigStore.GetOrCreateToken()
}

// GetMCPClientConfigSnippet 클라이언트(Claude Code / Cursor) 용 JSON 설정 조각.
// UI 의 "복사" 버튼이 이를 받아 사용자 클립보드에 넣는다.
func (a *App) GetMCPClientConfigSnippet(_ context.Context, client string) (string, error) {
	if a.mcpServer == nil {
		return "", fmt.Errorf("MCP not initialized")
	}
	st := a.mcpServer.Status()
	if !st.Running {
		return "", fmt.Errorf("MCP server is not running — start it first")
	}
	tok, err := a.mcpConfigStore.GetOrCreateToken()
	if err != nil {
		return "", err
	}

	switch strings.ToLower(client) {
	case "claude-code", "claude":
		// Claude Code 의 mcp.json 형식
		return fmt.Sprintf(`{
  "mcpServers": {
    "orcasql": {
      "type": "http",
      "url": "%s",
      "headers": {
        "Authorization": "Bearer %s"
      }
    }
  }
}`, st.Endpoint, tok), nil
	case "cursor":
		// Cursor 의 mcp.json 형식 (현재는 Claude Code 와 동일)
		return fmt.Sprintf(`{
  "mcpServers": {
    "orcasql": {
      "url": "%s",
      "headers": {
        "Authorization": "Bearer %s"
      }
    }
  }
}`, st.Endpoint, tok), nil
	default:
		return "", fmt.Errorf("unknown client: %q (supported: claude-code, cursor)", client)
	}
}

// TestMCPConnection 로컬 MCP 엔드포인트에 initialize 요청을 보내 응답을 검증한다.
// 사용자가 환경설정에서 한 번 클릭해 활성화 직후 동작 여부를 빠르게 확인하는 용도.
//
// 검증 항목 (모두 통과 시 Success=true):
//   1. 서버가 running 상태
//   2. 키체인 토큰으로 인증 통과
//   3. Streamable HTTP transport 가 200 + 유효 JSON-RPC 응답 반환
func (a *App) TestMCPConnection(ctx context.Context) (TestMCPResult, error) {
	if a.mcpServer == nil || a.mcpConfigStore == nil {
		return TestMCPResult{}, fmt.Errorf("MCP not initialized")
	}
	st := a.mcpServer.Status()
	if !st.Running {
		return TestMCPResult{Success: false, Message: "server not running"}, nil
	}
	tok, err := a.mcpConfigStore.GetOrCreateToken()
	if err != nil {
		return TestMCPResult{Success: false, Message: fmt.Sprintf("token: %v", err)}, nil
	}

	body := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"orcasql-self-test","version":"0"}}}`
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(probeCtx, http.MethodPost, st.Endpoint, strings.NewReader(body))
	if err != nil {
		return TestMCPResult{Success: false, Message: err.Error()}, nil
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")

	start := time.Now()
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return TestMCPResult{Success: false, Message: err.Error()}, nil
	}
	defer resp.Body.Close()
	durationMs := time.Since(start).Milliseconds()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return TestMCPResult{
			Success: false,
			Message: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b))),
		}, nil
	}

	// 응답이 JSON-RPC 결과인지 가볍게 확인 — full validation 은 mcp-go 가 처리하므로 여기선 형식만.
	var probe struct {
		JSONRPC string         `json:"jsonrpc"`
		Result  map[string]any `json:"result"`
		Error   any            `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&probe); err != nil {
		return TestMCPResult{
			Success: false,
			Message: fmt.Sprintf("invalid response: %v", err),
		}, nil
	}
	if probe.Error != nil {
		return TestMCPResult{
			Success: false,
			Message: fmt.Sprintf("server returned error: %v", probe.Error),
		}, nil
	}
	if probe.JSONRPC != "2.0" || probe.Result == nil {
		return TestMCPResult{Success: false, Message: "malformed JSON-RPC response"}, nil
	}

	return TestMCPResult{
		Success:    true,
		DurationMs: durationMs,
		Endpoint:   st.Endpoint,
	}, nil
}

// CheckMCPPortAvailable 지정 포트가 즉시 listen 가능한지 빠르게 확인한다.
// 활성화 토글 / 포트 변경 직전에 호출해 사용자에게 미리 경고하는 용도.
//
// 주의: 우리 서버가 이미 그 포트에서 돌고 있어도 false 반환 — 호출자(프론트)는
// GetMCPStatus 와 비교해 본인 서버인지 구분해야 한다.
func (a *App) CheckMCPPortAvailable(_ context.Context, port int) (bool, error) {
	if port < 1024 || port > 65535 {
		return false, fmt.Errorf("port out of range: %d", port)
	}
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return false, nil
	}
	_ = ln.Close()
	return true, nil
}

// GetMCPAIPromptSnippet 사용자가 LLM 채팅창에 붙여넣을 영문 프롬프트를 생성한다.
// BugFix-CY: MCP 가 이미 attach 됐다고 가정하지 않고, **서버 URL + Bearer 토큰을 직접 제시**해
// AI 클라이언트가 Streamable HTTP MCP transport 로 자체 연결을 수립하도록 유도한다.
// BugFix-CZ: 현재 MCP 설정(권한·포트·allowlist 정책) 및 실제로 노출되는 저장 연결 메타까지
// 본문에 포함 → AI 가 첫 도구 호출 전에 환경을 알고 의도를 조율할 수 있다.
//
// 의도적으로 영문 — Claude/Cursor 모두 영문 도구 description 과 일관되게 동작.
// 서버가 실행 중이어야 유효한 endpoint 가 노출되므로 GetMCPClientConfigSnippet 과 동일한 가드를 둔다.
func (a *App) GetMCPAIPromptSnippet(ctx context.Context) (string, error) {
	if a.mcpServer == nil || a.mcpConfigStore == nil {
		return "", fmt.Errorf("MCP not initialized")
	}
	st := a.mcpServer.Status()
	if !st.Running {
		return "", fmt.Errorf("MCP server is not running — start it first")
	}
	cfg, err := a.mcpConfigStore.Load()
	if err != nil {
		return "", fmt.Errorf("load mcp config: %w", err)
	}
	tok, err := a.mcpConfigStore.GetOrCreateToken()
	if err != nil {
		return "", err
	}

	var permissions string
	switch {
	case cfg.AllowDDL:
		permissions = "Read, write (INSERT/UPDATE/DELETE), AND DDL (CREATE/ALTER/DROP/TRUNCATE) are all permitted."
	case cfg.AllowWrite:
		permissions = "Read and write (INSERT/UPDATE/DELETE) are permitted. DDL (CREATE/ALTER/DROP/TRUNCATE) is blocked."
	default:
		permissions = "Read-only mode — only SELECT/SHOW/EXPLAIN are permitted. Any INSERT/UPDATE/DELETE/DDL will be rejected."
	}

	// BugFix-CZ: allowlist 정책 + 노출되는 저장 연결 메타 (이름·host:port·기본 DB) 를 함께 노출.
	// GetSavedConnections 는 평문 비밀번호를 반환하지 않으므로 안전(원본 파일에 평문이 남아 있어도 방어적으로 비움).
	rawSaved, sErr := a.GetSavedConnections(ctx)
	if sErr != nil {
		// 저장 연결 로드 실패는 치명적이지 않음 — 프롬프트 자체는 권한·URL·토큰 만으로도 유효.
		slog.Warn("ai prompt: load saved connections failed", "error", sErr)
		rawSaved = nil
	}
	saved := make([]ConnectConfigForPrompt, 0, len(rawSaved))
	for _, c := range rawSaved {
		saved = append(saved, ConnectConfigForPrompt{
			ID: c.ID, Name: c.Name, Host: c.Host, Port: c.Port, Database: c.Database,
		})
	}
	allowlist := formatAllowlistSection(cfg, saved)

	return fmt.Sprintf(`Please connect to my local MCP server "orcasql" and use it to explore my MySQL databases through OrcaSQL (a local MySQL GUI).

Connection details (Streamable HTTP MCP transport):
- Server URL: %s
- Authorization header: Bearer %s

If your client supports adding MCP servers at runtime, register it as:
{
  "mcpServers": {
    "orcasql": {
      "type": "http",
      "url": "%s",
      "headers": { "Authorization": "Bearer %s" }
    }
  }
}

Once connected, the server exposes these tools:
- list_connections — list MySQL connections allowlisted to MCP (id, name, host, default database, active flag)
- list_databases — list databases on a connection (args: connID)
- list_tables — list tables/views in a database with row count and size (args: connID, database)
- describe_table — return columns, indexes, and CREATE TABLE DDL (args: connID, database, table)
- execute_query — run a single SQL statement and return rows + metadata (args: connID, sql; optional: database)

Current server settings (snapshot at copy time — may change later if I edit policy in OrcaSQL):
- Endpoint port: %d
- Permission policy: %s
%s

After the transport is established, please bootstrap the session before asking me anything:
1. Call list_connections to discover available connections (this will reflect any policy changes I made after copying this prompt). If a connection is not active, ask me to open it in OrcaSQL UI first.
2. For the most relevant active connection, call list_databases.
3. Optionally call list_tables on a likely database to get a quick overview.
4. Give me a one-paragraph summary of what you found (connection name, database list, notable tables) and ask what I'd like to explore or query.

Rules:
- Always send the Authorization header above on every MCP request — the server returns 401 without it.
- Always use the connID returned by list_connections — never invent or guess one.
- Prefer narrow read-only inspection (SHOW, DESCRIBE, SELECT with LIMIT) when exploring.
- Never run write or DDL statements unless I explicitly ask, even if the policy allows them.
- Surface any tool errors verbatim so I can correct policy/allowlist if needed.`,
		st.Endpoint, tok, st.Endpoint, tok, st.Port, permissions, allowlist), nil
}

// formatAllowlistSection 현재 allowlist 정책을 프롬프트에 박을 한 문단으로 직렬화한다.
// BugFix-CZ: 별도 함수 → 테스트 가능 + Saved 메타 빈 케이스/와일드카드/정확 화이트리스트 분기를 한 곳에 집중.
func formatAllowlistSection(cfg mcppkg.Config, saved []ConnectConfigForPrompt) string {
	// 와일드카드 매칭 우선 검사 — IsConnAllowed 도 같은 로직.
	wildcard := false
	for _, id := range cfg.AllowedConnIDs {
		if id == mcppkg.AllowAllConnections {
			wildcard = true
			break
		}
	}

	switch {
	case len(cfg.AllowedConnIDs) == 0:
		return "- Allowlist: empty — no MySQL connections are exposed yet. Ask me to allowlist a connection in OrcaSQL → Settings → MCP before using tools."
	case wildcard:
		if len(saved) == 0 {
			return "- Allowlist: ALL saved connections are exposed via wildcard (\"*\"), but I currently have no saved connections in OrcaSQL."
		}
		return "- Allowlist: ALL saved connections are exposed via wildcard (\"*\"). Visible connections:\n" + bulletConnections(saved)
	default:
		// 명시 화이트리스트 — saved 메타와 매칭해 사용 가능한 이름까지 노출.
		visible := filterAllowedConnections(cfg.AllowedConnIDs, saved)
		if len(visible) == 0 {
			return fmt.Sprintf("- Allowlist: %d explicit connection ID(s) configured but none match a currently saved connection — ask me to fix the allowlist in OrcaSQL.", len(cfg.AllowedConnIDs))
		}
		return fmt.Sprintf("- Allowlist: %d explicit connection(s) exposed:\n", len(visible)) + bulletConnections(visible)
	}
}

// ConnectConfigForPrompt 프롬프트 직렬화용 saved connection 의 최소 메타.
// 비밀번호·SSH 키·프록시 정보는 의도적으로 포함하지 않는다.
type ConnectConfigForPrompt struct {
	ID       string
	Name     string
	Host     string
	Port     int
	Database string
}

// filterAllowedConnections AllowedConnIDs 와 saved 의 교집합 → name/host 메타와 함께 반환.
func filterAllowedConnections(allowedIDs []string, saved []ConnectConfigForPrompt) []ConnectConfigForPrompt {
	idx := make(map[string]ConnectConfigForPrompt, len(saved))
	for _, c := range saved {
		idx[c.ID] = c
	}
	out := make([]ConnectConfigForPrompt, 0, len(allowedIDs))
	for _, id := range allowedIDs {
		if id == mcppkg.AllowAllConnections {
			continue
		}
		if c, ok := idx[id]; ok {
			out = append(out, c)
		}
	}
	return out
}

// bulletConnections saved connection 목록을 줄바꿈 분리 bullet 으로 렌더.
func bulletConnections(saved []ConnectConfigForPrompt) string {
	var sb strings.Builder
	for _, c := range saved {
		db := c.Database
		if db == "" {
			db = "(no default DB)"
		}
		sb.WriteString(fmt.Sprintf("  - %s (id=%s) → %s:%d / %s\n", c.Name, c.ID, c.Host, c.Port, db))
	}
	// 마지막 개행 제거
	return strings.TrimRight(sb.String(), "\n")
}
