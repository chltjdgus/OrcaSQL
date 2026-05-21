// Package connection은 MySQL 연결 풀 관리 및 SSH 터널링을 담당한다.
package connection

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql" // MySQL 드라이버 등록
	"github.com/google/uuid"
	"orcasql/internal/keychain"
)

const dbTimeout = 30 * time.Second

// ConnectConfig MySQL 연결 설정.
type ConnectConfig struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Host      string   `json:"host"`
	Port      int      `json:"port"`
	User      string   `json:"user"`
	Password  string   `json:"password,omitempty"`  // 파일에 저장 시 항상 빈 문자열
	Database  string   `json:"database"`            // 기본 접속 DB (Databases[0] 자동 동기)
	Databases []string `json:"databases,omitempty"` // 즐겨찾기 DB 목록 (멀티셀렉)
	Charset   string   `json:"charset"`
	TLS       bool     `json:"tls"`

	// SSH 터널 설정
	UseSSH      bool   `json:"useSSH"`
	SSHHost     string `json:"sshHost"`
	SSHPort     int    `json:"sshPort"`
	SSHUser     string `json:"sshUser"`
	SSHKeyPath  string `json:"sshKeyPath"`
	SSHPassword string `json:"sshPassword,omitempty"` // SSH 패스워드 인증 (키 경로 없을 때 사용)

	// 프록시 설정 (Phase 6-F: SOCKS5 | HTTP CONNECT)
	UseProxy      bool   `json:"useProxy"`
	ProxyType     string `json:"proxyType"` // "socks5" | "http"
	ProxyHost     string `json:"proxyHost"`
	ProxyPort     int    `json:"proxyPort"`
	ProxyUser     string `json:"proxyUser"`
	ProxyPassword string `json:"proxyPassword,omitempty"` // 파일에 저장 시 항상 빈 문자열

	// 세션 관리 메타데이터
	GroupID   string    `json:"groupId,omitempty"`  // 소속 그룹 ID ("" = 루트)
	Color     string    `json:"color,omitempty"`    // 세션 색상 hex (e.g. "#4299e1")
	LastUsed  time.Time `json:"lastUsed,omitempty"` // 마지막 연결 시각
	SortOrder int       `json:"sortOrder"`          // 그룹 내 정렬 순서
}

// SessionGroup 세션 그룹 (폴더).
// 최대 2단계: 루트 그룹(ParentID="") → 하위 그룹(ParentID=상위ID).
type SessionGroup struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color,omitempty"`    // 그룹 색상 hex
	ParentID string `json:"parentId,omitempty"` // "" = 루트 레벨
	Order    int    `json:"order"`
}

// ConnectionInfo 활성 연결 상태 정보.
//
// ID 는 휘발 runtime 식별자(`ConnectAsNewSession` 경로에선 매번 새 UUID).
// CfgID 는 저장 연결(`connections.json`) 의 영구 ID — MCP allowlist·세션 복원 등 영구 식별이 필요한 곳에서 사용한다.
// 두 값이 같을 수도(예: legacy `Connect()` 경로, cfg.ID 가 그대로 runtime ID 로 쓰임), 다를 수도 있다(ConnectAsNewSession).
type ConnectionInfo struct {
	ID          string    `json:"id"`
	CfgID       string    `json:"cfgId,omitempty"` // BugFix-DA: 저장 연결 ID (영구). 빈 문자열 = unsaved.
	Name        string    `json:"name"`
	Host        string    `json:"host"`
	Port        int       `json:"port"`
	User        string    `json:"user"`
	Database    string    `json:"database"`
	ConnectedAt time.Time `json:"connectedAt"`
}

// connEntry 내부 연결 항목.
type connEntry struct {
	db         *sql.DB
	info       ConnectionInfo
	cfg        ConnectConfig // 재연결에 사용할 원본 설정 (cfg.ID 는 cfgId 유지)
	sshCloseFn func()        // SSH 터널 정리 함수
}

// Manager MySQL 연결 풀을 관리한다.
// 동시성 안전을 위해 sync.RWMutex로 보호된다.
type Manager struct {
	mu       sync.RWMutex
	conns    map[string]*connEntry
	keychain *keychain.Store
}

// NewManager Manager 인스턴스를 생성한다.
func NewManager(ks *keychain.Store) *Manager {
	return &Manager{
		conns:    make(map[string]*connEntry),
		keychain: ks,
	}
}

// Connect MySQL 서버에 연결하고 runtime connID 를 반환한다.
// cfg.ID 가 비어 있지 않으면 그 값을 runtime connID 로 사용한다(legacy 시맨틱 보존).
// SSH 터널이 설정된 경우 먼저 터널을 오픈한다.
func (m *Manager) Connect(ctx context.Context, cfg ConnectConfig) (string, error) {
	return m.connectImpl(ctx, cfg, false)
}

// ConnectAsNewSession MySQL 서버에 연결하되 cfg.ID 와 무관하게 항상 새 runtime UUID 를 발급한다.
// cfg.ID 는 `info.CfgID` 로 보존돼 MCP allowlist 매칭에 쓰인다(BugFix-DA).
// 한 cfgId 로 여러 탭(세션)을 동시에 여는 경로(`app.ConnectNew`) 에서 호출한다.
func (m *Manager) ConnectAsNewSession(ctx context.Context, cfg ConnectConfig) (string, error) {
	return m.connectImpl(ctx, cfg, true)
}

// connectImpl Connect / ConnectAsNewSession 의 공통 구현.
// forceNewRuntimeID=true 면 cfg.ID 와 무관하게 새 UUID 를 runtime 식별자로 사용한다.
func (m *Manager) connectImpl(ctx context.Context, cfg ConnectConfig, forceNewRuntimeID bool) (string, error) {
	// 키체인에서 MySQL 비밀번호 복원
	if cfg.Password == "" && cfg.ID != "" {
		pw, err := m.keychain.GetCredential(keychain.ServiceDB, cfg.ID)
		if err != nil {
			return "", fmt.Errorf("keychain get password: %w", err)
		}
		cfg.Password = pw
	}

	// 키체인에서 SSH 비밀번호 복원 (SSH 사용 시)
	if cfg.UseSSH && cfg.SSHPassword == "" && cfg.ID != "" {
		pw, err := m.keychain.GetCredential(keychain.ServiceSSH, cfg.ID)
		if err != nil {
			return "", fmt.Errorf("keychain get ssh password: %w", err)
		}
		cfg.SSHPassword = pw
	}

	// 키체인에서 프록시 비밀번호 복원 (프록시 사용 시)
	if cfg.UseProxy && cfg.ProxyPassword == "" && cfg.ID != "" {
		pw, err := m.keychain.GetCredential(keychain.ServiceProxy, cfg.ID)
		if err != nil {
			return "", fmt.Errorf("keychain get proxy password: %w", err)
		}
		cfg.ProxyPassword = pw
	}

	cfgID := cfg.ID // 영구 cfgId (저장 연결 ID). 빈 문자열 = unsaved.
	var connID string
	switch {
	case forceNewRuntimeID:
		connID = uuid.New().String()
	case cfgID != "":
		connID = cfgID
	default:
		connID = uuid.New().String()
	}

	host := cfg.Host
	port := cfg.Port
	if port == 0 {
		port = 3306
	}

	var sshCloseFn func()
	proxyNetwork := "tcp" // 기본 네트워크 이름; 프록시 사용 시 교체됨
	var proxyCleanFn func()

	// SSH 터널 오픈 (프록시보다 우선)
	if cfg.UseSSH {
		sshCfg := SSHConfig{
			Host:     cfg.SSHHost,
			Port:     cfg.SSHPort,
			User:     cfg.SSHUser,
			KeyPath:  cfg.SSHKeyPath,
			Password: cfg.SSHPassword,
		}
		localPort, closeFn, err := OpenTunnel(ctx, sshCfg, host, port)
		if err != nil {
			return "", fmt.Errorf("ssh tunnel: %w", err)
		}
		host = "127.0.0.1"
		port = localPort
		sshCloseFn = closeFn
	} else if cfg.UseProxy {
		// SOCKS5 / HTTP CONNECT 프록시 다이얼러 등록
		// (ProxyPassword는 Connect 진입부에서 키체인 복원 완료)
		proxyCfg := ProxyConfig{
			Type:     cfg.ProxyType,
			Host:     cfg.ProxyHost,
			Port:     cfg.ProxyPort,
			User:     cfg.ProxyUser,
			Password: cfg.ProxyPassword,
		}
		netName, cleanFn, err := RegisterProxyDialer(proxyCfg)
		if err != nil {
			return "", fmt.Errorf("proxy setup: %w", err)
		}
		proxyNetwork = netName
		proxyCleanFn = cleanFn
	}

	charset := cfg.Charset
	if charset == "" {
		charset = "utf8mb4"
	}

	// 기본 DB 결정: Database 필드 우선, 없으면 Databases[0] 사용
	defaultDB := cfg.Database
	if defaultDB == "" && len(cfg.Databases) > 0 {
		defaultDB = cfg.Databases[0]
	}

	// DSN 조립 (프록시 사용 시 네트워크 이름을 proxyNetwork 로 교체)
	dsn := fmt.Sprintf("%s:%s@%s(%s:%d)/%s?charset=%s&parseTime=true&loc=Local&timeout=30s",
		cfg.User, cfg.Password, proxyNetwork, host, port, defaultDB, charset)
	if cfg.TLS {
		dsn += "&tls=true"
	}

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		if sshCloseFn != nil {
			sshCloseFn()
		}
		if proxyCleanFn != nil {
			proxyCleanFn()
		}
		return "", fmt.Errorf("sql open: %w", err)
	}

	// 연결 풀 설정
	// SetConnMaxLifetime: MySQL wait_timeout(기본 8h) 이전에 연결을 재사용하지 않도록 짧게 유지
	// SetConnMaxIdleTime: 유휴 연결을 MySQL이 끊기 전에 먼저 닫아 "invalid connection" 방지
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	db.SetConnMaxIdleTime(3 * time.Minute)

	// 실제 연결 테스트
	pingCtx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		if sshCloseFn != nil {
			sshCloseFn()
		}
		if proxyCleanFn != nil {
			proxyCleanFn()
		}
		return "", fmt.Errorf("ping failed: %w", err)
	}

	// proxyCleanFn은 현재 no-op이므로 sshCloseFn과 함께 저장 (향후 정리 로직 추가 가능)
	closeFn := sshCloseFn
	if proxyCleanFn != nil && sshCloseFn == nil {
		closeFn = proxyCleanFn
	}

	// cfg.ID 는 저장 연결 ID(cfgId) 로 entry.cfg 에 보존 — Reconnect 시 cfgId 손실 방지(BugFix-DA).
	cfg.ID = cfgID
	m.mu.Lock()
	m.conns[connID] = &connEntry{
		db:  db,
		cfg: cfg,
		info: ConnectionInfo{
			ID:          connID,
			CfgID:       cfgID,
			Name:        cfg.Name,
			Host:        cfg.Host,
			Port:        cfg.Port,
			User:        cfg.User,
			Database:    cfg.Database,
			ConnectedAt: time.Now(),
		},
		sshCloseFn: closeFn,
	}
	m.mu.Unlock()

	slog.Info("MySQL connected", "connID", connID, "host", cfg.Host, "port", port)
	return connID, nil
}

// Disconnect 연결을 해제하고 SSH 터널도 정리한다.
func (m *Manager) Disconnect(connID string) error {
	m.mu.Lock()
	entry, ok := m.conns[connID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("connection not found: %s", connID)
	}
	delete(m.conns, connID)
	m.mu.Unlock()

	entry.db.Close()
	if entry.sshCloseFn != nil {
		entry.sshCloseFn()
	}
	slog.Info("MySQL disconnected", "connID", connID)
	return nil
}

// InjectTestDB 테스트 전용: connID에 이미 열린 *sql.DB를 직접 등록한다.
// 프로덕션 코드에서는 사용하지 않는다.
//
// BugFix-DA: info/cfg 의 ID·CfgID 도 connID 로 채워 list_connections 매칭이 동작하도록 한다.
func (m *Manager) InjectTestDB(connID string, db *sql.DB) {
	m.mu.Lock()
	m.conns[connID] = &connEntry{
		db:   db,
		cfg:  ConnectConfig{ID: connID},
		info: ConnectionInfo{ID: connID, CfgID: connID},
	}
	m.mu.Unlock()
}

// InjectTestDBAsNewSession 테스트 전용: runtime UUID 와 cfgId 가 분리된 상태를 흉내낸다.
// 프로덕션의 `ConnectAsNewSession` 경로 — 새 runtime ID + 영구 cfgId — 를 시뮬레이트하기 위함이다.
// 반환값은 m.conns 의 키로 쓰인 runtime ID.
func (m *Manager) InjectTestDBAsNewSession(cfgID string, db *sql.DB) string {
	runtimeID := uuid.New().String()
	m.mu.Lock()
	m.conns[runtimeID] = &connEntry{
		db:   db,
		cfg:  ConnectConfig{ID: cfgID},
		info: ConnectionInfo{ID: runtimeID, CfgID: cfgID},
	}
	m.mu.Unlock()
	return runtimeID
}

// GetDB id 로 *sql.DB 를 조회한다.
//
// BugFix-DA: 1차로 m.conns 의 키(runtime connID) 매칭을 시도하고, 실패하면
// 영구 cfgId 로도 매칭한다. MCP 가 list_connections 응답에서 cfgId 를 노출하므로
// AI 클라이언트의 후속 호출은 cfgId 로 들어오고, frontend 의 Reconnect 등은 runtime UUID 로 들어온다.
// BugFix-CX 의 host+port+user 중복 차단으로 한 Manager 안에서 같은 cfgId entry 는 단 1개만 존재한다.
func (m *Manager) GetDB(connID string) (*sql.DB, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if entry, ok := m.conns[connID]; ok {
		return entry.db, nil
	}
	for _, entry := range m.conns {
		if entry.info.CfgID == connID && entry.info.CfgID != "" {
			return entry.db, nil
		}
	}
	return nil, fmt.Errorf("connection not found: %s", connID)
}

// Ping 연결이 살아있는지 확인한다.
func (m *Manager) Ping(ctx context.Context, connID string) error {
	db, err := m.GetDB(connID)
	if err != nil {
		return err
	}
	pingCtx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	return db.PingContext(pingCtx)
}

// PingWithLatency Ping을 수행하고 지연 시간(ms)을 반환한다.
func (m *Manager) PingWithLatency(ctx context.Context, connID string) (int64, error) {
	db, err := m.GetDB(connID)
	if err != nil {
		return 0, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	start := time.Now()
	if err := db.PingContext(pingCtx); err != nil {
		return 0, err
	}
	return time.Since(start).Milliseconds(), nil
}

// Reconnect 기존 연결을 끊고 저장된 설정으로 재연결한다.
// MySQL 8시간 타임아웃 등으로 연결이 끊긴 경우에 사용한다.
//
// BugFix-DA: runtime connID 와 cfgId 가 다른 경우(`ConnectAsNewSession` 으로 만든 세션)
// 둘 다 보존해야 MCP active 마킹/allowlist 매칭이 깨지지 않는다.
func (m *Manager) Reconnect(ctx context.Context, connID string) error {
	m.mu.RLock()
	entry, ok := m.conns[connID]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("connection not found: %s", connID)
	}

	cfg := entry.cfg     // cfg.ID 는 cfgId 가 보존돼 있음
	cfgID := entry.info.CfgID

	// 기존 연결 정리 (에러 무시 — 이미 끊긴 상태일 수 있음)
	if err := m.Disconnect(connID); err != nil {
		slog.Warn("disconnect before reconnect failed", "connID", connID, "error", err)
	}

	// runtime connID 를 그대로 유지하기 위해 connectImpl 을 직접 호출 (cfgID 보존 + 동일 runtime UUID).
	// cfg.ID 를 cfgID 로 설정한 채로 forceNewRuntimeID 분기를 거치되, 원래 runtime ID 를 재사용해야 하므로
	// 별도 경로로 처리한다.
	cfg.ID = cfgID
	var newID string
	var err error
	if cfgID == connID {
		// legacy 경로 — runtime ID == cfgId. cfg.ID 가 그대로 runtime ID 로 재사용된다.
		newID, err = m.Connect(ctx, cfg)
	} else {
		// ConnectAsNewSession 으로 만든 세션 — 새 runtime UUID 가 발급되지만,
		// 호출자(StatusBar 등) 는 기존 runtime ID 가 그대로 살아남는다고 가정하므로 그에 맞춰 키를 다시 매핑한다.
		newID, err = m.ConnectAsNewSession(ctx, cfg)
		if err == nil && newID != connID {
			m.mu.Lock()
			if e, ok := m.conns[newID]; ok {
				delete(m.conns, newID)
				e.info.ID = connID
				m.conns[connID] = e
			}
			m.mu.Unlock()
			newID = connID
		}
	}
	if err != nil {
		return fmt.Errorf("reconnect failed: %w", err)
	}
	if newID != connID {
		slog.Warn("reconnect returned different ID", "expected", connID, "got", newID)
	}
	return nil
}

// ListConnections 현재 활성 연결 목록을 반환한다.
func (m *Manager) ListConnections() []ConnectionInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]ConnectionInfo, 0, len(m.conns))
	for _, entry := range m.conns {
		result = append(result, entry.info)
	}
	return result
}
