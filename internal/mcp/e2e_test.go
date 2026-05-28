package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	gokeyring "github.com/zalando/go-keyring"

	"orcasql/internal/connection"
	"orcasql/internal/history"
	"orcasql/internal/keychain"
	"orcasql/internal/query"
	"orcasql/internal/schema"
)

// E2E 테스트 — 실제 HTTP 서버를 띄우고 mcp-go 핸들러까지 전 흐름을 통과시킨다.
// MySQL 은 띄우지 않으며, DB 가 필요한 도구(list_databases / execute_query SELECT 등)는
// 정책 거부 / 미활성 연결 분기로만 검증한다. 실제 SELECT 검증은 수동 curl 시나리오로 미룬다.
//
// 검증 항목:
//  1. 서버 라이프사이클 (Start → Stop) 이 EADDRINUSE 없이 동작
//  2. 토큰 누락 시 401, 잘못된 Origin 시 403
//  3. MCP initialize 핸드셰이크 통과
//  4. tools/list 가 5개 도구 모두 반환
//  5. tools/call list_connections 가 allowlist 필터링 동작
//  6. tools/call execute_query 가 read-only 정책으로 INSERT 거부 + 미활성 connID 거부
//  7. 거부된 호출도 history 에 source=mcp 로 기록됨

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("free port: %v", err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// startE2EServer 격리된 임시 keychain + ConfigStore 로 MCP 서버를 띄우고 토큰을 반환한다.
// allowedConnIDs 는 caller 가 지정 — list_connections 결과 검증에 쓰임.
func startE2EServer(t *testing.T, allowedConnIDs []string, allowWrite bool) (*Server, string, string, *history.Store, *connection.Manager) {
	t.Helper()
	gokeyring.MockInit()

	dir := t.TempDir()
	ks := keychain.NewStore()
	cm := connection.NewManager(ks)
	qe := query.NewExecutor(cm)
	si := schema.NewInspector(cm)
	hs, err := history.NewStore(filepath.Join(dir, "history"))
	if err != nil {
		t.Fatalf("history store: %v", err)
	}

	store := NewConfigStore(filepath.Join(dir, "mcp.json"), ks)

	port := freePort(t)
	if err := store.Save(Config{
		Enabled:        true,
		Port:           port,
		AllowedConnIDs: allowedConnIDs,
		AllowWrite:     allowWrite,
	}); err != nil {
		t.Fatalf("save config: %v", err)
	}

	loadSaved := func(_ context.Context) ([]connection.ConnectConfig, error) {
		// 가짜 저장 연결 — 실제 keychain 비밀번호는 없지만 list_connections 만 쓰니 무관
		return []connection.ConnectConfig{
			{ID: "conn-allowed", Name: "Test Allowed", Host: "h1", Port: 3306, User: "u", Database: "d"},
			{ID: "conn-blocked", Name: "Test Blocked", Host: "h2", Port: 3306, User: "u", Database: "d"},
		}, nil
	}

	srv, err := NewServer(Deps{
		ConnManager:          cm,
		QueryExecutor:        qe,
		SchemaInsp:           si,
		HistoryStore:         hs,
		LoadSavedConnections: loadSaved,
	}, store, discardLogger())
	if err != nil {
		t.Fatalf("new server: %v", err)
	}

	if err := srv.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}
	t.Cleanup(func() {
		_ = srv.Stop(context.Background())
	})

	tok, err := store.GetOrCreateToken()
	if err != nil {
		t.Fatalf("token: %v", err)
	}

	endpoint := fmt.Sprintf("http://127.0.0.1:%d/mcp", port)
	waitForListening(t, endpoint, tok)
	return srv, endpoint, tok, hs, cm
}

// waitForListening Start 가 비동기라 short-poll 로 listener 준비를 기다린다.
func waitForListening(t *testing.T, endpoint, token string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		req, _ := http.NewRequest("POST", endpoint, strings.NewReader("{}"))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			resp.Body.Close()
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("server did not start listening at %s", endpoint)
}

// rpc JSON-RPC 요청을 보내고 응답을 디코딩한다.
// Streamable HTTP 는 단일 응답이면 application/json, 스트림이면 SSE 로 답하므로 둘 다 처리.
func rpc(t *testing.T, endpoint, token string, payload any) map[string]any {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("POST", endpoint, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("rpc: %v", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("rpc %d: %s", resp.StatusCode, string(raw))
	}
	// SSE 응답 파싱: 첫 "data: {...}" 라인만 추출
	text := string(raw)
	if strings.HasPrefix(strings.TrimSpace(text), "event:") || strings.Contains(text, "data: {") {
		for _, line := range strings.Split(text, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "data: ") {
				text = strings.TrimPrefix(line, "data: ")
				break
			}
		}
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("decode response: %v\n--- body ---\n%s", err, string(raw))
	}
	return out
}

func initialize(t *testing.T, endpoint, token string) {
	resp := rpc(t, endpoint, token, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": "2025-06-18",
			"capabilities":    map[string]any{},
			"clientInfo":      map[string]any{"name": "e2e-test", "version": "0"},
		},
	})
	if resp["error"] != nil {
		t.Fatalf("initialize error: %v", resp["error"])
	}
}

// callTool tools/call 결과의 JSON-RPC result.structuredContent 를 반환.
// isError 가 true 면 error 메시지(텍스트)를 두 번째 반환값으로.
func callTool(t *testing.T, endpoint, token, name string, args map[string]any) (any, string) {
	t.Helper()
	resp := rpc(t, endpoint, token, map[string]any{
		"jsonrpc": "2.0",
		"id":      99,
		"method":  "tools/call",
		"params": map[string]any{
			"name":      name,
			"arguments": args,
		},
	})
	if resp["error"] != nil {
		t.Fatalf("rpc error: %v", resp["error"])
	}
	result, _ := resp["result"].(map[string]any)
	if isErr, _ := result["isError"].(bool); isErr {
		// 첫 텍스트 컨텐츠 추출
		if contents, ok := result["content"].([]any); ok && len(contents) > 0 {
			if first, ok := contents[0].(map[string]any); ok {
				if txt, _ := first["text"].(string); txt != "" {
					return nil, txt
				}
			}
		}
		return nil, "(no error text)"
	}
	return result["structuredContent"], ""
}

// ─── 실제 테스트 ─────────────────────────────────────────────────────────────

func TestE2E_ServerLifecycle(t *testing.T) {
	srv, endpoint, _, _, _ := startE2EServer(t, []string{"conn-allowed"}, false)
	st := srv.Status()
	if !st.Running {
		t.Errorf("status.Running = false after Start")
	}
	if !strings.HasSuffix(st.Endpoint, "/mcp") {
		t.Errorf("status.Endpoint malformed: %s", st.Endpoint)
	}
	_ = endpoint

	// Stop → Status 갱신 + 같은 포트 재바인딩 가능
	if err := srv.Stop(context.Background()); err != nil {
		t.Errorf("stop: %v", err)
	}
	if srv.Status().Running {
		t.Errorf("status.Running still true after Stop")
	}
}

func TestE2E_AuthFailures(t *testing.T) {
	_, endpoint, token, _, _ := startE2EServer(t, []string{"conn-allowed"}, false)

	// 토큰 없음 → 401
	resp, err := http.Post(endpoint, "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no token: got %d, want 401", resp.StatusCode)
	}

	// 잘못된 Origin → 403
	req, _ := http.NewRequest("POST", endpoint, strings.NewReader("{}"))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Origin", "http://evil.com")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("evil origin: got %d, want 403", resp.StatusCode)
	}
}

func TestE2E_ToolsList(t *testing.T) {
	_, endpoint, token, _, _ := startE2EServer(t, []string{"conn-allowed"}, false)
	initialize(t, endpoint, token)

	resp := rpc(t, endpoint, token, map[string]any{
		"jsonrpc": "2.0", "id": 2, "method": "tools/list",
	})
	if resp["error"] != nil {
		t.Fatalf("tools/list error: %v", resp["error"])
	}
	result, _ := resp["result"].(map[string]any)
	tools, _ := result["tools"].([]any)

	wantNames := map[string]bool{
		"list_connections": false,
		"list_databases":   false,
		"list_tables":      false,
		"describe_table":   false,
		"execute_query":    false,
	}
	for _, tool := range tools {
		tm, _ := tool.(map[string]any)
		name, _ := tm["name"].(string)
		if _, ok := wantNames[name]; ok {
			wantNames[name] = true
		}
	}
	for name, found := range wantNames {
		if !found {
			t.Errorf("tool %q missing from tools/list", name)
		}
	}
}

func TestE2E_ListConnectionsRespectAllowlist(t *testing.T) {
	_, endpoint, token, _, _ := startE2EServer(t, []string{"conn-allowed"}, false)
	initialize(t, endpoint, token)

	structured, errMsg := callTool(t, endpoint, token, "list_connections", nil)
	if errMsg != "" {
		t.Fatalf("list_connections error: %s", errMsg)
	}
	wrapper, _ := structured.(map[string]any)
	conns, _ := wrapper["connections"].([]any)
	if len(conns) != 1 {
		t.Fatalf("got %d connections, want 1 (allowlist filter)", len(conns))
	}
	first, _ := conns[0].(map[string]any)
	if first["id"] != "conn-allowed" {
		t.Errorf("expected conn-allowed, got %v", first["id"])
	}
	if first["active"] != false {
		t.Errorf("expected inactive (no InjectTestDB), got %v", first["active"])
	}
}

// TestE2E_ListConnectionsActiveWithNewSessionRuntimeID BugFix-DA 회귀:
// `ConnectAsNewSession` 으로 만든 활성 연결 — runtime UUID ≠ cfgId — 에서도
// list_connections 가 `active: true` 를 반환하는지 검증한다. 과거엔 active 맵을 info.ID(휘발 UUID) 로
// 키잉해서 cfgId 와 매칭이 깨지고 항상 false 로 보고했다.
func TestE2E_ListConnectionsActiveWithNewSessionRuntimeID(t *testing.T) {
	_, endpoint, token, _, cm := startE2EServer(t, []string{"conn-allowed"}, false)
	initialize(t, endpoint, token)

	// 활성 연결을 새 runtime UUID 로 등록 — cfgId="conn-allowed" 는 보존.
	db, err := openFakeDB()
	if err != nil {
		t.Fatalf("open fake db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	runtimeID := cm.InjectTestDBAsNewSession("conn-allowed", db)
	if runtimeID == "conn-allowed" {
		t.Fatal("expected runtimeID to be a fresh UUID, not cfgId")
	}

	structured, errMsg := callTool(t, endpoint, token, "list_connections", nil)
	if errMsg != "" {
		t.Fatalf("list_connections error: %s", errMsg)
	}
	wrapper, _ := structured.(map[string]any)
	conns, _ := wrapper["connections"].([]any)
	if len(conns) != 1 {
		t.Fatalf("got %d connections, want 1", len(conns))
	}
	first, _ := conns[0].(map[string]any)
	if first["id"] != "conn-allowed" {
		t.Errorf("expected cfgId 'conn-allowed', got %v", first["id"])
	}
	if first["active"] != true {
		t.Errorf("expected active=true (cfgId-based matching), got %v", first["active"])
	}

	// 후속 도구 호출도 cfgId 로 들어오면 GetDB 가 CfgID fallback 으로 정상 동작해야 한다.
	_, errMsg = callTool(t, endpoint, token, "execute_query", map[string]any{
		"connID": "conn-allowed",
		"sql":    "SELECT 1+1",
	})
	if errMsg != "" {
		t.Fatalf("execute_query via cfgId failed: %s", errMsg)
	}
}

func TestE2E_ExecuteQueryDeniedByPolicy(t *testing.T) {
	_, endpoint, token, hs, _ := startE2EServer(t, []string{"conn-allowed"}, false /*read-only*/)
	initialize(t, endpoint, token)

	_, errMsg := callTool(t, endpoint, token, "execute_query", map[string]any{
		"connID": "conn-allowed",
		"sql":    "INSERT INTO t VALUES (1)",
	})
	if !strings.Contains(errMsg, "write queries") && !strings.Contains(errMsg, "AllowWrite") {
		t.Errorf("expected write-denied error, got: %s", errMsg)
	}

	// 거부된 호출도 history 에 source=mcp 로 기록됐는지 확인
	today := time.Now().Format("2006-01-02")
	entries, err := hs.ListByDate(today)
	if err != nil {
		t.Fatalf("history list: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("expected history entry for denied call")
	}
	last := entries[0]
	if last.Source != history.SourceMCP {
		t.Errorf("source = %q, want %q", last.Source, history.SourceMCP)
	}
	if !last.HasError {
		t.Error("hasError should be true for denied call")
	}
}

func TestE2E_ExecuteQueryRejectsInactiveConn(t *testing.T) {
	_, endpoint, token, _, _ := startE2EServer(t, []string{"conn-allowed"}, true /*allowWrite*/)
	initialize(t, endpoint, token)

	_, errMsg := callTool(t, endpoint, token, "execute_query", map[string]any{
		"connID": "conn-allowed",
		"sql":    "SELECT 1",
	})
	if !strings.Contains(errMsg, "not active") && !strings.Contains(errMsg, "connection not found") {
		t.Errorf("expected inactive-conn error, got: %s", errMsg)
	}
}

func TestE2E_ExecuteQueryRejectsNonAllowlisted(t *testing.T) {
	_, endpoint, token, _, _ := startE2EServer(t, []string{"conn-allowed"}, true)
	initialize(t, endpoint, token)

	_, errMsg := callTool(t, endpoint, token, "execute_query", map[string]any{
		"connID": "conn-other",
		"sql":    "SELECT 1",
	})
	if !strings.Contains(errMsg, "not allowlisted") {
		t.Errorf("expected allowlist-denied error, got: %s", errMsg)
	}
}

// TestE2E_ExecuteQuerySelectSuccess SELECT 성공 경로 — fake driver 로 활성 연결 흉내.
// MCP HTTP → mcp-go → tool handler → query.Executor → fake *sql.DB → 결과 → JSON 응답
// 까지 전 흐름을 닫고, 히스토리에 source=mcp 가 정상 기록되는지 확인한다.
func TestE2E_ExecuteQuerySelectSuccess(t *testing.T) {
	_, endpoint, token, hs, cm := startE2EServer(t, []string{"conn-allowed"}, false)
	initialize(t, endpoint, token)

	// 활성 연결 흉내 — fake driver 로 *sql.DB 만들어 conn-allowed 키로 등록
	db, err := openFakeDB()
	if err != nil {
		t.Fatalf("open fake db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	cm.InjectTestDB("conn-allowed", db)

	structured, errMsg := callTool(t, endpoint, token, "execute_query", map[string]any{
		"connID":   "conn-allowed",
		"database": "testdb",
		"sql":      "SELECT 1+1",
	})
	if errMsg != "" {
		t.Fatalf("execute_query error: %s", errMsg)
	}
	if structured == nil {
		t.Fatal("expected structuredContent, got nil")
	}
	res, _ := structured.(map[string]any)

	// rowCount == 1 (fake driver 는 항상 단일 행 반환)
	if rc, _ := res["rowCount"].(float64); rc != 1 {
		t.Errorf("rowCount = %v, want 1", rc)
	}

	// rows[0].result == 2
	rows, _ := res["rows"].([]any)
	if len(rows) != 1 {
		t.Fatalf("rows length = %d, want 1", len(rows))
	}
	first, _ := rows[0].(map[string]any)
	if first["result"] != float64(2) { // JSON 디코딩 시 number → float64
		t.Errorf("rows[0].result = %v, want 2", first["result"])
	}

	// columns 메타데이터
	cols, _ := res["columns"].([]any)
	if len(cols) != 1 {
		t.Errorf("columns length = %d, want 1", len(cols))
	} else {
		col0, _ := cols[0].(map[string]any)
		if col0["name"] != "result" {
			t.Errorf("columns[0].name = %v, want 'result'", col0["name"])
		}
	}

	// SQL 본문 echo
	if sql, _ := res["sql"].(string); sql != "SELECT 1+1" {
		t.Errorf("sql = %q, want %q", sql, "SELECT 1+1")
	}

	// 히스토리에 source=mcp + 성공 기록
	today := time.Now().Format("2006-01-02")
	entries, err := hs.ListByDate(today)
	if err != nil {
		t.Fatalf("history list: %v", err)
	}
	var success *history.Entry
	for i := range entries {
		if !entries[i].HasError && entries[i].SQL == "SELECT 1+1" {
			success = &entries[i]
			break
		}
	}
	if success == nil {
		t.Fatal("no successful history entry found for SELECT 1+1")
	}
	if success.Source != history.SourceMCP {
		t.Errorf("history.Source = %q, want %q", success.Source, history.SourceMCP)
	}
	if success.RowCount != 1 {
		t.Errorf("history.RowCount = %d, want 1", success.RowCount)
	}
	if success.Database != "testdb" {
		t.Errorf("history.Database = %q, want testdb", success.Database)
	}
	if success.ConnName != "Test Allowed" {
		t.Errorf("history.ConnName = %q, want 'Test Allowed' (from saved config)", success.ConnName)
	}
}
