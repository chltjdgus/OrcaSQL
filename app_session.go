package main

// ─── Session Restore ───────────────────────────────────────────────────────
//
// 열린 탭/연결/SQL 상태의 영속화. 앱 종료 직전 SaveSession, 시작 시 LoadSession,
// 손상 시 ResetSession (Phase 14-D).

import (
	"context"

	"orcasql/internal/session"
)

// SaveSession 현재 열린 탭 상태를 저장한다 (앱 종료 직전 호출).
func (a *App) SaveSession(ctx context.Context, state session.SessionState) error {
	return a.sessionStore.Save(state)
}

// LoadSession 저장된 세션 상태를 반환한다.
func (a *App) LoadSession(ctx context.Context) (*session.SessionState, error) {
	return a.sessionStore.Load()
}

// ClearSession 세션 파일을 삭제한다.
func (a *App) ClearSession(ctx context.Context) error {
	return a.sessionStore.Clear()
}

// ResetSession 손상된 세션을 빈 상태로 초기화한다 (파일 + .bak 모두 제거).
// Phase 14-D: 프론트엔드에서 LoadSession 실패 감지 시 호출.
func (a *App) ResetSession(ctx context.Context) error {
	return a.sessionStore.Reset()
}
