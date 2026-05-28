// Package query는 SQL 쿼리 실행 및 결과 처리를 담당한다.
package query

import "time"

// ColumnMeta 결과 컬럼 메타데이터.
type ColumnMeta struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
}

// TableEditContext 인라인 편집을 위한 테이블 컨텍스트.
// 단일 테이블 SELECT 쿼리에서 자동으로 채워진다.
type TableEditContext struct {
	Database  string   `json:"database"`
	Table     string   `json:"table"`
	PKColumns []string `json:"pkColumns"` // PK 컬럼 이름 목록 (WHERE 절 빌드에 사용)
}

// RowPKValue PK 컬럼과 그 값의 쌍 (UpdateRowValue 파라미터용).
type RowPKValue struct {
	Column string `json:"column"`
	Value  string `json:"value"` // 모든 타입을 문자열로 직렬화
}

// QueryResult SQL 실행 결과.
type QueryResult struct {
	Columns   []ColumnMeta      `json:"columns"`
	Rows      [][]any           `json:"rows"`
	Affected  int64             `json:"affected"`           // INSERT/UPDATE/DELETE affected rows
	LastID    int64             `json:"lastId"`             // INSERT last insert ID
	Duration  time.Duration     `json:"duration"`           // 실행 시간 (nanoseconds)
	SQL       string            `json:"sql"`
	EditCtx   *TableEditContext `json:"editCtx,omitempty"`  // 인라인 편집 컨텍스트 (단일 테이블 SELECT)
	Truncated bool              `json:"truncated,omitempty"` // true = 결과 행 상한선 초과로 잘림
}

// ResultChunk 대용량 결과 스트리밍 청크.
type ResultChunk struct {
	Columns   []ColumnMeta `json:"columns,omitempty"` // 첫 번째 청크에만 포함
	Rows      [][]any      `json:"rows"`
	ChunkIndex int         `json:"chunkIndex"`
	IsLast    bool         `json:"isLast"`
	Total     int64        `json:"total"` // 최종 청크에서만 유효
}

// MultiExecResult ExecuteMultiQuery 결과.
// 중간 실패 시에도 부분 결과를 함께 반환하며, 에러 정보를 구조체에 내장한다.
// Wails 바인딩이 항상 성공(rejection 없음)하도록 설계되어 있다.
type MultiExecResult struct {
	Results      []*QueryResult `json:"results"`      // 성공한 쿼리 결과 목록
	FailedIndex  int            `json:"failedIndex"`  // 실패한 statement 0-기반 인덱스 (-1 = 전부 성공)
	FailedSQL    string         `json:"failedSQL"`    // 실패한 SQL 문
	Error        string         `json:"error"`        // 오류 메시지 (FailedIndex >= 0 일 때만 유효)
	RemainingSQL string         `json:"remainingSQL"` // 미실행 SQL (FailedIndex 다음 statement들)
	TotalCount   int            `json:"totalCount"`   // 전체 statement 수
}

// ColumnValue InsertRow 파라미터용 컬럼·값 쌍.
type ColumnValue struct {
	Column  string `json:"column"`
	Value   string `json:"value"`
	SetNull bool   `json:"setNull"`
}

// QueryType SQL 문의 종류.
type QueryType int

const (
	QueryTypeSelect QueryType = iota
	QueryTypeInsert
	QueryTypeUpdate
	QueryTypeDelete
	QueryTypeDDL
	QueryTypeOther
)
