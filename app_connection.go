package main

// ─── 연결 관리 ─────────────────────────────────────────────────────────────
//
// MySQL/SSH/Proxy 연결 수립·해제·재연결·테스트 + connections.json 영속화.
// 비밀번호 3종(DB/SSH/Proxy) 은 OS 키체인에만 저장, 파일에는 빈 문자열.

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"orcasql/internal/connection"
	"orcasql/internal/keychain"
	mcppkg "orcasql/internal/mcp"
)

// TestConnResult 연결 테스트 결과.
// 에러 종류를 프론트엔드가 판단할 수 있도록 ErrorKind를 분리해 반환한다.
type TestConnResult struct {
	OK        bool   `json:"ok"`
	ServerVer string `json:"serverVer"` // 성공 시 MySQL 버전 문자열
	ErrorKind string `json:"errorKind"` // "host" | "auth" | "database" | "ssh" | "proxy" | "tls" | "other"
	Message   string `json:"message"`   // 원본 에러 메시지 (표시용)
}

// Connect MySQL 서버에 연결하고 connID를 반환한다.
func (a *App) Connect(ctx context.Context, cfg connection.ConnectConfig) (string, error) {
	connID, err := a.connManager.Connect(ctx, cfg)
	if err != nil {
		return "", fmt.Errorf("connect failed: %w", err)
	}
	slog.Info("connected", "connID", connID, "host", cfg.Host)
	return connID, nil
}

// ConnectNew Connect 와 동일하지만 cfg.ID 와 무관하게 항상 새 runtime connID 를 발급한다.
// 같은 저장된 연결을 여러 탭에서 동시에 열 때(BugFix-BA: 신규 연결 = 새 탭) 사용한다.
//
// BugFix-DA: cfg.ID 를 클리어하지 않고 그대로 `ConnectAsNewSession` 에 넘긴다.
// manager 가 cfg.ID 를 영구 cfgId 로 해석해 `info.CfgID` 에 보존 → MCP 의 active 마킹/
// allowlist 매칭이 정상 동작한다. 키체인 비밀번호 복원은 manager.Connect 가 cfg.ID 로 처리.
func (a *App) ConnectNew(ctx context.Context, cfg connection.ConnectConfig) (string, error) {
	origID := cfg.ID
	connID, err := a.connManager.ConnectAsNewSession(ctx, cfg)
	if err != nil {
		return "", fmt.Errorf("connect failed: %w", err)
	}
	slog.Info("connected (new tab)", "connID", connID, "cfgId", origID, "host", cfg.Host)
	return connID, nil
}

// Disconnect 연결을 해제한다.
func (a *App) Disconnect(ctx context.Context, connID string) error {
	if err := a.connManager.Disconnect(connID); err != nil {
		return fmt.Errorf("disconnect failed: %w", err)
	}
	return nil
}

// ListConnections 현재 활성 연결 목록을 반환한다.
func (a *App) ListConnections(ctx context.Context) ([]connection.ConnectionInfo, error) {
	return a.connManager.ListConnections(), nil
}

// Ping 연결이 살아있는지 확인한다.
func (a *App) Ping(ctx context.Context, connID string) error {
	return a.connManager.Ping(ctx, connID)
}

// PingWithLatency Ping을 수행하고 지연 시간(ms)을 반환한다.
// StatusBar의 연결 상태 표시에 사용한다.
func (a *App) PingWithLatency(ctx context.Context, connID string) (int64, error) {
	return a.connManager.PingWithLatency(ctx, connID)
}

// Reconnect 기존 연결을 끊고 저장된 설정으로 재연결한다.
// MySQL 8h wait_timeout 등으로 연결이 끊겼을 때 UI에서 호출한다.
func (a *App) Reconnect(ctx context.Context, connID string) error {
	if err := a.connManager.Reconnect(ctx, connID); err != nil {
		return err
	}
	slog.Info("connection reconnected via UI", "connID", connID)
	return nil
}

// TestConnection 저장하지 않고 연결 설정을 즉시 테스트한다.
// 에러 종류(호스트 불가/인증 실패/DB 없음/SSH 오류)를 구분해 반환한다.
func (a *App) TestConnection(ctx context.Context, cfg connection.ConnectConfig) TestConnResult {
	// 임시 연결 시도 (connManager에 등록하지 않음)
	testID, err := a.connManager.Connect(ctx, cfg)
	if err != nil {
		return TestConnResult{
			OK:        false,
			ErrorKind: classifyConnError(err.Error()),
			Message:   err.Error(),
		}
	}
	// 연결 성공 → 버전 조회 후 즉시 해제
	defer func() {
		_ = a.connManager.Disconnect(testID)
	}()

	db, dbErr := a.connManager.GetDB(testID)
	if dbErr != nil {
		return TestConnResult{OK: true, ServerVer: "unknown"}
	}
	var ver string
	if scanErr := db.QueryRowContext(ctx, "SELECT VERSION()").Scan(&ver); scanErr != nil {
		ver = "unknown"
	}
	return TestConnResult{OK: true, ServerVer: ver}
}

// classifyConnError MySQL/SSH 에러 메시지를 분석해 에러 종류를 반환한다.
func classifyConnError(msg string) string {
	lower := strings.ToLower(msg)
	switch {
	case strings.Contains(lower, "ssh"):
		return "ssh"
	case strings.Contains(lower, "socks5") || strings.Contains(lower, "proxy"):
		return "proxy"
	case strings.Contains(lower, "tls") || strings.Contains(lower, "certificate"):
		return "tls"
	// MySQL 에러 코드별 분류
	case strings.Contains(lower, "access denied"):
		return "auth" // 1045: Access denied (잘못된 사용자/비밀번호)
	case strings.Contains(lower, "unknown database"):
		return "database" // 1049: Unknown database
	case strings.Contains(lower, "no such host") ||
		strings.Contains(lower, "connection refused") ||
		strings.Contains(lower, "connection timed out") ||
		strings.Contains(lower, "i/o timeout") ||
		strings.Contains(lower, "network unreachable"):
		return "host"
	default:
		return "other"
	}
}

// ─── 연결 설정 저장/불러오기 ──────────────────────────────────────────────

// SaveConnection 연결 설정을 로컬 파일 + 비밀번호는 OS 키체인에 저장한다.
// MySQL / SSH / Proxy 세 가지 비밀번호 모두 키체인으로 분리되며, 파일에는 빈 문자열만 남는다.
// 빈 비밀번호로 들어온 필드는 키체인을 덮어쓰지 않는다 — 편집 UX 상 사용자가 기존 값을 유지할 수 있게 하기 위함.
func (a *App) SaveConnection(ctx context.Context, cfg connection.ConnectConfig) error {
	// MySQL 비밀번호 → 키체인
	if cfg.Password != "" {
		if err := a.keychainSvc.SaveCredential(keychain.ServiceDB, cfg.ID, cfg.Password); err != nil {
			return fmt.Errorf("keychain save db: %w", err)
		}
		cfg.Password = "" // 파일에 평문 저장 금지
	}
	// SSH 비밀번호 → 키체인
	if cfg.SSHPassword != "" {
		if err := a.keychainSvc.SaveCredential(keychain.ServiceSSH, cfg.ID, cfg.SSHPassword); err != nil {
			return fmt.Errorf("keychain save ssh: %w", err)
		}
		cfg.SSHPassword = ""
	}
	// Proxy 비밀번호 → 키체인
	if cfg.ProxyPassword != "" {
		if err := a.keychainSvc.SaveCredential(keychain.ServiceProxy, cfg.ID, cfg.ProxyPassword); err != nil {
			return fmt.Errorf("keychain save proxy: %w", err)
		}
		cfg.ProxyPassword = ""
	}

	// lock 안에서 read-modify-write → 다중 인스턴스 동시 저장 시 데이터 손실 방지
	return a.modifyAppConfig(func(appCfg *appConfig) error {
		found := false
		for i, c := range appCfg.Connections {
			if c.ID == cfg.ID {
				appCfg.Connections[i] = cfg
				found = true
				break
			}
		}
		if !found {
			appCfg.Connections = append(appCfg.Connections, cfg)
		}
		return nil
	})
}

// UpdateConnectionLastUsed 연결의 마지막 사용 시각을 현재 시각으로 업데이트한다.
func (a *App) UpdateConnectionLastUsed(ctx context.Context, connID string) error {
	return a.modifyAppConfig(func(cfg *appConfig) error {
		for i, c := range cfg.Connections {
			if c.ID == connID {
				cfg.Connections[i].LastUsed = time.Now()
				return nil
			}
		}
		return nil
	})
}

// DeleteConnection 연결 설정을 삭제한다 (키체인 + MCP allowlist 포함).
// MySQL / SSH / Proxy 세 키체인 엔트리 모두 제거하고, MCP allowlist 에 남은
// 죽은 connID 도 정리한다 (Phase 43 보완).
//
// MCP 정리는 best-effort: 실패해도 본 삭제 결과에 영향 X. 현재 실행 중인 서버의
// in-memory 정책 스냅샷은 그대로 — 다음 Restart 시점에 디스크에서 새로 로드.
// 살아있는 호출 흐름엔 영향 없음 (assertConnAllowedAndActive 가 어차피 거부).
func (a *App) DeleteConnection(ctx context.Context, connID string) error {
	_ = a.keychainSvc.DeleteCredential(keychain.ServiceDB, connID)
	_ = a.keychainSvc.DeleteCredential(keychain.ServiceSSH, connID)
	_ = a.keychainSvc.DeleteCredential(keychain.ServiceProxy, connID)

	// MCP allowlist 정리 — 디스크에 남은 죽은 ID 제거.
	if a.mcpConfigStore != nil && connID != "" {
		_, err := a.mcpConfigStore.Modify(func(cfg *mcppkg.Config) bool {
			next := cfg.AllowedConnIDs[:0:0]
			removed := false
			for _, id := range cfg.AllowedConnIDs {
				if id == connID {
					removed = true
					continue
				}
				next = append(next, id)
			}
			if !removed {
				return false
			}
			cfg.AllowedConnIDs = next
			return true
		})
		if err != nil {
			slog.Warn("delete connection: mcp allowlist cleanup failed", "connID", connID, "error", err)
		}
	}

	return a.modifyAppConfig(func(cfg *appConfig) error {
		filtered := make([]connection.ConnectConfig, 0, len(cfg.Connections))
		for _, c := range cfg.Connections {
			if c.ID != connID {
				filtered = append(filtered, c)
			}
		}
		cfg.Connections = filtered
		return nil
	})
}

// GetSavedConnections 저장된 연결 설정 목록을 반환한다 (비밀번호 제외).
// 파일에는 이미 빈 값이어야 하지만, 혹시 마이그레이션 미수행이나 외부 편집으로
// 평문이 남아있을 경우에도 프론트로 반출되지 않도록 방어적으로 비운다.
func (a *App) GetSavedConnections(ctx context.Context) ([]connection.ConnectConfig, error) {
	configs, err := a.loadConfigFile()
	if err != nil {
		return []connection.ConnectConfig{}, nil
	}
	if configs == nil {
		return []connection.ConnectConfig{}, nil
	}
	for i := range configs {
		configs[i].Password = ""
		configs[i].SSHPassword = ""
		configs[i].ProxyPassword = ""
	}
	return configs, nil
}

// GetConnectionWithCredential 저장된 연결 1건을 ID 로 조회해 반환한다.
// 세션 복원의 자동 재연결 흐름이 호출 — frontend 가 받은 cfg 를 그대로 Connect 에 넘기면
// Connect 가 keychain 에서 비밀번호를 자동 복원한다 (평문은 JS 에 절대 노출 안 됨).
//
// 미존재 ID 는 명시적 에러로 반환 — caller (App.tsx 자동 재연결) 가 try/catch 로 흡수.
func (a *App) GetConnectionWithCredential(_ context.Context, connID string) (connection.ConnectConfig, error) {
	configs, err := a.loadConfigFile()
	if err != nil {
		return connection.ConnectConfig{}, fmt.Errorf("load config: %w", err)
	}
	for _, c := range configs {
		if c.ID == connID {
			// 방어적 strip — 외부 편집 / 마이그레이션 미수행으로 평문이 남아있을 가능성 차단.
			c.Password = ""
			c.SSHPassword = ""
			c.ProxyPassword = ""
			return c, nil
		}
	}
	return connection.ConnectConfig{}, fmt.Errorf("connection not found: %s", connID)
}

// ─── SSH known_hosts 관리 ──────────────────────────────────────────────────

// ListKnownHosts ~/.orcasql/known_hosts의 모든 항목을 반환한다.
func (a *App) ListKnownHosts(ctx context.Context) ([]connection.KnownHostEntry, error) {
	return connection.ListKnownHosts()
}

// DeleteKnownHost ~/.orcasql/known_hosts에서 특정 라인을 삭제한다.
func (a *App) DeleteKnownHost(ctx context.Context, line string) error {
	return connection.DeleteKnownHost(line)
}
