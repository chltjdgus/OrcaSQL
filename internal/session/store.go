// Package session — 앱 세션(탭 상태) 저장/복원.
// 앱 종료 전에 현재 열린 탭의 SQL / 연결 정보를 파일에 저장하고,
// 다음 실행 시 복원한다.
package session

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// TabState 탭 하나의 저장 상태.
type TabState struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	SQL      string `json:"sql"`
	ConnID   string `json:"connId"`
	ConnName string `json:"connName"`
	Database string `json:"database"`
	IsActive bool   `json:"isActive"`
}

// ConnectionSessionState 연결별 독립 세션 상태 (Phase 14-A).
// 각 연결마다 자신의 쿼리 탭, 활성 탭, 선택 DB를 가진다.
type ConnectionSessionState struct {
	SelectedDatabase string     `json:"selectedDatabase,omitempty"`
	Tabs             []TabState `json:"tabs,omitempty"`
	ActiveTabID      string     `json:"activeTabId,omitempty"`
}

// SessionState 앱 전체 세션 상태.
//
// Phase 14-A: 연결별 상태는 PerConnection 맵에 저장된다.
// BugFix-BK: PerConnection 키와 ActiveCfgIDs 가 모두 영구 cfgId 기반.
// 휘발성 connID(매 연결마다 ConnectNew 가 새로 발급) 는 직렬화하지 않는다.
// Tabs / ActiveTabID / SelectedDatabase / ActiveConnIDs 는 구버전 호환을 위한 deprecated 필드로,
// Load() 시 PerConnection 으로 자동 마이그레이션된다.
type SessionState struct {
	SavedAt time.Time `json:"savedAt"`

	// BugFix-BK: 연결별 독립 세션 (key = cfgId — 저장된 연결 영구 ID).
	// 한 cfgId 를 두 탭으로 열어도 마지막 종료 시점 상태로 단일 항목 보존.
	PerConnection map[string]ConnectionSessionState `json:"perConnection,omitempty"`

	// BugFix-BK: 자동 재연결 대상 (cfgId 목록). 같은 cfgId 가 여러 번 등장하면 그 만큼 탭이 열림.
	ActiveCfgIDs []string `json:"activeCfgIds,omitempty"`

	// BugFix-BK: 마지막 활성 연결의 cfgId. 복원 후 첫 매칭 newConnId 를 selectedConnId 로 사용.
	SelectedCfgID string `json:"selectedCfgId,omitempty"`

	// ── Deprecated: 구버전 호환 (Phase 14 포맷) ──
	// Load 시 ActiveCfgIDs 가 비어있으면 ActiveConnIDs 를 그대로 폴백 시도하지만,
	// 휘발 UUID 라 GetConnectionWithCredential 이 실패할 수 있다(BugFix-BK 도입 이전 세션).
	ActiveConnIDs  []string `json:"activeConnIds,omitempty"`
	SelectedConnID string   `json:"selectedConnId,omitempty"`

	// ── Deprecated: 구버전 호환 (Load 시 PerConnection 으로 자동 이관) ──
	Tabs             []TabState `json:"tabs,omitempty"`
	ActiveTabID      string     `json:"activeTabId,omitempty"`
	SelectedDatabase string     `json:"selectedDatabase,omitempty"`
	SchemaExpanded   []string   `json:"schemaExpanded,omitempty"` // 사용 안 함 (Phase 14에서 복원 범위 외)
	OpenPanels       []string   `json:"openPanels,omitempty"`     // 사용 안 함 (Phase 14에서 복원 범위 외)
}

// migrateLegacy 구버전 SessionState (Tabs / SelectedDatabase 가 top-level) 를
// 새 PerConnection 구조로 변환한다. PerConnection 이 이미 존재하면 no-op.
func migrateLegacy(s *SessionState) {
	if len(s.PerConnection) > 0 {
		// 이미 신규 포맷
		return
	}
	if len(s.Tabs) == 0 && s.SelectedDatabase == "" {
		// 마이그레이션할 내용 없음
		return
	}

	perConn := make(map[string]ConnectionSessionState)

	// connID 별로 탭 그룹화
	tabsByConn := make(map[string][]TabState)
	activeByConn := make(map[string]string)
	for _, t := range s.Tabs {
		if t.ConnID == "" {
			continue
		}
		tabsByConn[t.ConnID] = append(tabsByConn[t.ConnID], t)
		if t.IsActive {
			activeByConn[t.ConnID] = t.ID
		}
	}

	for connID, tabs := range tabsByConn {
		cs := ConnectionSessionState{
			Tabs:        tabs,
			ActiveTabID: activeByConn[connID],
		}
		// 구버전은 SelectedDatabase 가 단일 필드 → SelectedConnID 의 세션에만 적용
		if connID == s.SelectedConnID && s.SelectedDatabase != "" {
			cs.SelectedDatabase = s.SelectedDatabase
		}
		perConn[connID] = cs
	}

	// SelectedConnID 가 활성 연결인데 탭이 없는 경우라도 selectedDatabase 는 보존
	if s.SelectedConnID != "" && s.SelectedDatabase != "" {
		if _, ok := perConn[s.SelectedConnID]; !ok {
			perConn[s.SelectedConnID] = ConnectionSessionState{SelectedDatabase: s.SelectedDatabase}
		}
	}

	s.PerConnection = perConn
	// 구필드 비우기 (다음 저장 시 깨끗한 신규 포맷이 되도록)
	s.Tabs = nil
	s.ActiveTabID = ""
	s.SelectedDatabase = ""
	s.SchemaExpanded = nil
	s.OpenPanels = nil
}

// Store 세션 파일 관리자.
type Store struct {
	mu       sync.Mutex
	filePath string
}

// NewStore Store 인스턴스를 생성한다.
func NewStore(filePath string) *Store {
	// 디렉토리 자동 생성
	if err := os.MkdirAll(filepath.Dir(filePath), 0o700); err != nil {
		// 실패해도 계속 진행 (파일 저장만 실패)
	}
	return &Store{filePath: filePath}
}

// Save 현재 세션 상태를 파일에 저장한다.
//
// Phase 14-C: 원자적 쓰기.
//  1. session.json.tmp 에 쓰고 fsync()
//  2. 기존 session.json → session.json.bak (1세대 롤링 백업)
//  3. session.json.tmp → session.json (POSIX rename, atomic)
//
// 중간에 크래시해도 session.json 또는 session.json.bak 중 하나는 항상 유효.
func (s *Store) Save(state SessionState) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	state.SavedAt = time.Now()
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal session: %w", err)
	}

	tmpPath := fmt.Sprintf("%s.%d.tmp", s.filePath, os.Getpid())
	bakPath := s.filePath + ".bak"

	// 1) tmp 파일에 쓰고 fsync
	f, err := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("create tmp session: %w", err)
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("write tmp session: %w", err)
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("fsync tmp session: %w", err)
	}
	if err := f.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("close tmp session: %w", err)
	}

	// 2) 기존 파일 → .bak (이전 백업 덮어쓰기)
	if _, err := os.Stat(s.filePath); err == nil {
		// 백업 파일을 만들기 위해 일단 기존 .bak 제거
		_ = os.Remove(bakPath)
		if err := os.Rename(s.filePath, bakPath); err != nil {
			// 백업 실패는 치명적이지 않음 (로그 정도). tmp 는 그대로 유지하고 진행.
			// 단, rename 에 실패하면 다음 단계에서 덮어쓰기로 처리.
		}
	}

	// 3) tmp → 최종 (atomic)
	if err := os.Rename(tmpPath, s.filePath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("rename tmp session: %w", err)
	}
	return nil
}

// Load 저장된 세션 상태를 반환한다. 파일이 없으면 빈 상태(에러 없음)를 반환한다.
//
// Phase 14-C/D:
//   - 파일 없음 → (&SessionState{}, nil) — 정상
//   - 파싱 실패 → .bak 에서 재시도 → 그것도 실패 시 에러 반환 (호출자가 ResetSession 호출)
//
// 구버전 포맷은 PerConnection 으로 자동 마이그레이션된다.
func (s *Store) Load() (*SessionState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadFile(s.filePath)
	if err == nil {
		migrateLegacy(state)
		return state, nil
	}
	if os.IsNotExist(err) {
		return &SessionState{}, nil
	}

	// 메인 파일 로드 실패 → .bak 폴백 시도
	bakPath := s.filePath + ".bak"
	bakState, bakErr := s.loadFile(bakPath)
	if bakErr == nil {
		migrateLegacy(bakState)
		return bakState, nil
	}

	// 둘 다 실패 → 호출자에게 알림 (ResetSession 트리거)
	return nil, fmt.Errorf("load session: %w", err)
}

// loadFile 단일 파일에서 SessionState 를 읽는다 (마이그레이션 미적용).
func (s *Store) loadFile(path string) (*SessionState, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var state SessionState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("parse session %s: %w", filepath.Base(path), err)
	}
	return &state, nil
}

// Clear 세션 파일과 백업을 모두 삭제한다.
func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.clearLocked()
}

// Reset 세션을 빈 상태로 초기화한다 (파일 + 백업 제거).
//
// Phase 14-D: 복원 실패 시 손상된 세션을 정리하기 위해 호출.
func (s *Store) Reset() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.clearLocked()
}

// clearLocked mu 락이 이미 잡힌 상태에서 파일/백업/tmp 를 제거한다.
// tmp 파일은 PID 기반 이름(*.tmp)이므로 glob으로 모두 정리한다.
func (s *Store) clearLocked() error {
	// 고정 파일 (메인 + 백업) 제거
	paths := []string{s.filePath, s.filePath + ".bak"}
	// PID 기반 tmp 파일 제거 (e.g. session.json.12345.tmp)
	if tmpFiles, _ := filepath.Glob(s.filePath + ".*.tmp"); len(tmpFiles) > 0 {
		paths = append(paths, tmpFiles...)
	}

	var firstErr error
	for _, p := range paths {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			if firstErr == nil {
				firstErr = fmt.Errorf("remove %s: %w", filepath.Base(p), err)
			}
		}
	}
	return firstErr
}
