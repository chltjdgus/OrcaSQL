package query

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"strings"
	"time"

	"orcasql/internal/connection"
)

// ImportResult CSV 임포트 결과.
type ImportResult struct {
	Inserted int    `json:"inserted"` // 삽입된 행 수
	Skipped  int    `json:"skipped"`  // 건너뛴 행 수 (열 수 불일치 등)
	Errors   string `json:"errors"`   // 첫 번째 오류 메시지 (없으면 빈 문자열)
}

// ImportCSV CSV 내용을 파싱하여 지정 테이블에 BATCH INSERT한다.
//
//   - hasHeader: 첫 줄이 헤더(컬럼명)이면 true. false이면 컬럼 순서대로 매핑.
//   - delimiter: 구분자 rune. 0이면 쉼표(',') 사용.
//
// 500행 단위 BATCH INSERT를 사용한다.
// 행 열 수가 헤더 열 수보다 적으면 NULL로 채우고, 많으면 뒤를 잘라낸다.
func ImportCSV(
	ctx context.Context,
	cm *connection.Manager,
	connID, database, table string,
	csvContent string,
	hasHeader bool,
	delimiter rune,
) (ImportResult, error) {
	if delimiter == 0 {
		delimiter = ','
	}

	reader := csv.NewReader(strings.NewReader(csvContent))
	reader.Comma = delimiter
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true
	reader.FieldsPerRecord = -1 // 행마다 열 수가 달라도 허용

	records, err := reader.ReadAll()
	if err != nil {
		return ImportResult{}, fmt.Errorf("CSV 파싱 실패: %w", err)
	}

	if len(records) == 0 {
		return ImportResult{}, nil
	}

	// 헤더/데이터 분리
	var columns []string
	startIdx := 0
	if hasHeader && len(records) > 0 {
		columns = records[0]
		startIdx = 1
	} else {
		// 헤더 없으면 첫 번째 데이터 행의 열 수로 컬럼 목록 생성
		columns = make([]string, len(records[0]))
		for i := range columns {
			columns[i] = fmt.Sprintf("col%d", i+1)
		}
	}

	dataRows := records[startIdx:]
	if len(dataRows) == 0 {
		return ImportResult{}, nil
	}

	db, err := cm.GetDB(connID)
	if err != nil {
		return ImportResult{}, err
	}

	// 컬럼 목록 (backtick 이스케이프)
	escapedCols := make([]string, len(columns))
	for i, c := range columns {
		escapedCols[i] = "`" + strings.ReplaceAll(c, "`", "``") + "`"
	}
	colList := strings.Join(escapedCols, ", ")
	dbEsc := strings.ReplaceAll(database, "`", "``")
	tblEsc := strings.ReplaceAll(table, "`", "``")

	const batchSize = 500
	result := ImportResult{}

	for batchStart := 0; batchStart < len(dataRows); batchStart += batchSize {
		end := batchStart + batchSize
		if end > len(dataRows) {
			end = len(dataRows)
		}
		batch := dataRows[batchStart:end]

		var buf bytes.Buffer
		fmt.Fprintf(&buf, "INSERT INTO `%s`.`%s` (%s) VALUES\n", dbEsc, tblEsc, colList)

		args := make([]interface{}, 0, len(batch)*len(columns))
		batchCount := 0

		for i, row := range batch {
			// 열 수 맞추기
			normalized := make([]interface{}, len(columns))
			for j := range columns {
				if j < len(row) {
					normalized[j] = row[j]
				} else {
					normalized[j] = nil
				}
			}

			if i > 0 {
				buf.WriteString(",\n")
			}
			buf.WriteString("(")
			placeholders := make([]string, len(columns))
			for j := range columns {
				placeholders[j] = "?"
				args = append(args, normalized[j])
			}
			buf.WriteString(strings.Join(placeholders, ", "))
			buf.WriteString(")")
			batchCount++
		}

		qctx, cancel := context.WithTimeout(ctx, 60*time.Second)
		res, execErr := db.ExecContext(qctx, buf.String(), args...)
		cancel()
		if execErr != nil {
			if result.Errors == "" {
				result.Errors = fmt.Sprintf("배치 시작 행 %d: %v", batchStart+1, execErr)
			}
			// 실패한 배치는 스킵 처리
			result.Skipped += batchCount
			continue
		}

		affected, _ := res.RowsAffected()
		result.Inserted += int(affected)
	}

	return result, nil
}
