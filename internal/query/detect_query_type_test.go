package query

import "testing"

// TestDetectQueryType_CommentPrefix BugFix-DY 회귀 가드.
// 선행 주석/공백이 실제 첫 키워드를 가려 QueryTypeOther 로 오판되던 문제를 검증한다.
func TestDetectQueryType_CommentPrefix(t *testing.T) {
	cases := []struct {
		name string
		sql  string
		want QueryType
	}{
		{"plain select", "SELECT 1", QueryTypeSelect},
		{"leading space", "   \n\t SELECT 1", QueryTypeSelect},
		{"block comment before ddl", "/* x */ DROP TABLE t", QueryTypeDDL},
		{"line comment before ddl", "-- x\nDROP TABLE t", QueryTypeDDL},
		{"hash comment before ddl", "# x\nDROP TABLE t", QueryTypeDDL},
		{"multiple leading comments", "  /* a */ -- b\n  /* c */ DELETE FROM t", QueryTypeDelete},
		{"comment before select stays select", "/* c */ SELECT 1", QueryTypeSelect},
		{"comment before update", "/* c */ UPDATE t SET x=1", QueryTypeUpdate},
		{"comment before insert", "/* c */INSERT INTO t VALUES (1)", QueryTypeInsert},
		// /*! ... */ 는 실행 주석 — 스킵하지 않아 Other 로 귀결(정책 계층에서 별도 거부).
		{"executable comment stays other", "/*!40000 DROP TABLE t */", QueryTypeOther},
		// 문자열 리터럴 안의 -- 는 주석이 아니며 SELECT 뒤라 판정에 영향 없음.
		{"string literal dashes", "SELECT '-- not a comment'", QueryTypeSelect},
		// "a--b" 형태(뺄셈)를 라인 주석으로 오인하지 않는다: 문두가 SELECT 라 SELECT.
		{"minus not line comment", "SELECT 1--2", QueryTypeSelect},
		// CTE 는 기존대로 실제 DML 을 감지.
		{"cte select", "WITH x AS (SELECT 1) SELECT * FROM x", QueryTypeSelect},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := DetectQueryType(tt.sql); got != tt.want {
				t.Errorf("DetectQueryType(%q) = %d, want %d", tt.sql, got, tt.want)
			}
		})
	}
}
