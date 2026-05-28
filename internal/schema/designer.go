// Package schema — Table Designer: 테이블 구조 조회 및 ALTER SQL 생성.
package schema

import (
	"context"
	"fmt"
	"strings"

	"orcasql/internal/connection"
)

// ColumnDef 테이블 컬럼 정의.
type ColumnDef struct {
	Name        string `json:"name"`
	DataType    string `json:"dataType"`    // int, varchar, text, ...
	Length      string `json:"length"`      // "255", "10,2" (DECIMAL)
	NotNull     bool   `json:"notNull"`
	Default     string `json:"default"`
	AutoInc     bool   `json:"autoInc"`
	PrimaryKey  bool   `json:"primaryKey"`
	Unique      bool   `json:"unique"`
	Unsigned    bool   `json:"unsigned"`
	ZeroFill    bool   `json:"zeroFill"`
	Comment     string `json:"comment"`
	OrdinalPos  int    `json:"ordinalPos"`
	Collation   string `json:"collation"`
	OnUpdate    string `json:"onUpdate"` // CURRENT_TIMESTAMP 등
	// OriginalName 은 Phase 16 디자이너에서 rename 감지용으로 사용된다.
	// 빈 문자열이면 신규 컬럼으로 간주한다.
	OriginalName string `json:"originalName,omitempty"`
}

// IndexDef 인덱스 정의.
type IndexDef struct {
	Name             string   `json:"name"`
	Columns          []string `json:"columns"`
	ColumnDirections []string `json:"columnDirections"` // 각 컬럼의 정렬 방향: "ASC" | "DESC"
	Unique           bool     `json:"unique"`
	FullText         bool     `json:"fullText"`
	IndexType        string   `json:"indexType"` // BTREE | HASH
	IsPrimary        bool     `json:"isPrimary"`
}

// ForeignKeyDef 외래 키 정의.
type ForeignKeyDef struct {
	Name      string `json:"name"`
	Column    string `json:"column"`
	RefTable  string `json:"refTable"`
	RefColumn string `json:"refColumn"`
	OnDelete  string `json:"onDelete"` // CASCADE | SET NULL | RESTRICT | NO ACTION
	OnUpdate  string `json:"onUpdate"`
}

// TableDefinition 전체 테이블 구조.
type TableDefinition struct {
	Name        string         `json:"name"`
	Engine      string         `json:"engine"`
	Charset     string         `json:"charset"`
	Collation   string         `json:"collation"`
	Comment     string         `json:"comment"`
	Columns     []ColumnDef    `json:"columns"`
	Indexes     []IndexDef     `json:"indexes"`
	ForeignKeys []ForeignKeyDef `json:"foreignKeys"`
}

// CheckConstraintDef CHECK 제약 정의.
type CheckConstraintDef struct {
	Name       string `json:"name"`
	Expression string `json:"expression"`
	Enforced   bool   `json:"enforced"`
}

// PartitionInfo information_schema.PARTITIONS 조회 결과.
type PartitionInfo struct {
	Name           string `json:"name"`
	Method         string `json:"method"`         // RANGE | LIST | HASH | KEY ...
	Expression     string `json:"expression"`
	Description    string `json:"description"`
	TableRows      int64  `json:"tableRows"`
	DataLength     int64  `json:"dataLength"`
	IndexLength    int64  `json:"indexLength"`
	SubpartitionName string `json:"subpartitionName"`
}

// TableMeta Phase 16 디자이너용 전체 메타데이터. 상단 탭과 하단 그리드에 필요한 모든 정보를 포함한다.
type TableMeta struct {
	// 기본 정보
	Name      string `json:"name"`
	Comment   string `json:"comment"`
	// 옵션
	Engine        string `json:"engine"`
	Charset       string `json:"charset"`
	Collation     string `json:"collation"`
	AutoIncrement int64  `json:"autoIncrement"`
	RowFormat     string `json:"rowFormat"`
	// 컬럼 및 제약
	Columns          []ColumnDef          `json:"columns"`
	Indexes          []IndexDef           `json:"indexes"`
	ForeignKeys      []ForeignKeyDef      `json:"foreignKeys"`
	CheckConstraints []CheckConstraintDef `json:"checkConstraints"`
	Partitions       []PartitionInfo      `json:"partitions"`
	// SHOW CREATE TABLE 원본
	CreateStmt string `json:"createStmt"`
}

// AlterStatement ALTER TABLE 실행 시 반환값.
type AlterStatement struct {
	SQL     string `json:"sql"`
	Preview string `json:"preview"` // 사람이 읽기 쉬운 변경 요약
}

// Designer 테이블 구조 설계기.
type Designer struct {
	connManager *connection.Manager
}

// NewDesigner Designer 인스턴스를 생성한다.
func NewDesigner(cm *connection.Manager) *Designer {
	return &Designer{connManager: cm}
}

// GetTableDefinition 테이블 전체 구조(컬럼+인덱스+FK)를 반환한다.
func (d *Designer) GetTableDefinition(ctx context.Context, connID, database, table string) (*TableDefinition, error) {
	db, err := d.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	def := &TableDefinition{Name: table}

	// ── 테이블 기본 정보 ──────────────────────────────────────────────────
	row := db.QueryRowContext(qctx, `
		SELECT
			IFNULL(ENGINE, '') AS ENGINE,
			IFNULL(TABLE_COLLATION, '') AS COLLATION,
			IFNULL(TABLE_COMMENT, '') AS COMMENT
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, database, table)
	var collation string
	if err := row.Scan(&def.Engine, &collation, &def.Comment); err != nil {
		return nil, fmt.Errorf("get table info: %w", err)
	}
	def.Collation = collation
	// Charset은 collation 앞부분 (utf8mb4_general_ci → utf8mb4)
	if idx := strings.Index(collation, "_"); idx > 0 {
		def.Charset = collation[:idx]
	}

	// ── 컬럼 ─────────────────────────────────────────────────────────────
	colRows, err := db.QueryContext(qctx, `
		SELECT
			COLUMN_NAME,
			ORDINAL_POSITION,
			DATA_TYPE,
			COLUMN_TYPE,
			IFNULL(CHARACTER_MAXIMUM_LENGTH, '') AS LEN,
			IF(IS_NULLABLE = 'YES', 0, 1) AS NOT_NULL,
			IFNULL(COLUMN_DEFAULT, '') AS COL_DEFAULT,
			IF(EXTRA LIKE '%auto_increment%', 1, 0) AS AUTO_INC,
			IF(COLUMN_KEY = 'PRI', 1, 0) AS PRI,
			IF(COLUMN_KEY = 'UNI', 1, 0) AS UNI,
			IFNULL(COLUMN_COMMENT, '') AS COMMENT,
			IFNULL(COLLATION_NAME, '') AS COLLATION,
			IFNULL(EXTRA, '') AS EXTRA
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		ORDER BY ORDINAL_POSITION`, database, table)
	if err != nil {
		return nil, fmt.Errorf("get columns: %w", err)
	}
	defer colRows.Close()

	for colRows.Next() {
		var c ColumnDef
		var notNull, autoInc, pri, uni int
		var colType, lenVal, extra string
		if err := colRows.Scan(
			&c.Name, &c.OrdinalPos, &c.DataType, &colType,
			&lenVal, &notNull, &c.Default,
			&autoInc, &pri, &uni, &c.Comment, &c.Collation, &extra,
		); err != nil {
			return nil, fmt.Errorf("scan column: %w", err)
		}
		c.NotNull = notNull == 1
		c.AutoInc = autoInc == 1
		c.PrimaryKey = pri == 1
		c.Unique = uni == 1
		c.OriginalName = c.Name

		// DECIMAL(10,2) 같은 경우 colType에서 length 추출
		c.Length = extractLength(colType)

		// COLUMN_TYPE 기반 unsigned / zerofill 추출
		upperType := strings.ToUpper(colType)
		c.Unsigned = strings.Contains(upperType, "UNSIGNED")
		c.ZeroFill = strings.Contains(upperType, "ZEROFILL")

		// ON UPDATE CURRENT_TIMESTAMP
		if strings.Contains(strings.ToUpper(extra), "ON UPDATE") {
			c.OnUpdate = "CURRENT_TIMESTAMP"
		}
		def.Columns = append(def.Columns, c)
	}
	if err := colRows.Err(); err != nil {
		return nil, err
	}

	// ── 인덱스 ───────────────────────────────────────────────────────────
	idxRows, err := db.QueryContext(qctx, `
		SELECT
			INDEX_NAME,
			GROUP_CONCAT(CONCAT(COLUMN_NAME, ':', IFNULL(COLLATION, 'A')) ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS COLS,
			IF(NON_UNIQUE = 0, 1, 0) AS IS_UNIQUE,
			INDEX_TYPE,
			IF(INDEX_NAME = 'PRIMARY', 1, 0) AS IS_PRIMARY
		FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		GROUP BY INDEX_NAME, NON_UNIQUE, INDEX_TYPE
		ORDER BY IS_PRIMARY DESC, INDEX_NAME`, database, table)
	if err != nil {
		return nil, fmt.Errorf("get indexes: %w", err)
	}
	defer idxRows.Close()

	for idxRows.Next() {
		var idx IndexDef
		var colsStr string
		var isUnique, isPrimary int
		if err := idxRows.Scan(&idx.Name, &colsStr, &isUnique, &idx.IndexType, &isPrimary); err != nil {
			return nil, fmt.Errorf("scan index: %w", err)
		}
		idx.Unique = isUnique == 1
		idx.IsPrimary = isPrimary == 1
		idx.FullText = idx.IndexType == "FULLTEXT"
		// "col:A,col2:D" 형태를 파싱해 이름과 정렬 방향을 분리
		for _, pair := range strings.Split(colsStr, ",") {
			parts := strings.SplitN(pair, ":", 2)
			idx.Columns = append(idx.Columns, parts[0])
			if len(parts) > 1 && parts[1] == "D" {
				idx.ColumnDirections = append(idx.ColumnDirections, "DESC")
			} else {
				idx.ColumnDirections = append(idx.ColumnDirections, "ASC")
			}
		}
		def.Indexes = append(def.Indexes, idx)
	}
	if err := idxRows.Err(); err != nil {
		return nil, err
	}

	// ── 외래 키 ──────────────────────────────────────────────────────────
	fkRows, err := db.QueryContext(qctx, `
		SELECT
			rc.CONSTRAINT_NAME,
			kcu.COLUMN_NAME,
			kcu.REFERENCED_TABLE_NAME,
			kcu.REFERENCED_COLUMN_NAME,
			IFNULL(rc.DELETE_RULE, 'RESTRICT') AS ON_DELETE,
			IFNULL(rc.UPDATE_RULE, 'RESTRICT') AS ON_UPDATE
		FROM information_schema.REFERENTIAL_CONSTRAINTS rc
		JOIN information_schema.KEY_COLUMN_USAGE kcu
			ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
			AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
		WHERE rc.CONSTRAINT_SCHEMA = ? AND kcu.TABLE_NAME = ?
		ORDER BY rc.CONSTRAINT_NAME`, database, table)
	if err != nil {
		return nil, fmt.Errorf("get foreign keys: %w", err)
	}
	defer fkRows.Close()

	for fkRows.Next() {
		var fk ForeignKeyDef
		if err := fkRows.Scan(
			&fk.Name, &fk.Column, &fk.RefTable, &fk.RefColumn,
			&fk.OnDelete, &fk.OnUpdate,
		); err != nil {
			return nil, fmt.Errorf("scan fk: %w", err)
		}
		def.ForeignKeys = append(def.ForeignKeys, fk)
	}
	return def, fkRows.Err()
}

// GetTableMeta Phase 16 디자이너 상단/하단 탭에 필요한 모든 메타를 한 번에 조회한다.
// 기존 GetTableDefinition 을 재사용한 뒤 옵션/체크 제약/파티션/CREATE 문을 덧붙인다.
func (d *Designer) GetTableMeta(ctx context.Context, connID, database, table string) (*TableMeta, error) {
	def, err := d.GetTableDefinition(ctx, connID, database, table)
	if err != nil {
		return nil, err
	}

	db, err := d.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	meta := &TableMeta{
		Name:        def.Name,
		Comment:     def.Comment,
		Engine:      def.Engine,
		Charset:     def.Charset,
		Collation:   def.Collation,
		Columns:     def.Columns,
		Indexes:     def.Indexes,
		ForeignKeys: def.ForeignKeys,
	}

	// ── 추가 옵션 (AUTO_INCREMENT, ROW_FORMAT) ────────────────────────
	optRow := db.QueryRowContext(qctx, `
		SELECT
			IFNULL(AUTO_INCREMENT, 0) AS AUTO_INCREMENT,
			IFNULL(ROW_FORMAT, '') AS ROW_FORMAT
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, database, table)
	if err := optRow.Scan(&meta.AutoIncrement, &meta.RowFormat); err != nil {
		// non-fatal — 옵션 조회 실패는 무시
		meta.AutoIncrement = 0
		meta.RowFormat = ""
	}

	// ── CHECK 제약 (MySQL 8.0+) ───────────────────────────────────────
	checkRows, cerr := db.QueryContext(qctx, `
		SELECT
			cc.CONSTRAINT_NAME,
			cc.CHECK_CLAUSE,
			IF(tc.ENFORCED = 'YES', 1, 0) AS ENFORCED
		FROM information_schema.CHECK_CONSTRAINTS cc
		INNER JOIN information_schema.TABLE_CONSTRAINTS tc
			ON  tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
			AND tc.CONSTRAINT_NAME   = cc.CONSTRAINT_NAME
			AND tc.CONSTRAINT_TYPE   = 'CHECK'
		WHERE cc.CONSTRAINT_SCHEMA = ? AND tc.TABLE_NAME = ?
		ORDER BY cc.CONSTRAINT_NAME`, database, table)
	if cerr == nil {
		for checkRows.Next() {
			var c CheckConstraintDef
			var enforced int
			if err := checkRows.Scan(&c.Name, &c.Expression, &enforced); err == nil {
				c.Enforced = enforced == 1
				meta.CheckConstraints = append(meta.CheckConstraints, c)
			}
		}
		checkRows.Close()
	}

	// ── 파티션 ────────────────────────────────────────────────────────
	partRows, perr := db.QueryContext(qctx, `
		SELECT
			IFNULL(PARTITION_NAME, ''),
			IFNULL(PARTITION_METHOD, ''),
			IFNULL(PARTITION_EXPRESSION, ''),
			IFNULL(PARTITION_DESCRIPTION, ''),
			IFNULL(TABLE_ROWS, 0),
			IFNULL(DATA_LENGTH, 0),
			IFNULL(INDEX_LENGTH, 0),
			IFNULL(SUBPARTITION_NAME, '')
		FROM information_schema.PARTITIONS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND PARTITION_NAME IS NOT NULL
		ORDER BY PARTITION_ORDINAL_POSITION`, database, table)
	if perr == nil {
		for partRows.Next() {
			var p PartitionInfo
			if err := partRows.Scan(
				&p.Name, &p.Method, &p.Expression, &p.Description,
				&p.TableRows, &p.DataLength, &p.IndexLength, &p.SubpartitionName,
			); err == nil {
				meta.Partitions = append(meta.Partitions, p)
			}
		}
		partRows.Close()
	}

	// ── SHOW CREATE TABLE ─────────────────────────────────────────────
	var tname, ddl string
	ddlRow := db.QueryRowContext(qctx, fmt.Sprintf("SHOW CREATE TABLE %s.%s", quoteIdent(database), quoteIdent(table)))
	if err := ddlRow.Scan(&tname, &ddl); err == nil {
		meta.CreateStmt = ddl
	}

	return meta, nil
}

// GenerateAlterSQL old → new 기준으로 ALTER TABLE SQL을 생성한다.
// 컬럼 추가/수정/삭제, 인덱스 추가/삭제, FK 추가/삭제를 처리한다.
func (d *Designer) GenerateAlterSQL(database, table string, old, new *TableDefinition) (*AlterStatement, error) {
	var parts []string
	var previews []string

	// ── 컬럼 비교 ────────────────────────────────────────────────────────
	oldColMap := make(map[string]ColumnDef, len(old.Columns))
	for _, c := range old.Columns {
		oldColMap[c.Name] = c
	}
	newColMap := make(map[string]ColumnDef, len(new.Columns))
	for _, c := range new.Columns {
		newColMap[c.Name] = c
	}

	// 추가 / 수정
	for _, nc := range new.Columns {
		oc, exists := oldColMap[nc.Name]
		if !exists {
			parts = append(parts, "ADD COLUMN "+columnDDL(nc))
			previews = append(previews, fmt.Sprintf("+ ADD COLUMN %s", nc.Name))
		} else if columnChanged(oc, nc) {
			parts = append(parts, "MODIFY COLUMN "+columnDDL(nc))
			previews = append(previews, fmt.Sprintf("~ MODIFY COLUMN %s", nc.Name))
		}
	}

	// 삭제
	for _, oc := range old.Columns {
		if _, exists := newColMap[oc.Name]; !exists {
			parts = append(parts, "DROP COLUMN "+quoteIdent(oc.Name))
			previews = append(previews, fmt.Sprintf("- DROP COLUMN %s", oc.Name))
		}
	}

	// ── 인덱스 비교 ──────────────────────────────────────────────────────
	oldIdxMap := make(map[string]IndexDef, len(old.Indexes))
	for _, idx := range old.Indexes {
		oldIdxMap[idx.Name] = idx
	}
	newIdxMap := make(map[string]IndexDef, len(new.Indexes))
	for _, idx := range new.Indexes {
		newIdxMap[idx.Name] = idx
	}

	for _, ni := range new.Indexes {
		if ni.IsPrimary {
			continue // PK는 별도 처리
		}
		if _, exists := oldIdxMap[ni.Name]; !exists {
			parts = append(parts, "ADD "+indexDDL(ni))
			previews = append(previews, fmt.Sprintf("+ ADD INDEX %s", ni.Name))
		}
	}
	for _, oi := range old.Indexes {
		if oi.IsPrimary {
			continue
		}
		if _, exists := newIdxMap[oi.Name]; !exists {
			parts = append(parts, "DROP INDEX "+quoteIdent(oi.Name))
			previews = append(previews, fmt.Sprintf("- DROP INDEX %s", oi.Name))
		}
	}

	// ── FK 비교 ──────────────────────────────────────────────────────────
	oldFKMap := make(map[string]ForeignKeyDef, len(old.ForeignKeys))
	for _, fk := range old.ForeignKeys {
		oldFKMap[fk.Name] = fk
	}
	for _, nf := range new.ForeignKeys {
		if _, exists := oldFKMap[nf.Name]; !exists {
			parts = append(parts, "ADD "+fkDDL(nf))
			previews = append(previews, fmt.Sprintf("+ ADD FK %s", nf.Name))
		}
	}
	newFKMap := make(map[string]ForeignKeyDef, len(new.ForeignKeys))
	for _, fk := range new.ForeignKeys {
		newFKMap[fk.Name] = fk
	}
	for _, of := range old.ForeignKeys {
		if _, exists := newFKMap[of.Name]; !exists {
			parts = append(parts, "DROP FOREIGN KEY "+quoteIdent(of.Name))
			previews = append(previews, fmt.Sprintf("- DROP FK %s", of.Name))
		}
	}

	// ── 테이블 옵션 변경 ─────────────────────────────────────────────────
	if old.Engine != new.Engine && new.Engine != "" {
		parts = append(parts, fmt.Sprintf("ENGINE = %s", new.Engine))
		previews = append(previews, fmt.Sprintf("~ ENGINE %s → %s", old.Engine, new.Engine))
	}
	if old.Comment != new.Comment {
		parts = append(parts, fmt.Sprintf("COMMENT = '%s'", escapeSQLString(new.Comment)))
		previews = append(previews, "~ COMMENT changed")
	}

	if len(parts) == 0 {
		return &AlterStatement{SQL: "", Preview: "변경 없음"}, nil
	}

	sql := fmt.Sprintf("ALTER TABLE %s.%s\n  %s;",
		quoteIdent(database), quoteIdent(table), strings.Join(parts, ",\n  "))
	return &AlterStatement{
		SQL:     sql,
		Preview: strings.Join(previews, "\n"),
	}, nil
}

// GenerateCreateSQL 신규 테이블의 CREATE TABLE SQL 을 생성한다.
// 디자이너 새 테이블 모드(table 인자가 빈 문자열)에서 사용된다.
// def.Name 은 필수, 컬럼이 1개 이상 있어야 한다.
func (d *Designer) GenerateCreateSQL(database string, def *TableDefinition) (*AlterStatement, error) {
	if def == nil || strings.TrimSpace(def.Name) == "" {
		return nil, fmt.Errorf("table name required")
	}
	if len(def.Columns) == 0 {
		return nil, fmt.Errorf("at least one column required")
	}

	var lines []string
	for _, c := range def.Columns {
		lines = append(lines, "  "+columnDDL(c))
	}

	// 컬럼에 표시된 PRIMARY KEY 모음
	var pkCols []string
	for _, c := range def.Columns {
		if c.PrimaryKey {
			pkCols = append(pkCols, quoteIdent(c.Name))
		}
	}
	if len(pkCols) > 0 {
		lines = append(lines, "  PRIMARY KEY ("+strings.Join(pkCols, ", ")+")")
	}

	// 일반 인덱스 (PRIMARY 제외)
	for _, idx := range def.Indexes {
		if idx.IsPrimary {
			continue
		}
		lines = append(lines, "  "+indexDDL(idx))
	}

	// 외래 키
	for _, fk := range def.ForeignKeys {
		lines = append(lines, "  "+fkDDL(fk))
	}

	var b strings.Builder
	fmt.Fprintf(&b, "CREATE TABLE %s.%s (\n", quoteIdent(database), quoteIdent(def.Name))
	b.WriteString(strings.Join(lines, ",\n"))
	b.WriteString("\n)")

	if def.Engine != "" {
		fmt.Fprintf(&b, " ENGINE=%s", def.Engine)
	}
	if def.Charset != "" {
		fmt.Fprintf(&b, " DEFAULT CHARSET=%s", def.Charset)
	}
	if def.Collation != "" {
		fmt.Fprintf(&b, " COLLATE=%s", def.Collation)
	}
	if def.Comment != "" {
		fmt.Fprintf(&b, " COMMENT='%s'", escapeSQLString(def.Comment))
	}
	b.WriteString(";")

	return &AlterStatement{
		SQL:     b.String(),
		Preview: fmt.Sprintf("+ CREATE TABLE %s.%s (%d columns)", quoteIdent(database), quoteIdent(def.Name), len(def.Columns)),
	}, nil
}

// BuildAlterFromMeta Phase 16 디자이너 전용 ALTER 빌더.
// old / new TableMeta 의 차이를 모두 반영한다: 컬럼 추가/삭제/수정/rename/reorder,
// 인덱스/외래키/체크제약 diff, 옵션(엔진/문자셋/auto_increment/comment) 변경.
// 컬럼의 OriginalName 필드를 rename 감지에 사용한다.
func (d *Designer) BuildAlterFromMeta(database, table string, old, newMeta *TableMeta) (*AlterStatement, error) {
	var parts []string
	var previews []string

	// ── 컬럼 rename/modify/add/drop/reorder ──────────────────────────────
	oldByName := make(map[string]ColumnDef, len(old.Columns))
	for _, c := range old.Columns {
		oldByName[c.Name] = c
	}

	// 신규 이름 집합 (rename 후 이름 기준)
	keepOrigNames := make(map[string]bool)
	for _, nc := range newMeta.Columns {
		if nc.OriginalName != "" {
			keepOrigNames[nc.OriginalName] = true
		}
	}

	// DROP: 원본에 있었지만 새 목록의 OriginalName 어디에도 없는 컬럼
	for _, oc := range old.Columns {
		if !keepOrigNames[oc.Name] {
			parts = append(parts, "DROP COLUMN "+quoteIdent(oc.Name))
			previews = append(previews, fmt.Sprintf("- DROP COLUMN %s", oc.Name))
		}
	}

	// ADD / MODIFY / CHANGE (rename) — 순서대로 처리하며 AFTER 절로 위치 고정
	var prevName string
	for i, nc := range newMeta.Columns {
		afterClause := ""
		if i == 0 {
			afterClause = " FIRST"
		} else {
			afterClause = " AFTER " + quoteIdent(prevName)
		}

		if nc.OriginalName == "" {
			// 신규 컬럼
			parts = append(parts, "ADD COLUMN "+columnDDL(nc)+afterClause)
			previews = append(previews, fmt.Sprintf("+ ADD COLUMN %s", nc.Name))
		} else {
			oc, exists := oldByName[nc.OriginalName]
			if !exists {
				// 이상상태 — 신규로 취급
				parts = append(parts, "ADD COLUMN "+columnDDL(nc)+afterClause)
				previews = append(previews, fmt.Sprintf("+ ADD COLUMN %s", nc.Name))
			} else {
				renamed := nc.OriginalName != nc.Name
				changed := columnChanged(oc, nc)
				moved := oc.OrdinalPos != i+1
				if renamed {
					parts = append(parts, fmt.Sprintf("CHANGE COLUMN %s %s%s",
						quoteIdent(nc.OriginalName), columnDDL(nc), afterClause))
					previews = append(previews, fmt.Sprintf("~ RENAME %s → %s", nc.OriginalName, nc.Name))
				} else if changed || moved {
					parts = append(parts, "MODIFY COLUMN "+columnDDL(nc)+afterClause)
					if changed {
						previews = append(previews, fmt.Sprintf("~ MODIFY COLUMN %s", nc.Name))
					}
					if moved {
						previews = append(previews, fmt.Sprintf("↕ REORDER COLUMN %s", nc.Name))
					}
				}
			}
		}
		prevName = nc.Name
	}

	// ── 인덱스 diff ──────────────────────────────────────────────────────
	oldIdxMap := make(map[string]IndexDef, len(old.Indexes))
	for _, idx := range old.Indexes {
		oldIdxMap[idx.Name] = idx
	}
	newIdxMap := make(map[string]IndexDef, len(newMeta.Indexes))
	for _, idx := range newMeta.Indexes {
		newIdxMap[idx.Name] = idx
	}

	// 변경된 인덱스는 DROP+ADD 쌍으로 처리
	for _, oi := range old.Indexes {
		if oi.IsPrimary {
			ni, exists := newIdxMap[oi.Name]
			if !exists {
				parts = append(parts, "DROP PRIMARY KEY")
				previews = append(previews, "- DROP PRIMARY KEY")
			} else if !sameIndexColumns(oi, ni) {
				parts = append(parts, "DROP PRIMARY KEY")
				previews = append(previews, "~ MODIFY PRIMARY KEY (drop)")
			}
			continue
		}
		ni, exists := newIdxMap[oi.Name]
		if !exists {
			parts = append(parts, "DROP INDEX "+quoteIdent(oi.Name))
			previews = append(previews, fmt.Sprintf("- DROP INDEX %s", oi.Name))
		} else if !sameIndexColumns(oi, ni) || oi.Unique != ni.Unique || oi.FullText != ni.FullText {
			parts = append(parts, "DROP INDEX "+quoteIdent(oi.Name))
			previews = append(previews, fmt.Sprintf("~ MODIFY INDEX %s (drop)", oi.Name))
		}
	}
	for _, ni := range newMeta.Indexes {
		if ni.IsPrimary {
			oi, exists := oldIdxMap[ni.Name]
			if !exists {
				parts = append(parts, fmt.Sprintf("ADD PRIMARY KEY (%s)", bracketCols(ni.Columns)))
				previews = append(previews, "+ ADD PRIMARY KEY")
			} else if !sameIndexColumns(oi, ni) {
				parts = append(parts, fmt.Sprintf("ADD PRIMARY KEY (%s)", bracketCols(ni.Columns)))
				previews = append(previews, "~ MODIFY PRIMARY KEY (add)")
			}
			continue
		}
		oi, exists := oldIdxMap[ni.Name]
		if !exists {
			parts = append(parts, "ADD "+indexDDL(ni))
			previews = append(previews, fmt.Sprintf("+ ADD INDEX %s", ni.Name))
		} else if !sameIndexColumns(oi, ni) || oi.Unique != ni.Unique || oi.FullText != ni.FullText {
			parts = append(parts, "ADD "+indexDDL(ni))
			previews = append(previews, fmt.Sprintf("~ MODIFY INDEX %s (add)", ni.Name))
		}
	}

	// ── FK diff ──────────────────────────────────────────────────────────
	oldFKMap := make(map[string]ForeignKeyDef, len(old.ForeignKeys))
	for _, fk := range old.ForeignKeys {
		oldFKMap[fk.Name] = fk
	}
	newFKMap := make(map[string]ForeignKeyDef, len(newMeta.ForeignKeys))
	for _, fk := range newMeta.ForeignKeys {
		newFKMap[fk.Name] = fk
	}
	for _, of := range old.ForeignKeys {
		if _, exists := newFKMap[of.Name]; !exists {
			parts = append(parts, "DROP FOREIGN KEY "+quoteIdent(of.Name))
			previews = append(previews, fmt.Sprintf("- DROP FK %s", of.Name))
		}
	}
	for _, nf := range newMeta.ForeignKeys {
		if _, exists := oldFKMap[nf.Name]; !exists {
			parts = append(parts, "ADD "+fkDDL(nf))
			previews = append(previews, fmt.Sprintf("+ ADD FK %s", nf.Name))
		}
	}

	// ── CHECK 제약 diff ──────────────────────────────────────────────────
	oldCheckMap := make(map[string]CheckConstraintDef, len(old.CheckConstraints))
	for _, c := range old.CheckConstraints {
		oldCheckMap[c.Name] = c
	}
	newCheckMap := make(map[string]CheckConstraintDef, len(newMeta.CheckConstraints))
	for _, c := range newMeta.CheckConstraints {
		newCheckMap[c.Name] = c
	}
	for _, oc := range old.CheckConstraints {
		if _, exists := newCheckMap[oc.Name]; !exists {
			parts = append(parts, "DROP CHECK "+quoteIdent(oc.Name))
			previews = append(previews, fmt.Sprintf("- DROP CHECK %s", oc.Name))
		}
	}
	for _, nc := range newMeta.CheckConstraints {
		if _, exists := oldCheckMap[nc.Name]; !exists {
			parts = append(parts, fmt.Sprintf("ADD CONSTRAINT %s CHECK (%s)", quoteIdent(nc.Name), nc.Expression))
			previews = append(previews, fmt.Sprintf("+ ADD CHECK %s", nc.Name))
		}
	}

	// ── 테이블 옵션 diff ─────────────────────────────────────────────────
	if old.Engine != newMeta.Engine && newMeta.Engine != "" {
		parts = append(parts, fmt.Sprintf("ENGINE = %s", newMeta.Engine))
		previews = append(previews, fmt.Sprintf("~ ENGINE %s → %s", old.Engine, newMeta.Engine))
	}
	if old.Charset != newMeta.Charset && newMeta.Charset != "" {
		parts = append(parts, fmt.Sprintf("DEFAULT CHARSET = %s", newMeta.Charset))
		previews = append(previews, fmt.Sprintf("~ CHARSET %s → %s", old.Charset, newMeta.Charset))
	}
	if old.Collation != newMeta.Collation && newMeta.Collation != "" {
		parts = append(parts, fmt.Sprintf("COLLATE = %s", newMeta.Collation))
		previews = append(previews, fmt.Sprintf("~ COLLATE %s → %s", old.Collation, newMeta.Collation))
	}
	if old.AutoIncrement != newMeta.AutoIncrement && newMeta.AutoIncrement > 0 {
		parts = append(parts, fmt.Sprintf("AUTO_INCREMENT = %d", newMeta.AutoIncrement))
		previews = append(previews, fmt.Sprintf("~ AUTO_INCREMENT = %d", newMeta.AutoIncrement))
	}
	if old.RowFormat != newMeta.RowFormat && newMeta.RowFormat != "" {
		parts = append(parts, fmt.Sprintf("ROW_FORMAT = %s", newMeta.RowFormat))
		previews = append(previews, fmt.Sprintf("~ ROW_FORMAT %s → %s", old.RowFormat, newMeta.RowFormat))
	}
	if old.Comment != newMeta.Comment {
		parts = append(parts, fmt.Sprintf("COMMENT = '%s'", escapeSQLString(newMeta.Comment)))
		previews = append(previews, "~ COMMENT changed")
	}

	// ── RENAME 은 별도 SQL 로 발행 (ALTER 안에 포함 불가) ─────────────────
	var sqlBuilder strings.Builder
	if old.Name != newMeta.Name && newMeta.Name != "" {
		sqlBuilder.WriteString(fmt.Sprintf("ALTER TABLE %s.%s RENAME TO %s.%s;\n",
			quoteIdent(database), quoteIdent(table), quoteIdent(database), quoteIdent(newMeta.Name)))
		previews = append(previews, fmt.Sprintf("~ RENAME TABLE %s → %s", old.Name, newMeta.Name))
	}

	if len(parts) == 0 {
		if sqlBuilder.Len() == 0 {
			return &AlterStatement{SQL: "", Preview: "변경 없음"}, nil
		}
		return &AlterStatement{SQL: sqlBuilder.String(), Preview: strings.Join(previews, "\n")}, nil
	}

	targetTable := newMeta.Name
	if targetTable == "" || old.Name == newMeta.Name {
		targetTable = table
	}
	sqlBuilder.WriteString(fmt.Sprintf("ALTER TABLE %s.%s\n  %s;",
		quoteIdent(database), quoteIdent(targetTable), strings.Join(parts, ",\n  ")))
	return &AlterStatement{
		SQL:     sqlBuilder.String(),
		Preview: strings.Join(previews, "\n"),
	}, nil
}

func sameIndexColumns(a, b IndexDef) bool {
	if len(a.Columns) != len(b.Columns) {
		return false
	}
	for i := range a.Columns {
		if a.Columns[i] != b.Columns[i] {
			return false
		}
		aDir := "ASC"
		if i < len(a.ColumnDirections) && a.ColumnDirections[i] != "" {
			aDir = a.ColumnDirections[i]
		}
		bDir := "ASC"
		if i < len(b.ColumnDirections) && b.ColumnDirections[i] != "" {
			bDir = b.ColumnDirections[i]
		}
		if aDir != bDir {
			return false
		}
	}
	return true
}

func bracketCols(cols []string) string {
	out := make([]string, len(cols))
	for i, c := range cols {
		out[i] = quoteIdent(c)
	}
	return strings.Join(out, ", ")
}

// ExecuteAlterTable ALTER TABLE SQL을 실행한다.
func (d *Designer) ExecuteAlterTable(ctx context.Context, connID, sql string) error {
	db, err := d.connManager.GetDB(connID)
	if err != nil {
		return err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	if _, err := db.ExecContext(qctx, sql); err != nil {
		return fmt.Errorf("alter table: %w", err)
	}
	return nil
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

// extractLength "varchar(255)" → "255", "decimal(10,2)" → "10,2"
func extractLength(colType string) string {
	start := strings.Index(colType, "(")
	end := strings.LastIndex(colType, ")")
	if start < 0 || end <= start {
		return ""
	}
	return colType[start+1 : end]
}

func columnDDL(c ColumnDef) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("%s %s", quoteIdent(c.Name), c.DataType))
	if c.Length != "" {
		b.WriteString(fmt.Sprintf("(%s)", c.Length))
	}
	if c.Unsigned {
		b.WriteString(" UNSIGNED")
	}
	if c.ZeroFill {
		b.WriteString(" ZEROFILL")
	}
	if c.NotNull {
		b.WriteString(" NOT NULL")
	} else {
		b.WriteString(" NULL")
	}
	// NOT NULL + DEFAULT NULL 은 무효 DDL → DEFAULT 절 생략
	effectiveDefault := c.Default
	if c.NotNull && strings.ToUpper(strings.TrimSpace(effectiveDefault)) == "NULL" {
		effectiveDefault = ""
	}
	if effectiveDefault != "" {
		if isDefaultLiteral(effectiveDefault) {
			b.WriteString(fmt.Sprintf(" DEFAULT %s", effectiveDefault))
		} else {
			b.WriteString(fmt.Sprintf(" DEFAULT '%s'", escapeSQLString(effectiveDefault)))
		}
	}
	if c.AutoInc {
		b.WriteString(" AUTO_INCREMENT")
	}
	if c.OnUpdate != "" {
		b.WriteString(fmt.Sprintf(" ON UPDATE %s", c.OnUpdate))
	}
	if c.Comment != "" {
		b.WriteString(fmt.Sprintf(" COMMENT '%s'", escapeSQLString(c.Comment)))
	}
	return b.String()
}

// isDefaultLiteral NULL / CURRENT_TIMESTAMP / (expr) 등 quote 하지 않아야 하는 DEFAULT 값.
func isDefaultLiteral(s string) bool {
	u := strings.ToUpper(strings.TrimSpace(s))
	if u == "NULL" || u == "CURRENT_TIMESTAMP" || u == "CURRENT_TIMESTAMP()" {
		return true
	}
	if strings.HasPrefix(u, "CURRENT_TIMESTAMP(") && strings.HasSuffix(u, ")") {
		return true
	}
	if strings.HasPrefix(s, "(") && strings.HasSuffix(s, ")") {
		return true
	}
	return false
}

func indexDDL(idx IndexDef) string {
	cols := make([]string, len(idx.Columns))
	for i, c := range idx.Columns {
		dir := ""
		if i < len(idx.ColumnDirections) && idx.ColumnDirections[i] == "DESC" {
			dir = " DESC"
		}
		cols[i] = quoteIdent(c) + dir
	}
	colList := strings.Join(cols, ", ")

	switch {
	case idx.FullText:
		return fmt.Sprintf("FULLTEXT INDEX %s (%s)", quoteIdent(idx.Name), colList)
	case idx.Unique:
		return fmt.Sprintf("UNIQUE INDEX %s (%s)", quoteIdent(idx.Name), colList)
	default:
		return fmt.Sprintf("INDEX %s (%s)", quoteIdent(idx.Name), colList)
	}
}

func fkDDL(fk ForeignKeyDef) string {
	return fmt.Sprintf(
		"CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s) ON DELETE %s ON UPDATE %s",
		quoteIdent(fk.Name), quoteIdent(fk.Column), quoteIdent(fk.RefTable), quoteIdent(fk.RefColumn), fk.OnDelete, fk.OnUpdate,
	)
}

func columnChanged(old, new ColumnDef) bool {
	return old.DataType != new.DataType ||
		old.Length != new.Length ||
		old.NotNull != new.NotNull ||
		old.Default != new.Default ||
		old.AutoInc != new.AutoInc ||
		old.Unsigned != new.Unsigned ||
		old.ZeroFill != new.ZeroFill ||
		old.Comment != new.Comment ||
		old.OnUpdate != new.OnUpdate
}

func escapeSQLString(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

// escapeIdent MySQL identifier 안의 backtick 을 두 번 반복으로 escape 한다.
// 식별자에 backtick 이 들어가는 경우는 드물지만 가능 (`` ` `` 자체 문자) — escape 부재 시 DDL 이 깨진다.
func escapeIdent(s string) string {
	return strings.ReplaceAll(s, "`", "``")
}

// quoteIdent 식별자를 backtick 으로 감싸고 내부 backtick 을 escape 한다.
// `quoteIdent("weird`name") == "`weird``name`"`.
func quoteIdent(s string) string {
	return "`" + escapeIdent(s) + "`"
}
