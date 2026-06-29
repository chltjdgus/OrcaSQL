package mcp

import (
	"fmt"

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
