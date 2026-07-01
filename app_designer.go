package main

// ─── Table Designer ────────────────────────────────────────────────────────
//
// HeidiSQL 스타일 테이블 디자이너 (Phase 16). 컬럼/인덱스/FK/옵션 편집을 위한
// 메타 조회 + diff 기반 ALTER TABLE / CREATE TABLE SQL 생성 + 실행.

import (
	"context"

	"orcasql/internal/schema"
)

// GetTableDefinition 테이블 전체 구조 (컬럼+인덱스+FK)를 반환한다.
func (a *App) GetTableDefinition(ctx context.Context, connID, database, table string) (*schema.TableDefinition, error) {
	return a.designer.GetTableDefinition(ctx, connID, database, table)
}

// GenerateAlterSQL old → new 기준으로 ALTER TABLE SQL을 생성한다 (미리보기용).
func (a *App) GenerateAlterSQL(ctx context.Context, database, table string, old, new *schema.TableDefinition) (*schema.AlterStatement, error) {
	return a.designer.GenerateAlterSQL(database, table, old, new)
}

// GenerateCreateSQL 신규 테이블 디자이너 모드에서 def → CREATE TABLE SQL 을 생성한다.
func (a *App) GenerateCreateSQL(ctx context.Context, database string, def *schema.TableDefinition) (*schema.AlterStatement, error) {
	return a.designer.GenerateCreateSQL(database, def)
}

// ExecuteAlterTable ALTER TABLE SQL을 실행한다.
func (a *App) ExecuteAlterTable(ctx context.Context, connID, sql string) error {
	return a.designer.ExecuteAlterTable(ctx, connID, sql)
}

// GetTableMeta Phase 16 디자이너 전용 — 상단 탭/하단 그리드에 필요한 모든 메타를 한 번에 조회한다.
func (a *App) GetTableMeta(ctx context.Context, connID, database, table string) (*schema.TableMeta, error) {
	return a.designer.GetTableMeta(ctx, connID, database, table)
}

// BuildTableAlter Phase 16 디자이너 전용 — TableMeta 변경 diff를 ALTER SQL로 생성한다.
func (a *App) BuildTableAlter(ctx context.Context, database, table string, old, newMeta *schema.TableMeta) (*schema.AlterStatement, error) {
	return a.designer.BuildAlterFromMeta(database, table, old, newMeta)
}
