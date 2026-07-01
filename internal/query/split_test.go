package query

import (
	"testing"
)

func TestSplitStatements(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{
			name:  "empty input",
			input: "",
			want:  nil,
		},
		{
			name:  "whitespace only",
			input: "   \n\t  ",
			want:  nil,
		},
		{
			name:  "single statement no semicolon",
			input: "SELECT 1",
			want:  []string{"SELECT 1"},
		},
		{
			name:  "single statement with semicolon",
			input: "SELECT 1;",
			want:  []string{"SELECT 1"},
		},
		{
			name:  "multiple statements",
			input: "SELECT 1; SELECT 2; SELECT 3",
			want:  []string{"SELECT 1", "SELECT 2", "SELECT 3"},
		},
		{
			name:  "multiple statements all with semicolons",
			input: "SELECT 1; SELECT 2; SELECT 3;",
			want:  []string{"SELECT 1", "SELECT 2", "SELECT 3"},
		},
		{
			name:  "semicolon in single quotes ignored",
			input: "SELECT ';' AS s; SELECT 2",
			want:  []string{"SELECT ';' AS s", "SELECT 2"},
		},
		{
			name:  "semicolon in double quotes ignored",
			input: `SELECT ";" AS s; SELECT 2`,
			want:  []string{`SELECT ";" AS s`, "SELECT 2"},
		},
		{
			name:  "semicolon in block comment ignored",
			input: "SELECT /* ; comment */ 1; SELECT 2",
			want:  []string{"SELECT /* ; comment */ 1", "SELECT 2"},
		},
		{
			name:  "semicolon in line comment ignored",
			input: "SELECT 1 -- ; this is a comment\n; SELECT 2",
			want:  []string{"SELECT 1 -- ; this is a comment", "SELECT 2"},
		},
		{
			name:  "multibyte chars in single-quoted string",
			input: "SELECT '한글;테스트'; SELECT 2",
			want:  []string{"SELECT '한글;테스트'", "SELECT 2"},
		},
		{
			name:  "multibyte chars in double-quoted string",
			input: `SELECT "日本語;テスト" AS s; SELECT 3`,
			want:  []string{`SELECT "日本語;テスト" AS s`, "SELECT 3"},
		},
		{
			name:  "multibyte chars in table name",
			input: "SELECT * FROM `테이블`; SELECT 1",
			want:  []string{"SELECT * FROM `테이블`", "SELECT 1"},
		},
		{
			name:  "escaped quote inside single quotes",
			input: `SELECT 'it\'s a test; here'; SELECT 2`,
			want:  []string{`SELECT 'it\'s a test; here'`, "SELECT 2"},
		},
		{
			name:  "whitespace-only segment between semicolons is skipped",
			input: "SELECT 1;   ; SELECT 2",
			want:  []string{"SELECT 1", "SELECT 2"},
		},
		{
			name:  "nested block comment with semicolon",
			input: "/* start ; */ SELECT 1 /* ; end */; SELECT 2",
			want:  []string{"/* start ; */ SELECT 1 /* ; end */", "SELECT 2"},
		},
		{
			name:  "CREATE PROCEDURE with multiple semicolons in body",
			input: "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END",
			// 프로시저 바디 내 세미콜론은 특별 처리 없이 분리됨 (DELIMITER 미사용 시)
			want: []string{
				"CREATE PROCEDURE p() BEGIN SELECT 1",
				"SELECT 2",
				"END",
			},
		},
		{
			name:  "string with newline inside",
			input: "SELECT 'line1\nline2;line3'; SELECT 1",
			want:  []string{"SELECT 'line1\nline2;line3'", "SELECT 1"},
		},
		{
			name:  "INSERT with semicolon in value",
			input: "INSERT INTO t VALUES(';'); SELECT 1",
			want:  []string{"INSERT INTO t VALUES(';')", "SELECT 1"},
		},

		// ── DELIMITER 지원 ──────────────────────────────────────────────────────

		{
			name:  "DELIMITER // basic stored procedure",
			input: "DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END//\nDELIMITER ;",
			want:  []string{"CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END"},
		},
		{
			name:  "DELIMITER $$ stored procedure",
			input: "DELIMITER $$\nCREATE FUNCTION f() RETURNS INT BEGIN RETURN 1; END$$\nDELIMITER ;",
			want:  []string{"CREATE FUNCTION f() RETURNS INT BEGIN RETURN 1; END"},
		},
		{
			name:  "statements before and after DELIMITER block",
			input: "SELECT 1;\nDELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 2; END//\nDELIMITER ;\nSELECT 3;",
			want:  []string{"SELECT 1", "CREATE PROCEDURE p() BEGIN SELECT 2; END", "SELECT 3"},
		},
		{
			name:  "multiple procedures with DELIMITER",
			input: "DELIMITER //\nCREATE PROCEDURE p1() BEGIN SELECT 1; END//\nCREATE PROCEDURE p2() BEGIN SELECT 2; END//\nDELIMITER ;",
			want: []string{
				"CREATE PROCEDURE p1() BEGIN SELECT 1; END",
				"CREATE PROCEDURE p2() BEGIN SELECT 2; END",
			},
		},
		{
			name:  "DELIMITER lowercase keyword",
			input: "delimiter //\nCREATE PROCEDURE p() BEGIN SELECT 1; END//\ndelimiter ;",
			want:  []string{"CREATE PROCEDURE p() BEGIN SELECT 1; END"},
		},
		{
			name:  "DELIMITER with trigger",
			input: "DELIMITER //\nCREATE TRIGGER t BEFORE INSERT ON tbl FOR EACH ROW BEGIN SET NEW.col = 1; END//\nDELIMITER ;",
			want:  []string{"CREATE TRIGGER t BEFORE INSERT ON tbl FOR EACH ROW BEGIN SET NEW.col = 1; END"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SplitStatements(tt.input)
			if len(got) != len(tt.want) {
				t.Errorf("got %d statements, want %d\ngot:  %v\nwant: %v",
					len(got), len(tt.want), got, tt.want)
				return
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("[%d] got  %q\n[%d] want %q", i, got[i], i, tt.want[i])
				}
			}
		})
	}
}
