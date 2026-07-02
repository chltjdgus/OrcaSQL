package main

import "testing"

func TestEscapeIdent(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"users", "users"},
		{"my_table", "my_table"},
		{"", ""},
		{"a`b", "a``b"},                 // 단일 backtick → doubling
		{"`", "``"},                     // backtick 하나만
		{"a`b`c", "a``b``c"},            // 다중 backtick
		{"x`; DROP TABLE y; --", "x``; DROP TABLE y; --"}, // 인젝션 시도 — backtick 만 escape
	}
	for _, c := range cases {
		if got := escapeIdent(c.in); got != c.want {
			t.Errorf("escapeIdent(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestQuoteIdent(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"users", "`users`"},
		{"", "``"},
		{"a`b", "`a``b`"},
		// 식별자 인젝션 방어: backtick 으로 식별자를 일찍 닫고 임의 SQL 을 붙이려는 시도가
		// 통째로 doubling 되어 단일 식별자 안에 갇힌다.
		{"x`.`y`; DROP DATABASE `z", "`x``.``y``; DROP DATABASE ``z`"},
	}
	for _, c := range cases {
		if got := quoteIdent(c.in); got != c.want {
			t.Errorf("quoteIdent(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
