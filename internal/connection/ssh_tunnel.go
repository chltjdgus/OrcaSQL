package connection

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
	"orcasql/internal/filelock"
)

// SSHConfig SSH 연결 설정.
type SSHConfig struct {
	Host    string
	Port    int
	User    string
	KeyPath string   // 개인키 경로 (빈 문자열이면 agent 또는 패스워드 사용)
	Password string  // SSH 패스워드 인증 (KeyPath 없을 때 사용)
}

// OpenTunnel SSH 터널을 오픈하고 로컬 포트를 반환한다.
// MySQL 트래픽이 localPort → remoteHost:remotePort 로 포워딩된다.
// 반환된 closeFn을 호출하면 터널과 SSH 연결이 정리된다.
func OpenTunnel(ctx context.Context, cfg SSHConfig, remoteHost string, remotePort int) (localPort int, closeFn func(), err error) {
	if cfg.Port == 0 {
		cfg.Port = 22
	}

	authMethods, err := buildAuthMethods(cfg)
	if err != nil {
		return 0, nil, fmt.Errorf("ssh auth: %w", err)
	}

	hostKeyCallback, err := buildTOFUCallback()
	if err != nil {
		return 0, nil, fmt.Errorf("ssh known_hosts: %w", err)
	}

	sshConfig := &ssh.ClientConfig{
		User:            cfg.User,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
		Timeout:         15 * time.Second,
	}

	sshAddr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	sshClient, err := ssh.Dial("tcp", sshAddr, sshConfig)
	if err != nil {
		return 0, nil, fmt.Errorf("ssh dial [%s]: %w", sshAddr, err)
	}

	// 로컬 포트 동적 할당
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		sshClient.Close()
		return 0, nil, fmt.Errorf("local listen: %w", err)
	}

	localPort = listener.Addr().(*net.TCPAddr).Port
	slog.Info("SSH tunnel opened", "local", localPort, "remote", fmt.Sprintf("%s:%d", remoteHost, remotePort))

	// 포워딩 goroutine
	go func() {
		defer listener.Close()
		for {
			localConn, err := listener.Accept()
			if err != nil {
				return
			}
			remoteAddr := fmt.Sprintf("%s:%d", remoteHost, remotePort)
			remoteConn, err := sshClient.Dial("tcp", remoteAddr)
			if err != nil {
				slog.Warn("ssh tunnel forward failed", "error", err)
				localConn.Close()
				continue
			}
			go forward(localConn, remoteConn)
		}
	}()

	closeFn = func() {
		listener.Close()
		sshClient.Close()
		slog.Info("SSH tunnel closed", "local", localPort)
	}

	return localPort, closeFn, nil
}

// forward 두 연결 사이의 양방향 데이터 복사.
func forward(local, remote net.Conn) {
	defer local.Close()
	defer remote.Close()
	done := make(chan struct{}, 2)
	go func() {
		io.Copy(local, remote) //nolint:errcheck
		done <- struct{}{}
	}()
	go func() {
		io.Copy(remote, local) //nolint:errcheck
		done <- struct{}{}
	}()
	<-done
}

// orcasqlKnownHostsPath OrcaSQL 전용 known_hosts 파일 경로를 반환한다.
// ~/.orcasql/known_hosts
func orcasqlKnownHostsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("user home dir: %w", err)
	}
	dir := filepath.Join(home, ".orcasql")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("mkdir .orcasql: %w", err)
	}
	return filepath.Join(dir, "known_hosts"), nil
}

// buildTOFUCallback TOFU(Trust On First Use) 방식의 HostKeyCallback을 반환한다.
//
// 동작:
//  1. ~/.orcasql/known_hosts 파일에서 이미 알려진 호스트 키를 로드한다.
//  2. 처음 연결하는 호스트(키 없음)는 자동으로 신뢰하고 파일에 저장한다.
//  3. 이미 저장된 호스트의 키가 다르면 오류를 반환한다 (MITM 감지).
func buildTOFUCallback() (ssh.HostKeyCallback, error) {
	khPath, err := orcasqlKnownHostsPath()
	if err != nil {
		// 파일 경로를 얻을 수 없으면 보안 경고 후 InsecureIgnoreHostKey로 폴백
		slog.Warn("cannot determine known_hosts path, falling back to insecure", "error", err)
		return ssh.InsecureIgnoreHostKey(), nil //nolint:gosec
	}
	return buildTOFUCallbackFromFile(khPath)
}

// buildTOFUCallbackFromFile 지정된 known_hosts 파일 경로를 사용하는 TOFU 콜백을 반환한다.
// 테스트에서 임시 파일 경로를 주입할 수 있도록 buildTOFUCallback에서 분리되었다.
func buildTOFUCallbackFromFile(khPath string) (ssh.HostKeyCallback, error) {
	// 파일이 없으면 빈 파일 생성
	if _, statErr := os.Stat(khPath); os.IsNotExist(statErr) {
		f, createErr := os.OpenFile(khPath, os.O_CREATE|os.O_WRONLY, 0600)
		if createErr != nil {
			slog.Warn("cannot create known_hosts file", "path", khPath, "error", createErr)
			return ssh.InsecureIgnoreHostKey(), nil //nolint:gosec
		}
		f.Close()
	}

	// 기존 known_hosts 로드
	strictCallback, err := knownhosts.New(khPath)
	if err != nil {
		slog.Warn("cannot load known_hosts, falling back to insecure", "path", khPath, "error", err)
		return ssh.InsecureIgnoreHostKey(), nil //nolint:gosec
	}

	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		err := strictCallback(hostname, remote, key)
		if err == nil {
			// 이미 알려진 호스트 — 검증 성공
			return nil
		}

		var keyErr *knownhosts.KeyError
		if !errors.As(err, &keyErr) {
			// 파싱 오류 등 예기치 않은 오류
			return fmt.Errorf("known_hosts check: %w", err)
		}

		if len(keyErr.Want) > 0 {
			// 저장된 키와 다름 → MITM 가능성
			slog.Error("SSH host key mismatch — possible MITM attack",
				"host", hostname,
				"expected_fingerprint", ssh.FingerprintSHA256(keyErr.Want[0].Key),
				"got_fingerprint", ssh.FingerprintSHA256(key),
			)
			return fmt.Errorf(
				"SSH 호스트 키 불일치: %s\n저장된 키: %s\n현재 키: %s\n"+
					"의도적인 서버 교체라면 ~/.orcasql/known_hosts에서 해당 항목을 삭제하세요",
				hostname,
				ssh.FingerprintSHA256(keyErr.Want[0].Key),
				ssh.FingerprintSHA256(key),
			)
		}

		// TOFU: 처음 보는 호스트 — 키를 저장하고 신뢰
		normalizedHost := knownhosts.Normalize(hostname)
		line := knownhosts.Line([]string{normalizedHost}, key)

		f, openErr := os.OpenFile(khPath, os.O_APPEND|os.O_WRONLY, 0600)
		if openErr != nil {
			slog.Warn("cannot append to known_hosts", "path", khPath, "error", openErr)
			return nil // 저장 실패는 연결 차단하지 않음 (비보안적이나 UX 우선)
		}
		defer f.Close()

		if _, writeErr := fmt.Fprintf(f, "%s\n", line); writeErr != nil {
			slog.Warn("cannot write known_hosts entry", "error", writeErr)
		} else {
			slog.Info("SSH host key saved (TOFU)",
				"host", normalizedHost,
				"fingerprint", ssh.FingerprintSHA256(key),
				"path", khPath,
			)
		}
		return nil
	}, nil
}

// buildAuthMethods SSH 인증 방식을 구성한다.
// 키 파일이 있으면 공개키 인증, 없으면 패스워드 인증을 시도한다.
func buildAuthMethods(cfg SSHConfig) ([]ssh.AuthMethod, error) {
	var methods []ssh.AuthMethod

	if cfg.KeyPath != "" {
		keyData, err := os.ReadFile(cfg.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("read ssh key [%s]: %w", cfg.KeyPath, err)
		}
		signer, err := ssh.ParsePrivateKey(keyData)
		if err != nil {
			return nil, fmt.Errorf("parse ssh key: %w", err)
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}

	if cfg.Password != "" {
		methods = append(methods, ssh.Password(cfg.Password))
	}

	if len(methods) == 0 {
		return nil, fmt.Errorf("no SSH auth method configured (key or password required)")
	}

	return methods, nil
}

// KnownHostEntry known_hosts 파일의 개별 항목.
type KnownHostEntry struct {
	Line        string `json:"line"`        // 원본 텍스트 라인
	Host        string `json:"host"`        // 호스트명/IP
	KeyType     string `json:"keyType"`     // 키 타입 (ssh-rsa, ecdsa-sha2-nistp256 등)
	Fingerprint string `json:"fingerprint"` // SHA256 핑거프린트
}

// ListKnownHosts ~/.orcasql/known_hosts의 모든 항목을 반환한다.
func ListKnownHosts() ([]KnownHostEntry, error) {
	khPath, err := orcasqlKnownHostsPath()
	if err != nil {
		return nil, fmt.Errorf("known_hosts path: %w", err)
	}

	data, err := os.ReadFile(khPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []KnownHostEntry{}, nil
		}
		return nil, fmt.Errorf("read known_hosts: %w", err)
	}

	var entries []KnownHostEntry
	for _, rawLine := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// known_hosts 형식: host keytype base64key [comment]
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}

		// golang.org/x/crypto/ssh knownhosts 파서로 키 파싱
		_, hosts, pubKey, _, _, parseErr := ssh.ParseKnownHosts([]byte(line))
		entry := KnownHostEntry{Line: line, Host: fields[0]}
		if parseErr == nil && len(hosts) > 0 {
			entry.Host = strings.Join(hosts, ", ")
			entry.KeyType = pubKey.Type()
			entry.Fingerprint = ssh.FingerprintSHA256(pubKey)
		} else {
			entry.KeyType = fields[1]
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// DeleteKnownHost ~/.orcasql/known_hosts에서 특정 호스트의 항목을 삭제한다.
// host는 항목의 Line 필드와 정확히 일치해야 한다.
// 다중 인스턴스 동시 삭제 시 데이터 손실을 막기 위해 exclusive lock을 사용한다.
func DeleteKnownHost(lineToDelete string) error {
	khPath, err := orcasqlKnownHostsPath()
	if err != nil {
		return fmt.Errorf("known_hosts path: %w", err)
	}

	lockPath := khPath + ".lock"
	tmpPath := fmt.Sprintf("%s.%d.tmp", khPath, os.Getpid())

	return filelock.WithExclusiveLock(lockPath, filelock.DefaultTimeout, func() error {
		data, err := os.ReadFile(khPath)
		if err != nil {
			return fmt.Errorf("read known_hosts: %w", err)
		}

		var kept []string
		found := false
		for _, rawLine := range strings.Split(string(data), "\n") {
			if strings.TrimSpace(rawLine) == strings.TrimSpace(lineToDelete) {
				found = true
				continue // 이 줄 제외
			}
			kept = append(kept, rawLine)
		}

		if !found {
			return fmt.Errorf("entry not found in known_hosts")
		}

		// 마지막 빈 줄 정리
		result := strings.Join(kept, "\n")
		result = strings.TrimRight(result, "\n") + "\n"

		if err := filelock.AtomicWriteFile(khPath, tmpPath, []byte(result), 0o600); err != nil {
			return fmt.Errorf("write known_hosts: %w", err)
		}
		slog.Info("SSH known_hosts entry deleted", "line", lineToDelete)
		return nil
	})
}
