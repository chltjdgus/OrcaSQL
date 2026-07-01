package reset

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"orcasql/internal/keychain"
)

type mockKeychain struct {
	calls []string
	fails map[string]error
}

func (m *mockKeychain) DeleteCredential(service, user string) error {
	key := service + "/" + user
	m.calls = append(m.calls, key)
	if err, ok := m.fails[key]; ok {
		return err
	}
	return nil
}

func TestResetAllUserData_Success(t *testing.T) {
	dir := t.TempDir()
	subDir := filepath.Join(dir, ".orcasql")
	if err := os.MkdirAll(filepath.Join(subDir, "history"), 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"connections.json", "session.json", "favorites.json"} {
		if err := os.WriteFile(filepath.Join(subDir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	mk := &mockKeychain{}
	connIDs := []string{"conn-1", "conn-2"}

	if err := ResetAllUserData(subDir, mk, connIDs); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := os.Stat(subDir); !os.IsNotExist(err) {
		t.Errorf("baseDir should be removed, stat err = %v", err)
	}

	// 2 connID × 3 services = 6 호출
	if len(mk.calls) != 6 {
		t.Errorf("expected 6 keychain calls, got %d: %v", len(mk.calls), mk.calls)
	}
	for _, id := range connIDs {
		for _, svc := range []string{keychain.ServiceDB, keychain.ServiceSSH, keychain.ServiceProxy} {
			want := svc + "/" + id
			found := false
			for _, c := range mk.calls {
				if c == want {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("expected keychain call %q not made", want)
			}
		}
	}
}

func TestResetAllUserData_PartialKeychainFailure(t *testing.T) {
	dir := t.TempDir()
	subDir := filepath.Join(dir, ".orcasql")
	if err := os.MkdirAll(subDir, 0o700); err != nil {
		t.Fatal(err)
	}

	mk := &mockKeychain{
		fails: map[string]error{
			keychain.ServiceSSH + "/conn-1": errors.New("backend down"),
		},
	}

	err := ResetAllUserData(subDir, mk, []string{"conn-1"})
	if err == nil {
		t.Fatal("expected error from partial failure")
	}

	// 디렉토리는 그래도 삭제되어야 함
	if _, statErr := os.Stat(subDir); !os.IsNotExist(statErr) {
		t.Errorf("baseDir should still be removed despite keychain failure")
	}
}

func TestResetAllUserData_EmptyBaseDir_SkipsRemoveAll(t *testing.T) {
	mk := &mockKeychain{}
	if err := ResetAllUserData("", mk, []string{"conn-1"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(mk.calls) != 3 {
		t.Errorf("expected 3 keychain calls, got %d", len(mk.calls))
	}
}

func TestResetAllUserData_NilKeychain_OnlyRemovesDir(t *testing.T) {
	dir := t.TempDir()
	subDir := filepath.Join(dir, ".orcasql")
	if err := os.MkdirAll(subDir, 0o700); err != nil {
		t.Fatal(err)
	}

	if err := ResetAllUserData(subDir, nil, []string{"conn-1"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, statErr := os.Stat(subDir); !os.IsNotExist(statErr) {
		t.Errorf("baseDir should be removed")
	}
}

func TestResetAllUserData_SkipsEmptyConnID(t *testing.T) {
	mk := &mockKeychain{}
	if err := ResetAllUserData("", mk, []string{"", "conn-1"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(mk.calls) != 3 {
		t.Errorf("expected 3 calls (empty ID skipped), got %d", len(mk.calls))
	}
}
