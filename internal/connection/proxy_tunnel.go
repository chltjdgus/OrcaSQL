// Package connection — SOCKS5 및 HTTP CONNECT 프록시를 통한 MySQL 터널링.
//
// 지원 프록시 타입:
//   - "socks5" : SOCKS5 프록시 (RFC 1928). SSH -D 포트포워딩과 함께 사용.
//   - "http"   : HTTP CONNECT 터널. nginx / squid 등 HTTP 프록시와 함께 사용.
//
// go-sql-driver/mysql 은 DSN에 사용자 정의 네트워크 이름을 등록할 수 있다.
// RegisterProxyDialer 가 "proxy-{uuid}" 이름으로 커스텀 다이얼러를 등록하고
// 해당 네트워크 이름을 반환하면 DSN 에서 tcp 대신 사용한다.
package connection

import (
	"bufio"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

// ProxyConfig 프록시 연결 설정.
type ProxyConfig struct {
	Type     string // "socks5" | "http"
	Host     string
	Port     int
	User     string
	Password string
}

// RegisterProxyDialer go-sql-driver/mysql 에 커스텀 다이얼러를 등록하고
// DSN 에서 사용할 네트워크 이름을 반환한다.
// cleanupFn 은 연결 종료 시 호출해야 한다 (현재 no-op, 확장 가능).
func RegisterProxyDialer(cfg ProxyConfig) (networkName string, cleanupFn func(), err error) {
	if cfg.Host == "" {
		return "", nil, fmt.Errorf("proxy host is empty")
	}
	if cfg.Port == 0 {
		cfg.Port = defaultProxyPort(cfg.Type)
	}

	proxyAddr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	networkName = "proxy-" + uuid.New().String()

	var dialFn func(ctx context.Context, addr string) (net.Conn, error)
	switch strings.ToLower(cfg.Type) {
	case "socks5":
		dialFn = makeSocks5Dialer(proxyAddr, cfg.User, cfg.Password)
	case "http":
		dialFn = makeHTTPConnectDialer(proxyAddr, cfg.User, cfg.Password)
	default:
		return "", nil, fmt.Errorf("unsupported proxy type: %q (use socks5 or http)", cfg.Type)
	}

	mysql.RegisterDialContext(networkName, dialFn)
	return networkName, func() { /* no-op */ }, nil
}

func defaultProxyPort(proxyType string) int {
	switch strings.ToLower(proxyType) {
	case "socks5":
		return 1080
	case "http":
		return 3128
	default:
		return 1080
	}
}

// ─── SOCKS5 다이얼러 ────────────────────────────────────────────────────────

// makeSocks5Dialer RFC 1928 SOCKS5 프록시를 통해 TCP 연결을 수립하는 다이얼러를 반환한다.
// user/password 가 빈 문자열이면 인증 없이 연결한다.
func makeSocks5Dialer(proxyAddr, user, password string) func(ctx context.Context, addr string) (net.Conn, error) {
	return func(ctx context.Context, addr string) (net.Conn, error) {
		conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", proxyAddr)
		if err != nil {
			return nil, fmt.Errorf("dial proxy %s: %w", proxyAddr, err)
		}

		if err := socks5Handshake(conn, addr, user, password); err != nil {
			conn.Close()
			return nil, fmt.Errorf("socks5 handshake: %w", err)
		}
		return conn, nil
	}
}

// socks5Handshake SOCKS5 핸드셰이크를 수행한다.
func socks5Handshake(conn net.Conn, targetAddr, user, password string) error {
	host, portStr, err := net.SplitHostPort(targetAddr)
	if err != nil {
		return fmt.Errorf("parse target addr: %w", err)
	}
	port, err := net.LookupPort("tcp", portStr)
	if err != nil {
		return fmt.Errorf("lookup port: %w", err)
	}

	// ─── 1단계: 인증 협상 ────────────────────────────────────────────────
	useAuth := user != ""
	var authMethods []byte
	if useAuth {
		authMethods = []byte{0x05, 0x02, 0x00, 0x02} // NO_AUTH + USERNAME/PASSWORD
	} else {
		authMethods = []byte{0x05, 0x01, 0x00} // NO_AUTH only
	}
	if _, err := conn.Write(authMethods); err != nil {
		return err
	}

	// 서버 응답: [버전, 선택된 방법]
	resp := make([]byte, 2)
	if _, err := io.ReadFull(conn, resp); err != nil {
		return fmt.Errorf("auth method response: %w", err)
	}
	if resp[0] != 0x05 {
		return fmt.Errorf("invalid SOCKS version: %d", resp[0])
	}

	switch resp[1] {
	case 0x00:
		// 인증 없음 — OK
	case 0x02:
		// Username/Password 인증 (RFC 1929)
		if !useAuth {
			return fmt.Errorf("proxy requires authentication")
		}
		if err := socks5Auth(conn, user, password); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unsupported auth method: 0x%02x", resp[1])
	}

	// ─── 2단계: CONNECT 요청 ─────────────────────────────────────────────
	// [ver, cmd=CONNECT, rsv, atyp, ...addr, port_hi, port_lo]
	hostBytes := []byte(host)
	req := make([]byte, 0, 7+len(hostBytes))
	req = append(req, 0x05, 0x01, 0x00) // VER, CMD=CONNECT, RSV
	req = append(req, 0x03)             // ATYP = DOMAINNAME
	req = append(req, byte(len(hostBytes)))
	req = append(req, hostBytes...)
	req = append(req, byte(port>>8), byte(port&0xff))

	if _, err := conn.Write(req); err != nil {
		return err
	}

	// 응답: [ver, rep, rsv, atyp, addr(variable), port(2)]
	header := make([]byte, 4)
	if _, err := io.ReadFull(conn, header); err != nil {
		return fmt.Errorf("connect response: %w", err)
	}
	if header[1] != 0x00 {
		return fmt.Errorf("SOCKS5 CONNECT failed, code: 0x%02x", header[1])
	}

	// 나머지 주소 바이트 소비
	switch header[3] {
	case 0x01: // IPv4
		buf := make([]byte, 4+2)
		_, err = io.ReadFull(conn, buf)
	case 0x03: // 도메인
		lenBuf := make([]byte, 1)
		if _, err = io.ReadFull(conn, lenBuf); err == nil {
			_, err = io.ReadFull(conn, make([]byte, int(lenBuf[0])+2))
		}
	case 0x04: // IPv6
		buf := make([]byte, 16+2)
		_, err = io.ReadFull(conn, buf)
	}
	return err
}

// socks5Auth RFC 1929 Username/Password 인증을 수행한다.
func socks5Auth(conn net.Conn, user, password string) error {
	authReq := make([]byte, 0, 3+len(user)+len(password))
	authReq = append(authReq, 0x01) // 버전
	authReq = append(authReq, byte(len(user)))
	authReq = append(authReq, []byte(user)...)
	authReq = append(authReq, byte(len(password)))
	authReq = append(authReq, []byte(password)...)

	if _, err := conn.Write(authReq); err != nil {
		return err
	}

	resp := make([]byte, 2)
	if _, err := io.ReadFull(conn, resp); err != nil {
		return fmt.Errorf("auth response: %w", err)
	}
	if resp[1] != 0x00 {
		return fmt.Errorf("SOCKS5 authentication failed")
	}
	return nil
}

// ─── HTTP CONNECT 다이얼러 ──────────────────────────────────────────────────

// makeHTTPConnectDialer HTTP CONNECT 방식으로 TCP 터널을 수립하는 다이얼러를 반환한다.
// RFC 7230 §4.3.6 (CONNECT method).
func makeHTTPConnectDialer(proxyAddr, user, password string) func(ctx context.Context, addr string) (net.Conn, error) {
	return func(ctx context.Context, addr string) (net.Conn, error) {
		conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", proxyAddr)
		if err != nil {
			return nil, fmt.Errorf("dial proxy %s: %w", proxyAddr, err)
		}

		if err := httpConnectHandshake(conn, addr, user, password); err != nil {
			conn.Close()
			return nil, fmt.Errorf("HTTP CONNECT: %w", err)
		}
		return conn, nil
	}
}

// httpConnectHandshake HTTP CONNECT 핸드셰이크를 수행한다.
func httpConnectHandshake(conn net.Conn, targetAddr, user, password string) error {
	req, err := http.NewRequest(http.MethodConnect, "http://"+targetAddr, nil)
	if err != nil {
		return err
	}
	req.Host = targetAddr

	// Proxy-Authorization: Basic ...
	if user != "" {
		creds := base64.StdEncoding.EncodeToString([]byte(user + ":" + password))
		req.Header.Set("Proxy-Authorization", "Basic "+creds)
	}

	if err := req.Write(conn); err != nil {
		return fmt.Errorf("write CONNECT request: %w", err)
	}

	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, req)
	if err != nil {
		return fmt.Errorf("read CONNECT response: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("proxy returned %s", resp.Status)
	}
	return nil
}
