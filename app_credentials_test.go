package main

// app_credentials_test.go — SaveConnection/DeleteConnection/migrateLegacyPasswords 등
// 비밀번호 키체인 이관 관련 시나리오 테스트.
//
// 주의: 이 테스트는 package main 에 속하므로 wails v3 (및 GTK on Linux) 의존성이 필요하다.
// Linux dev 환경에서는 libgtk-3-dev / libwebkit2gtk-4.1-dev 패키지가 설치되어 있어야 한다.

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	gokeyring "github.com/zalando/go-keyring"
	"orcasql/internal/connection"
	"orcasql/internal/keychain"
)

// newTestApp HOME 을 임시 디렉토리로 격리한 최소 App 인스턴스를 생성한다.
// keychain.MockInit 이 먼저 호출되어 있어야 OS 키체인을 건드리지 않는다.
func newTestApp(t *testing.T) *App {
	t.Helper()
	gokeyring.MockInit()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	// Wails Service 는 사용하지 않고 credential 관련 필드만 채운 최소 App 을 구성한다.
	ks := keychain.NewStore()
	configPath := filepath.Join(tmp, ".orcasql", "connections.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	return &App{
		keychainSvc:    ks,
		configPath:     configPath,
		configLockPath: configPath + ".lock",
	}
}

// readRawConfig 테스트에서 파일 내용을 직접 검사하기 위한 헬퍼.
func readRawConfig(t *testing.T, path string) appConfig {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	var cfg appConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return cfg
}

func TestSaveConnection_StoresAllThreeInKeychain(t *testing.T) {
	a := newTestApp(t)
	cfg := connection.ConnectConfig{
		ID:            "conn-1",
		Name:          "test",
		Host:          "localhost",
		Port:          3306,
		User:          "root",
		Password:      "mysql-secret",
		SSHPassword:   "ssh-secret",
		ProxyPassword: "proxy-secret",
	}
	if err := a.SaveConnection(context.Background(), cfg); err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}
	checks := map[string]string{
		keychain.ServiceDB:    "mysql-secret",
		keychain.ServiceSSH:   "ssh-secret",
		keychain.ServiceProxy: "proxy-secret",
	}
	for svc, want := range checks {
		got, err := a.keychainSvc.GetCredential(svc, "conn-1")
		if err != nil {
			t.Errorf("%s get: %v", svc, err)
		}
		if got != want {
			t.Errorf("%s: got %q want %q", svc, got, want)
		}
	}
}

func TestSaveConnection_ClearsAllPasswordFieldsInFile(t *testing.T) {
	a := newTestApp(t)
	cfg := connection.ConnectConfig{
		ID:            "conn-2",
		Name:          "test",
		Password:      "mysql-pw",
		SSHPassword:   "ssh-pw",
		ProxyPassword: "proxy-pw",
	}
	if err := a.SaveConnection(context.Background(), cfg); err != nil {
		t.Fatalf("SaveConnection: %v", err)
	}
	raw := readRawConfig(t, a.configPath)
	if len(raw.Connections) != 1 {
		t.Fatalf("expected 1 connection in file, got %d", len(raw.Connections))
	}
	c := raw.Connections[0]
	if c.Password != "" {
		t.Errorf("Password in file should be empty, got %q", c.Password)
	}
	if c.SSHPassword != "" {
		t.Errorf("SSHPassword in file should be empty, got %q", c.SSHPassword)
	}
	if c.ProxyPassword != "" {
		t.Errorf("ProxyPassword in file should be empty, got %q", c.ProxyPassword)
	}
}

func TestSaveConnection_EmptyPasswordLeavesKeychainUntouched(t *testing.T) {
	a := newTestApp(t)
	// 1차 저장: 비밀번호 모두 채워 저장
	if err := a.SaveConnection(context.Background(), connection.ConnectConfig{
		ID:            "conn-3",
		Name:          "test",
		Password:      "orig-db",
		SSHPassword:   "orig-ssh",
		ProxyPassword: "orig-proxy",
	}); err != nil {
		t.Fatalf("initial save: %v", err)
	}
	// 2차 저장: 비밀번호 필드 비움 (편집 UX 시나리오 — 사용자가 비밀번호 변경 없이 저장)
	if err := a.SaveConnection(context.Background(), connection.ConnectConfig{
		ID:   "conn-3",
		Name: "renamed",
	}); err != nil {
		t.Fatalf("second save: %v", err)
	}
	// 키체인에 원래 값이 그대로 남아있는지
	cases := map[string]string{
		keychain.ServiceDB:    "orig-db",
		keychain.ServiceSSH:   "orig-ssh",
		keychain.ServiceProxy: "orig-proxy",
	}
	for svc, want := range cases {
		got, _ := a.keychainSvc.GetCredential(svc, "conn-3")
		if got != want {
			t.Errorf("%s: empty save overwrote keychain; got %q want %q", svc, got, want)
		}
	}
}

func TestDeleteConnection_RemovesAllThreeKeychainEntries(t *testing.T) {
	a := newTestApp(t)
	if err := a.SaveConnection(context.Background(), connection.ConnectConfig{
		ID:            "conn-4",
		Password:      "db",
		SSHPassword:   "ssh",
		ProxyPassword: "proxy",
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.DeleteConnection(context.Background(), "conn-4"); err != nil {
		t.Fatalf("DeleteConnection: %v", err)
	}
	for _, svc := range []string{keychain.ServiceDB, keychain.ServiceSSH, keychain.ServiceProxy} {
		if got, _ := a.keychainSvc.GetCredential(svc, "conn-4"); got != "" {
			t.Errorf("%s: expected empty after delete, got %q", svc, got)
		}
	}
}

func TestGetSavedConnections_NeverReturnsPasswords(t *testing.T) {
	a := newTestApp(t)
	// 파일에 직접 평문 비밀번호를 써넣어 GetSavedConnections 가 방어적으로 비워 반환하는지 검증.
	tamperedCfg := appConfig{
		Version: 2,
		Connections: []connection.ConnectConfig{{
			ID:            "tampered-1",
			Name:          "raw",
			Password:      "leaked-db",
			SSHPassword:   "leaked-ssh",
			ProxyPassword: "leaked-proxy",
		}},
	}
	data, _ := json.MarshalIndent(tamperedCfg, "", "  ")
	if err := os.WriteFile(a.configPath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := a.GetSavedConnections(context.Background())
	if err != nil {
		t.Fatalf("GetSavedConnections: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 connection, got %d", len(got))
	}
	c := got[0]
	if c.Password != "" || c.SSHPassword != "" || c.ProxyPassword != "" {
		t.Errorf("GetSavedConnections returned plaintext: %+v", c)
	}
}

func TestMigrateLegacyPasswords_MovesPlaintextToKeychain(t *testing.T) {
	a := newTestApp(t)
	// 레거시 상태: 파일에 평문 SSH/Proxy 비밀번호가 남아 있음
	legacy := appConfig{
		Version: 2,
		Connections: []connection.ConnectConfig{{
			ID:            "legacy-1",
			Name:          "legacy",
			Password:      "old-db",
			SSHPassword:   "old-ssh",
			ProxyPassword: "old-proxy",
		}},
	}
	data, _ := json.MarshalIndent(legacy, "", "  ")
	if err := os.WriteFile(a.configPath, data, 0o600); err != nil {
		t.Fatal(err)
	}

	a.migrateLegacyPasswords()

	// 파일에는 평문이 사라져야 함
	raw := readRawConfig(t, a.configPath)
	if len(raw.Connections) != 1 {
		t.Fatalf("expected 1 conn, got %d", len(raw.Connections))
	}
	c := raw.Connections[0]
	if c.Password != "" || c.SSHPassword != "" || c.ProxyPassword != "" {
		t.Errorf("file still has plaintext after migration: %+v", c)
	}
	// 키체인에는 이관되어 있어야 함
	expected := map[string]string{
		keychain.ServiceDB:    "old-db",
		keychain.ServiceSSH:   "old-ssh",
		keychain.ServiceProxy: "old-proxy",
	}
	for svc, want := range expected {
		got, _ := a.keychainSvc.GetCredential(svc, "legacy-1")
		if got != want {
			t.Errorf("%s: keychain got %q want %q", svc, got, want)
		}
	}
}

func TestMigrateLegacyPasswords_PreservesExistingKeychainValue(t *testing.T) {
	a := newTestApp(t)
	// 사용자가 이미 키체인을 별도로 수정해놓은 상황:
	// 키체인에는 새 값, 파일에는 오래된 평문이 남아있음.
	const id = "hybrid-1"
	if err := a.keychainSvc.SaveCredential(keychain.ServiceSSH, id, "new-ssh-from-keychain"); err != nil {
		t.Fatal(err)
	}
	legacy := appConfig{
		Version: 2,
		Connections: []connection.ConnectConfig{{
			ID:          id,
			Name:        "hybrid",
			SSHPassword: "stale-from-file",
		}},
	}
	data, _ := json.MarshalIndent(legacy, "", "  ")
	if err := os.WriteFile(a.configPath, data, 0o600); err != nil {
		t.Fatal(err)
	}

	a.migrateLegacyPasswords()

	// 파일 평문은 제거됐어야 함
	raw := readRawConfig(t, a.configPath)
	if raw.Connections[0].SSHPassword != "" {
		t.Errorf("file still has plaintext: %q", raw.Connections[0].SSHPassword)
	}
	// 키체인 값은 덮어쓰이지 않고 원래대로 보존되어야 함
	got, _ := a.keychainSvc.GetCredential(keychain.ServiceSSH, id)
	if got != "new-ssh-from-keychain" {
		t.Errorf("keychain overwritten by stale plaintext: got %q", got)
	}
}

func TestMigrateLegacyPasswords_Idempotent(t *testing.T) {
	a := newTestApp(t)
	// 첫 저장으로 깨끗한 상태 생성 (이미 키체인 저장 + 파일 빈 값)
	if err := a.SaveConnection(context.Background(), connection.ConnectConfig{
		ID:          "idem-1",
		Password:    "pw",
		SSHPassword: "ssh",
	}); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(a.configPath)
	if err != nil {
		t.Fatal(err)
	}
	beforeStat, err := os.Stat(a.configPath)
	if err != nil {
		t.Fatal(err)
	}
	_ = beforeStat

	// 마이그레이션 두 번 호출 — 두 번째는 no-op 이어야 함
	a.migrateLegacyPasswords()
	a.migrateLegacyPasswords()

	after, err := os.ReadFile(a.configPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Errorf("idempotent migration modified file:\nbefore: %s\nafter: %s", before, after)
	}
}
