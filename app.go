package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"orcasql/internal/backup"
	"orcasql/internal/connection"
	"orcasql/internal/favorite"
	"orcasql/internal/filelock"
	"orcasql/internal/history"
	"orcasql/internal/keychain"
	mcppkg "orcasql/internal/mcp"
	"orcasql/internal/query"
	"orcasql/internal/reset"
	"orcasql/internal/schema"
	"orcasql/internal/session"
	"orcasql/internal/sync"
)

// App는 Wails v3 서비스 바인딩 레이어.
// 프론트엔드에서 호출하는 모든 public 메서드가 여기에 정의된다.
type App struct {
	connManager   *connection.Manager
	schemaInsp    *schema.Inspector
	queryExec     *query.Executor
	keychainSvc   *keychain.Store
	historyStore  *history.Store
	profiler      *schema.Profiler
	designer      *schema.Designer
	dumper        *backup.Dumper
	syncer        *sync.Syncer
	sessionStore   *session.Store
	favoriteStore  *favorite.Store
	configPath     string
	configLockPath string // connections.json.lock — 다중 인스턴스 간 exclusive lock
	version        string // main.Version에서 주입

	// MCP 서버 — Claude / IDE 등 외부 MCP 클라이언트가 활성 연결로 DB 질의 가능.
	// PoC 단계: 활성 연결 + allowlist 둘 다 만족해야 동작. 자세한 설계는
	// .claude/plans/phase-43-mcp-server.md 참조.
	mcpConfigStore *mcppkg.ConfigStore
	mcpServer      *mcppkg.Server
}

// AppInfo About 다이얼로그용 앱 정보.
type AppInfo struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
	Copyright   string `json:"copyright"`
}

// NewApp App 인스턴스를 생성한다.
func NewApp() *App {
	home, _ := os.UserHomeDir()
	baseDir := filepath.Join(home, ".orcasql")

	// ~/.orcasql 디렉토리가 없으면 생성. 권한 오류는 치명적이므로 로깅만.
	if err := os.MkdirAll(baseDir, 0o700); err != nil {
		slog.Error("failed to create app data directory", "path", baseDir, "error", err)
	}

	configPath := filepath.Join(baseDir, "connections.json")
	historyDir := filepath.Join(baseDir, "history")
	sessionPath := filepath.Join(baseDir, "session.json")
	favoritePath := filepath.Join(baseDir, "favorites.json")
	mcpConfigPath := filepath.Join(baseDir, "mcp.json")

	ks := keychain.NewStore()
	cm := connection.NewManager(ks)
	si := schema.NewInspector(cm)
	qe := query.NewExecutor(cm)

	hs, err := history.NewStore(historyDir)
	if err != nil {
		// 디렉토리 생성 후에도 실패하면 인메모리 빈 스토어로 대체 (앱은 계속 구동)
		slog.Error("history store init failed, using empty store", "path", historyDir, "error", err)
		hs, _ = history.NewStore("") // store 구현이 빈 경로를 인메모리로 처리
	}

	fs, err := favorite.NewStore(favoritePath)
	if err != nil {
		slog.Error("favorite store init failed, using empty store", "path", favoritePath, "error", err)
		fs, _ = favorite.NewStore("")
	}

	mcpStore := mcppkg.NewConfigStore(mcpConfigPath, ks)

	app := &App{
		connManager:   cm,
		schemaInsp:    si,
		queryExec:     qe,
		keychainSvc:   ks,
		historyStore:  hs,
		profiler:      schema.NewProfiler(cm),
		designer:      schema.NewDesigner(cm),
		dumper:        backup.NewDumper(cm),
		syncer:        sync.NewSyncer(cm),
		sessionStore:   session.NewStore(sessionPath),
		favoriteStore:  fs,
		configPath:     configPath,
		configLockPath: configPath + ".lock",
		mcpConfigStore: mcpStore,
	}

	// MCP 서버 인스턴스 생성 (아직 listen 안 함 — Start() 호출 시 listen).
	// 의존성을 평탄하게 주입 — closure 로 GetSavedConnections 만 위임.
	mcpServer, err := mcppkg.NewServer(mcppkg.Deps{
		ConnManager:          cm,
		QueryExecutor:        qe,
		SchemaInsp:           si,
		HistoryStore:         hs,
		LoadSavedConnections: app.GetSavedConnections,
	}, mcpStore, slog.Default())
	if err != nil {
		// 의존성 누락은 코드 버그 — 부팅은 계속하되 로그.
		slog.Error("mcp server init failed", "error", err)
	} else {
		app.mcpServer = mcpServer
	}

	return app
}

// SetVersion main.go에서 버전 문자열을 주입한다.
func (a *App) SetVersion(v string) {
	a.version = v
}

// GetAppInfo About 다이얼로그용 앱 정보를 반환한다.
func (a *App) GetAppInfo(_ context.Context) AppInfo {
	return AppInfo{
		Name:        "OrcaSQL",
		Version:     a.version,
		Description: "Windows · macOS 네이티브 MySQL GUI 클라이언트 — 쿼리 편집기, 결과 그리드 인라인 편집, 스키마 관리, SSH 터널을 한 앱에서.",
		Copyright:   fmt.Sprintf("Copyright © %d", time.Now().Year()),
	}
}

// ResetAllUserData 모든 사용자 데이터(연결·세션·히스토리·즐겨찾기·SSH known_hosts·로그·키체인 비밀번호)를
// 영구 삭제하고 1.5초 뒤 앱을 종료한다.
//
// 도움말 메뉴의 "모든 설정 초기화" 진입점에서 호출된다.
// 동작:
//  1. connections.json lock 시도 — 다른 인스턴스가 작업 중이면 차단
//  2. 활성 연결 모두 Disconnect (TCP 핸들 해제)
//  3. MCP 서버 중지 (이후 listener 가 더 이상 활성 connection 을 잡지 못하도록)
//  4. connections.json 의 모든 connID 수집 → 키체인 3개 서비스 항목 Delete
//  5. ~/.orcasql 디렉토리 통째로 RemoveAll
//  6. MCP 토큰 키체인 항목 Delete (Phase 43)
//  7. 1.5초 후 application Quit (프론트가 토스트 표시할 시간)
//
// 부분 실패 시에도 가능한 만큼 정리하고 wrapped error 반환.
func (a *App) ResetAllUserData(ctx context.Context) error {
	home, _ := os.UserHomeDir()
	baseDir := filepath.Join(home, ".orcasql")

	// 다중 인스턴스 가드 — 짧은 타임아웃으로 시도, 실패 시 사용자에게 안내
	var connIDs []string
	lockErr := filelock.WithExclusiveLock(a.configLockPath, 500*time.Millisecond, func() error {
		cfg, err := a.loadAppConfig()
		if err != nil {
			slog.Warn("reset: loadAppConfig failed, proceeding with active connections only", "error", err)
		}
		seen := map[string]struct{}{}
		for _, c := range cfg.Connections {
			if c.ID != "" {
				seen[c.ID] = struct{}{}
			}
		}
		// 활성 연결도 합집합 (config에 저장 안 된 임시 연결 대비)
		for _, info := range a.connManager.ListConnections() {
			if info.ID != "" {
				seen[info.ID] = struct{}{}
			}
		}
		for id := range seen {
			connIDs = append(connIDs, id)
		}
		return nil
	})
	if lockErr != nil {
		return fmt.Errorf("다른 OrcaSQL 인스턴스가 실행 중입니다. 모든 인스턴스를 종료한 뒤 다시 시도하세요: %w", lockErr)
	}

	// MCP 서버 우선 중지 — listener 가 활성 connection 을 더 이상 못 잡게 + 키체인 정리 race 방지.
	// Stop 자체가 실패해도 reset 흐름은 계속 (best-effort).
	if a.mcpServer != nil {
		if err := a.mcpServer.Stop(ctx); err != nil {
			slog.Warn("reset: mcp stop failed", "error", err)
		}
	}

	// 활성 연결 모두 disconnect (TCP/SSH 핸들 정리)
	for _, info := range a.connManager.ListConnections() {
		if err := a.connManager.Disconnect(info.ID); err != nil {
			slog.Warn("reset: disconnect failed", "connID", info.ID, "error", err)
		}
	}

	resetErr := reset.ResetAllUserData(baseDir, a.keychainSvc, connIDs)

	// MCP 토큰 키체인 항목 정리 — reset.ResetAllUserData 는 connID 별 3개 서비스만 알기에
	// MCP 전용 키(orcasql-mcp/token)는 별도 호출. 실패해도 reset 흐름 계속.
	if a.mcpConfigStore != nil {
		if err := a.mcpConfigStore.DeleteToken(); err != nil {
			slog.Warn("reset: mcp token delete failed", "error", err)
			if resetErr != nil {
				resetErr = fmt.Errorf("%w; mcp token: %v", resetErr, err)
			} else {
				resetErr = fmt.Errorf("mcp token: %w", err)
			}
		}
	}

	if resetErr != nil {
		slog.Error("reset: partial failure", "error", resetErr)
		// 부분 실패여도 종료는 진행 (다음 부팅 시 잔존물 자연 정리)
		go scheduleQuit()
		return fmt.Errorf("일부 데이터 삭제 실패 (앱은 곧 종료됩니다): %w", resetErr)
	}

	slog.Info("reset: all user data cleared, scheduling quit")
	go scheduleQuit()
	return nil
}

func scheduleQuit() {
	time.Sleep(1500 * time.Millisecond)
	if app := application.Get(); app != nil {
		app.Quit()
	}
}

// OpenDevTools 현재 윈도우의 개발자 도구를 연다.
// 도움말 메뉴 > 개발자 도구 진입점에서 호출된다.
// production 빌드에서도 main.go 의 DevToolsEnabled=true 설정이 살아있는 한 동작한다.
func (a *App) OpenDevTools(_ context.Context) error {
	app := application.Get()
	if app == nil {
		return fmt.Errorf("application not initialized")
	}
	w := app.Window.Current()
	if w == nil {
		return fmt.Errorf("no active window")
	}
	w.OpenDevTools()
	return nil
}

// OnStartup은 Wails v3 서비스 라이프사이클 훅이다.
func (a *App) OnStartup(ctx context.Context, options application.ServiceOptions) error {
	slog.Info("App service started")
	// 레거시 평문 비밀번호를 키체인으로 이관 (idempotent, 실패해도 부팅 차단 안 함)
	a.migrateLegacyPasswords()
	// 저장된 연결 설정 자동 로드
	_ = a.loadSavedConnections()

	// MCP 서버 자동 시작 (Config.Enabled=true 일 때만).
	// 실패해도 앱 부팅은 계속 — 사용자가 UI 에서 상태 확인 후 수동 재시도 가능.
	if a.mcpServer != nil {
		if err := a.mcpServer.Start(ctx); err != nil {
			if !isMCPBenignStartError(err) {
				slog.Error("mcp auto-start failed", "error", err)
			}
		}
	}
	return nil
}

// isMCPBenignStartError 비활성 상태 / 이미 실행 중 에러는 부팅 시 정상 흐름.
func isMCPBenignStartError(err error) bool {
	return errors.Is(err, mcppkg.ErrDisabled) || errors.Is(err, mcppkg.ErrAlreadyRunning)
}


// ─── 내부 헬퍼 ─────────────────────────────────────────────────────────────

// ─── Config 파일 내부 포맷 ────────────────────────────────────────────────

// appConfig connections.json 전체 구조 (v2 포맷).
// v1 (flat array)에서 하위 호환 로드 지원.
type appConfig struct {
	Version     int                        `json:"version"`
	Connections []connection.ConnectConfig `json:"connections"`
	Groups      []connection.SessionGroup  `json:"groups"`
}

func (a *App) loadSavedConnections() error {
	cfg, err := a.loadAppConfig()
	if err != nil {
		return err
	}
	slog.Info("loaded saved connections", "count", len(cfg.Connections))
	return nil
}

// migrateLegacyPasswords는 connections.json 에 평문으로 남아있을 수 있는
// Password / SSHPassword / ProxyPassword 필드를 OS 키체인으로 이관하고
// 파일에서 평문을 제거한다. 앱 시작 시마다 호출되어도 안전한 idempotent 동작.
//
// 불변식:
//  1. 키체인에 이미 값이 있으면 덮어쓰지 않는다 (사용자가 별도 수정했을 가능성 보존).
//  2. 파일의 평문 필드는 항상 제거한다 — 이중 저장을 허용하지 않는다.
//  3. 개별 이관 실패는 로깅만 하고 나머지 항목은 계속 처리 (부분 성공 허용).
func (a *App) migrateLegacyPasswords() {
	cfg, err := a.loadAppConfig()
	if err != nil {
		return
	}
	dirty := false
	ensure := func(service, id, plain string) bool {
		// 키체인에 이미 값이 있으면 파일 평문으로 덮어쓰지 않는다.
		if existing, _ := a.keychainSvc.GetCredential(service, id); existing != "" {
			return true // 파일 필드는 비우되 키체인은 그대로
		}
		if err := a.keychainSvc.SaveCredential(service, id, plain); err != nil {
			slog.Warn("migrate password: keychain save failed", "service", service, "id", id, "error", err)
			return false
		}
		return true
	}
	for i, c := range cfg.Connections {
		if c.Password != "" && ensure(keychain.ServiceDB, c.ID, c.Password) {
			cfg.Connections[i].Password = ""
			dirty = true
		}
		if c.SSHPassword != "" && ensure(keychain.ServiceSSH, c.ID, c.SSHPassword) {
			cfg.Connections[i].SSHPassword = ""
			dirty = true
		}
		if c.ProxyPassword != "" && ensure(keychain.ServiceProxy, c.ID, c.ProxyPassword) {
			cfg.Connections[i].ProxyPassword = ""
			dirty = true
		}
	}
	if dirty {
		slog.Info("migrated legacy plaintext passwords to keychain")
		if err := a.saveAppConfig(cfg); err != nil {
			slog.Error("migrate password: saveAppConfig failed", "error", err)
		}
	}
}

// loadAppConfig connections.json을 읽어 appConfig로 반환한다.
// v1 포맷(flat array)도 투명하게 처리한다.
func (a *App) loadAppConfig() (appConfig, error) {
	data, err := os.ReadFile(a.configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return appConfig{Version: 2}, nil
		}
		return appConfig{}, fmt.Errorf("read config: %w", err)
	}
	// v2 포맷 시도 (object with "version" key)
	var cfg appConfig
	if err2 := json.Unmarshal(data, &cfg); err2 == nil && cfg.Version >= 2 {
		return cfg, nil
	}
	// v1 포맷 폴백 (flat array)
	var conns []connection.ConnectConfig
	if err2 := json.Unmarshal(data, &conns); err2 != nil {
		return appConfig{}, fmt.Errorf("parse config: %w", err2)
	}
	return appConfig{Version: 2, Connections: conns, Groups: nil}, nil
}

// saveAppConfig connections.json을 원자적으로(tmp→fsync→rename) 쓴다.
// 단순 쓰기 전용. 다중 인스턴스 RMW 패턴은 modifyAppConfig를 사용할 것.
func (a *App) saveAppConfig(cfg appConfig) error {
	cfg.Version = 2
	if err := os.MkdirAll(filepath.Dir(a.configPath), 0o700); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	tmpPath := fmt.Sprintf("%s.%d.tmp", a.configPath, os.Getpid())
	return filelock.AtomicWriteFile(a.configPath, tmpPath, data, 0o600)
}

// modifyAppConfig는 connections.json에 프로세스 간 exclusive lock을 잡고
// fn(현재 cfg)을 실행한 뒤 결과를 원자적으로 저장한다.
// 다중 인스턴스가 동시에 연결/그룹을 추가·수정·삭제해도 데이터가 유실되지 않는다.
func (a *App) modifyAppConfig(fn func(cfg *appConfig) error) error {
	tmpPath := fmt.Sprintf("%s.%d.tmp", a.configPath, os.Getpid())
	return filelock.WithExclusiveLock(a.configLockPath, filelock.DefaultTimeout, func() error {
		cfg, err := a.loadAppConfig()
		if err != nil {
			cfg = appConfig{Version: 2}
		}
		if err := fn(&cfg); err != nil {
			return err
		}
		cfg.Version = 2
		data, err := json.MarshalIndent(cfg, "", "  ")
		if err != nil {
			return fmt.Errorf("marshal config: %w", err)
		}
		return filelock.AtomicWriteFile(a.configPath, tmpPath, data, 0o600)
	})
}

// loadConfigFile 기존 코드와의 호환성을 위해 Connections만 반환한다.
func (a *App) loadConfigFile() ([]connection.ConnectConfig, error) {
	cfg, err := a.loadAppConfig()
	if err != nil {
		return nil, err
	}
	return cfg.Connections, nil
}

func (a *App) saveConfigFile(configs []connection.ConnectConfig) error {
	return a.modifyAppConfig(func(cfg *appConfig) error {
		cfg.Connections = configs
		return nil
	})
}

