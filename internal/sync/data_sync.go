// Package sync — 두 MySQL 서버/DB 간 데이터 비교 및 동기화 SQL 생성.
package sync

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

// DataDiffAction 데이터 차이 액션 타입.
type DataDiffAction string

const (
	DataDiffInsert DataDiffAction = "INSERT" // 소스에만 있음 → 대상에 삽입
	DataDiffUpdate DataDiffAction = "UPDATE" // 양쪽 모두 있으나 값이 다름
	DataDiffDelete DataDiffAction = "DELETE" // 대상에만 있음 → 대상에서 삭제
)

// DataDiffRow 한 행의 데이터 차이.
type DataDiffRow struct {
	PK     string            `json:"pk"`     // PK 값 (복합 PK는 "|" 구분)
	Action DataDiffAction    `json:"action"` // INSERT | UPDATE | DELETE
	SrcRow map[string]string `json:"srcRow"` // 소스 행 (DELETE 시 nil)
	DstRow map[string]string `json:"dstRow"` // 대상 행 (INSERT 시 nil)
	SQL    string            `json:"sql"`    // 동기화 SQL
}

// DataSyncResult 데이터 비교 결과.
type DataSyncResult struct {
	Table    string        `json:"table"`
	SrcCount int64         `json:"srcCount"`
	DstCount int64         `json:"dstCount"`
	Diffs    []DataDiffRow `json:"diffs"`
	SyncSQL  string        `json:"syncSql"` // 전체 동기화 SQL (concat)
	Analyzed time.Time     `json:"analyzed"`
}

const dataSyncTimeout = 120 * time.Second

// CompareTableData 소스와 대상 테이블의 데이터를 PK 기준으로 비교한다.
// maxRows가 0이면 5000행으로 제한한다.
func (s *Syncer) CompareTableData(
	ctx context.Context,
	srcConnID, srcDB, srcTable,
	dstConnID, dstDB, dstTable string,
	maxRows int,
) (*DataSyncResult, error) {
	if maxRows <= 0 {
		maxRows = 5000
	}

	qctx, cancel := context.WithTimeout(ctx, dataSyncTimeout)
	defer cancel()

	srcConn, err := s.connManager.GetDB(srcConnID)
	if err != nil {
		return nil, fmt.Errorf("src conn: %w", err)
	}
	dstConn, err := s.connManager.GetDB(dstConnID)
	if err != nil {
		return nil, fmt.Errorf("dst conn: %w", err)
	}

	// PK 컬럼 목록 조회 (소스 기준)
	pkCols, err := getPrimaryKeys(qctx, srcConn, srcDB, srcTable)
	if err != nil {
		return nil, fmt.Errorf("pk cols: %w", err)
	}
	if len(pkCols) == 0 {
		return nil, fmt.Errorf("테이블 '%s'에 Primary Key가 없습니다. 데이터 동기화에는 PK가 필요합니다", srcTable)
	}

	// 전체 컬럼 목록 (소스 기준)
	allCols, err := getColumnNames(qctx, srcConn, srcDB, srcTable)
	if err != nil {
		return nil, fmt.Errorf("columns: %w", err)
	}

	// 소스/대상 데이터 로드 → pk→row 인덱스
	srcRows, srcCount, err := loadTableData(qctx, srcConn, srcDB, srcTable, pkCols, allCols, maxRows)
	if err != nil {
		return nil, fmt.Errorf("load src: %w", err)
	}
	dstRows, dstCount, err := loadTableData(qctx, dstConn, dstDB, dstTable, pkCols, allCols, maxRows)
	if err != nil {
		return nil, fmt.Errorf("load dst: %w", err)
	}

	// PK 기준 비교
	diffs := compareData(pkCols, allCols, srcRows, dstRows, dstTable)

	// 전체 동기화 SQL 합산
	var sb strings.Builder
	for _, d := range diffs {
		sb.WriteString(d.SQL)
		sb.WriteString(";\n")
	}

	return &DataSyncResult{
		Table:    srcTable,
		SrcCount: srcCount,
		DstCount: dstCount,
		Diffs:    diffs,
		SyncSQL:  sb.String(),
		Analyzed: time.Now(),
	}, nil
}

// SyncTableData 대상 DB에 동기화 SQL을 트랜잭션으로 실행한다.
func (s *Syncer) SyncTableData(ctx context.Context, dstConnID, dstDB, syncSQL string) error {
	qctx, cancel := context.WithTimeout(ctx, dataSyncTimeout)
	defer cancel()

	db, err := s.connManager.GetDB(dstConnID)
	if err != nil {
		return fmt.Errorf("dst conn: %w", err)
	}

	// 대상 DB 선택
	if _, err := db.ExecContext(qctx, "USE "+quoteIdent(dstDB)); err != nil {
		return fmt.Errorf("use db: %w", err)
	}

	tx, err := db.BeginTx(qctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}

	for _, stmt := range strings.Split(syncSQL, ";\n") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, execErr := tx.ExecContext(qctx, stmt); execErr != nil {
			_ = tx.Rollback()
			return fmt.Errorf("exec sql: %w", execErr)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// ─── 내부 헬퍼 ─────────────────────────────────────────────────────────────

// getPrimaryKeys 테이블의 PK 컬럼 목록을 ORDINAL_POSITION 순으로 반환한다.
func getPrimaryKeys(ctx context.Context, db *sql.DB, database, table string) ([]string, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT COLUMN_NAME
		   FROM information_schema.KEY_COLUMN_USAGE
		  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
		  ORDER BY ORDINAL_POSITION`,
		database, table,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cols []string
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			return nil, err
		}
		cols = append(cols, col)
	}
	return cols, rows.Err()
}

// getColumnNames 테이블의 전체 컬럼 목록을 ORDINAL_POSITION 순으로 반환한다.
func getColumnNames(ctx context.Context, db *sql.DB, database, table string) ([]string, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT COLUMN_NAME
		   FROM information_schema.COLUMNS
		  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		  ORDER BY ORDINAL_POSITION`,
		database, table,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cols []string
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			return nil, err
		}
		cols = append(cols, col)
	}
	return cols, rows.Err()
}

// loadTableData 테이블 데이터를 "PK키 → 행" 맵으로 로드한다.
// PK 키는 pkCols 컬럼 값들을 "|" 로 조합한 문자열이다.
func loadTableData(
	ctx context.Context,
	db *sql.DB,
	database, table string,
	pkCols, allCols []string,
	limit int,
) (map[string]map[string]string, int64, error) {
	// 전체 행 수 조회
	var total int64
	countRow := db.QueryRowContext(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s.%s", quoteIdent(database), quoteIdent(table)))
	if err := countRow.Scan(&total); err != nil {
		return nil, 0, err
	}

	// SELECT 쿼리 (PK ORDER BY로 일관된 순서 보장)
	quotedCols := make([]string, len(allCols))
	for i, c := range allCols {
		quotedCols[i] = quoteIdent(c)
	}
	quotedPKs := make([]string, len(pkCols))
	for i, c := range pkCols {
		quotedPKs[i] = quoteIdent(c)
	}
	query := fmt.Sprintf(
		"SELECT %s FROM %s.%s ORDER BY %s LIMIT %d",
		strings.Join(quotedCols, ", "),
		quoteIdent(database), quoteIdent(table),
		strings.Join(quotedPKs, ", "),
		limit,
	)

	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	result := make(map[string]map[string]string)
	for rows.Next() {
		vals := make([]interface{}, len(allCols))
		ptrs := make([]interface{}, len(allCols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, 0, err
		}

		m := make(map[string]string, len(allCols))
		for i, col := range allCols {
			if vals[i] == nil {
				m[col] = "NULL"
			} else {
				switch v := vals[i].(type) {
				case []byte:
					m[col] = string(v)
				default:
					m[col] = fmt.Sprintf("%v", v)
				}
			}
		}

		pk := makePKKey(pkCols, m)
		result[pk] = m
	}
	return result, total, rows.Err()
}

// makePKKey pkCols 순서대로 행에서 PK 키를 생성한다 ("|" 구분).
func makePKKey(pkCols []string, row map[string]string) string {
	parts := make([]string, len(pkCols))
	for i, col := range pkCols {
		parts[i] = row[col]
	}
	return strings.Join(parts, "|")
}

// compareData 소스/대상 PK 인덱스를 비교해 DataDiffRow 슬라이스를 반환한다.
func compareData(
	pkCols []string,
	allCols []string,
	srcRows, dstRows map[string]map[string]string,
	dstTable string,
) []DataDiffRow {
	var diffs []DataDiffRow

	// INSERT / UPDATE: 소스 기준 순회
	for pk, srcRow := range srcRows {
		dstRow, exists := dstRows[pk]
		if !exists {
			// 대상에 없음 → INSERT
			diffs = append(diffs, DataDiffRow{
				PK:     pk,
				Action: DataDiffInsert,
				SrcRow: srcRow,
				DstRow: nil,
				SQL:    buildInsertSQL(dstTable, allCols, srcRow),
			})
		} else if rowChanged(allCols, srcRow, dstRow) {
			// 값이 다름 → UPDATE
			diffs = append(diffs, DataDiffRow{
				PK:     pk,
				Action: DataDiffUpdate,
				SrcRow: srcRow,
				DstRow: dstRow,
				SQL:    buildUpdateSQL(dstTable, pkCols, allCols, srcRow),
			})
		}
	}

	// DELETE: 대상에만 있음
	for pk, dstRow := range dstRows {
		if _, exists := srcRows[pk]; !exists {
			diffs = append(diffs, DataDiffRow{
				PK:     pk,
				Action: DataDiffDelete,
				SrcRow: nil,
				DstRow: dstRow,
				SQL:    buildDeleteSQL(dstTable, pkCols, dstRow),
			})
		}
	}

	// PK 기준 안정 정렬
	sort.Slice(diffs, func(i, j int) bool {
		return diffs[i].PK < diffs[j].PK
	})
	return diffs
}

// rowChanged 두 행에서 값이 다른 컬럼이 하나라도 있는지 확인한다.
func rowChanged(cols []string, src, dst map[string]string) bool {
	for _, col := range cols {
		if src[col] != dst[col] {
			return true
		}
	}
	return false
}

// quoteVal SQL 문자열 값을 따옴표로 감싸고 이스케이프한다.
func quoteVal(v string) string {
	if v == "NULL" {
		return "NULL"
	}
	v = strings.ReplaceAll(v, `\`, `\\`)
	v = strings.ReplaceAll(v, `'`, `\'`)
	return "'" + v + "'"
}

// buildInsertSQL INSERT 문을 생성한다.
func buildInsertSQL(table string, cols []string, row map[string]string) string {
	colParts := make([]string, len(cols))
	valParts := make([]string, len(cols))
	for i, col := range cols {
		colParts[i] = quoteIdent(col)
		valParts[i] = quoteVal(row[col])
	}
	return fmt.Sprintf(
		"INSERT INTO %s (%s) VALUES (%s)",
		quoteIdent(table),
		strings.Join(colParts, ", "),
		strings.Join(valParts, ", "),
	)
}

// buildUpdateSQL UPDATE 문을 생성한다. PK 컬럼은 WHERE 절에만 사용한다.
func buildUpdateSQL(table string, pkCols, allCols []string, row map[string]string) string {
	pkSet := make(map[string]struct{}, len(pkCols))
	for _, c := range pkCols {
		pkSet[c] = struct{}{}
	}

	var setParts, whereParts []string
	for _, col := range allCols {
		if _, isPK := pkSet[col]; !isPK {
			setParts = append(setParts, fmt.Sprintf("%s = %s", quoteIdent(col), quoteVal(row[col])))
		}
	}
	for _, col := range pkCols {
		whereParts = append(whereParts, fmt.Sprintf("%s = %s", quoteIdent(col), quoteVal(row[col])))
	}

	return fmt.Sprintf(
		"UPDATE %s SET %s WHERE %s",
		quoteIdent(table),
		strings.Join(setParts, ", "),
		strings.Join(whereParts, " AND "),
	)
}

// buildDeleteSQL DELETE 문을 생성한다.
func buildDeleteSQL(table string, pkCols []string, row map[string]string) string {
	whereParts := make([]string, len(pkCols))
	for i, col := range pkCols {
		whereParts[i] = fmt.Sprintf("%s = %s", quoteIdent(col), quoteVal(row[col]))
	}
	return fmt.Sprintf(
		"DELETE FROM %s WHERE %s",
		quoteIdent(table),
		strings.Join(whereParts, " AND "),
	)
}
