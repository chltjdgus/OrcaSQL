package main

// ─── 쿼리 히스토리 ────────────────────────────────────────────────────────
//
// ~/.orcasql/history/YYYY-MM-DD.jsonl 기반 일자별 분리 저장. ExecuteQuery /
// ExecuteMultiQuery 가 자동으로 항목 추가, 본 파일의 메서드는 UI 조회·삭제 전용.

import (
	"context"
	"time"

	"github.com/google/uuid"
	"orcasql/internal/history"
)

// GetQueryHistory 오늘 날짜 히스토리를 반환한다 (하위호환).
func (a *App) GetQueryHistory(ctx context.Context) ([]history.Entry, error) {
	date := time.Now().Format("2006-01-02")
	return a.historyStore.ListByDate(date)
}

// GetHistoryDates 히스토리가 있는 날짜 목록을 반환한다 (내림차순).
func (a *App) GetHistoryDates(ctx context.Context) ([]string, error) {
	return a.historyStore.ListDates()
}

// GetHistoryByDate 특정 날짜의 히스토리를 반환한다.
func (a *App) GetHistoryByDate(ctx context.Context, date string) ([]history.Entry, error) {
	return a.historyStore.ListByDate(date)
}

// SearchHistory 쿼리 히스토리를 검색한다. date가 비어 있으면 전체 파일 검색.
func (a *App) SearchHistory(ctx context.Context, query, date string) ([]history.Entry, error) {
	return a.historyStore.Search(query, date)
}

// DeleteHistoryEntry 특정 히스토리 항목을 삭제한다.
func (a *App) DeleteHistoryEntry(ctx context.Context, id string) error {
	return a.historyStore.DeleteByID(id)
}

// ClearHistory 히스토리 전체를 삭제한다.
func (a *App) ClearHistory(ctx context.Context) error {
	return a.historyStore.ClearAll()
}

// RecordHistoryEntry UI 측에서 직접 호출하는 행위(인라인 셀 수정·행 삽입 등
// `ExecuteQuery` 를 거치지 않는 경로) 의 결과를 히스토리에 추가한다.
//
// BugFix-CW: Messages·History 일관성 — 모든 쿼리 행위가 한곳에 기록되도록 한다.
// 자동 채움 필드: 빈 ID 는 uuid.New, 0-time ExecutedAt 은 time.Now 로 대체.
//
// Duration 은 nanoseconds(time.Duration 호환 정수). 프런트엔드는 ms 단위로
// 측정한 값을 1_000_000 곱해 전달한다.
func (a *App) RecordHistoryEntry(ctx context.Context, entry history.Entry) error {
	if entry.ID == "" {
		entry.ID = uuid.New().String()
	}
	if entry.ExecutedAt.IsZero() {
		entry.ExecutedAt = time.Now()
	}
	return a.historyStore.Add(entry)
}
