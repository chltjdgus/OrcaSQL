package main

// ─── Data Search ───────────────────────────────────────────────────────────
//
// 지정 데이터베이스의 모든 테이블/컬럼에서 키워드를 LIKE 검색. UI: DataSearch 컴포넌트.

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// DataSearchResult 데이터 검색 결과 항목.
type DataSearchResult struct {
	Table  string     `json:"table"`
	Column string     `json:"column"`
	Rows   [][]string `json:"rows"` // 매칭된 행 (문자열 변환)
	Total  int        `json:"total"`
}

// SearchInDatabase 지정 데이터베이스의 모든 테이블/컬럼에서 키워드를 검색한다.
// 결과가 많을 경우 테이블당 최대 maxPerTable 행으로 제한한다.
func (a *App) SearchInDatabase(ctx context.Context, connID, database, keyword string, maxPerTable int) ([]DataSearchResult, error) {
	if keyword == "" {
		return nil, fmt.Errorf("keyword is empty")
	}
	if maxPerTable <= 0 {
		maxPerTable = 100
	}

	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}

	// 모든 텍스트 컬럼 목록 조회
	qctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	colRows, err := db.QueryContext(qctx, `
		SELECT TABLE_NAME, COLUMN_NAME
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ?
		  AND DATA_TYPE IN ('varchar','char','text','mediumtext','longtext','tinytext','json','enum','set')
		ORDER BY TABLE_NAME, ORDINAL_POSITION`, database)
	if err != nil {
		return nil, fmt.Errorf("get text columns: %w", err)
	}
	defer colRows.Close()

	type colRef struct{ table, col string }
	var cols []colRef
	for colRows.Next() {
		var c colRef
		if err := colRows.Scan(&c.table, &c.col); err != nil {
			return nil, err
		}
		cols = append(cols, c)
	}
	if err := colRows.Err(); err != nil {
		return nil, err
	}

	// 테이블별로 컬럼 그룹핑
	tableColsMap := make(map[string][]string)
	for _, c := range cols {
		tableColsMap[c.table] = append(tableColsMap[c.table], c.col)
	}

	likeVal := keyword + "%"
	var results []DataSearchResult

	for tableName, tableCols := range tableColsMap {
		select {
		case <-ctx.Done():
			return results, ctx.Err()
		default:
		}

		// WHERE col1 LIKE ? OR col2 LIKE ? ...
		whereParts := make([]string, len(tableCols))
		args := make([]interface{}, 0, len(tableCols)+1)
		args = append(args, database)
		for i, col := range tableCols {
			whereParts[i] = fmt.Sprintf("%s LIKE ?", quoteIdent(col))
			args = append(args, likeVal)
		}

		sqlStr := fmt.Sprintf("SELECT * FROM %s.%s WHERE %s LIMIT %d",
			quoteIdent(database), quoteIdent(tableName), strings.Join(whereParts, " OR "), maxPerTable)

		sctx, scancel := context.WithTimeout(ctx, 30*time.Second)
		srows, err := db.QueryContext(sctx, sqlStr, args[1:]...)
		if err != nil {
			scancel()
			continue // 테이블 오류 무시
		}

		allCols, _ := srows.Columns()
		var matchedRows [][]string
		for srows.Next() {
			vals := make([]interface{}, len(allCols))
			ptrs := make([]interface{}, len(allCols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := srows.Scan(ptrs...); err != nil {
				continue
			}
			row := make([]string, len(allCols))
			for i, v := range vals {
				if v == nil {
					row[i] = "NULL"
				} else if b, ok := v.([]byte); ok {
					row[i] = string(b)
				} else {
					row[i] = fmt.Sprintf("%v", v)
				}
			}
			matchedRows = append(matchedRows, row)
		}
		srows.Close()
		scancel()

		if len(matchedRows) > 0 {
			results = append(results, DataSearchResult{
				Table:  tableName,
				Column: strings.Join(tableCols, ", "),
				Rows:   matchedRows,
				Total:  len(matchedRows),
			})
		}
	}

	return results, nil
}
