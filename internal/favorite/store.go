// Package favorite — 쿼리 즐겨찾기(스니펫) 저장/관리.
package favorite

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"orcasql/internal/filelock"
)

// Snippet 즐겨찾기 항목.
type Snippet struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	SQL         string    `json:"sql"`
	Category    string    `json:"category"` // 사용자 정의 카테고리 (예: "분석", "운영")
	Tags        []string  `json:"tags"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	UseCount    int       `json:"useCount"`
}

// Store 즐겨찾기 파일 관리자.
type Store struct {
	mu       sync.RWMutex
	items    []*Snippet
	filePath string
	lockPath string // filePath + ".lock" — 다중 인스턴스 간 exclusive lock
}

// NewStore Store 인스턴스를 생성한다.
func NewStore(filePath string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(filePath), 0o700); err != nil {
		return nil, fmt.Errorf("mkdir: %w", err)
	}
	s := &Store{filePath: filePath, lockPath: filePath + ".lock"}
	if err := s.load(); err != nil {
		return s, nil // 파일 없으면 빈 상태로 시작
	}
	return s, nil
}

// List 모든 즐겨찾기를 반환한다 (사용 횟수 내림차순).
func (s *Store) List() []Snippet {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]Snippet, len(s.items))
	for i, item := range s.items {
		result[i] = *item
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].UseCount != result[j].UseCount {
			return result[i].UseCount > result[j].UseCount
		}
		return result[i].UpdatedAt.After(result[j].UpdatedAt)
	})
	return result
}

// Add 새 즐겨찾기를 추가한다.
func (s *Store) Add(snippet Snippet) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	snippet.CreatedAt = now
	snippet.UpdatedAt = now
	s.items = append(s.items, &snippet)
	return s.save()
}

// Update 기존 즐겨찾기를 수정한다.
func (s *Store) Update(snippet Snippet) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, item := range s.items {
		if item.ID == snippet.ID {
			snippet.CreatedAt = item.CreatedAt
			snippet.UpdatedAt = time.Now()
			s.items[i] = &snippet
			return s.save()
		}
	}
	return fmt.Errorf("snippet %s not found", snippet.ID)
}

// Delete 즐겨찾기를 삭제한다.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, item := range s.items {
		if item.ID == id {
			s.items = append(s.items[:i], s.items[i+1:]...)
			return s.save()
		}
	}
	return nil
}

// IncrementUseCount 사용 횟수를 증가시킨다.
func (s *Store) IncrementUseCount(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, item := range s.items {
		if item.ID == id {
			item.UseCount++
			item.UpdatedAt = time.Now()
			return s.save()
		}
	}
	return nil
}

// ─── 파일 I/O ────────────────────────────────────────────────────────────────

func (s *Store) load() error {
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return err
	}
	var items []*Snippet
	if err := json.Unmarshal(data, &items); err != nil {
		return err
	}
	s.items = items
	return nil
}

func (s *Store) save() error {
	data, err := json.MarshalIndent(s.items, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	tmpPath := fmt.Sprintf("%s.%d.tmp", s.filePath, os.Getpid())
	return filelock.WithExclusiveLock(s.lockPath, filelock.DefaultTimeout, func() error {
		return filelock.AtomicWriteFile(s.filePath, tmpPath, data, 0o600)
	})
}
