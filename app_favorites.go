package main

// ─── Query Favorites ───────────────────────────────────────────────────────
//
// 자주 쓰는 SQL 스니펫을 ~/.orcasql/favorites.json 에 저장. 사용 횟수 기반 정렬.

import (
	"context"

	"github.com/google/uuid"
	"orcasql/internal/favorite"
)

// ListFavorites 모든 즐겨찾기를 반환한다 (사용 횟수 내림차순).
func (a *App) ListFavorites(ctx context.Context) ([]favorite.Snippet, error) {
	return a.favoriteStore.List(), nil
}

// AddFavorite 새 즐겨찾기를 추가한다.
func (a *App) AddFavorite(ctx context.Context, snippet favorite.Snippet) error {
	if snippet.ID == "" {
		snippet.ID = uuid.New().String()
	}
	return a.favoriteStore.Add(snippet)
}

// UpdateFavorite 기존 즐겨찾기를 수정한다.
func (a *App) UpdateFavorite(ctx context.Context, snippet favorite.Snippet) error {
	return a.favoriteStore.Update(snippet)
}

// DeleteFavorite 즐겨찾기를 삭제한다.
func (a *App) DeleteFavorite(ctx context.Context, id string) error {
	return a.favoriteStore.Delete(id)
}

// UseFavorite 즐겨찾기 사용 횟수를 증가시킨다.
func (a *App) UseFavorite(ctx context.Context, id string) error {
	return a.favoriteStore.IncrementUseCount(id)
}
