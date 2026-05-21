package connection

// manager_credentials_test.go — Connect 경로에서 MySQL/SSH/Proxy 비밀번호가
// 키체인으로부터 올바르게 복원되는지 검증한다.

import (
	"context"
	"os"
	"strings"
	"testing"

	gokeyring "github.com/zalando/go-keyring"
	"orcasql/internal/keychain"
)

func TestMain(m *testing.M) {
	gokeyring.MockInit()
	os.Exit(m.Run())
}

// TestConnect_RestoresSSHPasswordFromKeychain cfg.SSHPassword=="" + UseSSH=true 일 때
// Connect 가 keychain.ServiceSSH 에서 비밀번호를 복원해 OpenTunnel 까지 전달하는지 검증.
// 실제 SSH dial 은 존재하지 않는 포트로 유도해 "ssh tunnel" 실패 지점에서 멈춘다 —
// 복원 로직이 호출됐다는 것만 증명하면 된다.
func TestConnect_RestoresSSHPasswordFromKeychain(t *testing.T) {
	ks := keychain.NewStore()
	const connID = "test-conn-ssh-restore"
	const sshPW = "restored-ssh-pw"

	if err := ks.SaveCredential(keychain.ServiceSSH, connID, sshPW); err != nil {
		t.Fatalf("setup: save ssh pw: %v", err)
	}
	t.Cleanup(func() { _ = ks.DeleteCredential(keychain.ServiceSSH, connID) })

	m := NewManager(ks)
	cfg := ConnectConfig{
		ID:       connID,
		Name:     "ssh-restore-test",
		Host:     "127.0.0.1",
		Port:     3306,
		User:     "root",
		Password: "db-pw", // DB PW는 복원 단계 스킵
		UseSSH:   true,
		SSHHost:  "127.0.0.1",
		SSHPort:  1, // 사용 불가 포트 → ssh.Dial 실패 유도
		SSHUser:  "test",
		// KeyPath 없음 + SSHPassword 비움 → 키체인에서 복원되어야 함
	}

	_, err := m.Connect(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected Connect to fail at ssh tunnel stage")
	}
	// 복원 실패면 "keychain get ssh password" 에러가 먼저 발생함.
	// 복원 성공 후 OpenTunnel 단계에서 실패해야 한다.
	if strings.Contains(err.Error(), "keychain get ssh password") {
		t.Errorf("keychain restore should have succeeded, but got: %v", err)
	}
	if !strings.Contains(err.Error(), "ssh") {
		t.Errorf("expected ssh-related error after keychain restore, got: %v", err)
	}
}

// TestConnect_RestoresProxyPasswordFromKeychain 프록시 비밀번호 복원 검증.
func TestConnect_RestoresProxyPasswordFromKeychain(t *testing.T) {
	ks := keychain.NewStore()
	const connID = "test-conn-proxy-restore"
	const proxyPW = "restored-proxy-pw"

	if err := ks.SaveCredential(keychain.ServiceProxy, connID, proxyPW); err != nil {
		t.Fatalf("setup: save proxy pw: %v", err)
	}
	t.Cleanup(func() { _ = ks.DeleteCredential(keychain.ServiceProxy, connID) })

	m := NewManager(ks)
	cfg := ConnectConfig{
		ID:        connID,
		Name:      "proxy-restore-test",
		Host:      "127.0.0.1",
		Port:      3306,
		User:      "root",
		Password:  "db-pw",
		UseProxy:  true,
		ProxyType: "socks5",
		ProxyHost: "127.0.0.1",
		ProxyPort: 1, // 사용 불가 포트
		ProxyUser: "puser",
		// ProxyPassword 비움 → 키체인에서 복원되어야 함
	}

	_, err := m.Connect(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected Connect to fail (no real proxy running)")
	}
	if strings.Contains(err.Error(), "keychain get proxy password") {
		t.Errorf("keychain restore should have succeeded, but got: %v", err)
	}
}

// TestConnect_NoKeychainLookupWhenPasswordProvided cfg 에 비밀번호가 이미 있으면
// 키체인을 조회하지 않는지 검증 (빈 값일 때만 복원).
// 이 테스트는 ID="" 로 cfg 를 넘겨 키체인 조회 자체가 일어날 수 없도록 한 뒤
// 호출이 키체인 단계를 건너뛰고 다음 단계(DB PW 누락 또는 DSN 에러)에서 실패함을 확인한다.
func TestConnect_SkipsKeychainWhenCfgIDEmpty(t *testing.T) {
	ks := keychain.NewStore()
	m := NewManager(ks)
	cfg := ConnectConfig{
		ID:       "", // ID 없음 → 키체인 조회 경로 비활성
		Name:     "no-id-test",
		Host:     "127.0.0.1",
		Port:     3306,
		User:     "root",
		Password: "", // 빈 값이지만 ID=="" 이라 복원 시도 안 함
	}
	_, err := m.Connect(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected Connect to fail (no real MySQL)")
	}
	// 키체인 관련 에러가 나지 않아야 함
	if strings.Contains(err.Error(), "keychain") {
		t.Errorf("expected non-keychain error, got: %v", err)
	}
}
