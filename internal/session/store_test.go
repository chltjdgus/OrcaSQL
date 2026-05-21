package session

// store_test.go — 세션 Save/Load/Reset, .bak 폴백, migrateLegacy 테스트.
// 모든 테스트는 t.TempDir() 로 격리해 실제 사용자 홈을 건드리지 않는다.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "session.json")
	return NewStore(path), path
}

// ─── migrateLegacy ───────────────────────────────────────────────────────────

func TestMigrateLegacy_NoOpWhenPerConnectionPresent(t *testing.T) {
	s := &SessionState{
		PerConnection: map[string]ConnectionSessionState{
			"cfg-a": {SelectedDatabase: "db1"},
		},
		Tabs: []TabState{{ID: "t1", ConnID: "old-conn", SQL: "SELECT 1"}}, // 무시되어야 함
	}
	migrateLegacy(s)
	if len(s.PerConnection) != 1 {
		t.Errorf("PerConnection should not be modified when already populated, got: %v", s.PerConnection)
	}
	if len(s.Tabs) == 0 {
		t.Errorf("Tabs should NOT be cleared when migration is no-op, got empty")
	}
}

func TestMigrateLegacy_NoOpWhenNothingToMigrate(t *testing.T) {
	s := &SessionState{}
	migrateLegacy(s)
	if s.PerConnection != nil {
		t.Errorf("PerConnection should remain nil when nothing to migrate")
	}
}

func TestMigrateLegacy_GroupsTabsByConnID(t *testing.T) {
	s := &SessionState{
		Tabs: []TabState{
			{ID: "t1", ConnID: "c1", SQL: "SELECT 1", IsActive: true},
			{ID: "t2", ConnID: "c1", SQL: "SELECT 2"},
			{ID: "t3", ConnID: "c2", SQL: "SELECT 3", IsActive: true},
		},
		ActiveTabID:      "t1",
		SelectedConnID:   "c1",
		SelectedDatabase: "mydb",
	}
	migrateLegacy(s)

	if len(s.PerConnection) != 2 {
		t.Fatalf("expected 2 connections, got %d", len(s.PerConnection))
	}
	c1 := s.PerConnection["c1"]
	if len(c1.Tabs) != 2 {
		t.Errorf("c1 should have 2 tabs, got %d", len(c1.Tabs))
	}
	if c1.ActiveTabID != "t1" {
		t.Errorf("c1 active tab should be t1, got %q", c1.ActiveTabID)
	}
	if c1.SelectedDatabase != "mydb" {
		t.Errorf("c1 selectedDatabase should be 'mydb' (migrated from top-level), got %q", c1.SelectedDatabase)
	}

	c2 := s.PerConnection["c2"]
	if len(c2.Tabs) != 1 {
		t.Errorf("c2 should have 1 tab, got %d", len(c2.Tabs))
	}
	if c2.SelectedDatabase != "" {
		t.Errorf("c2 should NOT inherit top-level selectedDatabase, got %q", c2.SelectedDatabase)
	}

	// 구필드 청소
	if len(s.Tabs) != 0 || s.ActiveTabID != "" || s.SelectedDatabase != "" {
		t.Errorf("legacy fields should be cleared after migration, got Tabs=%v, ActiveTabID=%q, SelectedDatabase=%q",
			s.Tabs, s.ActiveTabID, s.SelectedDatabase)
	}
}

func TestMigrateLegacy_SkipsEmptyConnID(t *testing.T) {
	s := &SessionState{
		Tabs: []TabState{
			{ID: "t1", ConnID: "", SQL: "no-conn"},
			{ID: "t2", ConnID: "c1", SQL: "yes"},
		},
	}
	migrateLegacy(s)
	if _, ok := s.PerConnection[""]; ok {
		t.Errorf("empty ConnID should be skipped, got entry under empty key")
	}
	if len(s.PerConnection["c1"].Tabs) != 1 {
		t.Errorf("c1 should have 1 tab")
	}
}

func TestMigrateLegacy_SelectedDatabaseWithoutTabs(t *testing.T) {
	// 활성 연결이 있고 selectedDatabase 도 있는데 그 연결에 탭이 0개인 경우
	s := &SessionState{
		Tabs:             []TabState{},
		SelectedConnID:   "c1",
		SelectedDatabase: "mydb",
	}
	migrateLegacy(s)
	if s.PerConnection["c1"].SelectedDatabase != "mydb" {
		t.Errorf("selectedDatabase should be preserved on tabless selected conn, got: %v", s.PerConnection)
	}
	if len(s.PerConnection["c1"].Tabs) != 0 {
		t.Errorf("c1 should have 0 tabs, got %d", len(s.PerConnection["c1"].Tabs))
	}
}

// ─── Save / Load ─────────────────────────────────────────────────────────────

func TestSaveLoad_Roundtrip(t *testing.T) {
	store, _ := newTestStore(t)

	in := SessionState{
		PerConnection: map[string]ConnectionSessionState{
			"cfg-a": {
				SelectedDatabase: "db1",
				ActiveTabID:      "t1",
				Tabs: []TabState{
					{ID: "t1", Title: "쿼리 1", SQL: "SELECT 1", ConnName: "prod", Database: "db1", IsActive: true},
				},
			},
		},
		ActiveCfgIDs:  []string{"cfg-a"},
		SelectedCfgID: "cfg-a",
	}

	if err := store.Save(in); err != nil {
		t.Fatalf("Save: %v", err)
	}
	out, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if len(out.ActiveCfgIDs) != 1 || out.ActiveCfgIDs[0] != "cfg-a" {
		t.Errorf("ActiveCfgIDs mismatch: %v", out.ActiveCfgIDs)
	}
	if out.SelectedCfgID != "cfg-a" {
		t.Errorf("SelectedCfgID mismatch: %q", out.SelectedCfgID)
	}
	cs := out.PerConnection["cfg-a"]
	if cs.SelectedDatabase != "db1" || cs.ActiveTabID != "t1" {
		t.Errorf("PerConnection not preserved: %+v", cs)
	}
	if len(cs.Tabs) != 1 || cs.Tabs[0].SQL != "SELECT 1" {
		t.Errorf("Tabs not preserved: %+v", cs.Tabs)
	}
	if out.SavedAt.IsZero() {
		t.Errorf("SavedAt should be set automatically")
	}
}

func TestLoad_FileNotExist(t *testing.T) {
	store, _ := newTestStore(t)
	out, err := store.Load()
	if err != nil {
		t.Fatalf("Load on missing file should not error, got: %v", err)
	}
	if out == nil {
		t.Fatalf("Load should return empty state, not nil")
	}
	if len(out.PerConnection) != 0 || len(out.ActiveCfgIDs) != 0 {
		t.Errorf("expected empty state, got: %+v", out)
	}
}

func TestSave_AtomicLeavesBak(t *testing.T) {
	// Phase 14-C: Save 는 기존 파일을 .bak 로 롤백 백업한 뒤 tmp → 최종으로 rename.
	// 두 번 Save 하면 .bak 에는 첫 번째 상태가, 메인에는 두 번째 상태가 남아야 한다.
	store, path := newTestStore(t)

	first := SessionState{ActiveCfgIDs: []string{"first"}}
	if err := store.Save(first); err != nil {
		t.Fatalf("Save 1: %v", err)
	}
	second := SessionState{ActiveCfgIDs: []string{"second"}}
	if err := store.Save(second); err != nil {
		t.Fatalf("Save 2: %v", err)
	}

	// 메인 파일에는 second
	mainData, _ := os.ReadFile(path)
	var mainState SessionState
	_ = json.Unmarshal(mainData, &mainState)
	if len(mainState.ActiveCfgIDs) != 1 || mainState.ActiveCfgIDs[0] != "second" {
		t.Errorf("main file should hold 'second', got: %v", mainState.ActiveCfgIDs)
	}
	// .bak 에는 first
	bakData, err := os.ReadFile(path + ".bak")
	if err != nil {
		t.Fatalf(".bak should exist after second Save: %v", err)
	}
	var bakState SessionState
	_ = json.Unmarshal(bakData, &bakState)
	if len(bakState.ActiveCfgIDs) != 1 || bakState.ActiveCfgIDs[0] != "first" {
		t.Errorf(".bak should hold 'first', got: %v", bakState.ActiveCfgIDs)
	}
}

func TestLoad_FallsBackToBakOnCorruptedMain(t *testing.T) {
	// Phase 14-C/D: 메인 파일이 손상되면 .bak 에서 복원.
	store, path := newTestStore(t)

	// 두 번 저장해 .bak 생성
	_ = store.Save(SessionState{ActiveCfgIDs: []string{"good-bak"}})
	_ = store.Save(SessionState{ActiveCfgIDs: []string{"good-main"}})

	// 메인 파일을 손상시킴
	if err := os.WriteFile(path, []byte("{ this is not valid json"), 0o600); err != nil {
		t.Fatalf("corrupt main: %v", err)
	}

	out, err := store.Load()
	if err != nil {
		t.Fatalf("Load should succeed via .bak fallback, got: %v", err)
	}
	if len(out.ActiveCfgIDs) != 1 || out.ActiveCfgIDs[0] != "good-bak" {
		t.Errorf("should fall back to .bak content (good-bak), got: %v", out.ActiveCfgIDs)
	}
}

func TestLoad_BothFilesCorruptedReturnsError(t *testing.T) {
	store, path := newTestStore(t)
	if err := os.WriteFile(path, []byte("not json"), 0o600); err != nil {
		t.Fatalf("write main: %v", err)
	}
	if err := os.WriteFile(path+".bak", []byte("also not json"), 0o600); err != nil {
		t.Fatalf("write bak: %v", err)
	}
	_, err := store.Load()
	if err == nil {
		t.Errorf("Load should return error when both files corrupted")
	}
	if !strings.Contains(err.Error(), "load session") {
		t.Errorf("error should be wrapped with 'load session', got: %v", err)
	}
}

func TestLoad_AppliesMigrationOnLegacyFormat(t *testing.T) {
	// 구버전 포맷 직접 기록 → Load 가 자동으로 PerConnection 으로 이관해야 함
	store, path := newTestStore(t)
	legacy := SessionState{
		Tabs: []TabState{
			{ID: "t1", ConnID: "c1", SQL: "SELECT 1", IsActive: true},
		},
		ActiveTabID:      "t1",
		SelectedConnID:   "c1",
		SelectedDatabase: "legacy_db",
	}
	data, _ := json.MarshalIndent(legacy, "", "  ")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write legacy: %v", err)
	}

	out, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(out.PerConnection) != 1 {
		t.Fatalf("legacy should be migrated to PerConnection, got: %+v", out.PerConnection)
	}
	if out.PerConnection["c1"].SelectedDatabase != "legacy_db" {
		t.Errorf("legacy selectedDatabase not migrated: %+v", out.PerConnection["c1"])
	}
	if len(out.Tabs) != 0 {
		t.Errorf("legacy Tabs should be cleared after migration: %+v", out.Tabs)
	}
}

// ─── Reset / Clear ───────────────────────────────────────────────────────────

func TestReset_RemovesMainAndBak(t *testing.T) {
	store, path := newTestStore(t)
	_ = store.Save(SessionState{ActiveCfgIDs: []string{"a"}})
	_ = store.Save(SessionState{ActiveCfgIDs: []string{"b"}})

	if _, err := os.Stat(path + ".bak"); err != nil {
		t.Fatalf("setup precondition: .bak should exist before Reset, got: %v", err)
	}

	if err := store.Reset(); err != nil {
		t.Fatalf("Reset: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("main file should be removed: %v", err)
	}
	if _, err := os.Stat(path + ".bak"); !os.IsNotExist(err) {
		t.Errorf(".bak file should be removed: %v", err)
	}
}

func TestClear_AlsoRemovesPidTmpFiles(t *testing.T) {
	store, path := newTestStore(t)
	// 시뮬레이션: 크래시로 남은 PID tmp 파일
	tmpPath := path + ".99999.tmp"
	if err := os.WriteFile(tmpPath, []byte("orphan"), 0o600); err != nil {
		t.Fatalf("seed tmp: %v", err)
	}
	if err := store.Clear(); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Errorf("orphan tmp file should be cleared: %v", err)
	}
}

func TestReset_NoErrorWhenFilesAlreadyMissing(t *testing.T) {
	store, _ := newTestStore(t)
	if err := store.Reset(); err != nil {
		t.Errorf("Reset should be idempotent on empty dir, got: %v", err)
	}
}
