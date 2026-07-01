// Package history는 실행된 SQL 쿼리 히스토리를 일(day)단위 JSON 파일로 관리한다.
// ~/.orcasql/history/YYYY-MM-DD.json 형식으로 저장한다.
package history

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"orcasql/internal/filelock"
)

const maxPerDay = 500

// 쿼리 실행 출처 식별자. 빈 값은 UI 호환성을 위해 SourceUI 로 해석한다.
const (
	SourceUI  = "ui"  // Wails UI / 프론트엔드 경로 (기본값)
	SourceMCP = "mcp" // MCP 서버 경로 (Claude / IDE 등 외부 클라이언트)
)

// Entry 쿼리 히스토리 항목.
type Entry struct {
	ID         string        `json:"id"`
	SQL        string        `json:"sql"`
	ConnName   string        `json:"connName"`
	Database   string        `json:"database"`
	ExecutedAt time.Time     `json:"executedAt"`
	Duration   time.Duration `json:"duration"`
	RowCount   int64         `json:"rowCount"`
	Affected   int64         `json:"affected"`
	HasError   bool          `json:"hasError"`
	ErrorMsg   string        `json:"errorMsg,omitempty"`
	Source     string        `json:"source,omitempty"` // "" or "ui" = UI, "mcp" = MCP 서버
}

// Store 쿼리 히스토리 저장소 (일단위 파일 기반).
type Store struct {
	mu      sync.RWMutex
	dirPath string // ~/.orcasql/history/
	lockDir string // dirPath/.locks/ — 날짜별 lock 파일 보관
}

// NewStore 히스토리 저장소를 초기화한다.
// dirPath가 비어 있으면 인메모리 모드(파일 저장 안 함).
func NewStore(dirPath string) (*Store, error) {
	lockDir := filepath.Join(dirPath, ".locks")
	s := &Store{dirPath: dirPath, lockDir: lockDir}
	if dirPath == "" {
		return s, nil
	}
	if err := os.MkdirAll(dirPath, 0o700); err != nil {
		return nil, fmt.Errorf("mkdir history dir: %w", err)
	}
	// 날짜별 lock 파일용 디렉토리 생성 (실패해도 계속 구동)
	if err := os.MkdirAll(lockDir, 0o700); err != nil {
		slog.Warn("history lock dir creation failed", "path", lockDir, "error", err)
	}
	if err := s.migrateOld(); err != nil {
		slog.Warn("history migration failed", "error", err)
	}
	return s, nil
}

// Add 히스토리 항목을 추가한다.
func (s *Store) Add(entry Entry) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	date := entry.ExecutedAt.Format("2006-01-02")
	entries, err := s.loadDateFileLocked(date)
	if err != nil {
		return err
	}

	// 중복 연속 실행은 하나로 합침 (같은 SQL이 오늘 첫 항목과 동일하면 스킵)
	if len(entries) > 0 && entries[0].SQL == entry.SQL && !entry.HasError {
		entries[0] = entry // 최신 실행 시각으로 갱신
	} else {
		entries = append([]Entry{entry}, entries...)
	}

	// 일별 최대 건수 유지
	if len(entries) > maxPerDay {
		entries = entries[:maxPerDay]
	}

	return s.saveDateFileLocked(date, entries)
}

// ListDates 히스토리가 있는 날짜 목록을 내림차순으로 반환한다 (YYYY-MM-DD).
// 결과가 비어 있어도 nil 이 아닌 빈 슬라이스를 반환한다 (JSON null → 프론트 TypeError 방지).
func (s *Store) ListDates() ([]string, error) {
	dates := []string{}
	if s.dirPath == "" {
		return dates, nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()

	entries, err := os.ReadDir(s.dirPath)
	if err != nil {
		if os.IsNotExist(err) {
			return dates, nil
		}
		return dates, fmt.Errorf("readdir history: %w", err)
	}

	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() && strings.HasSuffix(name, ".json") {
			date := strings.TrimSuffix(name, ".json")
			// YYYY-MM-DD 형식 검증 (간단)
			if len(date) == 10 && date[4] == '-' && date[7] == '-' {
				dates = append(dates, date)
			}
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(dates)))
	return dates, nil
}

// ListByDate 특정 날짜의 히스토리를 반환한다.
func (s *Store) ListByDate(date string) ([]Entry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.loadDateFileLocked(date)
}

// Search 쿼리를 검색한다.
// date가 비어 있으면 전체 파일을 검색하고, date가 지정되면 해당 날짜만 검색한다.
func (s *Store) Search(query, date string) ([]Entry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var dates []string
	if date != "" {
		dates = []string{date}
	} else {
		all, err := s.listDatesLocked()
		if err != nil {
			return nil, err
		}
		dates = all
	}

	q := strings.ToLower(query)
	result := []Entry{}
	for _, d := range dates {
		entries, err := s.loadDateFileLocked(d)
		if err != nil {
			slog.Warn("history search: failed to load date file", "date", d, "error", err)
			continue
		}
		for _, e := range entries {
			if strings.Contains(strings.ToLower(e.SQL), q) ||
				strings.Contains(strings.ToLower(e.ConnName), q) ||
				strings.Contains(strings.ToLower(e.Database), q) {
				result = append(result, e)
			}
		}
	}
	return result, nil
}

// DeleteByID 특정 ID의 항목을 삭제한다.
func (s *Store) DeleteByID(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dates, err := s.listDatesLocked()
	if err != nil {
		return err
	}

	for _, date := range dates {
		entries, err := s.loadDateFileLocked(date)
		if err != nil {
			continue
		}
		found := false
		filtered := entries[:0]
		for _, e := range entries {
			if e.ID == id {
				found = true
			} else {
				filtered = append(filtered, e)
			}
		}
		if found {
			return s.saveDateFileLocked(date, filtered)
		}
	}
	return nil // ID를 찾지 못해도 오류 아님
}

// ClearAll 모든 히스토리 파일을 삭제한다.
func (s *Store) ClearAll() error {
	if s.dirPath == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := os.ReadDir(s.dirPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("readdir: %w", err)
	}
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() && strings.HasSuffix(name, ".json") {
			path := filepath.Join(s.dirPath, name)
			if err := os.Remove(path); err != nil {
				slog.Warn("history clearAll: failed to remove file", "path", path, "error", err)
			}
		}
	}
	return nil
}

// ─── 내부 헬퍼 ─────────────────────────────────────────────────────────────

func (s *Store) loadDateFileLocked(date string) ([]Entry, error) {
	// nil 대신 빈 슬라이스 반환 — JSON null 로 직렬화되어 프론트가 .filter() 호출 시 TypeError 발생하는 것을 방지.
	if s.dirPath == "" {
		return []Entry{}, nil
	}
	path := filepath.Join(s.dirPath, date+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []Entry{}, nil
		}
		return []Entry{}, fmt.Errorf("read history file %s: %w", date, err)
	}
	entries := []Entry{}
	if err := json.Unmarshal(data, &entries); err != nil {
		return []Entry{}, fmt.Errorf("unmarshal history file %s: %w", date, err)
	}
	return entries, nil
}

func (s *Store) saveDateFileLocked(date string, newEntries []Entry) error {
	if s.dirPath == "" {
		return nil
	}
	path := filepath.Join(s.dirPath, date+".json")
	lockPath := filepath.Join(s.lockDir, date+".lock")
	tmpPath := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())

	return filelock.WithExclusiveLock(lockPath, filelock.DefaultTimeout, func() error {
		// 다른 인스턴스가 이미 항목을 추가했을 수 있으므로 파일을 재읽기한 뒤 merge
		existing, _ := s.loadDateFileLocked(date)
		merged := mergeHistoryEntries(existing, newEntries)
		data, err := json.Marshal(merged)
		if err != nil {
			return fmt.Errorf("marshal history: %w", err)
		}
		return filelock.AtomicWriteFile(path, tmpPath, data, 0o600)
	})
}

// mergeHistoryEntries는 두 Entry 슬라이스를 병합하여 ID 중복을 제거하고 최신순으로 정렬한다.
// newEntries의 항목이 우선하며(동일 ID면 newEntries 기준), 최대 maxPerDay 개를 반환한다.
func mergeHistoryEntries(existing, newEntries []Entry) []Entry {
	seen := make(map[string]bool)
	result := make([]Entry, 0, len(newEntries)+len(existing))

	for _, e := range newEntries {
		if !seen[e.ID] {
			seen[e.ID] = true
			result = append(result, e)
		}
	}
	for _, e := range existing {
		if !seen[e.ID] {
			seen[e.ID] = true
			result = append(result, e)
		}
	}

	// 최신순 정렬
	sort.Slice(result, func(i, j int) bool {
		return result[i].ExecutedAt.After(result[j].ExecutedAt)
	})

	if len(result) > maxPerDay {
		result = result[:maxPerDay]
	}
	return result
}

// listDatesLocked RLock 또는 Lock 상태에서 호출해야 한다.
func (s *Store) listDatesLocked() ([]string, error) {
	if s.dirPath == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(s.dirPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("readdir history: %w", err)
	}
	var dates []string
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() && strings.HasSuffix(name, ".json") {
			date := strings.TrimSuffix(name, ".json")
			if len(date) == 10 && date[4] == '-' && date[7] == '-' {
				dates = append(dates, date)
			}
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(dates)))
	return dates, nil
}

// migrateOld 기존 단일 파일(query_history.json)을 날짜별 파일로 분산 마이그레이션한다.
func (s *Store) migrateOld() error {
	oldPath := filepath.Join(filepath.Dir(s.dirPath), "query_history.json")
	data, err := os.ReadFile(oldPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // 기존 파일 없음 — 정상
		}
		return fmt.Errorf("read old history: %w", err)
	}

	var entries []Entry
	if err := json.Unmarshal(data, &entries); err != nil {
		return fmt.Errorf("unmarshal old history: %w", err)
	}

	// 날짜별로 그룹화
	byDate := make(map[string][]Entry)
	for _, e := range entries {
		date := e.ExecutedAt.Format("2006-01-02")
		byDate[date] = append(byDate[date], e)
	}

	// 각 날짜 파일로 저장
	for date, dateEntries := range byDate {
		if err := s.saveDateFileLocked(date, dateEntries); err != nil {
			slog.Warn("history migration: failed to save date file", "date", date, "error", err)
		}
	}

	// 원본 파일 삭제
	if err := os.Remove(oldPath); err != nil {
		slog.Warn("history migration: failed to remove old file", "path", oldPath, "error", err)
	}

	slog.Info("history migration complete", "entries", len(entries), "dates", len(byDate))
	return nil
}
