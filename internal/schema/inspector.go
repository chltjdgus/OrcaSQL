// Package schema는 MySQL 스키마 메타데이터 조회를 담당한다.
package schema

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"orcasql/internal/connection"
)

const schemaTimeout = 30 * time.Second

// TableInfo 테이블/뷰 기본 정보.
type TableInfo struct {
	Name      string `json:"name"`
	Type      string `json:"type"`      // "BASE TABLE" | "VIEW"
	Engine    string `json:"engine"`
	Rows      int64  `json:"rows"`
	SizeBytes int64  `json:"sizeBytes"` // data_length + index_length
	Comment   string `json:"comment"`
}

// ColumnInfo 컬럼 상세 정보.
type ColumnInfo struct {
	Name       string `json:"name"`
	OrdinalPos int    `json:"ordinalPos"`
	Default    string `json:"default"`
	Nullable   bool   `json:"nullable"`
	DataType   string `json:"dataType"`
	ColumnType string `json:"columnType"` // 예: varchar(255)
	Key        string `json:"key"`        // PRI, UNI, MUL
	Extra      string `json:"extra"`      // auto_increment 등
	Comment    string `json:"comment"`
}

// IndexInfo 인덱스 정보.
type IndexInfo struct {
	Name       string `json:"name"`
	Columns    string `json:"columns"`
	Unique     bool   `json:"unique"`
	IndexType  string `json:"indexType"` // BTREE, HASH, FULLTEXT
}

// Inspector MySQL 스키마 조회기.
type Inspector struct {
	connManager *connection.Manager
}

// NewInspector Inspector 인스턴스를 생성한다.
func NewInspector(cm *connection.Manager) *Inspector {
	return &Inspector{connManager: cm}
}

// ListDatabases 접근 가능한 데이터베이스 목록을 반환한다.
func (ins *Inspector) ListDatabases(ctx context.Context, connID string) ([]string, error) {
	db, err := ins.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	rows, err := db.QueryContext(qctx, "SHOW DATABASES")
	if err != nil {
		return nil, fmt.Errorf("list databases: %w", err)
	}
	defer rows.Close()

	var dbs []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("scan database: %w", err)
		}
		dbs = append(dbs, name)
	}
	return dbs, rows.Err()
}

// ListTables 특정 데이터베이스의 테이블/뷰 목록을 반환한다.
func (ins *Inspector) ListTables(ctx context.Context, connID, database string) ([]TableInfo, error) {
	db, err := ins.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	query := `
		SELECT
			TABLE_NAME,
			TABLE_TYPE,
			IFNULL(ENGINE, '') AS ENGINE,
			IFNULL(TABLE_ROWS, 0) AS TABLE_ROWS,
			IFNULL(DATA_LENGTH, 0) + IFNULL(INDEX_LENGTH, 0) AS SIZE_BYTES,
			IFNULL(TABLE_COMMENT, '') AS TABLE_COMMENT
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ?
		ORDER BY TABLE_TYPE, TABLE_NAME`

	rows, err := db.QueryContext(qctx, query, database)
	if err != nil {
		return nil, fmt.Errorf("list tables: %w", err)
	}
	defer rows.Close()

	var tables []TableInfo
	for rows.Next() {
		var t TableInfo
		if err := rows.Scan(&t.Name, &t.Type, &t.Engine, &t.Rows, &t.SizeBytes, &t.Comment); err != nil {
			return nil, fmt.Errorf("scan table: %w", err)
		}
		tables = append(tables, t)
	}
	return tables, rows.Err()
}

// ListColumns 테이블의 컬럼 목록을 반환한다.
func (ins *Inspector) ListColumns(ctx context.Context, connID, database, table string) ([]ColumnInfo, error) {
	db, err := ins.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	query := `
		SELECT
			COLUMN_NAME,
			ORDINAL_POSITION,
			IFNULL(COLUMN_DEFAULT, '') AS COLUMN_DEFAULT,
			IF(IS_NULLABLE = 'YES', 1, 0) AS NULLABLE,
			DATA_TYPE,
			COLUMN_TYPE,
			IFNULL(COLUMN_KEY, '') AS COLUMN_KEY,
			IFNULL(EXTRA, '') AS EXTRA,
			IFNULL(COLUMN_COMMENT, '') AS COLUMN_COMMENT
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		ORDER BY ORDINAL_POSITION`

	rows, err := db.QueryContext(qctx, query, database, table)
	if err != nil {
		return nil, fmt.Errorf("list columns: %w", err)
	}
	defer rows.Close()

	var cols []ColumnInfo
	for rows.Next() {
		var c ColumnInfo
		var nullable int
		if err := rows.Scan(
			&c.Name, &c.OrdinalPos, &c.Default,
			&nullable, &c.DataType, &c.ColumnType,
			&c.Key, &c.Extra, &c.Comment,
		); err != nil {
			return nil, fmt.Errorf("scan column: %w", err)
		}
		c.Nullable = nullable == 1
		cols = append(cols, c)
	}
	return cols, rows.Err()
}

// ListIndexes 테이블의 인덱스 목록을 반환한다.
func (ins *Inspector) ListIndexes(ctx context.Context, connID, database, table string) ([]IndexInfo, error) {
	db, err := ins.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	query := `
		SELECT
			INDEX_NAME,
			GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS COLUMNS,
			IF(NON_UNIQUE = 0, 1, 0) AS IS_UNIQUE,
			INDEX_TYPE
		FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		GROUP BY INDEX_NAME, NON_UNIQUE, INDEX_TYPE
		ORDER BY INDEX_NAME`

	rows, err := db.QueryContext(qctx, query, database, table)
	if err != nil {
		return nil, fmt.Errorf("list indexes: %w", err)
	}
	defer rows.Close()

	var indexes []IndexInfo
	for rows.Next() {
		var idx IndexInfo
		var isUnique int
		if err := rows.Scan(&idx.Name, &idx.Columns, &isUnique, &idx.IndexType); err != nil {
			return nil, fmt.Errorf("scan index: %w", err)
		}
		idx.Unique = isUnique == 1
		indexes = append(indexes, idx)
	}
	return indexes, rows.Err()
}

// ObjectInfo SP/Function/Trigger/Event 기본 정보.
type ObjectInfo struct {
	Name      string `json:"name"`
	ObjType   string `json:"objType"`
	Definer   string `json:"definer"`
	Created   string `json:"created"`
	Modified  string `json:"modified"`
	Comment   string `json:"comment"`
}

// ListObjects SP/Function/Event 목록을 반환한다.
// objType: "PROCEDURE" | "FUNCTION" | "EVENT"
func (ins *Inspector) ListObjects(ctx context.Context, connID, database, objType string) ([]ObjectInfo, error) {
	db, err := ins.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	query := `
		SELECT ROUTINE_NAME, ROUTINE_TYPE,
			IFNULL(DEFINER, '') AS DEFINER,
			IFNULL(CREATED, '') AS CREATED,
			IFNULL(LAST_ALTERED, '') AS LAST_ALTERED,
			IFNULL(ROUTINE_COMMENT, '') AS COMMENT
		FROM information_schema.ROUTINES
		WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = ?
		ORDER BY ROUTINE_NAME`

	if objType == "EVENT" {
		query = `
			SELECT EVENT_NAME, 'EVENT',
				IFNULL(DEFINER, '') AS DEFINER,
				IFNULL(CREATED, '') AS CREATED,
				IFNULL(LAST_ALTERED, '') AS LAST_ALTERED,
				IFNULL(EVENT_COMMENT, '') AS COMMENT
			FROM information_schema.EVENTS
			WHERE EVENT_SCHEMA = ?
			ORDER BY EVENT_NAME`
	}

	var rows *sql.Rows
	var rowErr error
	if objType == "EVENT" {
		rows, rowErr = db.QueryContext(qctx, query, database)
	} else {
		rows, rowErr = db.QueryContext(qctx, query, database, objType)
	}
	if rowErr != nil {
		return nil, fmt.Errorf("list objects [%s]: %w", objType, rowErr)
	}
	defer rows.Close()

	var result []ObjectInfo
	for rows.Next() {
		var o ObjectInfo
		if err := rows.Scan(&o.Name, &o.ObjType, &o.Definer, &o.Created, &o.Modified, &o.Comment); err != nil {
			return nil, fmt.Errorf("scan object: %w", err)
		}
		result = append(result, o)
	}
	return result, rows.Err()
}

// ListTriggers 트리거 목록을 반환한다.
func (ins *Inspector) ListTriggers(ctx context.Context, connID, database, table string) ([]ObjectInfo, error) {
	db, err := ins.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	query := `
		SELECT TRIGGER_NAME, 'TRIGGER',
			IFNULL(DEFINER, '') AS DEFINER,
			IFNULL(CREATED, '') AS CREATED,
			IFNULL(CREATED, '') AS LAST_ALTERED,
			'' AS COMMENT
		FROM information_schema.TRIGGERS
		WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?
		ORDER BY TRIGGER_NAME`

	rows, err := db.QueryContext(qctx, query, database, table)
	if err != nil {
		return nil, fmt.Errorf("list triggers: %w", err)
	}
	defer rows.Close()

	var result []ObjectInfo
	for rows.Next() {
		var o ObjectInfo
		if err := rows.Scan(&o.Name, &o.ObjType, &o.Definer, &o.Created, &o.Modified, &o.Comment); err != nil {
			return nil, fmt.Errorf("scan trigger: %w", err)
		}
		result = append(result, o)
	}
	return result, rows.Err()
}

// GetObjectDDL SP/Function/Trigger/Event 의 CREATE DDL을 반환한다.
func (ins *Inspector) GetObjectDDL(ctx context.Context, connID, database, objType, name string) (string, error) {
	db, err := ins.connManager.GetDB(connID)
	if err != nil {
		return "", err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	var query string
	switch objType {
	case "PROCEDURE":
		query = fmt.Sprintf("SHOW CREATE PROCEDURE %s.%s", quoteIdent(database), quoteIdent(name))
	case "FUNCTION":
		query = fmt.Sprintf("SHOW CREATE FUNCTION %s.%s", quoteIdent(database), quoteIdent(name))
	case "TRIGGER":
		query = fmt.Sprintf("SHOW CREATE TRIGGER %s.%s", quoteIdent(database), quoteIdent(name))
	case "EVENT":
		query = fmt.Sprintf("SHOW CREATE EVENT %s.%s", quoteIdent(database), quoteIdent(name))
	default:
		return "", fmt.Errorf("unknown object type: %s", objType)
	}

	rows, err := db.QueryContext(qctx, query)
	if err != nil {
		return "", fmt.Errorf("show create %s: %w", objType, err)
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	if rows.Next() {
		dest := make([]any, len(cols))
		for i := range dest {
			dest[i] = new(sql.NullString)
		}
		if err := rows.Scan(dest...); err != nil {
			return "", fmt.Errorf("scan ddl: %w", err)
		}
		// DDL은 두 번째 또는 세 번째 컬럼에 위치 (MySQL 버전마다 다름)
		for i := 1; i < len(dest); i++ {
			if ns, ok := dest[i].(*sql.NullString); ok && ns.Valid && len(ns.String) > 10 {
				return ns.String, nil
			}
		}
	}
	return "", fmt.Errorf("no DDL found for %s %s", objType, name)
}

// GetTableDDL CREATE TABLE DDL 문을 반환한다.
// ListTableNames 테이블 이름 목록만 반환한다 (덤프 옵션용).
func (ins *Inspector) ListTableNames(ctx context.Context, connID, database string) ([]string, error) {
	db, err := ins.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	rows, err := db.QueryContext(qctx,
		"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
		database)
	if err != nil {
		return nil, fmt.Errorf("list table names: %w", err)
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

func (ins *Inspector) GetTableDDL(ctx context.Context, connID, database, table string) (string, error) {
	db, err := ins.connManager.GetDB(connID)
	if err != nil {
		return "", err
	}
	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	var tableName, ddl string
	row := db.QueryRowContext(qctx, fmt.Sprintf("SHOW CREATE TABLE %s.%s", quoteIdent(database), quoteIdent(table)))
	if err := row.Scan(&tableName, &ddl); err != nil {
		return "", fmt.Errorf("show create table: %w", err)
	}
	return ddl, nil
}


// GetPKColumns 테이블의 PRIMARY KEY 컬럼 목록을 반환한다.
// 인라인 편집의 WHERE 조건 구성에 사용한다.
func (ins *Inspector) GetPKColumns(ctx context.Context, connID, database, table string) ([]string, error) {
	db, err := ins.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}

	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	query := fmt.Sprintf("SHOW KEYS FROM %s.%s WHERE Key_name = 'PRIMARY'", quoteIdent(database), quoteIdent(table))
	rows, err := db.QueryContext(qctx, query)
	if err != nil {
		return nil, fmt.Errorf("show keys: %w", err)
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	var pkCols []string
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			continue
		}
		for i, col := range cols {
			if !strings.EqualFold(col, "Column_name") {
				continue
			}
			switch v := vals[i].(type) {
			case []byte:
				pkCols = append(pkCols, string(v))
			case string:
				pkCols = append(pkCols, v)
			}
		}
	}
	return pkCols, rows.Err()
}

// FKInfo information_schema에서 조회한 실제 외래키 정보.
type FKInfo struct {
	// 자식 테이블 (FK를 가진 쪽)
	TableName  string `json:"tableName"`
	ColumnName string `json:"columnName"`
	// 부모 테이블 (참조 대상)
	RefTableName  string `json:"refTableName"`
	RefColumnName string `json:"refColumnName"`
	// 제약 조건 이름
	ConstraintName string `json:"constraintName"`
}

// GetForeignKeys 지정 데이터베이스의 모든 FK를 information_schema에서 조회한다.
// ER 다이어그램의 FK 엣지 생성에 사용한다.
func (ins *Inspector) GetForeignKeys(ctx context.Context, connID, database string) ([]FKInfo, error) {
	db, err := ins.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}

	qctx, cancel := context.WithTimeout(ctx, schemaTimeout)
	defer cancel()

	query := `
		SELECT
			kcu.CONSTRAINT_NAME,
			kcu.TABLE_NAME,
			kcu.COLUMN_NAME,
			kcu.REFERENCED_TABLE_NAME,
			kcu.REFERENCED_COLUMN_NAME
		FROM information_schema.KEY_COLUMN_USAGE kcu
		INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
			ON  rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
			AND rc.CONSTRAINT_NAME   = kcu.CONSTRAINT_NAME
		WHERE kcu.CONSTRAINT_SCHEMA = ?
		  AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
		ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`

	rows, err := db.QueryContext(qctx, query, database)
	if err != nil {
		return nil, fmt.Errorf("query foreign keys: %w", err)
	}
	defer rows.Close()

	var fks []FKInfo
	for rows.Next() {
		var fk FKInfo
		if err := rows.Scan(
			&fk.ConstraintName,
			&fk.TableName,
			&fk.ColumnName,
			&fk.RefTableName,
			&fk.RefColumnName,
		); err != nil {
			return nil, err
		}
		fks = append(fks, fk)
	}
	return fks, rows.Err()
}
