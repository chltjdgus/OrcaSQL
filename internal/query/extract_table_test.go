package query

import (
	"testing"
)

func TestExtractSingleTable(t *testing.T) {
	tests := []struct {
		name    string
		sql     string
		wantDB  string
		wantTbl string
		wantOK  bool
	}{
		// ── 성공 케이스 ─────────────────────────────────────────────
		{
			name:    "simple table only",
			sql:     "SELECT * FROM users",
			wantDB:  "", wantTbl: "users", wantOK: true,
		},
		{
			name:    "db.table qualified",
			sql:     "SELECT * FROM mydb.users",
			wantDB:  "mydb", wantTbl: "users", wantOK: true,
		},
		{
			name:    "backtick-quoted table",
			sql:     "SELECT * FROM `users`",
			wantDB:  "", wantTbl: "users", wantOK: true,
		},
		{
			name:    "backtick-quoted db and table",
			sql:     "SELECT * FROM `mydb`.`users`",
			wantDB:  "mydb", wantTbl: "users", wantOK: true,
		},
		{
			name:    "with WHERE clause",
			sql:     "SELECT id, name FROM users WHERE id = 1",
			wantDB:  "", wantTbl: "users", wantOK: true,
		},
		{
			name:    "with ORDER BY and LIMIT",
			sql:     "SELECT * FROM products ORDER BY price DESC LIMIT 10",
			wantDB:  "", wantTbl: "products", wantOK: true,
		},
		{
			name:    "lowercase from",
			sql:     "select * from orders where id > 5",
			wantDB:  "", wantTbl: "orders", wantOK: true,
		},
		{
			name:    "with trailing semicolon (after TrimSpace)",
			sql:     "SELECT * FROM logs",
			wantDB:  "", wantTbl: "logs", wantOK: true,
		},

		// ── 실패 케이스: JOIN ────────────────────────────────────────
		{
			name:   "INNER JOIN → false",
			sql:    "SELECT * FROM users JOIN orders ON users.id = orders.user_id",
			wantOK: false,
		},
		{
			name:   "LEFT JOIN → false",
			sql:    "SELECT u.id FROM users LEFT JOIN orders ON u.id = orders.user_id",
			wantOK: false,
		},

		// ── 실패 케이스: UNION ───────────────────────────────────────
		{
			name:   "UNION → false",
			sql:    "SELECT id FROM a UNION SELECT id FROM b",
			wantOK: false,
		},
		{
			name:   "UNION ALL → false",
			sql:    "SELECT id FROM a UNION ALL SELECT id FROM b",
			wantOK: false,
		},

		// ── 실패 케이스: 서브쿼리 ────────────────────────────────────
		{
			name:   "subquery in FROM → false",
			sql:    "SELECT * FROM (SELECT id FROM users) AS sub",
			wantOK: false,
		},
		{
			name:   "subquery in WHERE → false (secondary FROM)",
			sql:    "SELECT * FROM users WHERE id IN (SELECT id FROM deleted_users)",
			wantOK: false,
		},

		// ── 실패 케이스: 비-SELECT 문 ────────────────────────────────
		{
			name:   "INSERT → false",
			sql:    "INSERT INTO users VALUES (1, 'test')",
			wantOK: false,
		},
		{
			name:   "UPDATE → false",
			sql:    "UPDATE users SET name = 'test' WHERE id = 1",
			wantOK: false,
		},
		{
			name:   "DELETE → false",
			sql:    "DELETE FROM users WHERE id = 1",
			wantOK: false,
		},
		{
			name:   "CREATE TABLE → false",
			sql:    "CREATE TABLE foo (id INT)",
			wantOK: false,
		},

		// ── 실패 케이스: CTE (WITH 절) ──────────────────────────────
		{
			name:   "CTE WITH → false",
			sql:    "WITH cte AS (SELECT id FROM users) SELECT * FROM cte",
			wantOK: false,
		},
		{
			name:   "CTE WITH lowercase → false",
			sql:    "with cte as (select id from users) select * from cte",
			wantOK: false,
		},
		{
			name:   "CTE multi-line → false",
			sql:    "WITH\nranked AS (SELECT *, ROW_NUMBER() OVER () AS rn FROM orders)\nSELECT * FROM ranked WHERE rn = 1",
			wantOK: false,
		},

		// ── 엣지 케이스 ──────────────────────────────────────────────
		{
			name:   "SELECT with no FROM → false",
			sql:    "SELECT NOW()",
			wantOK: false,
		},
		{
			name:   "empty string → false",
			sql:    "",
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotDB, gotTbl, gotOK := ExtractSingleTable(tt.sql)
			if gotOK != tt.wantOK {
				t.Errorf("ok = %v, want %v  (sql=%q)", gotOK, tt.wantOK, tt.sql)
				return
			}
			if !tt.wantOK {
				return
			}
			if gotDB != tt.wantDB {
				t.Errorf("database = %q, want %q", gotDB, tt.wantDB)
			}
			if gotTbl != tt.wantTbl {
				t.Errorf("table = %q, want %q", gotTbl, tt.wantTbl)
			}
		})
	}
}
