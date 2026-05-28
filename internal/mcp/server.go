package mcp

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/mark3labs/mcp-go/server"
)

const (
	// MCP 엔드포인트 경로 — Streamable HTTP transport 표준.
	endpointPath = "/mcp"

	// 서버 이름 / 버전 (initialize 응답에 포함됨).
	mcpServerName    = "orcasql-mcp"
	mcpServerVersion = "0.1.0-poc"

	// shutdownTimeout 앱 종료 시 graceful shutdown 대기.
	shutdownTimeout = 5 * time.Second
)

// Status MCP 서버 상태 — UI / Wails 바인딩에서 표시용.
type Status struct {
	Running     bool      `json:"running"`
	Port        int       `json:"port"`
	Endpoint    string    `json:"endpoint"`        // 예: "http://127.0.0.1:7878/mcp"
	StartedAt   time.Time `json:"startedAt,omitempty"`
	LastError   string    `json:"lastError,omitempty"`
	ConfigError string    `json:"configError,omitempty"`
}

// Server MCP HTTP 서버 — Wails 프로세스 안에서 goroutine 으로 동작.
// Start 는 비동기 (즉시 반환), 실제 listen 은 background goroutine 에서.
type Server struct {
	deps   Deps
	store  *ConfigStore
	logger *slog.Logger

	mu        sync.Mutex
	running   atomic.Bool
	stream    *server.StreamableHTTPServer
	httpSrv   *http.Server
	port      int
	startedAt time.Time
	lastErr   atomic.Value // string

	// 현재 적용된 토큰/Config 의 스냅샷 — 인증 미들웨어가 atomic 하게 읽음.
	token  atomic.Value // string
	policy atomic.Value // Config
}

// NewServer 의존성 검증 후 서버를 생성한다 (아직 listen 안 함).
func NewServer(deps Deps, store *ConfigStore, logger *slog.Logger) (*Server, error) {
	if err := deps.validate(); err != nil {
		return nil, err
	}
	if store == nil {
		return nil, errors.New("mcp: ConfigStore is required")
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Server{
		deps:   deps,
		store:  store,
		logger: logger.With("component", "mcp"),
	}, nil
}

// Start 현재 디스크 설정을 로드해 listen 을 시작한다.
// 이미 실행 중이면 ErrAlreadyRunning.
//
// 동작:
//  1. Config 로드 → Enabled=false 면 ErrDisabled
//  2. AllowedConnIDs 가 비어 있으면 경고 로그 (서버는 시작하되 모든 호출 거부)
//  3. 토큰 보장 (없으면 신규 발급)
//  4. mark3labs/mcp-go 인스턴스 생성 + 도구 등록
//  5. http.Server 로 127.0.0.1:port listen (별도 goroutine)
func (s *Server) Start(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running.Load() {
		return ErrAlreadyRunning
	}

	cfg, err := s.store.Load()
	if err != nil {
		return fmt.Errorf("load mcp config: %w", err)
	}
	if !cfg.Enabled {
		return ErrDisabled
	}

	tok, err := s.store.GetOrCreateToken()
	if err != nil {
		return fmt.Errorf("ensure mcp token: %w", err)
	}
	s.token.Store(tok)
	s.policy.Store(cfg)

	if len(cfg.AllowedConnIDs) == 0 {
		s.logger.Warn("MCP enabled but allowedConnIDs is empty — all tool calls will be rejected until a connection is allowlisted")
	}

	mcpInst := server.NewMCPServer(
		mcpServerName,
		mcpServerVersion,
		server.WithToolCapabilities(true),
		server.WithRecovery(),
	)
	s.registerTools(mcpInst)

	stream := server.NewStreamableHTTPServer(
		mcpInst,
		server.WithEndpointPath(endpointPath),
		server.WithStateLess(true), // 단순화 — 세션 상태 X, 매 요청 stateless
	)

	addr := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
	mux := http.NewServeMux()
	mux.Handle(endpointPath, s.authMiddleware(stream))

	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// 미리 listen 해서 EADDRINUSE 등 즉시 감지 — 그 후 비동기로 Serve.
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("mcp listen %s: %w", addr, err)
	}

	s.stream = stream
	s.httpSrv = httpSrv
	s.port = cfg.Port
	s.startedAt = time.Now()
	s.running.Store(true)
	s.lastErr.Store("")

	go func() {
		s.logger.Info("MCP server listening", "addr", addr, "endpoint", endpointPath)
		if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Error("MCP server serve error", "error", err)
			s.lastErr.Store(err.Error())
			s.running.Store(false)
		}
	}()

	return nil
}

// Stop graceful shutdown — 진행 중 요청 완료 대기 (최대 shutdownTimeout).
// 실행 중이 아니면 nil.
func (s *Server) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running.Load() {
		return nil
	}

	stopCtx, cancel := context.WithTimeout(ctx, shutdownTimeout)
	defer cancel()

	var firstErr error
	if s.stream != nil {
		if err := s.stream.Shutdown(stopCtx); err != nil {
			firstErr = err
		}
	}
	if s.httpSrv != nil {
		if err := s.httpSrv.Shutdown(stopCtx); err != nil && firstErr == nil {
			firstErr = err
		}
	}

	s.running.Store(false)
	s.stream = nil
	s.httpSrv = nil

	if firstErr != nil {
		s.logger.Warn("MCP server shutdown returned error", "error", firstErr)
	} else {
		s.logger.Info("MCP server stopped")
	}
	return firstErr
}

// Restart 설정 변경 후 깨끗한 재시작.
func (s *Server) Restart(ctx context.Context) error {
	if err := s.Stop(ctx); err != nil {
		s.logger.Warn("stop during restart failed", "error", err)
	}
	return s.Start(ctx)
}

// Status 현재 서버 상태를 반환한다.
func (s *Server) Status() Status {
	st := Status{
		Running: s.running.Load(),
		Port:    s.port,
	}
	if st.Port > 0 {
		st.Endpoint = fmt.Sprintf("http://127.0.0.1:%d%s", st.Port, endpointPath)
	}
	if st.Running {
		st.StartedAt = s.startedAt
	}
	if v, ok := s.lastErr.Load().(string); ok {
		st.LastError = v
	}
	return st
}

// CurrentPolicy 인증된 핸들러가 정책 게이트를 적용할 때 호출.
// Start 시점의 Config 스냅샷을 반환 (재시작해야 갱신됨).
func (s *Server) CurrentPolicy() Config {
	if v, ok := s.policy.Load().(Config); ok {
		return v
	}
	return DefaultConfig()
}

// ─── 인증 미들웨어 ───────────────────────────────────────────────────────────

// authMiddleware Bearer 토큰 + Origin 화이트리스트 + 메서드 화이트리스트 검사.
// 통과 시 다음 핸들러 (mcp-go StreamableHTTP) 로 위임.
func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Method 화이트리스트 — POST(요청), GET(SSE 스트림), DELETE(세션 종료)만.
		// stateless 모드라 GET/DELETE 는 사실상 안 쓰이지만 표준 호환을 위해 허용.
		switch r.Method {
		case http.MethodPost, http.MethodGet, http.MethodDelete, http.MethodOptions:
			// ok
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		if !checkOrigin(r) {
			s.logger.Warn("MCP request rejected — bad origin",
				"origin", r.Header.Get("Origin"),
				"remote", r.RemoteAddr,
			)
			http.Error(w, "forbidden origin", http.StatusForbidden)
			return
		}

		expected, _ := s.token.Load().(string)
		if expected == "" {
			http.Error(w, "server token not configured", http.StatusServiceUnavailable)
			return
		}

		got := extractBearer(r.Header.Get("Authorization"))
		// 상수 시간 비교 — 타이밍 사이드 채널 차단
		if subtle.ConstantTimeCompare([]byte(got), []byte(expected)) != 1 {
			s.logger.Warn("MCP request rejected — bad token", "remote", r.RemoteAddr)
			w.Header().Set("WWW-Authenticate", `Bearer realm="orcasql-mcp"`)
			http.Error(w, "invalid or missing token", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// extractBearer "Authorization: Bearer xxx" 에서 토큰 부분 추출.
// 대소문자 무관(스펙상 "Bearer" 는 case-insensitive).
func extractBearer(h string) string {
	const prefix = "bearer "
	if len(h) <= len(prefix) {
		return ""
	}
	if !strings.EqualFold(h[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(h[len(prefix):])
}

// checkOrigin DNS rebinding 방지 — Origin 헤더가 비었거나 localhost 계열이면 통과.
// 그 외 도메인은 차단.
//
// 비어있는 Origin 도 허용하는 이유: curl / 일부 MCP 클라이언트는 Origin 을 안 보냄.
// 이미 Bearer 토큰이 별도 보안층이므로 Origin 만 단독으로는 약하지만,
// 토큰 + Origin 결합으로 브라우저 우회 시나리오를 차단하는 게 목적.
func checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// ─── 패키지 에러 ─────────────────────────────────────────────────────────────

// ErrAlreadyRunning Start 가 이미 실행 중인 서버에 호출됐을 때 반환된다.
var ErrAlreadyRunning = errors.New("mcp: server already running")

// ErrDisabled Config.Enabled == false 일 때 Start 가 반환한다.
var ErrDisabled = errors.New("mcp: disabled in config")
