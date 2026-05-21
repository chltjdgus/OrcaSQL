package sync

import "strings"

// escapeIdent MySQL identifier 안의 backtick 을 두 번 반복으로 escape.
func escapeIdent(s string) string {
	return strings.ReplaceAll(s, "`", "``")
}

// quoteIdent 식별자를 backtick 으로 감싼 안전한 형태로 반환.
func quoteIdent(s string) string {
	return "`" + escapeIdent(s) + "`"
}
