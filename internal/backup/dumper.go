// Package backup — mysqldump 수준 SQL 덤프 생성기.
// 외부 바이너리 의존 없이 Go 드라이버로 직접 덤프한다.
package backup

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"strings"
	"time"

	"orcasql/internal/connection"
)

// DumpOptions SQL 덤프 옵션.
type DumpOptions struct {
	ConnID    string   `json:"connId"`
	Database  string   `json:"database"`
	Tables    []string `json:"tables"`    // 비어있으면 전체 테이블
	NoData    bool     `json:"noData"`    // 구조만 덤프 (DDL only)
	NoCreate  bool     `json:"noCreate"`  // 데이터만 덤프 (INSERT only)
	DropTable bool     `json:"dropTable"` // DROP TABLE IF EXISTS 포함
	InsertIgnore bool  `json:"insertIgnore"` // INSERT IGNORE INTO 사용
	BatchSize int      `json:"batchSize"` // INSERT 배치 크기 (기본 1000)
}

// DumpProgress 덤프 진행 상황.
type DumpProgress struct {
	Table     string  `json:"table"`
	Phase     string  `json:"phase"` // "ddl" | "data" | "done"
	RowsDone  int64   `json:"rowsDone"`
	TotalRows int64   `json:"totalRows"`
	Percent   float64 `json:"percent"`
}

// Dumper SQL 덤프 실행기.
type Dumper struct {
	connManager *connection.Manager
}

// NewDumper Dumper 인스턴스를 생성한다.
func NewDumper(cm *connection.Manager) *Dumper {
	return &Dumper{connManager: cm}
}

// Dump 지정 데이터베이스/테이블을 writer에 SQL로 출력한다.
// onProgress 콜백으로 진행 상황을 실시간 보고한다.
func (d *Dumper) Dump(
	ctx context.Context,
	opts DumpOptions,
	w io.Writer,
	onProgress func(DumpProgress),
) error {
	db, err := d.connManager.GetDB(opts.ConnID)
	if err != nil {
		return fmt.Errorf("get db: %w", err)
	}

	batchSize := opts.BatchSize
	if batchSize <= 0 {
		batchSize = 1000
	}

	// ── 헤더 ───────────────────────────────────────────────────────────
	if _, err := fmt.Fprintf(w, "-- OrcaSQL Dump\n-- Database: %s\n-- Date: %s\n\n",
		opts.Database, time.Now().Format(time.RFC3339)); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "SET FOREIGN_KEY_CHECKS=0;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n\n"); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "USE %s;\n\n", quoteIdent(opts.Database)); err != nil {
		return err
	}

	// ── 테이블 목록 결정 ────────────────────────────────────────────────
	tables := opts.Tables
	if len(tables) == 0 {
		tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		rows, err := db.QueryContext(tctx,
			"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
			opts.Database)
		if err != nil {
			return fmt.Errorf("list tables: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				return err
			}
			tables = append(tables, name)
		}
		if err := rows.Err(); err != nil {
			return err
		}
	}

	// ── 테이블별 덤프 ───────────────────────────────────────────────────
	for _, tableName := range tables {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// DDL
		if !opts.NoCreate {
			if onProgress != nil {
				onProgress(DumpProgress{Table: tableName, Phase: "ddl"})
			}
			if err := d.dumpTableDDL(ctx, opts, db, tableName, w); err != nil {
				return fmt.Errorf("ddl %s: %w", tableName, err)
			}
		}

		// 데이터
		if !opts.NoData {
			if err := d.dumpTableData(ctx, opts, db, tableName, batchSize, w, onProgress); err != nil {
				return fmt.Errorf("data %s: %w", tableName, err)
			}
		}
	}

	// ── 푸터 ───────────────────────────────────────────────────────────
	_, err = fmt.Fprintf(w, "\nSET FOREIGN_KEY_CHECKS=1;\n-- Dump completed: %s\n", time.Now().Format(time.RFC3339))
	return err
}

func (d *Dumper) dumpTableDDL(
	ctx context.Context,
	opts DumpOptions,
	_ *sql.DB,
	tableName string,
	w io.Writer,
) error {
	// SHOW CREATE TABLE
	realDB, err := d.connManager.GetDB(opts.ConnID)
	if err != nil {
		return err
	}
	qctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var tname, createSQL string
	row := realDB.QueryRowContext(qctx, fmt.Sprintf("SHOW CREATE TABLE %s.%s", quoteIdent(opts.Database), quoteIdent(tableName)))
	if err := row.Scan(&tname, &createSQL); err != nil {
		return fmt.Errorf("show create table: %w", err)
	}

	if _, err := fmt.Fprintf(w, "\n-- Table: %s\n", tableName); err != nil {
		return err
	}
	if opts.DropTable {
		if _, err := fmt.Fprintf(w, "DROP TABLE IF EXISTS %s;\n", quoteIdent(tableName)); err != nil {
			return err
		}
	}
	_, err = fmt.Fprintf(w, "%s;\n", createSQL)
	return err
}

func (d *Dumper) dumpTableData(
	ctx context.Context,
	opts DumpOptions,
	_ interface{},
	tableName string,
	batchSize int,
	w io.Writer,
	onProgress func(DumpProgress),
) error {
	realDB, err := d.connManager.GetDB(opts.ConnID)
	if err != nil {
		return err
	}

	// 총 행 수
	var totalRows int64
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	row := realDB.QueryRowContext(cctx, fmt.Sprintf("SELECT COUNT(*) FROM %s.%s", quoteIdent(opts.Database), quoteIdent(tableName)))
	if err := row.Scan(&totalRows); err != nil {
		return fmt.Errorf("count rows: %w", err)
	}
	if totalRows == 0 {
		return nil
	}

	// 전체 SELECT
	qctx, qcancel := context.WithTimeout(ctx, 600*time.Second)
	defer qcancel()

	rows, err := realDB.QueryContext(qctx, fmt.Sprintf("SELECT * FROM %s.%s", quoteIdent(opts.Database), quoteIdent(tableName)))
	if err != nil {
		return fmt.Errorf("select data: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return err
	}

	insertKeyword := "INSERT INTO"
	if opts.InsertIgnore {
		insertKeyword = "INSERT IGNORE INTO"
	}
	escapedCols := make([]string, len(cols))
	for i, c := range cols {
		escapedCols[i] = quoteIdent(c)
	}
	colList := strings.Join(escapedCols, ", ")

	var rowsDone int64
	var batchRows []string

	flushBatch := func() error {
		if len(batchRows) == 0 {
			return nil
		}
		_, err := fmt.Fprintf(w, "%s %s (%s) VALUES\n%s;\n",
			insertKeyword, quoteIdent(tableName), colList,
			strings.Join(batchRows, ",\n"))
		batchRows = batchRows[:0]
		return err
	}

	vals := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}

	if _, err := fmt.Fprintf(w, "\n-- Data: %s (%d rows)\n", tableName, totalRows); err != nil {
		return err
	}

	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return fmt.Errorf("scan row: %w", err)
		}

		parts := make([]string, len(cols))
		for i, v := range vals {
			parts[i] = sqlValue(v)
		}
		batchRows = append(batchRows, "("+strings.Join(parts, ", ")+")")
		rowsDone++

		if len(batchRows) >= batchSize {
			if err := flushBatch(); err != nil {
				return err
			}
		}

		if onProgress != nil && rowsDone%1000 == 0 {
			pct := float64(rowsDone) / float64(totalRows) * 100
			onProgress(DumpProgress{
				Table:     tableName,
				Phase:     "data",
				RowsDone:  rowsDone,
				TotalRows: totalRows,
				Percent:   pct,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := flushBatch(); err != nil {
		return err
	}
	if onProgress != nil {
		onProgress(DumpProgress{
			Table:     tableName,
			Phase:     "done",
			RowsDone:  rowsDone,
			TotalRows: totalRows,
			Percent:   100,
		})
	}
	return nil
}

// sqlValue 값을 SQL 리터럴로 변환한다.
func sqlValue(v interface{}) string {
	if v == nil {
		return "NULL"
	}
	switch val := v.(type) {
	case []byte:
		return "'" + escapeSQLStr(string(val)) + "'"
	case string:
		return "'" + escapeSQLStr(val) + "'"
	case int64:
		return fmt.Sprintf("%d", val)
	case float64:
		return fmt.Sprintf("%g", val)
	case bool:
		if val {
			return "1"
		}
		return "0"
	case time.Time:
		return "'" + val.Format("2006-01-02 15:04:05") + "'"
	default:
		return "'" + escapeSQLStr(fmt.Sprintf("%v", val)) + "'"
	}
}

func escapeSQLStr(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "'", "\\'")
	s = strings.ReplaceAll(s, "\n", "\\n")
	s = strings.ReplaceAll(s, "\r", "\\r")
	s = strings.ReplaceAll(s, "\x00", "\\0")
	return s
}
