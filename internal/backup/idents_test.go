package backup

import "testing"

func TestEscapeIdent(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"users", "users"},
		{"weird`name", "weird``name"},
		{"a`b`c", "a``b``c"},
		{"", ""},
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
		{"weird`name", "`weird``name`"},
		{"my db", "`my db`"},
		{"", "``"},
	}
	for _, c := range cases {
		if got := quoteIdent(c.in); got != c.want {
			t.Errorf("quoteIdent(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
