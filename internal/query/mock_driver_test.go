package query

// mock_driver_test.go — 테스트 전용 최소 database/sql 드라이버 구현.
//
// 두 종류의 드라이버를 제공한다:
//  1. slowDriver — QueryContext가 지정 시간 동안 block하거나 ctx 취소 시 즉시 반환
//  2. recordDriver — ExecContext 호출 인자를 기록해 Import 로직 검증에 사용

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"sync"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// slowDriver: QueryContext가 delay 동안 sleep하고, ctx 취소 시 ctx.Err() 반환
// ─────────────────────────────────────────────────────────────────────────────

const slowDriverName = "orcasql-slow-test"

var slowDriverOnce sync.Once

func registerSlowDriver() {
	slowDriverOnce.Do(func() {
		sql.Register(slowDriverName, &slowDriverImpl{})
	})
}

// openSlowDB delay 동안 블로킹하는 테스트용 *sql.DB를 반환한다.
func openSlowDB(delay time.Duration) (*sql.DB, error) {
	registerSlowDriver()
	// DSN에 delay를 전달하는 대신 connString을 활용한다.
	dsn := fmt.Sprintf("%d", delay.Nanoseconds())
	db, err := sql.Open(slowDriverName, dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

type slowDriverImpl struct{}

func (d *slowDriverImpl) Open(name string) (driver.Conn, error) {
	var ns int64
	fmt.Sscanf(name, "%d", &ns)
	return &slowConn{delay: time.Duration(ns)}, nil
}

type slowConn struct {
	delay time.Duration
}

func (c *slowConn) Prepare(query string) (driver.Stmt, error) {
	return &slowStmt{delay: c.delay}, nil
}

func (c *slowConn) Close() error { return nil }

func (c *slowConn) Begin() (driver.Tx, error) { return nil, driver.ErrBadConn }

// QueryContext: driver.QueryerContext 구현으로 context 취소를 즉시 반영한다.
func (c *slowConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	select {
	case <-time.After(c.delay):
		return &slowRows{}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

type slowStmt struct {
	delay time.Duration
}

func (s *slowStmt) Close() error                                    { return nil }
func (s *slowStmt) NumInput() int                                   { return -1 }
func (s *slowStmt) Exec(_ []driver.Value) (driver.Result, error)    { return nil, driver.ErrBadConn }
func (s *slowStmt) Query(_ []driver.Value) (driver.Rows, error) {
	time.Sleep(s.delay)
	return &slowRows{}, nil
}

type slowRows struct{ done bool }

func (r *slowRows) Columns() []string        { return []string{"x"} }
func (r *slowRows) Close() error             { return nil }
func (r *slowRows) Next(_ []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// recordDriver: ExecContext 호출을 기록하는 드라이버 (ImportCSV 검증용)
// ─────────────────────────────────────────────────────────────────────────────

const recordDriverName = "orcasql-record-test"

var recordDriverOnce sync.Once

// ExecRecord 기록된 단일 ExecContext 호출 내역.
type ExecRecord struct {
	Query string
	Args  []driver.NamedValue
}

type recordDriverImpl struct {
	mu      sync.Mutex
	records []ExecRecord
}

var globalRecordDriver = &recordDriverImpl{}

func registerRecordDriver() {
	recordDriverOnce.Do(func() {
		sql.Register(recordDriverName, globalRecordDriver)
	})
}

// openRecordDB 호출 내역을 기록하는 테스트용 *sql.DB를 반환한다.
// 반환된 *recordDriverImpl로 기록된 SQL/인자를 검사할 수 있다.
func openRecordDB() (*sql.DB, *recordDriverImpl, error) {
	registerRecordDriver()
	globalRecordDriver.mu.Lock()
	globalRecordDriver.records = nil
	globalRecordDriver.mu.Unlock()

	db, err := sql.Open(recordDriverName, "")
	if err != nil {
		return nil, nil, err
	}
	db.SetMaxOpenConns(1)
	return db, globalRecordDriver, nil
}

// Records 지금까지 기록된 ExecContext 호출 목록을 복사해 반환한다.
func (d *recordDriverImpl) Records() []ExecRecord {
	d.mu.Lock()
	defer d.mu.Unlock()
	cp := make([]ExecRecord, len(d.records))
	copy(cp, d.records)
	return cp
}

func (d *recordDriverImpl) Open(_ string) (driver.Conn, error) {
	return &recordConn{driver: d}, nil
}

type recordConn struct {
	driver *recordDriverImpl
}

func (c *recordConn) Prepare(query string) (driver.Stmt, error) {
	return &recordStmt{conn: c, query: query}, nil
}
func (c *recordConn) Close() error              { return nil }
func (c *recordConn) Begin() (driver.Tx, error) { return &recordTx{}, nil }

// ExecContext: driver.ExecerContext 구현
// RowsAffected는 쿼리에서 VALUE 그룹 수를 세어 반환한다.
// 실제 INSERT 검증용이므로 단순히 배치 행 수를 추정한다.
func (c *recordConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.driver.mu.Lock()
	argsCopy := make([]driver.NamedValue, len(args))
	copy(argsCopy, args)
	c.driver.records = append(c.driver.records, ExecRecord{Query: query, Args: argsCopy})
	c.driver.mu.Unlock()
	// 행 수 = args 수 / 플레이스홀더(?) 수 — 단순 추정값 (테스트에서 Inserted 검사 안함)
	return &recordResult{rows: 1}, nil
}

type recordStmt struct {
	conn  *recordConn
	query string
}

func (s *recordStmt) Close() error { return nil }
func (s *recordStmt) NumInput() int { return -1 }
func (s *recordStmt) Exec(args []driver.Value) (driver.Result, error) {
	named := make([]driver.NamedValue, len(args))
	for i, v := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: v}
	}
	return s.conn.ExecContext(context.Background(), s.query, named)
}
func (s *recordStmt) Query(_ []driver.Value) (driver.Rows, error) {
	return &slowRows{}, nil
}

type recordResult struct{ rows int64 }

func (r *recordResult) LastInsertId() (int64, error) { return 0, nil }
func (r *recordResult) RowsAffected() (int64, error)  { return r.rows, nil }

type recordTx struct{}

func (t *recordTx) Commit() error   { return nil }
func (t *recordTx) Rollback() error { return nil }
