package mcp

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	gokeyring "github.com/zalando/go-keyring"

	"orcasql/internal/keychain"
	"orcasql/internal/query"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// 핵심 PoC 단위 테스트 — 라이브 서버 띄우기는 manual curl 시나리오로 검증.
// 여기선 격리하기 쉬운 순수 로직 (Config, Policy, auth helpers) 만 검사한다.

func TestConfigDefault(t *testing.T) {
	c := DefaultConfig()
	if c.Enabled {
		t.Error("default Enabled should be false")
	}
	if c.Port != DefaultPort {
		t.Errorf("default Port = %d, want %d", c.Port, DefaultPort)
	}
	if c.AllowWrite || c.AllowDDL {
		t.Error("default permissions must be read-only")
	}
	if len(c.AllowedConnIDs) != 0 {
		t.Error("default AllowedConnIDs must be empty (deny-by-default)")
	}
}

func TestIsConnAllowed(t *testing.T) {
	tests := []struct {
		name    string
		allowed []string
		conn    string
		want    bool
	}{
		{"empty list denies all", []string{}, "abc", false},
		{"wildcard allows any", []string{AllowAllConnections}, "anything", true},
		{"exact match allows", []string{"abc", "def"}, "abc", true},
		{"non-match denies", []string{"abc"}, "xyz", false},
		{"wildcard among list", []string{"abc", "*"}, "xyz", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := Config{AllowedConnIDs: tt.allowed}
			if got := c.IsConnAllowed(tt.conn); got != tt.want {
				t.Errorf("IsConnAllowed(%q) = %v, want %v", tt.conn, got, tt.want)
			}
		})
	}
}

func TestConfigStoreRoundtrip(t *testing.T) {
	dir := t.TempDir()
	store := NewConfigStore(filepath.Join(dir, "mcp.json"), nil)

	// 처음엔 파일 없음 → DefaultConfig
	got, err := store.Load()
	if err != nil {
		t.Fatalf("first load: %v", err)
	}
	if got.Enabled {
		t.Errorf("fresh load should be default (disabled)")
	}

	// 저장 후 다시 로드
	want := DefaultConfig()
	want.Enabled = true
	want.Port = 9999
	want.AllowWrite = true
	want.AllowedConnIDs = []string{"a", "b"}
	if err := store.Save(want); err != nil {
		t.Fatalf("save: %v", err)
	}
	got, err = store.Load()
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got.Enabled != want.Enabled || got.Port != want.Port ||
		got.AllowWrite != want.AllowWrite || len(got.AllowedConnIDs) != 2 {
		t.Errorf("roundtrip mismatch: got %+v want %+v", got, want)
	}
}

func TestConfigStoreSaveRejectsBadPort(t *testing.T) {
	store := NewConfigStore(filepath.Join(t.TempDir(), "mcp.json"), nil)
	for _, p := range []int{0, 80, 65536, 100000} {
		c := DefaultConfig()
		c.Port = p
		if err := store.Save(c); err == nil {
			t.Errorf("port %d should be rejected", p)
		}
	}
}

func TestCheckExecutePolicy(t *testing.T) {
	tests := []struct {
		name    string
		cfg     Config
		sql     string
		wantErr bool
	}{
		{"select always ok", Config{}, "SELECT 1", false},
		{"show always ok", Config{}, "SHOW DATABASES", false},
		{"explain always ok", Config{}, "EXPLAIN SELECT 1", false},
		{"insert blocked default", Config{}, "INSERT INTO t VALUES (1)", true},
		{"insert ok with write", Config{AllowWrite: true}, "INSERT INTO t VALUES (1)", false},
		{"update blocked default", Config{}, "UPDATE t SET x=1", true},
		{"update ok with write", Config{AllowWrite: true}, "UPDATE t SET x=1", false},
		{"delete blocked default", Config{}, "DELETE FROM t", true},
		{"ddl blocked even with write", Config{AllowWrite: true}, "DROP TABLE t", true},
		{"ddl ok with ddl flag", Config{AllowDDL: true}, "DROP TABLE t", false},
		{"create ok with ddl", Config{AllowDDL: true}, "CREATE TABLE t (id INT)", false},
		{"alter ok with ddl", Config{AllowDDL: true}, "ALTER TABLE t ADD COLUMN x INT", false},
		{"truncate ok with ddl", Config{AllowDDL: true}, "TRUNCATE TABLE t", false},
		{"cte select ok", Config{}, "WITH x AS (SELECT 1) SELECT * FROM x", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := CheckExecutePolicy(tt.cfg, tt.sql)
			if (err != nil) != tt.wantErr {
				t.Errorf("CheckExecutePolicy(%q) err=%v, wantErr=%v (qt=%d)",
					tt.sql, err, tt.wantErr, query.DetectQueryType(tt.sql))
			}
		})
	}
}

func TestExtractBearer(t *testing.T) {
	tests := []struct {
		header string
		want   string
	}{
		{"", ""},
		{"Bearer ", ""},
		{"Bearer abc123", "abc123"},
		{"bearer abc123", "abc123"},
		{"BEARER  abc123 ", "abc123"},
		{"Token abc", ""},
		{"abc123", ""},
	}
	for _, tt := range tests {
		t.Run(tt.header, func(t *testing.T) {
			if got := extractBearer(tt.header); got != tt.want {
				t.Errorf("extractBearer(%q) = %q, want %q", tt.header, got, tt.want)
			}
		})
	}
}

func TestCheckOrigin(t *testing.T) {
	tests := []struct {
		origin string
		want   bool
	}{
		{"", true}, // no Origin → allow (curl/CLI)
		{"http://localhost", true},
		{"http://localhost:3000", true},
		{"http://127.0.0.1:7878", true},
		{"http://[::1]:8080", true},
		{"http://evil.com", false},
		{"https://example.org", false},
		{"http://192.168.1.5", false},
		{"not a url://", false},
	}
	for _, tt := range tests {
		t.Run(tt.origin, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/mcp", strings.NewReader(""))
			if tt.origin != "" {
				r.Header.Set("Origin", tt.origin)
			}
			if got := checkOrigin(r); got != tt.want {
				t.Errorf("checkOrigin(%q) = %v, want %v", tt.origin, got, tt.want)
			}
		})
	}
}

func TestAuthMiddlewareRejects(t *testing.T) {
	srv := &Server{logger: discardLogger()}
	srv.token.Store("secret-token")

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	h := srv.authMiddleware(next)

	cases := []struct {
		name       string
		auth       string
		origin     string
		wantStatus int
		wantCalled bool
	}{
		{"missing auth", "", "", http.StatusUnauthorized, false},
		{"wrong token", "Bearer nope", "", http.StatusUnauthorized, false},
		{"correct token, no origin", "Bearer secret-token", "", http.StatusOK, true},
		{"correct token, good origin", "Bearer secret-token", "http://localhost", http.StatusOK, true},
		{"correct token, bad origin", "Bearer secret-token", "http://evil.com", http.StatusForbidden, false},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			called = false
			r := httptest.NewRequest("POST", "/mcp", strings.NewReader("{}"))
			if tt.auth != "" {
				r.Header.Set("Authorization", tt.auth)
			}
			if tt.origin != "" {
				r.Header.Set("Origin", tt.origin)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}
			if called != tt.wantCalled {
				t.Errorf("next called = %v, want %v", called, tt.wantCalled)
			}
		})
	}
}

// TestConfigStoreDeleteToken — Reset 흐름이 MCP 토큰을 키체인에서 제거하는지 검증.
// Phase 43 보완: ResetAllUserData 가 connID 별 3개 서비스만 청소하던 시점에는
// orcasql-mcp/token 이 잔존하던 결함을 회귀 방지.
func TestConfigStoreDeleteToken(t *testing.T) {
	gokeyring.MockInit()
	store := NewConfigStore("", keychain.NewStore())

	// 초기엔 토큰 없음 → GetOrCreateToken 이 발급해야 함
	tok1, err := store.GetOrCreateToken()
	if err != nil {
		t.Fatalf("first get: %v", err)
	}
	if len(tok1) != 64 {
		t.Errorf("token length = %d, want 64 (hex of 32 bytes)", len(tok1))
	}

	// 같은 호출 다시 → 동일 토큰 (idempotent)
	tok2, err := store.GetOrCreateToken()
	if err != nil {
		t.Fatalf("second get: %v", err)
	}
	if tok1 != tok2 {
		t.Errorf("idempotency broken: %q vs %q", tok1, tok2)
	}

	// Delete 후 다시 GetOrCreateToken → 새로 발급되어야 함
	if err := store.DeleteToken(); err != nil {
		t.Fatalf("delete: %v", err)
	}
	tok3, err := store.GetOrCreateToken()
	if err != nil {
		t.Fatalf("post-delete get: %v", err)
	}
	if tok3 == tok1 {
		t.Error("post-delete token should differ from pre-delete")
	}

	// 두 번 Delete 호출해도 에러 없음 (idempotent — 키체인 ErrNotFound 흡수 검증)
	if err := store.DeleteToken(); err != nil {
		t.Errorf("second delete should be idempotent, got: %v", err)
	}
	if err := store.DeleteToken(); err != nil {
		t.Errorf("third delete should be idempotent, got: %v", err)
	}
}

// TestConfigStoreModify — atomic load+save 헬퍼 동작 검증.
// DeleteConnection 등에서 allowlist 정리 시 사용된다 (Phase 43 보완).
func TestConfigStoreModify(t *testing.T) {
	dir := t.TempDir()
	store := NewConfigStore(filepath.Join(dir, "mcp.json"), nil)

	// 초기 설정 저장 — allowlist 에 두 ID
	if err := store.Save(Config{Port: 7878, AllowedConnIDs: []string{"a", "b"}}); err != nil {
		t.Fatalf("seed save: %v", err)
	}

	// "a" 제거 — Modify 가 true 반환해야 함
	changed, err := store.Modify(func(c *Config) bool {
		next := c.AllowedConnIDs[:0:0]
		removed := false
		for _, id := range c.AllowedConnIDs {
			if id == "a" {
				removed = true
				continue
			}
			next = append(next, id)
		}
		if !removed {
			return false
		}
		c.AllowedConnIDs = next
		return true
	})
	if err != nil {
		t.Fatalf("modify: %v", err)
	}
	if !changed {
		t.Error("changed should be true when ID was removed")
	}

	got, err := store.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(got.AllowedConnIDs) != 1 || got.AllowedConnIDs[0] != "b" {
		t.Errorf("AllowedConnIDs = %v, want [b]", got.AllowedConnIDs)
	}

	// 존재하지 않는 ID 제거 시도 → false 반환, 디스크 쓰기 X
	changed, err = store.Modify(func(c *Config) bool {
		for _, id := range c.AllowedConnIDs {
			if id == "nonexistent" {
				return true
			}
		}
		return false
	})
	if err != nil {
		t.Fatalf("modify (no-op): %v", err)
	}
	if changed {
		t.Error("changed should be false when nothing matched")
	}

	// 검증 실패 시나리오 — Modify 안에서 잘못된 port 로 변경 시도 → 에러
	_, err = store.Modify(func(c *Config) bool {
		c.Port = 80 // 1024 미만
		return true
	})
	if err == nil {
		t.Error("Modify should reject invalid port")
	}
	// 검증 실패 후에도 디스크는 변경 전 상태 유지
	got, _ = store.Load()
	if got.Port != 7878 {
		t.Errorf("Port should remain 7878 after rejected modify, got %d", got.Port)
	}
}

func TestGenerateTokenUnique(t *testing.T) {
	a, err := generateToken()
	if err != nil {
		t.Fatal(err)
	}
	b, err := generateToken()
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Error("two generated tokens should differ")
	}
	if len(a) != 64 {
		t.Errorf("token length = %d, want 64 (32 bytes hex)", len(a))
	}
}
