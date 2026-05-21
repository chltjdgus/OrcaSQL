package query

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"orcasql/internal/connection"
)

const defaultTimeoutSeconds int64 = 30
const defaultResultLimit int64 = 50_000

// Executor SQL 쿼리 실행기.
type Executor struct {
	connManager    *connection.Manager
	mu             sync.Mutex
	cancelFuncs    map[string]context.CancelFunc // connID → 실행 중인 쿼리 취소 함수
	timeoutSeconds atomic.Int64                  // 쿼리 타임아웃 (초), 0이면 defaultTimeoutSeconds 사용
	resultLimit    atomic.Int64                  // SELECT 결과 상한선 (행 수), 0이면 defaultResultLimit 사용
}

// NewExecutor Executor 인스턴스를 생성한다.
func NewExecutor(cm *connection.Manager) *Executor {
	e := &Executor{
		connManager: cm,
		cancelFuncs: make(map[string]context.CancelFunc),
	}
	e.timeoutSeconds.Store(defaultTimeoutSeconds)
	e.resultLimit.Store(defaultResultLimit)
	return e
}

// SetTimeout 쿼리 타임아웃을 변경한다. seconds는 5~300 범위여야 한다.
func (e *Executor) SetTimeout(seconds int) {
	if seconds < 5 {
		seconds = 5
	}
	if seconds > 300 {
		seconds = 300
	}
	e.timeoutSeconds.Store(int64(seconds))
	slog.Info("query timeout updated", "seconds", seconds)
}

// Timeout 현재 설정된 타임아웃을 반환한다.
func (e *Executor) Timeout() time.Duration {
	return time.Duration(e.timeoutSeconds.Load()) * time.Second
}

// SetResultLimit SELECT 결과 행 상한선을 변경한다. n은 100~1,000,000 범위여야 한다.
func (e *Executor) SetResultLimit(n int) {
	if n < 100 {
		n = 100
	}
	if n > 1_000_000 {
		n = 1_000_000
	}
	e.resultLimit.Store(int64(n))
	slog.Info("result limit updated", "rows", n)
}

// ResultLimit 현재 설정된 결과 행 상한선을 반환한다.
func (e *Executor) ResultLimit() int64 {
	v := e.resultLimit.Load()
	if v <= 0 {
		return defaultResultLimit
	}
	return v
}

// Execute SQL을 실행하고 전체 결과를 반환한다.
// cancelKey는 cancelFuncs 맵의 키로 사용된다.
//   - ExecuteMulti에서 호출 시: tabID (탭별 독립 취소)
//   - 직접 호출 시: connID (연결 단위 취소)
//
// database가 빈 문자열이 아니면, conn 풀에서 단일 conn을 확보한 뒤
// 그 conn에 `USE <database>`를 적용한 후 같은 conn으로 SQL을 실행한다.
// (MySQL의 USE는 connection-scoped이므로 풀의 다른 conn에 영향이 없도록 단일 conn에 묶는다.)
//
// SELECT: 모든 행을 메모리에 로드 (대용량이면 ExecuteStream 사용 권장)
// INSERT/UPDATE/DELETE/DDL: affected rows, last insert ID 반환
func (e *Executor) Execute(ctx context.Context, connID, cancelKey, database, sqlStr string) (*QueryResult, error) {
	db, err := e.connManager.GetDB(connID)
	if err != nil {
		return nil, err
	}

	qctx, cancel := context.WithTimeout(ctx, e.Timeout())
	e.registerCancel(cancelKey, cancel)
	defer func() {
		cancel()
		e.unregisterCancel(cancelKey)
	}()

	conn, err := db.Conn(qctx)
	if err != nil {
		return nil, fmt.Errorf("acquire conn: %w", err)
	}
	defer conn.Close()

	if database != "" {
		// identifier backtick escape: `weird``name`
		escaped := strings.ReplaceAll(database, "`", "``")
		if _, err := conn.ExecContext(qctx, "USE `"+escaped+"`"); err != nil {
			return nil, fmt.Errorf("use database %q: %w", database, err)
		}
	}

	start := time.Now()
	qType := DetectQueryType(sqlStr)

	switch qType {
	case QueryTypeSelect:
		return e.executeSelect(qctx, conn, sqlStr, start)
	default:
		return e.executeExec(qctx, conn, sqlStr, start)
	}
}

// ExecuteStream 대용량 SELECT를 chunkSize 행 단위로 스트리밍한다.
// emit 콜백으로 각 청크를 전달하며, 마지막 청크에 IsLast=true가 설정된다.
func (e *Executor) ExecuteStream(ctx context.Context, connID, sqlStr string, chunkSize int, emit func(ResultChunk)) error {
	db, err := e.connManager.GetDB(connID)
	if err != nil {
		return err
	}

	qctx, cancel := context.WithTimeout(ctx, 10*time.Minute) // 스트리밍은 더 긴 timeout
	e.registerCancel(connID, cancel)
	defer func() {
		cancel()
		e.unregisterCancel(connID)
	}()

	rows, err := db.QueryContext(qctx, sqlStr)
	if err != nil {
		return fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return fmt.Errorf("column types: %w", err)
	}

	columns := makeColumnMeta(colTypes)
	chunkIdx := 0
	batch := make([][]any, 0, chunkSize)
	var totalRows int64

	flush := func(isLast bool) {
		chunk := ResultChunk{
			Rows:       batch,
			ChunkIndex: chunkIdx,
			IsLast:     isLast,
			Total:      totalRows,
		}
		if chunkIdx == 0 {
			chunk.Columns = columns
		}
		emit(chunk)
		chunkIdx++
		batch = make([][]any, 0, chunkSize)
	}

	scanDest := makeScanDest(len(columns))

	for rows.Next() {
		if err := rows.Scan(scanDest...); err != nil {
			return fmt.Errorf("scan: %w", err)
		}
		row := extractRow(scanDest, columns)
		batch = append(batch, row)
		totalRows++

		if len(batch) >= chunkSize {
			flush(false)
		}
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("rows error: %w", err)
	}

	flush(true) // 마지막 청크
	slog.Info("stream complete", "connID", connID, "rows", totalRows)
	return nil
}

// Cancel 실행 중인 쿼리를 취소한다.
// cancelKey는 Execute() 호출 시 지정한 키와 동일해야 한다.
// - ExecuteMulti 경유 쿼리: tabID
// - ExecuteQuery 직접 호출: connID
func (e *Executor) Cancel(cancelKey string) error {
	e.mu.Lock()
	cancelFn, ok := e.cancelFuncs[cancelKey]
	e.mu.Unlock()
	if !ok {
		return fmt.Errorf("no running query for key: %s", cancelKey)
	}
	cancelFn()
	return nil
}

// ─── 내부 헬퍼 ─────────────────────────────────────────────────────────────

func (e *Executor) executeSelect(ctx context.Context, db *sql.Conn, sqlStr string, start time.Time) (*QueryResult, error) {
	rows, err := db.QueryContext(ctx, sqlStr)
	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return nil, fmt.Errorf("column types: %w", err)
	}

	limit := e.ResultLimit()
	columns := makeColumnMeta(colTypes)
	scanDest := makeScanDest(len(columns))
	var allRows [][]any
	truncated := false

	for rows.Next() {
		if int64(len(allRows)) >= limit {
			truncated = true
			break
		}
		if err := rows.Scan(scanDest...); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		allRows = append(allRows, extractRow(scanDest, columns))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows: %w", err)
	}

	// 0행 SELECT 의 경우 allRows 가 nil 이라 JSON 으로 null 이 됨 — 빈 슬라이스로 정규화.
	if allRows == nil {
		allRows = [][]any{}
	}

	return &QueryResult{
		Columns:   columns,
		Rows:      allRows,
		Duration:  time.Since(start),
		SQL:       sqlStr,
		Truncated: truncated,
	}, nil
}

func (e *Executor) executeExec(ctx context.Context, db *sql.Conn, sqlStr string, start time.Time) (*QueryResult, error) {
	result, err := db.ExecContext(ctx, sqlStr)
	if err != nil {
		return nil, fmt.Errorf("exec: %w", err)
	}
	affected, _ := result.RowsAffected()
	lastID, _ := result.LastInsertId()
	// Columns/Rows 를 빈 슬라이스로 명시 — JSON 직렬화 시 null 이 아닌 [] 로 나가도록 (프론트 .length 안전).
	return &QueryResult{
		Columns:  []ColumnMeta{},
		Rows:     [][]any{},
		Affected: affected,
		LastID:   lastID,
		Duration: time.Since(start),
		SQL:      sqlStr,
	}, nil
}

func (e *Executor) registerCancel(connID string, cancel context.CancelFunc) {
	e.mu.Lock()
	e.cancelFuncs[connID] = cancel
	e.mu.Unlock()
}

func (e *Executor) unregisterCancel(connID string) {
	e.mu.Lock()
	delete(e.cancelFuncs, connID)
	e.mu.Unlock()
}

// ExecuteMulti 세미콜론으로 구분된 여러 SQL 문을 순차 실행한다.
// tabID는 cancelFuncs 키로 사용되어 탭별 독립 취소를 지원한다.
// database가 빈 문자열이 아니면 각 stmt 실행 시 USE database를 conn 단위로 적용한다.
// (단일 conn 묶음·트랜잭션 일관성은 별도 후속 작업.)
// 실패 시 MultiExecResult.FailedIndex >= 0 이며 에러 정보가 구조체에 내장된다.
// Wails 바인딩 레이어에서 항상 성공 응답으로 처리하도록 error를 반환하지 않는다.
func (e *Executor) ExecuteMulti(ctx context.Context, connID, tabID, database, sqlStr string) *MultiExecResult {
	stmts := SplitStatements(sqlStr)
	out := &MultiExecResult{
		FailedIndex: -1,
		TotalCount:  len(stmts),
	}
	if len(stmts) == 0 {
		out.Error = "실행할 SQL 문이 없습니다"
		out.FailedIndex = 0
		return out
	}
	out.Results = make([]*QueryResult, 0, len(stmts))
	for i, stmt := range stmts {
		// tabID를 cancelKey로 사용 → 탭별 독립 취소 가능
		result, err := e.Execute(ctx, connID, tabID, database, stmt)
		if err != nil {
			out.FailedIndex = i
			out.FailedSQL = stmt
			out.Error = err.Error()
			// 남은 statement들을 remainingSQL로 합친다
			if i+1 < len(stmts) {
				out.RemainingSQL = joinStatements(stmts[i+1:])
			}
			return out
		}
		out.Results = append(out.Results, result)
	}
	return out
}

// joinStatements statements를 세미콜론으로 합쳐 하나의 SQL 문자열로 반환한다.
func joinStatements(stmts []string) string {
	var b strings.Builder
	for i, s := range stmts {
		if i > 0 {
			b.WriteString(";\n")
		}
		b.WriteString(s)
	}
	if b.Len() > 0 {
		b.WriteByte(';')
	}
	return b.String()
}

// SplitStatements SQL 문자열을 개별 statement로 분리한다.
// 문자열 리터럴(' 또는 "), 블록 주석(/* */), 라인 주석(--)
// 내부의 세미콜론은 구분자로 취급하지 않는다.
// DELIMITER 명령어를 인식하여 구분자를 동적으로 변경한다.
// (SP/Function/Trigger/Event 생성 스크립트에서 DELIMITER // … DELIMITER ; 패턴 지원)
func SplitStatements(sql string) []string {
	var statements []string
	var buf strings.Builder
	inSingle := false // ' ... ' 문자열 내부
	inDouble := false // " ... " 문자열 내부
	inBlock := false  // /* ... */ 블록 주석 내부
	delimiter := ";"
	delimRunes := []rune(delimiter)
	runes := []rune(sql)
	n := len(runes)

	for i := 0; i < n; i++ {
		ch := runes[i]

		// 블록 주석 내부
		if inBlock {
			buf.WriteRune(ch)
			if ch == '*' && i+1 < n && runes[i+1] == '/' {
				buf.WriteRune(runes[i+1])
				i++
				inBlock = false
			}
			continue
		}

		// 싱글 쿼트 문자열 내부
		if inSingle {
			buf.WriteRune(ch)
			if ch == '\\' && i+1 < n {
				buf.WriteRune(runes[i+1])
				i++
			} else if ch == '\'' {
				inSingle = false
			}
			continue
		}

		// 더블 쿼트 문자열 내부
		if inDouble {
			buf.WriteRune(ch)
			if ch == '\\' && i+1 < n {
				buf.WriteRune(runes[i+1])
				i++
			} else if ch == '"' {
				inDouble = false
			}
			continue
		}

		// DELIMITER 키워드 감지 (줄 시작, 대소문자 무관)
		// "DELIMITER //" → 구분자를 // 로 변경
		// "DELIMITER ;"  → 구분자를 ; 로 복귀
		if splitIsLineStart(buf.String()) && splitMatchesKeyword(runes, i, "DELIMITER") {
			i += len("DELIMITER")
			// 공백 건너뜀
			for i < n && (runes[i] == ' ' || runes[i] == '\t') {
				i++
			}
			// 새 구분자 토큰 읽기 (줄 끝까지)
			var delimBuf strings.Builder
			for i < n && runes[i] != '\n' && runes[i] != '\r' {
				delimBuf.WriteRune(runes[i])
				i++
			}
			if newDelim := strings.TrimSpace(delimBuf.String()); newDelim != "" {
				delimiter = newDelim
				delimRunes = []rune(delimiter)
			}
			buf.Reset()
			continue
		}

		// 현재 구분자 매칭 검사
		if splitMatchesAt(runes, i, delimRunes) {
			if stmt := strings.TrimSpace(buf.String()); stmt != "" {
				statements = append(statements, stmt)
			}
			buf.Reset()
			i += len(delimRunes) - 1
			continue
		}

		// 블록 주석 시작
		if ch == '/' && i+1 < n && runes[i+1] == '*' {
			buf.WriteRune(ch)
			buf.WriteRune(runes[i+1])
			i++
			inBlock = true
			continue
		}

		// 라인 주석: 줄 끝까지 버퍼에 쌓음
		if ch == '-' && i+1 < n && runes[i+1] == '-' {
			buf.WriteRune(ch)
			for i+1 < n && runes[i+1] != '\n' {
				i++
				buf.WriteRune(runes[i])
			}
			continue
		}

		// 문자열 시작
		if ch == '\'' {
			inSingle = true
			buf.WriteRune(ch)
			continue
		}
		if ch == '"' {
			inDouble = true
			buf.WriteRune(ch)
			continue
		}

		buf.WriteRune(ch)
	}

	// 마지막 statement (구분자 없이 끝나는 경우)
	if stmt := strings.TrimSpace(buf.String()); stmt != "" {
		statements = append(statements, stmt)
	}
	return statements
}

// splitIsLineStart buf가 비어 있거나 마지막 비공백 문자가 개행('\n')이면 true를 반환한다.
// DELIMITER 키워드가 줄 시작에 위치하는지 확인하는 데 사용한다.
func splitIsLineStart(s string) bool {
	trimmed := strings.TrimRight(s, " \t")
	return trimmed == "" || trimmed[len(trimmed)-1] == '\n'
}

// splitMatchesKeyword runes[i:] 가 keyword(대문자)로 시작하고
// 그 직후에 공백/탭이 오면 true를 반환한다 (대소문자 무관).
func splitMatchesKeyword(runes []rune, i int, keyword string) bool {
	kw := []rune(keyword)
	end := i + len(kw)
	if end >= len(runes) { // 키워드 뒤에 토큰이 없으면 무시
		return false
	}
	for j, k := range kw {
		r := runes[i+j]
		if r >= 'a' && r <= 'z' {
			r -= 32 // 소문자 → 대문자
		}
		if r != k {
			return false
		}
	}
	return runes[end] == ' ' || runes[end] == '\t'
}

// splitMatchesAt runes[i:] 가 target 슬라이스로 시작하면 true를 반환한다.
func splitMatchesAt(runes []rune, i int, target []rune) bool {
	if i+len(target) > len(runes) {
		return false
	}
	for j, t := range target {
		if runes[i+j] != t {
			return false
		}
	}
	return true
}

// ExtractSingleTable SQL이 단일 테이블 SELECT이면 (database, table, true)을 반환한다.
// JOIN, UNION, CTE(WITH), 서브쿼리가 포함된 경우에는 ok=false를 반환한다.
// 이 함수는 인라인 편집 가능 여부를 판단하는 데만 사용한다 (정확성보다 안전성 우선).
func ExtractSingleTable(sql string) (database, table string, ok bool) {
	upper := strings.ToUpper(sql)
	trimmed := strings.TrimSpace(upper)

	// SELECT 문만 처리
	if !strings.HasPrefix(trimmed, "SELECT") {
		return "", "", false
	}

	// CTE(WITH 절)가 앞에 오는 경우 → 단일 테이블 편집 불가
	// WITH cte AS (...) SELECT ... 패턴
	if strings.HasPrefix(trimmed, "WITH ") || strings.HasPrefix(trimmed, "WITH\t") || strings.HasPrefix(trimmed, "WITH\n") {
		return "", "", false
	}

	// JOIN, UNION, 서브쿼리 안전 검출
	for _, kw := range []string{" JOIN ", "\tJOIN\t", " JOIN\n", "\nJOIN ", " UNION ", "(SELECT "} {
		if strings.Contains(trimmed, kw) {
			return "", "", false
		}
	}

	// FROM 다음 테이블명 추출
	fromIdx := strings.Index(trimmed, " FROM ")
	if fromIdx < 0 {
		return "", "", false
	}

	// 원본 SQL에서 FROM 뒤 부분을 파싱 (대소문자 보존)
	afterFrom := strings.TrimSpace(sql[fromIdx+6:])

	// 테이블명 끝 위치 탐색 (공백·탭·개행·세미콜론·콤마·괄호에서 종료)
	end := len(afterFrom)
	for i, ch := range afterFrom {
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' ||
			ch == ';' || ch == ',' || ch == ')' || ch == '(' {
			end = i
			break
		}
	}
	tableExpr := strings.ReplaceAll(afterFrom[:end], "`", "")

	// db.table 또는 table 분리
	parts := strings.SplitN(tableExpr, ".", 2)
	switch len(parts) {
	case 2:
		database = parts[0]
		table = parts[1]
	case 1:
		table = parts[0]
	default:
		return "", "", false
	}

	if table == "" {
		return "", "", false
	}

	// FROM 뒤 나머지에 또 다른 FROM이 있으면 서브쿼리로 간주
	remaining := strings.ToUpper(afterFrom[end:])
	if strings.Contains(remaining, " FROM ") {
		return "", "", false
	}

	return database, table, true
}

// DetectQueryType SQL 문의 종류를 감지한다.
// CTE(WITH ... AS (...) SELECT/INSERT/UPDATE/DELETE)는 WITH 절을 건너뛰고 실제 DML을 감지한다.
//
// 외부 패키지 (예: internal/mcp) 의 권한 게이트에서 재사용된다.
func DetectQueryType(sqlStr string) QueryType {
	trimmed := strings.ToUpper(strings.TrimSpace(sqlStr))

	// CTE 처리: WITH cte AS (...) SELECT/INSERT/UPDATE/DELETE
	// WITH 절 이후 균형 잡힌 괄호를 건너뛰어 실제 statement 키워드를 찾는다.
	if strings.HasPrefix(trimmed, "WITH ") || strings.HasPrefix(trimmed, "WITH\t") || strings.HasPrefix(trimmed, "WITH\n") {
		if inner := skipCTEDefinitions(trimmed); inner != "" {
			trimmed = inner
		} else {
			// 파싱 실패 시 SELECT로 보수적으로 처리 (가장 흔한 CTE 패턴)
			return QueryTypeSelect
		}
	}

	switch {
	case strings.HasPrefix(trimmed, "SELECT") || strings.HasPrefix(trimmed, "SHOW") || strings.HasPrefix(trimmed, "EXPLAIN"):
		return QueryTypeSelect
	case strings.HasPrefix(trimmed, "INSERT"):
		return QueryTypeInsert
	case strings.HasPrefix(trimmed, "UPDATE"):
		return QueryTypeUpdate
	case strings.HasPrefix(trimmed, "DELETE"):
		return QueryTypeDelete
	case strings.HasPrefix(trimmed, "CREATE") || strings.HasPrefix(trimmed, "ALTER") ||
		strings.HasPrefix(trimmed, "DROP") || strings.HasPrefix(trimmed, "TRUNCATE"):
		return QueryTypeDDL
	default:
		return QueryTypeOther
	}
}

// skipCTEDefinitions WITH 절(CTE 정의 블록 전체)을 건너뛰고
// 실제 DML/SELECT 키워드부터 시작하는 대문자 문자열을 반환한다.
// 파싱에 실패하면 "" 을 반환한다.
// 입력은 반드시 TrimSpace + ToUpper 된 상태여야 한다.
func skipCTEDefinitions(sql string) string {
	// "WITH " 다음부터 시작
	i := 5 // len("WITH ")
	n := len(sql)

	for i < n {
		// 공백 건너뜀
		for i < n && (sql[i] == ' ' || sql[i] == '\t' || sql[i] == '\n' || sql[i] == '\r') {
			i++
		}
		if i >= n {
			return ""
		}

		// cte_name 건너뜀 (영문·숫자·_·백틱·공백 등)
		for i < n && sql[i] != '(' && sql[i] != ' ' && sql[i] != '\t' && sql[i] != '\n' {
			i++
		}
		// "AS" 키워드와 공백 건너뜀
		for i < n && sql[i] != '(' {
			i++
		}
		if i >= n {
			return ""
		}

		// 균형 잡힌 괄호 블록 건너뜀
		depth := 0
		for i < n {
			switch sql[i] {
			case '(':
				depth++
			case ')':
				depth--
				if depth == 0 {
					i++ // ')' 포함해서 전진
					goto afterBlock
				}
			}
			i++
		}
		return "" // 괄호 미닫힘

	afterBlock:
		// 공백 건너뜀
		for i < n && (sql[i] == ' ' || sql[i] == '\t' || sql[i] == '\n' || sql[i] == '\r') {
			i++
		}
		if i >= n {
			return ""
		}

		// 쉼표가 있으면 다음 CTE 정의로 이어짐
		if sql[i] == ',' {
			i++
			continue
		}

		// 쉼표가 없으면 실제 statement 시작
		return sql[i:]
	}
	return ""
}

func makeColumnMeta(colTypes []*sql.ColumnType) []ColumnMeta {
	cols := make([]ColumnMeta, len(colTypes))
	for i, ct := range colTypes {
		nullable, _ := ct.Nullable()
		cols[i] = ColumnMeta{
			Name:     ct.Name(),
			Type:     ct.DatabaseTypeName(),
			Nullable: nullable,
		}
	}
	return cols
}

func makeScanDest(n int) []any {
	dest := make([]any, n)
	for i := range dest {
		dest[i] = new(any)
	}
	return dest
}

func extractRow(scanDest []any, columns []ColumnMeta) []any {
	n := len(columns)
	row := make([]any, n)
	for i, d := range scanDest {
		val := *(d.(*any))
		switch v := val.(type) {
		case []byte:
			// []byte → string 변환 (JSON 직렬화 시 base64 방지)
			row[i] = string(v)
		case time.Time:
			// parseTime=true 로 DATE/DATETIME/TIMESTAMP가 time.Time으로 스캔됨.
			// 기본 JSON 직렬화는 RFC3339("2021-03-03T17:36:03+09:00")지만,
			// DateTimeEditor 및 저장 경로가 MySQL 포맷을 기대하므로 문자열로 통일.
			row[i] = formatTimeByColType(v, columns[i].Type)
		default:
			row[i] = val
		}
	}
	return row
}

// formatTimeByColType time.Time을 컬럼 타입에 맞춘 MySQL 문자열 포맷으로 변환한다.
func formatTimeByColType(t time.Time, colType string) string {
	switch strings.ToUpper(colType) {
	case "DATE":
		return t.Format("2006-01-02")
	default:
		// DATETIME / TIMESTAMP (+ 예외적으로 time.Time으로 스캔되는 타입)
		return t.Format("2006-01-02 15:04:05")
	}
}
