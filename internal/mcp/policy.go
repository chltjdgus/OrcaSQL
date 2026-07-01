package mcp

import (
	"fmt"
	"strings"

	"orcasql/internal/query"
)

// PolicyError 권한 게이트가 SQL 실행을 거부할 때 반환된다.
type PolicyError struct {
	QueryType query.QueryType
	Reason    string
}

func (e *PolicyError) Error() string {
	return e.Reason
}

// CheckExecutePolicy SQL 문 종류에 대해 현재 Config 가 실행을 허용하는지 검사한다.
//
// 정책:
//   - SELECT / SHOW / EXPLAIN — 항상 허용
//   - INSERT / UPDATE / DELETE — AllowWrite 필요
//   - CREATE / ALTER / DROP / TRUNCATE — AllowDDL 필요 (AllowWrite 도 함께 요구)
//   - 기타 (USE, SET 등) — AllowWrite 필요 (보수적)
//
// 실패 시 *PolicyError 반환, 허용 시 nil.
func CheckExecutePolicy(cfg Config, sqlStr string) error {
	// BugFix-DY 방어 1 — 다중 문장 거부.
	// DetectQueryType 은 첫 문장 종류만 보므로 "SELECT 1; DROP TABLE t" 가 SELECT 로 오판돼
	// 통과할 수 있다. 현재 DSN 은 multiStatements=false 라 드라이버가 실행을 거부하지만, 그
	// 방어는 DSN 기본값에 암묵 의존한다 — 정책 계층에서 명시적으로 차단해 설정 변경에도 안전하게 한다.
	// SplitStatements 는 문자열 리터럴/주석 내부의 세미콜론을 구분자로 세지 않는다.
	if stmts := query.SplitStatements(sqlStr); len(stmts) > 1 {
		return &PolicyError{
			QueryType: query.DetectQueryType(sqlStr),
			Reason: "multiple SQL statements in one call are not permitted over MCP. " +
				"Send a single statement per execute_query call.",
		}
	}

	// BugFix-DY 방어 2 — MySQL 실행 주석 `/*! ... */` 거부.
	// 서버가 버전 조건부로 실제 실행하므로(예: `/*!40000 DROP TABLE t */`) 정적 타입 판정을
	// 우회한다. optimizer hint `/*+ ... */` 는 `/*!` 가 아니므로 영향받지 않는다.
	if strings.Contains(sqlStr, "/*!") {
		return &PolicyError{
			QueryType: query.QueryTypeOther,
			Reason: "MySQL executable comments (/*! ... */) are not permitted over MCP — " +
				"they bypass query-type policy checks.",
		}
	}

	qt := query.DetectQueryType(sqlStr)
	switch qt {
	case query.QueryTypeSelect:
		return nil
	case query.QueryTypeInsert, query.QueryTypeUpdate, query.QueryTypeDelete:
		if !cfg.AllowWrite {
			return &PolicyError{
				QueryType: qt,
				Reason: fmt.Sprintf(
					"write queries (%s) are not permitted by current MCP policy. " +
						"Enable AllowWrite in OrcaSQL settings → MCP.",
					queryTypeName(qt),
				),
			}
		}
		return nil
	case query.QueryTypeDDL:
		if !cfg.AllowDDL {
			return &PolicyError{
				QueryType: qt,
				Reason: "DDL queries (CREATE/ALTER/DROP/TRUNCATE) are not permitted by current MCP policy. " +
					"Enable AllowDDL in OrcaSQL settings → MCP.",
			}
		}
		return nil
	case query.QueryTypeOther:
		if !cfg.AllowWrite {
			return &PolicyError{
				QueryType: qt,
				Reason: "non-SELECT statements are not permitted in read-only mode. " +
					"Enable AllowWrite in OrcaSQL settings → MCP.",
			}
		}
		return nil
	default:
		// 알 수 없는 타입 — 보수적으로 거부
		return &PolicyError{
			QueryType: qt,
			Reason:    "unrecognized query type — refused for safety",
		}
	}
}

// queryTypeName 사용자에게 보일 한국어/영어 무관한 짧은 라벨.
func queryTypeName(qt query.QueryType) string {
	switch qt {
	case query.QueryTypeSelect:
		return "SELECT"
	case query.QueryTypeInsert:
		return "INSERT"
	case query.QueryTypeUpdate:
		return "UPDATE"
	case query.QueryTypeDelete:
		return "DELETE"
	case query.QueryTypeDDL:
		return "DDL"
	default:
		return "OTHER"
	}
}
