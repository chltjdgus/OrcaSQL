package connection

// ssh_tofu_test.go — SSH TOFU(Trust On First Use) known_hosts 동작 검증.
//
// buildTOFUCallbackFromFile을 직접 호출해 임시 파일에 대해 테스트한다.
// 검증 항목:
//  1. 처음 연결 시 호스트 키가 known_hosts에 저장된다.
//  2. 같은 키로 재연결 시 성공한다.
//  3. 다른 키로 연결 시 MITM 에러가 반환된다.
//  4. 파일이 없을 때 자동 생성된다.
//  5. *net.TCPAddr 등 다양한 net.Addr 타입에서도 정상 동작한다.

import (
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"os"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

// newTestPublicKey 테스트용 ED25519 공개키를 생성한다.
func newTestPublicKey(t *testing.T) ssh.PublicKey {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("ED25519 키 생성 실패: %v", err)
	}
	sshPub, err := ssh.NewPublicKey(pub)
	if err != nil {
		t.Fatalf("ssh.NewPublicKey 실패: %v", err)
	}
	return sshPub
}

// fakeAddr net.Addr 구현체 (테스트용 더미)
type fakeAddr struct{ addr string }

func (a fakeAddr) Network() string { return "tcp" }
func (a fakeAddr) String() string  { return a.addr }

func TestTOFU_FirstConnect_SavesKey(t *testing.T) {
	khPath := tempKnownHostsFile(t)
	pubKey := newTestPublicKey(t)

	cb, err := buildTOFUCallbackFromFile(khPath)
	if err != nil {
		t.Fatalf("buildTOFUCallbackFromFile: %v", err)
	}

	// 처음 연결 → nil 반환(허용) + 키를 파일에 기록
	if callErr := cb("test-host.example.com:22", fakeAddr{"1.2.3.4:22"}, pubKey); callErr != nil {
		t.Fatalf("첫 연결에서 에러: %v", callErr)
	}

	data, _ := os.ReadFile(khPath)
	if !strings.Contains(string(data), "test-host.example.com") {
		t.Errorf("known_hosts에 호스트가 저장되지 않음\n내용: %s", string(data))
	}
}

func TestTOFU_SecondConnect_SameKey_Succeeds(t *testing.T) {
	khPath := tempKnownHostsFile(t)
	pubKey := newTestPublicKey(t)
	hostname := "server.internal:22"
	remote := fakeAddr{"10.0.0.1:22"}

	// 1차: TOFU 저장
	cb1, _ := buildTOFUCallbackFromFile(khPath)
	if err := cb1(hostname, remote, pubKey); err != nil {
		t.Fatalf("1차 연결 에러: %v", err)
	}

	// 2차: 파일 재로드 + 동일 키 → 성공
	cb2, err := buildTOFUCallbackFromFile(khPath)
	if err != nil {
		t.Fatalf("buildTOFUCallbackFromFile (2차): %v", err)
	}
	if err := cb2(hostname, remote, pubKey); err != nil {
		t.Errorf("같은 키 재연결에서 에러: %v", err)
	}
}

func TestTOFU_DifferentKey_ReturnsMITMError(t *testing.T) {
	khPath := tempKnownHostsFile(t)
	key1 := newTestPublicKey(t)
	key2 := newTestPublicKey(t) // 다른 키
	hostname := "secure.example.com:22"
	remote := fakeAddr{"5.6.7.8:22"}

	// 1차: key1 저장
	cb1, _ := buildTOFUCallbackFromFile(khPath)
	if err := cb1(hostname, remote, key1); err != nil {
		t.Fatalf("1차 연결 에러: %v", err)
	}

	// 2차: key2(다른 키) → MITM 에러 반환
	cb2, err := buildTOFUCallbackFromFile(khPath)
	if err != nil {
		t.Fatalf("buildTOFUCallbackFromFile (2차): %v", err)
	}
	mitmErr := cb2(hostname, remote, key2)
	if mitmErr == nil {
		t.Fatal("다른 키 연결에서 에러 없음 — MITM 감지 실패")
	}
	if !strings.Contains(mitmErr.Error(), "호스트 키 불일치") {
		t.Errorf("MITM 에러 메시지 불일치: %v", mitmErr)
	}
}

func TestTOFU_FileNotExist_AutoCreated(t *testing.T) {
	// 파일 미존재 상태 → buildTOFUCallbackFromFile이 자동 생성
	dir := t.TempDir()
	khPath := dir + "/known_hosts"

	pubKey := newTestPublicKey(t)
	cb, err := buildTOFUCallbackFromFile(khPath)
	if err != nil {
		t.Fatalf("buildTOFUCallbackFromFile: %v", err)
	}
	if err := cb("myhost.local:22", fakeAddr{"192.168.1.1:22"}, pubKey); err != nil {
		t.Fatalf("연결 에러: %v", err)
	}
	if _, statErr := os.Stat(khPath); statErr != nil {
		t.Errorf("known_hosts 파일이 자동 생성되지 않음: %v", statErr)
	}
}

func TestTOFU_TCPAddr_Works(t *testing.T) {
	khPath := tempKnownHostsFile(t)
	pubKey := newTestPublicKey(t)
	cb, _ := buildTOFUCallbackFromFile(khPath)

	tcpAddr, _ := net.ResolveTCPAddr("tcp", "127.0.0.1:3306")
	if err := cb("localhost:3306", tcpAddr, pubKey); err != nil {
		t.Errorf("*net.TCPAddr 사용 시 에러: %v", err)
	}
}

// tempKnownHostsFile 빈 임시 known_hosts 파일을 생성하고 경로를 반환한다.
func tempKnownHostsFile(t *testing.T) string {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "known_hosts_*")
	if err != nil {
		t.Fatalf("임시 파일 생성 실패: %v", err)
	}
	path := f.Name()
	f.Close()
	return path
}
