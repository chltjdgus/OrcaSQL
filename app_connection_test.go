package main

// app_connection_test.go — classifyConnError 분류 함수 단위 테스트.
// MySQL/SSH/TLS/Proxy 오류 메시지에서 프론트엔드 ErrorKind 분류가 정확한지 검증.

import "testing"

// TestClassifyConnError 분류 우선순위(ssh > proxy > tls > auth > database > host > other) 와
// case-insensitive 매칭이 모두 정상 동작하는지 검증한다.
func TestClassifyConnError(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		msg  string
		want string
	}{
		// SSH — 최우선 분기 (메시지에 ssh 포함 시 다른 키워드 있어도 ssh)
		{"ssh handshake", "ssh: handshake failed", "ssh"},
		{"ssh wins over auth", "ssh tunnel access denied", "ssh"},

		// Proxy — socks5 또는 proxy 키워드
		{"socks5 only", "socks5 connection refused", "proxy"},
		{"proxy keyword", "proxy server unreachable", "proxy"},

		// TLS — tls 또는 certificate 키워드
		{"tls handshake lower", "tls handshake error", "tls"},
		{"TLS upper", "TLS handshake failure", "tls"},
		{"certificate", "x509: certificate signed by unknown authority", "tls"},

		// Auth — Access denied (MySQL 1045)
		{"access denied", "Error 1045: Access denied for user 'foo'", "auth"},

		// Database — Unknown database (MySQL 1049)
		{"unknown database", "Error 1049: Unknown database 'foo'", "database"},

		// Host — 네트워크 도달 불가 5종
		{"no such host", "dial tcp: lookup foo: no such host", "host"},
		{"connection refused", "dial tcp 127.0.0.1:3306: connection refused", "host"},
		{"connection timed out", "dial tcp: connection timed out", "host"},
		{"i/o timeout", "read tcp: i/o timeout", "host"},
		{"network unreachable", "dial tcp: network unreachable", "host"},

		// Other — 분류되지 않은 모든 경우
		{"empty", "", "other"},
		{"generic", "something weird happened", "other"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := classifyConnError(tc.msg)
			if got != tc.want {
				t.Fatalf("classifyConnError(%q) = %q; want %q", tc.msg, got, tc.want)
			}
		})
	}
}
