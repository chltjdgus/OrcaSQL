package mcp

// mock_driver_test.go — MCP E2E 테스트용 최소 database/sql 드라이버.
// "SELECT 1+1" 같은 단순 쿼리에 대해 단일 컬럼 단일 행 결과를 반환하면 충분.

import (
	"database/sql"
	"database/sql/driver"
	"io"
	"sync"
)

const fakeDriverName = "orcasql-mcp-fake"

var fakeDriverOnce sync.Once

func registerFakeDriver() {
	fakeDriverOnce.Do(func() {
		sql.Register(fakeDriverName, fakeDriverImpl{})
	})
}

// openFakeDB MCP 테스트에서 InjectTestDB 로 끼워넣을 *sql.DB 를 반환한다.
func openFakeDB() (*sql.DB, error) {
	registerFakeDriver()
	db, err := sql.Open(fakeDriverName, "")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

type fakeDriverImpl struct{}

func (fakeDriverImpl) Open(_ string) (driver.Conn, error) { return &fakeConn{}, nil }

type fakeConn struct{}

func (c *fakeConn) Prepare(_ string) (driver.Stmt, error) { return &fakeStmt{}, nil }
func (c *fakeConn) Close() error                          { return nil }
func (c *fakeConn) Begin() (driver.Tx, error)             { return nil, driver.ErrBadConn }

// QueryContext: 항상 단일 컬럼 "result" + 단일 행 [int64(2)] 반환.
// 실제 SQL 은 무시 — MCP 의 입출력 흐름만 검증.
func (c *fakeConn) Query(_ string, _ []driver.Value) (driver.Rows, error) {
	return &fakeRows{}, nil
}

type fakeStmt struct{}

func (s *fakeStmt) Close() error                                 { return nil }
func (s *fakeStmt) NumInput() int                                { return -1 }
func (s *fakeStmt) Exec(_ []driver.Value) (driver.Result, error) { return fakeResult{}, nil }
func (s *fakeStmt) Query(_ []driver.Value) (driver.Rows, error)  { return &fakeRows{}, nil }

type fakeResult struct{}

func (fakeResult) LastInsertId() (int64, error) { return 0, nil }
func (fakeResult) RowsAffected() (int64, error) { return 0, nil }

type fakeRows struct{ done bool }

func (r *fakeRows) Columns() []string { return []string{"result"} }
func (r *fakeRows) Close() error      { return nil }
func (r *fakeRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	if len(dest) > 0 {
		dest[0] = int64(2)
	}
	return nil
}
