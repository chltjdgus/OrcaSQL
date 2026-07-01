package main

// app_import_export_test.go — mergeImport / ExportConnections / ImportConnections 검증.
// v1/v2 포맷 + 중복 ID 덮어쓰기 + 비밀번호 strip + JSON 파싱 라운드트립.
// 실제 파일 IO 를 사용하므로 newTestApp 의 임시 디렉토리에서 격리.

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"orcasql/internal/connection"
)

// TestMergeImport_EmptyExisting 기존 설정이 없는 상태에 새 연결을 추가하는 경로.
func TestMergeImport_EmptyExisting(t *testing.T) {
	a := newTestApp(t)
	conns := []connection.ConnectConfig{
		{ID: "c1", Name: "Conn1", Host: "h1"},
		{ID: "c2", Name: "Conn2", Host: "h2"},
	}
	added, err := a.mergeImport(conns, nil)
	if err != nil {
		t.Fatalf("mergeImport: %v", err)
	}
	if added != 2 {
		t.Fatalf("added = %d; want 2", added)
	}
	cfg := readRawConfig(t, a.configPath)
	if len(cfg.Connections) != 2 {
		t.Fatalf("Connections len = %d; want 2", len(cfg.Connections))
	}
}

// TestMergeImport_DuplicateOverwrite 동일 ID 는 덮어쓰기되며 added 카운트에서 제외.
func TestMergeImport_DuplicateOverwrite(t *testing.T) {
	a := newTestApp(t)
	// 1차 import — 2건 신규
	_, err := a.mergeImport([]connection.ConnectConfig{
		{ID: "c1", Name: "Original1", Host: "old"},
		{ID: "c2", Name: "Original2", Host: "old"},
	}, nil)
	if err != nil {
		t.Fatalf("first import: %v", err)
	}
	// 2차 import — c1 덮어쓰기 + c3 신규
	added, err := a.mergeImport([]connection.ConnectConfig{
		{ID: "c1", Name: "Updated1", Host: "new"},
		{ID: "c3", Name: "New3", Host: "new"},
	}, nil)
	if err != nil {
		t.Fatalf("second import: %v", err)
	}
	if added != 1 {
		t.Fatalf("added = %d; want 1 (c3 only)", added)
	}
	cfg := readRawConfig(t, a.configPath)
	if len(cfg.Connections) != 3 {
		t.Fatalf("Connections len = %d; want 3", len(cfg.Connections))
	}
	// c1 의 Name 이 덮어쓰기 되었는지 확인
	var c1 connection.ConnectConfig
	for _, c := range cfg.Connections {
		if c.ID == "c1" {
			c1 = c
			break
		}
	}
	if c1.Name != "Updated1" || c1.Host != "new" {
		t.Fatalf("c1 = %+v; want Updated1/new", c1)
	}
}

// TestMergeImport_StripPassword 비밀번호 평문은 저장되지 않아야 한다 (키체인 분리 정책).
func TestMergeImport_StripPassword(t *testing.T) {
	a := newTestApp(t)
	_, err := a.mergeImport([]connection.ConnectConfig{
		{ID: "c1", Name: "Conn1", Password: "secret_should_be_stripped"},
	}, nil)
	if err != nil {
		t.Fatalf("mergeImport: %v", err)
	}
	cfg := readRawConfig(t, a.configPath)
	if len(cfg.Connections) != 1 {
		t.Fatalf("Connections len = %d; want 1", len(cfg.Connections))
	}
	if cfg.Connections[0].Password != "" {
		t.Fatalf("Password = %q; should be empty (stripped)", cfg.Connections[0].Password)
	}
}

// TestMergeImport_GroupsMerge v2 포맷에서 그룹도 함께 병합되고 중복 ID 는 덮어쓴다.
func TestMergeImport_GroupsMerge(t *testing.T) {
	a := newTestApp(t)
	// 1차 — 그룹 2건
	_, err := a.mergeImport(nil, []connection.SessionGroup{
		{ID: "g1", Name: "Group1"},
		{ID: "g2", Name: "Group2"},
	})
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	// 2차 — g1 덮어쓰기 + g3 신규
	_, err = a.mergeImport(nil, []connection.SessionGroup{
		{ID: "g1", Name: "Updated1"},
		{ID: "g3", Name: "Group3"},
	})
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	cfg := readRawConfig(t, a.configPath)
	if len(cfg.Groups) != 3 {
		t.Fatalf("Groups len = %d; want 3", len(cfg.Groups))
	}
	// g1 갱신 확인
	var g1Name string
	for _, g := range cfg.Groups {
		if g.ID == "g1" {
			g1Name = g.Name
			break
		}
	}
	if g1Name != "Updated1" {
		t.Fatalf("g1.Name = %q; want Updated1", g1Name)
	}
}

// TestMergeImport_NoGroupsKeepsExisting 그룹 인자가 nil 이면 기존 그룹을 건드리지 않는다.
func TestMergeImport_NoGroupsKeepsExisting(t *testing.T) {
	a := newTestApp(t)
	// 1차 — 그룹 추가
	if _, err := a.mergeImport(nil, []connection.SessionGroup{{ID: "g1", Name: "G1"}}); err != nil {
		t.Fatalf("seed groups: %v", err)
	}
	// 2차 — 연결만 import, groups=nil
	if _, err := a.mergeImport([]connection.ConnectConfig{{ID: "c1", Name: "C1"}}, nil); err != nil {
		t.Fatalf("conns only: %v", err)
	}
	cfg := readRawConfig(t, a.configPath)
	if len(cfg.Groups) != 1 || cfg.Groups[0].ID != "g1" {
		t.Fatalf("Groups = %+v; want [g1] preserved", cfg.Groups)
	}
	if len(cfg.Connections) != 1 || cfg.Connections[0].ID != "c1" {
		t.Fatalf("Connections = %+v; want [c1]", cfg.Connections)
	}
}

// ─── ExportConnections / ImportConnections ─────────────────────────────────

// TestExportConnections_EmptyState 빈 설정에서도 valid v2 JSON 을 반환한다.
func TestExportConnections_EmptyState(t *testing.T) {
	a := newTestApp(t)
	out, err := a.ExportConnections(context.Background())
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	var p exportPayload
	if err := json.Unmarshal([]byte(out), &p); err != nil {
		t.Fatalf("output is not valid JSON: %v", err)
	}
	if p.Version != 2 {
		t.Fatalf("Version = %d; want 2", p.Version)
	}
	if len(p.Connections) != 0 {
		t.Fatalf("Connections = %+v; want empty", p.Connections)
	}
}

// TestExportConnections_StripsPassword 파일에 평문 비밀번호가 남아있더라도 Export 결과에서는 제거된다.
// (외부 편집 / 마이그레이션 미수행 시나리오 가드)
func TestExportConnections_StripsPassword(t *testing.T) {
	a := newTestApp(t)
	// 파일에 직접 평문 비밀번호 포함된 cfg 저장 (실제 시나리오에선 보통 일어나지 않지만 방어적 strip 가드)
	if err := a.saveAppConfig(appConfig{
		Version: 2,
		Connections: []connection.ConnectConfig{
			{ID: "c1", Name: "C1", Password: "leaked_plaintext"},
		},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	out, err := a.ExportConnections(context.Background())
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	if strings.Contains(out, "leaked_plaintext") {
		t.Fatalf("Export output contains plaintext password — strip violated:\n%s", out)
	}
	// 구조도 함께 검증 — Password 필드 자체가 빈 문자열로 직렬화됨
	var p exportPayload
	if err := json.Unmarshal([]byte(out), &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(p.Connections) != 1 || p.Connections[0].Password != "" {
		t.Fatalf("Connections[0] = %+v; want Password empty", p.Connections[0])
	}
}

// TestExportConnections_IncludesGroups v2 포맷에서 그룹도 함께 직렬화된다.
func TestExportConnections_IncludesGroups(t *testing.T) {
	a := newTestApp(t)
	if _, err := a.mergeImport(
		[]connection.ConnectConfig{{ID: "c1", Name: "C1"}},
		[]connection.SessionGroup{{ID: "g1", Name: "G1"}, {ID: "g2", Name: "G2"}},
	); err != nil {
		t.Fatalf("seed: %v", err)
	}
	out, err := a.ExportConnections(context.Background())
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	var p exportPayload
	if err := json.Unmarshal([]byte(out), &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(p.Groups) != 2 {
		t.Fatalf("Groups len = %d; want 2", len(p.Groups))
	}
}

// TestImportConnections_V2Format 명시적 v2 JSON (version + connections + groups) 을 처리한다.
func TestImportConnections_V2Format(t *testing.T) {
	a := newTestApp(t)
	jsonStr := `{
		"version": 2,
		"connections": [
			{"id": "c1", "name": "C1"},
			{"id": "c2", "name": "C2"}
		],
		"groups": [
			{"id": "g1", "name": "G1"}
		]
	}`
	added, err := a.ImportConnections(context.Background(), jsonStr)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if added != 2 {
		t.Fatalf("added = %d; want 2", added)
	}
	cfg := readRawConfig(t, a.configPath)
	if len(cfg.Connections) != 2 {
		t.Fatalf("Connections len = %d; want 2", len(cfg.Connections))
	}
	if len(cfg.Groups) != 1 || cfg.Groups[0].ID != "g1" {
		t.Fatalf("Groups = %+v; want [g1]", cfg.Groups)
	}
}

// TestImportConnections_V1Fallback flat array (version 키 없음) 도 처리한다 (하위 호환).
func TestImportConnections_V1Fallback(t *testing.T) {
	a := newTestApp(t)
	jsonStr := `[
		{"id": "c1", "name": "C1"},
		{"id": "c2", "name": "C2"}
	]`
	added, err := a.ImportConnections(context.Background(), jsonStr)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if added != 2 {
		t.Fatalf("added = %d; want 2", added)
	}
	cfg := readRawConfig(t, a.configPath)
	if len(cfg.Connections) != 2 {
		t.Fatalf("Connections len = %d; want 2", len(cfg.Connections))
	}
	// v1 폴백은 그룹 정보가 없으므로 빈 상태 유지
	if len(cfg.Groups) != 0 {
		t.Fatalf("Groups = %+v; want empty (v1 has no groups)", cfg.Groups)
	}
}

// TestImportConnections_InvalidJSON 잘못된 JSON 은 명시적 에러 + 0 added.
func TestImportConnections_InvalidJSON(t *testing.T) {
	a := newTestApp(t)
	added, err := a.ImportConnections(context.Background(), "not json {{{")
	if err == nil {
		t.Fatalf("expected error for invalid JSON, got nil")
	}
	if added != 0 {
		t.Fatalf("added = %d; want 0 on error", added)
	}
}

// TestRoundTrip_ExportThenImport A 에서 export 한 JSON 을 B 에 import 하면 A 의 상태가 복원된다.
// 가장 중요한 통합 테스트 — Export/Import/mergeImport/loadAppConfig/saveAppConfig 가 모두 협력해야 통과.
func TestRoundTrip_ExportThenImport(t *testing.T) {
	// A — seed
	appA := newTestApp(t)
	seedConns := []connection.ConnectConfig{
		{ID: "c1", Name: "C1", Host: "h1", Port: 3306, User: "u1", Database: "db1"},
		{ID: "c2", Name: "C2", Host: "h2", Port: 3307, User: "u2", Database: "db2"},
	}
	seedGroups := []connection.SessionGroup{
		{ID: "g1", Name: "Prod", ParentID: ""},
		{ID: "g2", Name: "Dev", ParentID: ""},
	}
	if _, err := appA.mergeImport(seedConns, seedGroups); err != nil {
		t.Fatalf("seed A: %v", err)
	}
	exported, err := appA.ExportConnections(context.Background())
	if err != nil {
		t.Fatalf("Export A: %v", err)
	}

	// B — import 수신
	appB := newTestApp(t)
	added, err := appB.ImportConnections(context.Background(), exported)
	if err != nil {
		t.Fatalf("Import B: %v", err)
	}
	if added != len(seedConns) {
		t.Fatalf("added = %d; want %d", added, len(seedConns))
	}

	// B 의 파일을 직접 검사해 A 의 seed 상태와 일치하는지 확인
	cfgB := readRawConfig(t, appB.configPath)
	if len(cfgB.Connections) != len(seedConns) {
		t.Fatalf("B Connections len = %d; want %d", len(cfgB.Connections), len(seedConns))
	}
	if len(cfgB.Groups) != len(seedGroups) {
		t.Fatalf("B Groups len = %d; want %d", len(cfgB.Groups), len(seedGroups))
	}
	// 키 필드 비교 — Host / Port / Name 이 정확히 라운드트립
	for _, want := range seedConns {
		var got connection.ConnectConfig
		for _, c := range cfgB.Connections {
			if c.ID == want.ID {
				got = c
				break
			}
		}
		if got.ID == "" {
			t.Fatalf("connection %q missing in B", want.ID)
		}
		if got.Name != want.Name || got.Host != want.Host || got.Port != want.Port || got.User != want.User || got.Database != want.Database {
			t.Fatalf("connection %q roundtrip mismatch: got %+v, want %+v", want.ID, got, want)
		}
	}
}
