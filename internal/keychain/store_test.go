package keychain

import (
	"os"
	"testing"

	gokeyring "github.com/zalando/go-keyring"
)

// TestMain OS 키체인 대신 인메모리 mock 백엔드로 전환해 모든 테스트가
// 호스트 환경에 영향을 주지 않도록 한다.
func TestMain(m *testing.M) {
	gokeyring.MockInit()
	os.Exit(m.Run())
}

func TestStore_SaveGetDeleteRoundtrip(t *testing.T) {
	s := NewStore()
	cases := []struct {
		service string
		user    string
		pw      string
	}{
		{ServiceDB, "conn-db-1", "mysql-secret"},
		{ServiceSSH, "conn-ssh-1", "ssh-secret"},
		{ServiceProxy, "conn-proxy-1", "proxy-secret"},
	}
	for _, tc := range cases {
		t.Run(tc.service, func(t *testing.T) {
			if err := s.SaveCredential(tc.service, tc.user, tc.pw); err != nil {
				t.Fatalf("SaveCredential: %v", err)
			}
			got, err := s.GetCredential(tc.service, tc.user)
			if err != nil {
				t.Fatalf("GetCredential: %v", err)
			}
			if got != tc.pw {
				t.Errorf("roundtrip mismatch: got %q want %q", got, tc.pw)
			}
			if err := s.DeleteCredential(tc.service, tc.user); err != nil {
				t.Fatalf("DeleteCredential: %v", err)
			}
			if got, _ := s.GetCredential(tc.service, tc.user); got != "" {
				t.Errorf("after delete, expected empty, got %q", got)
			}
		})
	}
}

// TestStore_NamespaceIsolation 동일 connID 에 대해 세 서비스가 서로 다른 값을 독립 유지함을 검증.
func TestStore_NamespaceIsolation(t *testing.T) {
	s := NewStore()
	const id = "shared-conn-id"
	if err := s.SaveCredential(ServiceDB, id, "db-pw"); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveCredential(ServiceSSH, id, "ssh-pw"); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveCredential(ServiceProxy, id, "proxy-pw"); err != nil {
		t.Fatal(err)
	}
	checks := map[string]string{
		ServiceDB:    "db-pw",
		ServiceSSH:   "ssh-pw",
		ServiceProxy: "proxy-pw",
	}
	for svc, want := range checks {
		got, err := s.GetCredential(svc, id)
		if err != nil {
			t.Fatalf("%s get: %v", svc, err)
		}
		if got != want {
			t.Errorf("%s: got %q want %q", svc, got, want)
		}
	}
	// 한 서비스만 지워도 다른 서비스는 보존되어야 한다.
	if err := s.DeleteCredential(ServiceSSH, id); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.GetCredential(ServiceSSH, id); got != "" {
		t.Errorf("deleted SSH should be empty, got %q", got)
	}
	if got, _ := s.GetCredential(ServiceDB, id); got != "db-pw" {
		t.Errorf("DB should still be 'db-pw', got %q", got)
	}
	if got, _ := s.GetCredential(ServiceProxy, id); got != "proxy-pw" {
		t.Errorf("Proxy should still be 'proxy-pw', got %q", got)
	}
	// 정리
	_ = s.DeleteCredential(ServiceDB, id)
	_ = s.DeleteCredential(ServiceProxy, id)
}

// TestStore_GetNonExistentReturnsEmpty 없는 키 조회 시 "" + nil 에러.
func TestStore_GetNonExistentReturnsEmpty(t *testing.T) {
	s := NewStore()
	got, err := s.GetCredential(ServiceDB, "does-not-exist-123")
	if err != nil {
		t.Fatalf("expected nil error for missing key, got %v", err)
	}
	if got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

// TestStore_DeleteNonExistentIsNoOp 없는 키 삭제는 nil 에러.
func TestStore_DeleteNonExistentIsNoOp(t *testing.T) {
	s := NewStore()
	if err := s.DeleteCredential(ServiceDB, "does-not-exist-456"); err != nil {
		t.Errorf("expected nil for missing key delete, got %v", err)
	}
}
