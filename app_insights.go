package main

// ─── Performance Insights (Phase 66) ───────────────────────────────────────
//
// performance_schema + sys 스키마 기반 성능 진단(읽기 전용). ProcessList 보완.
// 각 섹션은 독립 실행 — perf_schema off / sys 미설치 / 권한 부족이어도 나머지는 반환.
// UI: PerformanceInsights 컴포넌트.

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// SlowQueryRow는 다이제스트 요약 한 행.
type SlowQueryRow struct {
	Schema         string  `json:"schema"`
	Digest         string  `json:"digest"`
	ExecCount      int64   `json:"execCount"`
	TotalLatencyMs float64 `json:"totalLatencyMs"`
	AvgLatencyMs   float64 `json:"avgLatencyMs"`
	RowsSent       int64   `json:"rowsSent"`
	RowsExamined   int64   `json:"rowsExamined"`
	NoIndexUsed    int64   `json:"noIndexUsed"`
}

// UnusedIndexRow는 sys.schema_unused_indexes 한 행.
type UnusedIndexRow struct {
	Schema string `json:"schema"`
	Table  string `json:"table"`
	Index  string `json:"index"`
}

// PerformanceInsights는 GetPerformanceInsights 반환 페이로드.
type PerformanceInsights struct {
	PerfSchemaAvailable bool             `json:"perfSchemaAvailable"`
	SysAvailable        bool             `json:"sysAvailable"`
	TopQueries          []SlowQueryRow   `json:"topQueries"`
	FullScanQueries     []SlowQueryRow   `json:"fullScanQueries"`
	UnusedIndexes       []UnusedIndexRow `json:"unusedIndexes"`
	Note                string           `json:"note"`
}

// GetPerformanceInsights는 서버 성능 진단을 반환한다.
// events_statements_summary_by_digest 는 서버 전역이라 database 인자는 없다.
func (a *App) GetPerformanceInsights(ctx context.Context, connID string) (*PerformanceInsights, error) {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return nil, fmt.Errorf("get db: %w", err)
	}
	qctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	out := &PerformanceInsights{
		TopQueries:      []SlowQueryRow{},
		FullScanQueries: []SlowQueryRow{},
		UnusedIndexes:   []UnusedIndexRow{},
	}

	// ── Top 쿼리 (총 레이턴시순) + 풀스캔 ──
	const digestCols = `SCHEMA_NAME, DIGEST_TEXT, COUNT_STAR, SUM_TIMER_WAIT,
	                    SUM_ROWS_SENT, SUM_ROWS_EXAMINED, SUM_NO_INDEX_USED`
	topQ := `SELECT ` + digestCols + `
	         FROM performance_schema.events_statements_summary_by_digest
	         WHERE DIGEST_TEXT IS NOT NULL
	         ORDER BY SUM_TIMER_WAIT DESC LIMIT 30`
	if top, err := queryDigest(qctx, db, topQ); err == nil {
		out.PerfSchemaAvailable = true
		out.TopQueries = top

		fullQ := `SELECT ` + digestCols + `
		          FROM performance_schema.events_statements_summary_by_digest
		          WHERE DIGEST_TEXT IS NOT NULL AND SUM_NO_INDEX_USED > 0
		          ORDER BY SUM_NO_INDEX_USED DESC LIMIT 20`
		if full, err := queryDigest(qctx, db, fullQ); err == nil {
			out.FullScanQueries = full
		}
	}

	// ── 미사용 인덱스 (sys 스키마) ──
	unusedQ := `SELECT object_schema, object_name, index_name
	            FROM sys.schema_unused_indexes
	            WHERE object_schema NOT IN ('mysql','performance_schema','sys','information_schema')
	            LIMIT 100`
	rows, err := db.QueryContext(qctx, unusedQ)
	if err == nil {
		out.SysAvailable = true
		defer rows.Close()
		for rows.Next() {
			var r UnusedIndexRow
			var idxNull sql.NullString
			if err := rows.Scan(&r.Schema, &r.Table, &idxNull); err != nil {
				continue
			}
			r.Index = idxNull.String
			out.UnusedIndexes = append(out.UnusedIndexes, r)
		}
	}

	if !out.PerfSchemaAvailable && !out.SysAvailable {
		out.Note = "performance_schema and sys schema are unavailable (disabled, missing, or insufficient privileges)."
	}
	return out, nil
}

// queryDigest는 events_statements_summary_by_digest 조회 결과를 SlowQueryRow 슬라이스로 반환한다.
// 레이턴시(피코초)는 ms 로 환산한다.
func queryDigest(ctx context.Context, db *sql.DB, query string) ([]SlowQueryRow, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []SlowQueryRow{}
	for rows.Next() {
		var (
			schemaNull   sql.NullString
			digest       string
			count        int64
			sumTimer     float64
			rowsSent     int64
			rowsExamined int64
			noIndex      int64
		)
		if err := rows.Scan(&schemaNull, &digest, &count, &sumTimer, &rowsSent, &rowsExamined, &noIndex); err != nil {
			continue
		}
		totalMs := sumTimer / 1e9 // picoseconds → milliseconds
		var avgMs float64
		if count > 0 {
			avgMs = totalMs / float64(count)
		}
		result = append(result, SlowQueryRow{
			Schema:         schemaNull.String,
			Digest:         digest,
			ExecCount:      count,
			TotalLatencyMs: totalMs,
			AvgLatencyMs:   avgMs,
			RowsSent:       rowsSent,
			RowsExamined:   rowsExamined,
			NoIndexUsed:    noIndex,
		})
	}
	return result, nil
}
