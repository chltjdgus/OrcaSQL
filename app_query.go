package main

// ─── 쿼리 실행 ─────────────────────────────────────────────────────────────
//
// SQL 단일/멀티 실행, 스트리밍, 행 수정·삽입, 타임아웃·결과 상한선 설정, CSV 임포트.
// 모든 실행 결과(성공/실패) 는 history 에 자동 저장.

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
	"orcasql/internal/history"
	"orcasql/internal/query"
)

// ExecuteQuery SQL을 실행하고 결과를 반환한다.
// 실행 결과(성공/실패 모두)는 히스토리에 자동 저장된다.
func (a *App) ExecuteQuery(ctx context.Context, connID, connName, database, sql string) (*query.QueryResult, error) {
	// 단일 실행은 connID를 cancelKey로 사용 (탭 단위 취소 불필요)
	result, execErr := a.queryExec.Execute(ctx, connID, connID, database, sql)

	// 히스토리 저장 (성공/실패 무관)
	entry := history.Entry{
		ID:         uuid.New().String(),
		SQL:        sql,
		ConnName:   connName,
		Database:   database,
		ExecutedAt: time.Now(),
		HasError:   execErr != nil,
	}
	if execErr != nil {
		entry.ErrorMsg = execErr.Error()
	} else {
		entry.Duration = result.Duration
		entry.RowCount = int64(len(result.Rows))
		entry.Affected = result.Affected
	}
	if hsErr := a.historyStore.Add(entry); hsErr != nil {
		slog.Warn("history save failed", "error", hsErr)
	}

	if execErr != nil {
		return nil, fmt.Errorf("execute query: %w", execErr)
	}
	// SELECT 결과에 인라인 편집 컨텍스트 자동 포함
	a.attachEditCtx(ctx, connID, database, []*query.QueryResult{result})
	return result, nil
}

// ExecuteMultiQuery 세미콜론으로 구분된 여러 SQL 문을 순차 실행하고 MultiExecResult를 반환한다.
// tabID는 cancelFuncs 키로 사용되어 탭별 독립 취소를 지원한다.
// 실패 시에도 Wails 바인딩에서 오류를 발생시키지 않는다 (부분 결과 + 오류가 구조체에 내장).
// 프론트엔드에서 failedIndex >= 0 을 감지해 계속/중단 선택 대화를 표시한다.
func (a *App) ExecuteMultiQuery(ctx context.Context, connID, tabID, connName, database, sql string) (*query.MultiExecResult, error) {
	out := a.queryExec.ExecuteMulti(ctx, connID, tabID, database, sql)

	// SELECT 결과에 인라인 편집 컨텍스트 자동 포함
	// 단일 테이블 SELECT이면 PK 컬럼을 조회해 EditCtx를 채운다.
	a.attachEditCtx(ctx, connID, database, out.Results)

	// 히스토리 저장 (전체 블록 — 성공 여부 무관)
	var totalRows, totalAffected int64
	var totalDuration time.Duration
	for _, r := range out.Results {
		totalRows += int64(len(r.Rows))
		totalAffected += r.Affected
		totalDuration += r.Duration
	}
	entry := history.Entry{
		ID:         uuid.New().String(),
		SQL:        sql,
		ConnName:   connName,
		Database:   database,
		ExecutedAt: time.Now(),
		HasError:   out.FailedIndex >= 0,
		Duration:   totalDuration,
		RowCount:   totalRows,
		Affected:   totalAffected,
	}
	if out.FailedIndex >= 0 {
		entry.ErrorMsg = out.Error
	}
	if hsErr := a.historyStore.Add(entry); hsErr != nil {
		slog.Warn("history save failed", "error", hsErr)
	}

	return out, nil
}

// attachEditCtx SELECT 결과에 인라인 편집 컨텍스트(PK 컬럼 정보)를 채운다.
func (a *App) attachEditCtx(ctx context.Context, connID, database string, results []*query.QueryResult) {
	for _, r := range results {
		if r == nil || len(r.Columns) == 0 {
			continue
		}
		dbName, tableName, ok := query.ExtractSingleTable(r.SQL)
		if !ok {
			continue
		}
		if dbName == "" {
			dbName = database
		}
		pkCols, err := a.schemaInsp.GetPKColumns(ctx, connID, dbName, tableName)
		if err != nil || len(pkCols) == 0 {
			continue
		}
		r.EditCtx = &query.TableEditContext{
			Database:  dbName,
			Table:     tableName,
			PKColumns: pkCols,
		}
	}
}

// ExecuteQueryStream 대용량 쿼리를 청크 단위로 스트리밍 실행한다.
// 결과는 "query:chunk" Wails 이벤트로 전달된다.
func (a *App) ExecuteQueryStream(ctx context.Context, connID, sql string) error {
	return a.queryExec.ExecuteStream(ctx, connID, sql, 500, func(chunk query.ResultChunk) {
		application.Get().Event.Emit("query:chunk", chunk)
	})
}

// CancelQuery 실행 중인 쿼리를 취소한다.
// tabID: ExecuteMultiQuery 호출 시 전달한 tabID (cancelFuncs 키).
func (a *App) CancelQuery(ctx context.Context, tabID string) error {
	return a.queryExec.Cancel(tabID)
}

// UpdateRowValue 결과 그리드 인라인 편집 — 단일 셀 값을 UPDATE한다.
// pkValues: WHERE 조건을 구성하는 PK 컬럼·값 쌍 배열
// setNull: true이면 newValue를 무시하고 NULL로 설정
func (a *App) UpdateRowValue(
	ctx context.Context,
	connID, database, table, column, newValue string,
	setNull bool,
	pkValues []query.RowPKValue,
) error {
	if len(pkValues) == 0 {
		return fmt.Errorf("PK 값이 없어 UPDATE를 실행할 수 없습니다")
	}

	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return err
	}

	// WHERE 절 구성
	whereParts := make([]string, len(pkValues))
	whereArgs := make([]any, len(pkValues))
	for i, pk := range pkValues {
		whereParts[i] = fmt.Sprintf("%s = ?", quoteIdent(pk.Column))
		whereArgs[i] = pk.Value
	}

	// SET 절 구성
	var sqlStr string
	var args []any
	if setNull {
		sqlStr = fmt.Sprintf(
			"UPDATE %s.%s SET %s = NULL WHERE %s LIMIT 1",
			quoteIdent(database), quoteIdent(table), quoteIdent(column), strings.Join(whereParts, " AND "),
		)
		args = whereArgs
	} else {
		sqlStr = fmt.Sprintf(
			"UPDATE %s.%s SET %s = ? WHERE %s LIMIT 1",
			quoteIdent(database), quoteIdent(table), quoteIdent(column), strings.Join(whereParts, " AND "),
		)
		args = append([]any{newValue}, whereArgs...)
	}

	qctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	result, err := db.ExecContext(qctx, sqlStr, args...)
	if err != nil {
		return fmt.Errorf("update row: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("변경된 행이 없습니다 — 행이 외부에서 수정되었을 수 있습니다")
	}
	slog.Info("row updated", "table", table, "column", column, "setNull", setNull)
	return nil
}

// InsertRow 결과 그리드 — 신규 행을 INSERT한다.
// columnValues에 포함된 컬럼만 INSERT하고 나머지는 DB 기본값으로 처리된다.
func (a *App) InsertRow(
	ctx context.Context,
	connID, database, table string,
	columnValues []query.ColumnValue,
) error {
	if len(columnValues) == 0 {
		return fmt.Errorf("삽입할 컬럼 값이 없습니다")
	}
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return err
	}

	cols := make([]string, len(columnValues))
	placeholders := make([]string, len(columnValues))
	args := make([]any, 0, len(columnValues))
	for i, cv := range columnValues {
		cols[i] = quoteIdent(cv.Column)
		placeholders[i] = "?"
		if cv.SetNull {
			args = append(args, nil)
		} else {
			args = append(args, cv.Value)
		}
	}

	sqlStr := fmt.Sprintf(
		"INSERT INTO %s.%s (%s) VALUES (%s)",
		quoteIdent(database), quoteIdent(table),
		strings.Join(cols, ", "),
		strings.Join(placeholders, ", "),
	)

	qctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	result, err := db.ExecContext(qctx, sqlStr, args...)
	if err != nil {
		return fmt.Errorf("insert row: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("행이 삽입되지 않았습니다")
	}
	slog.Info("row inserted", "table", table, "columns", len(columnValues))
	return nil
}

// SetQueryTimeout 쿼리 타임아웃을 변경한다. seconds는 5~300 범위.
func (a *App) SetQueryTimeout(ctx context.Context, seconds int) error {
	if seconds < 5 || seconds > 300 {
		return fmt.Errorf("timeout must be between 5 and 300 seconds (got %d)", seconds)
	}
	a.queryExec.SetTimeout(seconds)
	return nil
}

// GetQueryTimeout 현재 쿼리 타임아웃(초)을 반환한다.
func (a *App) GetQueryTimeout(ctx context.Context) int {
	return int(a.queryExec.Timeout().Seconds())
}

// SetResultLimit SELECT 결과 행 상한선을 변경한다. n은 100~1,000,000 범위.
func (a *App) SetResultLimit(ctx context.Context, n int) error {
	if n < 100 || n > 1_000_000 {
		return fmt.Errorf("result limit must be between 100 and 1,000,000 (got %d)", n)
	}
	a.queryExec.SetResultLimit(n)
	return nil
}

// GetResultLimit 현재 SELECT 결과 행 상한선을 반환한다.
func (a *App) GetResultLimit(ctx context.Context) int {
	return int(a.queryExec.ResultLimit())
}

// ImportCSVData CSV 문자열을 파싱하여 지정 테이블에 BATCH INSERT한다.
// delimiter: 구분자 문자열 (예: ",", "\t", ";"). 빈 문자열이면 ","로 처리.
// 반환: 삽입 결과 (inserted, skipped, errors)
func (a *App) ImportCSVData(
	ctx context.Context,
	connID, database, table, csvContent string,
	hasHeader bool,
	delimiter string,
) (query.ImportResult, error) {
	sep := ','
	if delimiter != "" {
		runes := []rune(delimiter)
		if len(runes) > 0 {
			sep = runes[0]
		}
	}
	result, err := query.ImportCSV(ctx, a.connManager, connID, database, table, csvContent, hasHeader, sep)
	if err != nil {
		return query.ImportResult{}, fmt.Errorf("CSV 임포트 실패: %w", err)
	}
	slog.Info("CSV import done", "connID", connID, "table", table, "inserted", result.Inserted, "skipped", result.Skipped)
	return result, nil
}
