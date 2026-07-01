package schema

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"orcasql/internal/connection"
)

// ExplainRow EXPLAIN 결과 한 행.
type ExplainRow struct {
	ID           int     `json:"id"`
	SelectType   string  `json:"selectType"`
	Table        string  `json:"table"`
	Partitions   string  `json:"partitions"`
	Type         string  `json:"type"`
	PossibleKeys string  `json:"possibleKeys"`
	Key          string  `json:"key"`
	KeyLen       string  `json:"keyLen"`
	Ref          string  `json:"ref"`
	Rows         int64   `json:"rows"`
	Filtered     float64 `json:"filtered"`
	Extra        string  `json:"extra"`
}

// ProfileRow SHOW PROFILE 결과 한 행.
type ProfileRow struct {
	Status   string  `json:"status"`
	Duration float64 `json:"duration"` // seconds
}

// Profiler SQL 실행 분석기.
type Profiler struct {
	connManager *connection.Manager
}

// NewProfiler Profiler 인스턴스를 생성한다.
func NewProfiler(cm *connection.Manager) *Profiler {
	return &Profiler{connManager: cm}
}

// GetExplain EXPLAIN 결과를 반환한다.
func (p *Profiler) GetExplain(ctx context.Context, connID, sqlStr string) ([]ExplainRow, error) {
	db, err := p.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	explainSQL := "EXPLAIN " + strings.TrimRight(strings.TrimSpace(sqlStr), ";")
	rows, err := db.QueryContext(qctx, explainSQL)
	if err != nil {
		return nil, fmt.Errorf("explain: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("explain columns: %w", err)
	}

	var result []ExplainRow
	for rows.Next() {
		var row ExplainRow
		// EXPLAIN 컬럼 수는 MySQL 버전에 따라 다르므로 동적으로 스캔
		dest := makeExplainScanDest(len(cols))
		if err := rows.Scan(dest...); err != nil {
			return nil, fmt.Errorf("explain scan: %w", err)
		}
		row = parseExplainRow(cols, dest)
		result = append(result, row)
	}
	return result, rows.Err()
}

// GetProfile SHOW PROFILE 결과를 반환한다.
// MySQL 5.6+ 에서만 지원되며, 지원되지 않는 경우 빈 슬라이스를 반환한다.
func (p *Profiler) GetProfile(ctx context.Context, connID string) ([]ProfileRow, error) {
	db, err := p.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	// SHOW PROFILE FOR QUERY 1 (마지막 쿼리)
	rows, err := db.QueryContext(qctx, "SHOW PROFILE FOR QUERY 1")
	if err != nil {
		// SHOW PROFILE 미지원 서버 → 에러 무시
		return []ProfileRow{}, nil //nolint:nilerr
	}
	defer rows.Close()

	var result []ProfileRow
	for rows.Next() {
		var r ProfileRow
		if err := rows.Scan(&r.Status, &r.Duration); err != nil {
			continue
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// GetExplainJSON EXPLAIN FORMAT=JSON 결과를 원시 JSON 문자열로 반환한다.
// 트리/그래프 시각화에 사용한다.
// MySQL 5.6+ 에서 지원된다.
func (p *Profiler) GetExplainJSON(ctx context.Context, connID, sqlStr string) (string, error) {
	db, err := p.connManager.GetDB(connID)
	if err != nil {
		return "", err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	cleanSQL := strings.TrimRight(strings.TrimSpace(sqlStr), ";")
	explainSQL := "EXPLAIN FORMAT=JSON " + cleanSQL
	rows, err := db.QueryContext(qctx, explainSQL)
	if err != nil {
		return "", fmt.Errorf("explain json: %w", err)
	}
	defer rows.Close()

	if rows.Next() {
		var jsonStr string
		if scanErr := rows.Scan(&jsonStr); scanErr != nil {
			return "", fmt.Errorf("explain json scan: %w", scanErr)
		}
		return jsonStr, rows.Err()
	}
	return "", rows.Err()
}

// ExplainAnalyze MySQL 8.0.18+ EXPLAIN ANALYZE 결과를 반환한다.
func (p *Profiler) ExplainAnalyze(ctx context.Context, connID, sqlStr string) (string, error) {
	db, err := p.connManager.GetDB(connID)
	if err != nil {
		return "", err
	}
	qctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()

	analyzeSQL := "EXPLAIN ANALYZE " + strings.TrimRight(strings.TrimSpace(sqlStr), ";")
	rows, err := db.QueryContext(qctx, analyzeSQL)
	if err != nil {
		return "", fmt.Errorf("explain analyze: %w", err)
	}
	defer rows.Close()

	var lines []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			continue
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n"), rows.Err()
}

// ─── 내부 헬퍼 ─────────────────────────────────────────────────────────────

func makeExplainScanDest(n int) []any {
	dest := make([]any, n)
	for i := range dest {
		dest[i] = new(sql.NullString)
	}
	return dest
}

func parseExplainRow(cols []string, dest []any) ExplainRow {
	get := func(name string) string {
		for i, c := range cols {
			if strings.EqualFold(c, name) {
				if ns, ok := dest[i].(*sql.NullString); ok && ns.Valid {
					return ns.String
				}
			}
		}
		return ""
	}
	getInt := func(name string) int64 {
		s := get(name)
		var n int64
		fmt.Sscanf(s, "%d", &n)
		return n
	}
	getFloat := func(name string) float64 {
		s := get(name)
		var f float64
		fmt.Sscanf(s, "%f", &f)
		return f
	}

	return ExplainRow{
		ID:           int(getInt("id")),
		SelectType:   get("select_type"),
		Table:        get("table"),
		Partitions:   get("partitions"),
		Type:         get("type"),
		PossibleKeys: get("possible_keys"),
		Key:          get("key"),
		KeyLen:       get("key_len"),
		Ref:          get("ref"),
		Rows:         getInt("rows"),
		Filtered:     getFloat("filtered"),
		Extra:        get("Extra"),
	}
}
