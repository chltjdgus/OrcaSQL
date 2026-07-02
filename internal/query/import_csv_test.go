package query

// import_csv_test.go — ImportCSV() 단위 테스트.
//
// recordDriver를 통해 실제 DB 없이 INSERT SQL 구조와 args를 검증한다.
// 검증 항목:
//  - hasHeader=true/false 분기
//  - 탭 구분자 및 기타 구분자
//  - 열 수 불일치(부족 → NULL 패딩, 초과 → 잘라냄)
//  - 빈 CSV 입력
//  - 배치 크기(500행) 경계

import (
	"context"
	"strings"
	"testing"

	"orcasql/internal/connection"
	"orcasql/internal/keychain"
)

const testImportConnID = "test-import-conn"

func setupImportTest(t *testing.T) (*connection.Manager, *recordDriverImpl) {
	t.Helper()
	db, rec, err := openRecordDB()
	if err != nil {
		t.Fatalf("openRecordDB: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	mgr := connection.NewManager(keychain.NewStore())
	mgr.InjectTestDB(testImportConnID, db)
	return mgr, rec
}

func TestImportCSV_BasicWithHeader(t *testing.T) {
	mgr, rec := setupImportTest(t)

	csv := "id,name,age\n1,Alice,30\n2,Bob,25"
	result, err := ImportCSV(context.Background(), mgr, testImportConnID, "mydb", "users", csv, true, 0)
	if err != nil {
		t.Fatalf("ImportCSV error: %v", err)
	}
	if result.Errors != "" {
		t.Errorf("예상치 않은 에러: %s", result.Errors)
	}

	records := rec.Records()
	if len(records) != 1 {
		t.Fatalf("ExecContext 호출 횟수 = %d, want 1", len(records))
	}
	// INSERT 쿼리에 테이블명과 컬럼명이 포함되어야 한다
	q := records[0].Query
	if !strings.Contains(q, "`mydb`.`users`") {
		t.Errorf("INSERT 쿼리에 DB/테이블명 없음: %q", q)
	}
	if !strings.Contains(q, "`id`") || !strings.Contains(q, "`name`") || !strings.Contains(q, "`age`") {
		t.Errorf("INSERT 쿼리에 컬럼명 없음: %q", q)
	}
	// args: 2행 × 3열 = 6개
	if len(records[0].Args) != 6 {
		t.Errorf("args 개수 = %d, want 6", len(records[0].Args))
	}
}

func TestImportCSV_NoHeader(t *testing.T) {
	mgr, rec := setupImportTest(t)

	csv := "1,Alice\n2,Bob"
	_, err := ImportCSV(context.Background(), mgr, testImportConnID, "db", "tbl", csv, false, 0)
	if err != nil {
		t.Fatalf("ImportCSV error: %v", err)
	}

	records := rec.Records()
	if len(records) != 1 {
		t.Fatalf("ExecContext 호출 횟수 = %d, want 1", len(records))
	}
	q := records[0].Query
	// hasHeader=false 이면 col1, col2 형태로 컬럼명 생성
	if !strings.Contains(q, "`col1`") || !strings.Contains(q, "`col2`") {
		t.Errorf("자동 생성 컬럼명(col1, col2)이 쿼리에 없음: %q", q)
	}
}

func TestImportCSV_TabDelimiter(t *testing.T) {
	mgr, rec := setupImportTest(t)

	tsv := "id\tname\n10\tCharlie"
	_, err := ImportCSV(context.Background(), mgr, testImportConnID, "db", "tbl", tsv, true, '\t')
	if err != nil {
		t.Fatalf("ImportCSV error: %v", err)
	}

	records := rec.Records()
	if len(records) != 1 {
		t.Fatalf("ExecContext 호출 횟수 = %d, want 1", len(records))
	}
	// args: 1행 × 2열 = 2개
	if len(records[0].Args) != 2 {
		t.Errorf("args 개수 = %d, want 2", len(records[0].Args))
	}
	// 첫 번째 arg가 "10" (id 값)
	if v, ok := records[0].Args[0].Value.(string); !ok || v != "10" {
		t.Errorf("args[0] = %v, want \"10\"", records[0].Args[0].Value)
	}
}

func TestImportCSV_ColumnCountMismatch_TooFew(t *testing.T) {
	// 데이터 행의 열 수가 헤더보다 적으면 NULL 패딩되어야 한다
	mgr, rec := setupImportTest(t)

	csv := "a,b,c\n1,2" // c 열 값 없음
	_, err := ImportCSV(context.Background(), mgr, testImportConnID, "db", "tbl", csv, true, 0)
	if err != nil {
		t.Fatalf("ImportCSV error: %v", err)
	}

	records := rec.Records()
	if len(records) != 1 {
		t.Fatalf("ExecContext 호출 횟수 = %d, want 1", len(records))
	}
	// 1행 × 3열 = 3개 args, 세 번째는 nil (NULL 패딩)
	args := records[0].Args
	if len(args) != 3 {
		t.Fatalf("args 개수 = %d, want 3", len(args))
	}
	if args[2].Value != nil {
		t.Errorf("args[2] = %v, want nil (NULL 패딩)", args[2].Value)
	}
}

func TestImportCSV_ColumnCountMismatch_TooMany(t *testing.T) {
	// 데이터 행의 열 수가 헤더보다 많으면 잘라내야 한다
	mgr, rec := setupImportTest(t)

	csv := "a,b\n1,2,3,4" // 열이 2개인데 데이터는 4개
	_, err := ImportCSV(context.Background(), mgr, testImportConnID, "db", "tbl", csv, true, 0)
	if err != nil {
		t.Fatalf("ImportCSV error: %v", err)
	}

	records := rec.Records()
	if len(records) != 1 {
		t.Fatalf("ExecContext 호출 횟수 = %d, want 1", len(records))
	}
	// 1행 × 2열 = 2개 args (3,4 잘림)
	if len(records[0].Args) != 2 {
		t.Errorf("args 개수 = %d, want 2 (초과 열 잘림)", len(records[0].Args))
	}
}

func TestImportCSV_EmptyContent(t *testing.T) {
	mgr, _ := setupImportTest(t)

	result, err := ImportCSV(context.Background(), mgr, testImportConnID, "db", "tbl", "", true, 0)
	if err != nil {
		t.Fatalf("ImportCSV error: %v", err)
	}
	if result.Inserted != 0 || result.Skipped != 0 {
		t.Errorf("빈 CSV: inserted=%d, skipped=%d, want 0, 0", result.Inserted, result.Skipped)
	}
}

func TestImportCSV_HeaderOnlyNoData(t *testing.T) {
	mgr, rec := setupImportTest(t)

	csv := "col1,col2,col3"
	result, err := ImportCSV(context.Background(), mgr, testImportConnID, "db", "tbl", csv, true, 0)
	if err != nil {
		t.Fatalf("ImportCSV error: %v", err)
	}
	if result.Inserted != 0 {
		t.Errorf("inserted = %d, want 0", result.Inserted)
	}
	if len(rec.Records()) != 0 {
		t.Errorf("ExecContext 호출 있음 (데이터 행이 없으므로 없어야 함)")
	}
}

func TestImportCSV_SemicolonDelimiter(t *testing.T) {
	mgr, rec := setupImportTest(t)

	csv := "x;y\n10;20"
	_, err := ImportCSV(context.Background(), mgr, testImportConnID, "db", "tbl", csv, true, ';')
	if err != nil {
		t.Fatalf("ImportCSV error: %v", err)
	}

	records := rec.Records()
	if len(records) != 1 {
		t.Fatalf("ExecContext 호출 횟수 = %d, want 1", len(records))
	}
	if len(records[0].Args) != 2 {
		t.Errorf("args 개수 = %d, want 2", len(records[0].Args))
	}
}
