// Package sync — 두 MySQL 서버/DB 간 스키마 비교 및 동기화 SQL 생성.
package sync

import (
	"context"
	"fmt"
	"strings"
	"time"

	"orcasql/internal/connection"
)

// SchemaDiffItem 두 스키마 간 차이 항목.
type SchemaDiffItem struct {
	ObjectType string `json:"objectType"` // "TABLE" | "COLUMN" | "INDEX"
	ObjectName string `json:"objectName"` // 테이블명
	SubName    string `json:"subName"`    // 컬럼/인덱스명 (해당 시)
	Action     string `json:"action"`     // "ADD" | "DROP" | "MODIFY"
	SourceDDL  string `json:"sourceDdl"`  // 소스 정의
	TargetDDL  string `json:"targetDdl"`  // 대상 정의 (없으면 "")
	SQL        string `json:"sql"`        // 동기화 SQL
}

// SchemaSyncResult 스키마 비교 결과.
type SchemaSyncResult struct {
	Diffs    []SchemaDiffItem `json:"diffs"`
	SyncSQL  string           `json:"syncSql"`  // 전체 동기화 SQL (concat)
	Analyzed time.Time        `json:"analyzed"`
}

// Syncer 스키마 동기화기.
type Syncer struct {
	connManager *connection.Manager
}

// NewSyncer 새 Syncer를 생성한다.
func NewSyncer(cm *connection.Manager) *Syncer {
	return &Syncer{connManager: cm}
}

// CompareSchemas sourceConn.sourceDB → targetConn.targetDB 스키마를 비교한다.
// 반환된 SchemaSyncResult의 SyncSQL을 대상 DB에 적용하면 스키마가 동기화된다.
func (s *Syncer) CompareSchemas(
	ctx context.Context,
	sourceConnID, sourceDB,
	targetConnID, targetDB string,
) (*SchemaSyncResult, error) {
	srcTables, err := s.getTableDDLMap(ctx, sourceConnID, sourceDB)
	if err != nil {
		return nil, fmt.Errorf("source schema: %w", err)
	}
	dstTables, err := s.getTableDDLMap(ctx, targetConnID, targetDB)
	if err != nil {
		return nil, fmt.Errorf("target schema: %w", err)
	}

	var diffs []SchemaDiffItem
	var sqls []string

	// 소스에 있지만 대상에 없는 테이블 → ADD
	for tableName, srcDDL := range srcTables {
		if _, exists := dstTables[tableName]; !exists {
			adapted := adaptDDLToDatabase(srcDDL, targetDB)
			diffs = append(diffs, SchemaDiffItem{
				ObjectType: "TABLE",
				ObjectName: tableName,
				Action:     "ADD",
				SourceDDL:  srcDDL,
				TargetDDL:  "",
				SQL:        adapted + ";",
			})
			sqls = append(sqls, adapted+";")
		}
	}

	// 대상에 있지만 소스에 없는 테이블 → DROP
	for tableName, dstDDL := range dstTables {
		if _, exists := srcTables[tableName]; !exists {
			dropSQL := fmt.Sprintf("DROP TABLE IF EXISTS %s.%s;", quoteIdent(targetDB), quoteIdent(tableName))
			diffs = append(diffs, SchemaDiffItem{
				ObjectType: "TABLE",
				ObjectName: tableName,
				Action:     "DROP",
				SourceDDL:  "",
				TargetDDL:  dstDDL,
				SQL:        dropSQL,
			})
			sqls = append(sqls, dropSQL)
		}
	}

	// 양쪽에 모두 있는 테이블 → 컬럼/인덱스 비교
	for tableName, srcDDL := range srcTables {
		if dstDDL, exists := dstTables[tableName]; exists {
			if srcDDL != dstDDL {
				colDiffs, err := s.compareTableColumns(ctx, sourceConnID, sourceDB, targetConnID, targetDB, tableName)
				if err != nil {
					return nil, err
				}
				diffs = append(diffs, colDiffs...)
				for _, d := range colDiffs {
					sqls = append(sqls, d.SQL)
				}
			}
		}
	}

	syncSQL := ""
	if len(sqls) > 0 {
		header := fmt.Sprintf(
			"-- Schema Sync: %s.%s → %s.%s\n-- Generated: %s\n\nSET FOREIGN_KEY_CHECKS=0;\n\n",
			sourceConnID, sourceDB, targetConnID, targetDB, time.Now().Format(time.RFC3339),
		)
		syncSQL = header + strings.Join(sqls, "\n") + "\n\nSET FOREIGN_KEY_CHECKS=1;\n"
	}

	return &SchemaSyncResult{
		Diffs:    diffs,
		SyncSQL:  syncSQL,
		Analyzed: time.Now(),
	}, nil
}

// ApplySyncSQL 동기화 SQL을 대상 DB에 적용한다.
func (s *Syncer) ApplySyncSQL(ctx context.Context, connID, database, sql string) error {
	db, err := s.connManager.GetDB(connID)
	if err != nil {
		return err
	}

	// 세미콜론 기준으로 분리 실행
	statements := splitSQL(sql)
	for _, stmt := range statements {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" || strings.HasPrefix(stmt, "--") {
			continue
		}
		qctx, cancel := context.WithTimeout(ctx, 60*time.Second)
		_, execErr := db.ExecContext(qctx, stmt)
		cancel()
		if execErr != nil {
			return fmt.Errorf("execute [%.80s...]: %w", stmt, execErr)
		}
	}
	return nil
}

// ─── 내부 헬퍼 ──────────────────────────────────────────────────────────────

func (s *Syncer) getTableDDLMap(ctx context.Context, connID, database string) (map[string]string, error) {
	db, err := s.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	rows, err := db.QueryContext(qctx,
		"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
		database)
	if err != nil {
		return nil, fmt.Errorf("list tables: %w", err)
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tables = append(tables, name)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make(map[string]string, len(tables))
	for _, tableName := range tables {
		dctx, dcancel := context.WithTimeout(ctx, 30*time.Second)
		row := db.QueryRowContext(dctx, fmt.Sprintf("SHOW CREATE TABLE %s.%s", quoteIdent(database), quoteIdent(tableName)))
		var tname, ddl string
		err := row.Scan(&tname, &ddl)
		dcancel()
		if err != nil {
			return nil, fmt.Errorf("show create %s: %w", tableName, err)
		}
		// DB 이름 제거 (비교 목적)
		ddl = normalizedDDL(ddl, database)
		result[tableName] = ddl
	}
	return result, nil
}

func (s *Syncer) compareTableColumns(
	ctx context.Context,
	srcConnID, srcDB, dstConnID, dstDB, tableName string,
) ([]SchemaDiffItem, error) {
	srcCols, err := s.getColumnMap(ctx, srcConnID, srcDB, tableName)
	if err != nil {
		return nil, err
	}
	dstCols, err := s.getColumnMap(ctx, dstConnID, dstDB, tableName)
	if err != nil {
		return nil, err
	}

	var diffs []SchemaDiffItem

	// 소스에 있지만 대상에 없는 컬럼
	for colName, srcDef := range srcCols {
		if _, exists := dstCols[colName]; !exists {
			alterSQL := fmt.Sprintf("ALTER TABLE %s.%s ADD COLUMN %s;", quoteIdent(dstDB), quoteIdent(tableName), srcDef)
			diffs = append(diffs, SchemaDiffItem{
				ObjectType: "COLUMN",
				ObjectName: tableName,
				SubName:    colName,
				Action:     "ADD",
				SourceDDL:  srcDef,
				TargetDDL:  "",
				SQL:        alterSQL,
			})
		}
	}

	// 대상에 있지만 소스에 없는 컬럼
	for colName, dstDef := range dstCols {
		if _, exists := srcCols[colName]; !exists {
			alterSQL := fmt.Sprintf("ALTER TABLE %s.%s DROP COLUMN %s;", quoteIdent(dstDB), quoteIdent(tableName), quoteIdent(colName))
			diffs = append(diffs, SchemaDiffItem{
				ObjectType: "COLUMN",
				ObjectName: tableName,
				SubName:    colName,
				Action:     "DROP",
				SourceDDL:  "",
				TargetDDL:  dstDef,
				SQL:        alterSQL,
			})
		}
	}

	// 양쪽에 있지만 정의가 다른 컬럼
	for colName, srcDef := range srcCols {
		if dstDef, exists := dstCols[colName]; exists && srcDef != dstDef {
			alterSQL := fmt.Sprintf("ALTER TABLE %s.%s MODIFY COLUMN %s;", quoteIdent(dstDB), quoteIdent(tableName), srcDef)
			diffs = append(diffs, SchemaDiffItem{
				ObjectType: "COLUMN",
				ObjectName: tableName,
				SubName:    colName,
				Action:     "MODIFY",
				SourceDDL:  srcDef,
				TargetDDL:  dstDef,
				SQL:        alterSQL,
			})
		}
	}

	return diffs, nil
}

func (s *Syncer) getColumnMap(ctx context.Context, connID, database, table string) (map[string]string, error) {
	db, err := s.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	rows, err := db.QueryContext(qctx, `
		SELECT COLUMN_NAME, COLUMN_TYPE,
		       IF(IS_NULLABLE = 'YES', 'NULL', 'NOT NULL') AS NULLABLE,
		       IFNULL(COLUMN_DEFAULT, '') AS DEF,
		       IFNULL(EXTRA, '') AS EXTRA,
		       IFNULL(COLUMN_COMMENT, '') AS COMMENT
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		ORDER BY ORDINAL_POSITION`, database, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]string)
	for rows.Next() {
		var colName, colType, nullable, def, extra, comment string
		if err := rows.Scan(&colName, &colType, &nullable, &def, &extra, &comment); err != nil {
			return nil, err
		}
		def2 := ""
		if def != "" {
			def2 = " DEFAULT '" + def + "'"
		}
		ext := ""
		if extra != "" {
			ext = " " + strings.ToUpper(extra)
		}
		cmt := ""
		if comment != "" {
			cmt = " COMMENT '" + comment + "'"
		}
		result[colName] = fmt.Sprintf("%s %s %s%s%s%s", quoteIdent(colName), colType, nullable, def2, ext, cmt)
	}
	return result, rows.Err()
}

func normalizedDDL(ddl, database string) string {
	// `dbname`.`table` → `table` (비교 정규화)
	return strings.ReplaceAll(ddl, "`"+database+"`.", "")
}

func adaptDDLToDatabase(ddl, targetDB string) string {
	return fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s.%s", quoteIdent(targetDB), extractTableBody(ddl))
}

func extractTableBody(ddl string) string {
	// "CREATE TABLE `name` (...)" → "`name` (...)"
	upper := strings.ToUpper(ddl)
	idx := strings.Index(upper, "CREATE TABLE")
	if idx < 0 {
		return ddl
	}
	rest := ddl[idx+len("CREATE TABLE"):]
	return strings.TrimSpace(rest)
}

func splitSQL(sql string) []string {
	var stmts []string
	parts := strings.Split(sql, ";")
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			stmts = append(stmts, p)
		}
	}
	return stmts
}
