package main

// app_table_ops_test.go — ExportTableData 의 CSV/SQL 직렬화 헬퍼 단위 테스트.
// csvQuote (RFC 4180 부분 준수) + escapeSQLStr (MySQL backslash 이스케이프).

import "testing"

// TestCsvQuote RFC 4180 의 quoting 규칙을 따른다:
//   - 필드에 , " CR LF 가 없으면 그대로 반환 (no quotes)
//   - 있으면 전체를 "..." 로 감싸고, 내부 " 는 "" 로 escape
//
// 탭/공백/한글/숫자 등 그 외 문자는 quote 트리거가 아님.
func TestCsvQuote(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain ascii", "hello", "hello"},
		{"empty string", "", ""},
		{"tab not special", "a\tb", "a\tb"},
		{"korean not special", "한글", "한글"},
		{"comma triggers quote", "a,b", `"a,b"`},
		{"newline triggers quote", "line1\nline2", "\"line1\nline2\""},
		{"cr triggers quote", "line1\rline2", "\"line1\rline2\""},
		{"double quote triggers + escape", `say "hi"`, `"say ""hi"""`},
		{"comma + quote combined", `a,"b`, `"a,""b"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := csvQuote(tc.in)
			if got != tc.want {
				t.Fatalf("csvQuote(%q) = %q; want %q", tc.in, got, tc.want)
			}
		})
	}
}

// TestEscapeSQLStr MySQL 의 string literal 이스케이프 5종을 검증:
//   ' → \', \ → \\, \n → \n (literal backslash-n), \r → \r, NUL(0) → \0
// 결과는 항상 single-quote 로 감싼다.
func TestEscapeSQLStr(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", "''"},
		{"plain", "hello", "'hello'"},
		{"single quote", "it's", `'it\'s'`},
		{"backslash", `back\slash`, `'back\\slash'`},
		{"newline", "line1\nline2", `'line1\nline2'`},
		{"carriage return", "line1\rline2", `'line1\rline2'`},
		{"null byte", "with\x00null", `'with\0null'`},
		{"korean passthrough", "한글", "'한글'"},
		{"mixed escape", "a'b\\c\nd", `'a\'b\\c\nd'`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := escapeSQLStr(tc.in)
			if got != tc.want {
				t.Fatalf("escapeSQLStr(%q) = %q; want %q", tc.in, got, tc.want)
			}
		})
	}
}
