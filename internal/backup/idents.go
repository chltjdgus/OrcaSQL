package backup

import "strings"

// escapeIdent MySQL identifier 안의 backtick 을 두 번 반복으로 escape.
// (internal/schema/designer.go · internal/sync/idents.go 와 동일 — 세 패키지가
// 서로 import 하기 곤란해서 의도적으로 복제. 동작 차이가 생기면 회귀 테스트로 잡힘.)
func escapeIdent(s string) string {
	return strings.ReplaceAll(s, "`", "``")
}

// quoteIdent 식별자를 backtick 으로 감싼 안전한 형태로 반환.
func quoteIdent(s string) string {
	return "`" + escapeIdent(s) + "`"
}
