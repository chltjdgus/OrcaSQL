// Package mcp 는 OrcaSQL 의 Model Context Protocol 서버를 구현한다.
// Claude / IDE 등 MCP 클라이언트가 OrcaSQL 의 활성 연결을 통해
// MySQL 에 read-only 쿼리(또는 사용자가 명시 허용 시 쓰기/DDL) 를 실행할 수 있게 한다.
//
// 보안 모델:
//   - 127.0.0.1 만 listen, 외부 접근 차단
//   - Bearer 토큰 인증 (32B 랜덤, OS 키체인 보관)
//   - Origin 헤더 화이트리스트 (DNS rebinding 방지)
//   - 권한 게이트 3단: read-only(기본) → write 허용 → DDL 허용
//   - Connection allowlist 기본 빈 배열 (=비활성)
package mcp

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"orcasql/internal/keychain"
)

const (
	// DefaultPort MCP 서버 기본 포트.
	// 변경 시 클라이언트 설정도 같이 갱신해야 하므로 자주 바꾸지 않는다.
	DefaultPort = 7878

	// minPort/maxPort 사용자 입력 검증 범위 — well-known 포트 차단.
	minPort = 1024
	maxPort = 65535

	// keychainServiceMCP / keychainTokenKey OS 키체인 항목 식별자.
	// 기존 connection 자격증명(orcasql / orcasql-ssh / orcasql-proxy)과 충돌하지 않도록 구분.
	keychainServiceMCP = "orcasql-mcp"
	keychainTokenKey   = "token"

	// AllowAllConnections allowedConnIDs 배열에 이 값이 있으면 모든 저장 연결 노출.
	AllowAllConnections = "*"
)

// Config MCP 서버 설정 — 디스크 저장 가능 부분만.
// 토큰은 별도로 OS 키체인에 보관된다.
type Config struct {
	Enabled        bool      `json:"enabled"`
	Port           int       `json:"port"`
	AllowWrite     bool      `json:"allowWrite"`
	AllowDDL       bool      `json:"allowDDL"`
	AllowedConnIDs []string  `json:"allowedConnIDs"` // [] = 모두 차단(기본), ["*"] = 모두, [...] = 화이트리스트
	CreatedAt      time.Time `json:"createdAt,omitempty"`
}

// DefaultConfig 안전한 기본값 — 비활성화 + 빈 allowlist.
// 사용자가 환경설정에서 명시적으로 켜야 동작한다.
func DefaultConfig() Config {
	return Config{
		Enabled:        false,
		Port:           DefaultPort,
		AllowWrite:     false,
		AllowDDL:       false,
		AllowedConnIDs: []string{},
		CreatedAt:      time.Now().UTC(),
	}
}

// IsConnAllowed connID 가 allowlist 에 포함되는지 검사한다.
// 빈 배열 → 모두 거부, ["*"] 포함 → 모두 허용, 그 외 → 정확 일치.
func (c Config) IsConnAllowed(connID string) bool {
	if len(c.AllowedConnIDs) == 0 {
		return false
	}
	for _, id := range c.AllowedConnIDs {
		if id == AllowAllConnections {
			return true
		}
		if id == connID {
			return true
		}
	}
	return false
}

// ConfigStore mcp.json 파일 + 키체인 토큰을 묶어 관리한다.
// 동시 호출 안전 (RWMutex).
type ConfigStore struct {
	path     string
	keychain *keychain.Store
	mu       sync.RWMutex
}

// NewConfigStore 설정 저장소를 생성한다.
// path 가 빈 문자열이면 인메모리 모드(테스트용) — 실제 디스크 저장 안 함.
func NewConfigStore(path string, ks *keychain.Store) *ConfigStore {
	return &ConfigStore{path: path, keychain: ks}
}

// Load 설정을 디스크에서 읽는다. 파일이 없으면 DefaultConfig 반환 (에러 X).
// 검증 실패 시에도 기본값으로 fallback 하여 앱 부팅을 막지 않는다.
func (s *ConfigStore) Load() (Config, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.loadLocked()
}

// Save 설정을 디스크에 atomic write 한다.
// 포트 범위 검증 후 0o600 으로 기록 (사용자만 읽기/쓰기).
func (s *ConfigStore) Save(cfg Config) error {
	if err := validateConfig(cfg); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(cfg)
}

// Modify load → fn(cfg) → save 를 하나의 lock 안에서 수행한다.
// fn 이 false 를 반환하면 변경사항 없음 — Save 안 함.
// 외부에서 read-modify-write 를 직접 하면 동시 호출 간 lost-update 가능 — 대신 이걸 사용.
func (s *ConfigStore) Modify(fn func(*Config) bool) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.loadLocked()
	if err != nil {
		return false, err
	}
	if !fn(&cfg) {
		return false, nil
	}
	if err := validateConfig(cfg); err != nil {
		return false, err
	}
	if err := s.saveLocked(cfg); err != nil {
		return false, err
	}
	return true, nil
}

// loadLocked 호출자가 mu (R 또는 W) 를 잡은 상태에서만 호출.
func (s *ConfigStore) loadLocked() (Config, error) {
	if s.path == "" {
		return DefaultConfig(), nil
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return DefaultConfig(), nil
		}
		return DefaultConfig(), fmt.Errorf("read mcp config: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return DefaultConfig(), fmt.Errorf("parse mcp config: %w", err)
	}
	if cfg.Port == 0 {
		cfg.Port = DefaultPort
	}
	if cfg.AllowedConnIDs == nil {
		cfg.AllowedConnIDs = []string{}
	}
	return cfg, nil
}

// saveLocked 호출자가 mu (W) 를 잡은 상태에서만 호출.
func (s *ConfigStore) saveLocked(cfg Config) error {
	if s.path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("mkdir mcp dir: %w", err)
	}
	if cfg.AllowedConnIDs == nil {
		cfg.AllowedConnIDs = []string{}
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal mcp config: %w", err)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write mcp config tmp: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename mcp config: %w", err)
	}
	return nil
}

// validateConfig 디스크 쓰기 전 검증 — 현재는 포트 범위만.
func validateConfig(cfg Config) error {
	if cfg.Port < minPort || cfg.Port > maxPort {
		return fmt.Errorf("port out of range [%d,%d]: %d", minPort, maxPort, cfg.Port)
	}
	return nil
}

// GetOrCreateToken 기존 토큰을 반환하거나, 없으면 신규 발급해 키체인에 저장한다.
// 첫 활성화 직전이나 서버 시작 직전에 호출한다.
func (s *ConfigStore) GetOrCreateToken() (string, error) {
	if s.keychain == nil {
		return "", errors.New("keychain not configured")
	}

	tok, err := s.keychain.GetCredential(keychainServiceMCP, keychainTokenKey)
	if err != nil {
		return "", fmt.Errorf("keychain get mcp token: %w", err)
	}
	if tok != "" {
		return tok, nil
	}

	tok, err = generateToken()
	if err != nil {
		return "", err
	}
	if err := s.keychain.SaveCredential(keychainServiceMCP, keychainTokenKey, tok); err != nil {
		return "", fmt.Errorf("keychain save mcp token: %w", err)
	}
	return tok, nil
}

// RegenerateToken 토큰을 강제로 재발급한다 — 기존 클라이언트는 401 받게 됨.
func (s *ConfigStore) RegenerateToken() (string, error) {
	if s.keychain == nil {
		return "", errors.New("keychain not configured")
	}
	tok, err := generateToken()
	if err != nil {
		return "", err
	}
	if err := s.keychain.SaveCredential(keychainServiceMCP, keychainTokenKey, tok); err != nil {
		return "", fmt.Errorf("keychain save mcp token: %w", err)
	}
	return tok, nil
}

// DeleteToken 키체인에서 토큰을 삭제한다 (모든 사용자 데이터 초기화 경로 등에서 호출).
func (s *ConfigStore) DeleteToken() error {
	if s.keychain == nil {
		return nil
	}
	return s.keychain.DeleteCredential(keychainServiceMCP, keychainTokenKey)
}

// generateToken 32-byte 랜덤 hex 토큰을 생성한다 (256비트 엔트로피).
func generateToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("random token: %w", err)
	}
	return hex.EncodeToString(buf), nil
}
