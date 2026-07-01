package main

// ─── Table Data Export + Table Utilities ──────────────────────────────────
//
// 테이블 데이터 내보내기 (CSV/JSON/SQL) + 테이블/DB 단위 DDL (Rename/Copy/CreateDB/DropDB).
// csvQuote / escapeSQLStr 는 ExportTableData 의 SQL/CSV 직렬화 헬퍼.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// ─── Table Data Export ────────────────────────────────────────────────────

// ExportTableData 테이블 데이터를 지정 포맷(csv/json/sql)으로 내보낸다.
// limit이 0이면 최대 10000행을 반환한다.
func (a *App) ExportTableData(ctx context.Context, connID, database, table, format string, limit int) (string, error) {
	if limit <= 0 {
		limit = 10000
	}
	qctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return "", fmt.Errorf("get conn: %w", err)
	}

	rows, err := db.QueryContext(qctx, fmt.Sprintf("SELECT * FROM %s.%s LIMIT %d", quoteIdent(database), quoteIdent(table), limit))
	if err != nil {
		return "", fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return "", fmt.Errorf("columns: %w", err)
	}

	var records [][]string
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			continue
		}
		row := make([]string, len(cols))
		for i, v := range vals {
			if v == nil {
				row[i] = "NULL"
			} else {
				switch vv := v.(type) {
				case []byte:
					row[i] = string(vv)
				default:
					row[i] = fmt.Sprintf("%v", vv)
				}
			}
		}
		records = append(records, row)
	}

	switch strings.ToLower(format) {
	case "json":
		type jsonRow = map[string]string
		out := make([]jsonRow, 0, len(records))
		for _, r := range records {
			m := make(jsonRow, len(cols))
			for i, c := range cols {
				m[c] = r[i]
			}
			out = append(out, m)
		}
		data, err := json.MarshalIndent(out, "", "  ")
		if err != nil {
			return "", fmt.Errorf("json marshal: %w", err)
		}
		return string(data), nil

	case "sql":
		var sb strings.Builder
		for _, r := range records {
			sb.WriteString(fmt.Sprintf("INSERT INTO %s (", quoteIdent(table)))
			for i, c := range cols {
				if i > 0 {
					sb.WriteByte(',')
				}
				sb.WriteString(quoteIdent(c))
			}
			sb.WriteString(") VALUES (")
			for i, v := range r {
				if i > 0 {
					sb.WriteByte(',')
				}
				if v == "NULL" {
					sb.WriteString("NULL")
				} else {
					sb.WriteString(escapeSQLStr(v))
				}
			}
			sb.WriteString(");\n")
		}
		return sb.String(), nil

	default: // csv
		var sb strings.Builder
		// 헤더
		for i, c := range cols {
			if i > 0 {
				sb.WriteByte(',')
			}
			sb.WriteString(csvQuote(c))
		}
		sb.WriteByte('\n')
		for _, r := range records {
			for i, v := range r {
				if i > 0 {
					sb.WriteByte(',')
				}
				sb.WriteString(csvQuote(v))
			}
			sb.WriteByte('\n')
		}
		return sb.String(), nil
	}
}

func csvQuote(s string) string {
	if strings.ContainsAny(s, ",\"\n\r") {
		return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
	}
	return s
}

func escapeSQLStr(s string) string {
	var buf bytes.Buffer
	buf.WriteByte('\'')
	for _, c := range s {
		switch c {
		case '\'':
			buf.WriteString(`\'`)
		case '\\':
			buf.WriteString(`\\`)
		case '\n':
			buf.WriteString(`\n`)
		case '\r':
			buf.WriteString(`\r`)
		case 0:
			buf.WriteString(`\0`)
		default:
			buf.WriteRune(c)
		}
	}
	buf.WriteByte('\'')
	return buf.String()
}

// ─── Table Utilities ───────────────────────────────────────────────────────

// RenameTable 테이블 이름을 변경한다.
func (a *App) RenameTable(ctx context.Context, connID, database, oldName, newName string) error {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return err
	}
	sqlStr := fmt.Sprintf("RENAME TABLE %s.%s TO %s.%s",
		quoteIdent(database), quoteIdent(oldName), quoteIdent(database), quoteIdent(newName))
	qctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if _, err = db.ExecContext(qctx, sqlStr); err != nil {
		return fmt.Errorf("rename table: %w", err)
	}
	slog.Info("table renamed", "from", oldName, "to", newName, "db", database)
	return nil
}

// CopyTable 테이블 구조를 복사한다. withData=true 이면 데이터도 함께 복사한다.
func (a *App) CopyTable(ctx context.Context, connID, database, srcTable, dstTable string, withData bool) error {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return err
	}
	qctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	createSQL := fmt.Sprintf("CREATE TABLE %s.%s LIKE %s.%s",
		quoteIdent(database), quoteIdent(dstTable), quoteIdent(database), quoteIdent(srcTable))
	if _, err = db.ExecContext(qctx, createSQL); err != nil {
		return fmt.Errorf("create table: %w", err)
	}
	if withData {
		dataSQL := fmt.Sprintf("INSERT INTO %s.%s SELECT * FROM %s.%s",
			quoteIdent(database), quoteIdent(dstTable), quoteIdent(database), quoteIdent(srcTable))
		if _, err = db.ExecContext(qctx, dataSQL); err != nil {
			return fmt.Errorf("copy data: %w", err)
		}
	}
	slog.Info("table copied", "src", srcTable, "dst", dstTable, "withData", withData)
	return nil
}

// CreateDatabase 새 데이터베이스를 생성한다.
func (a *App) CreateDatabase(ctx context.Context, connID, database string) error {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return err
	}
	qctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	sqlStr := fmt.Sprintf("CREATE DATABASE IF NOT EXISTS %s", quoteIdent(database))
	if _, err = db.ExecContext(qctx, sqlStr); err != nil {
		return fmt.Errorf("create database: %w", err)
	}
	slog.Info("database created", "database", database)
	return nil
}

// DropDatabase 데이터베이스를 삭제한다.
func (a *App) DropDatabase(ctx context.Context, connID, database string) error {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return err
	}
	qctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	sqlStr := fmt.Sprintf("DROP DATABASE %s", quoteIdent(database))
	if _, err = db.ExecContext(qctx, sqlStr); err != nil {
		return fmt.Errorf("drop database: %w", err)
	}
	slog.Info("database dropped", "database", database)
	return nil
}
