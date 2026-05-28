package main

// ─── 스키마 조회 + Query Profiler + Stored Objects ──────────────────────────
//
// 읽기 전용 스키마 메타데이터: 데이터베이스/테이블/컬럼/인덱스/FK 목록,
// EXPLAIN/SHOW PROFILE, 저장 객체(Procedure/Function/Trigger/Event) 조회.

import (
	"context"
	"fmt"

	"orcasql/internal/connection"
	"orcasql/internal/schema"
)

// ─── 스키마 조회 ───────────────────────────────────────────────────────────

// ListDatabases 데이터베이스 목록을 반환한다.
func (a *App) ListDatabases(ctx context.Context, connID string) ([]string, error) {
	return a.schemaInsp.ListDatabases(ctx, connID)
}

// ListDatabasesFromConfig 연결 설정으로 임시 연결 후 DB 목록을 반환한다.
// 연결 편집 모달에서 테스트 성공 후 DB 목록을 가져올 때 사용한다.
func (a *App) ListDatabasesFromConfig(ctx context.Context, cfg connection.ConnectConfig) ([]string, error) {
	// database 필드를 비워서 연결 (특정 DB 없이 연결)
	tmpCfg := cfg
	tmpCfg.Database = ""
	tmpID, err := a.connManager.Connect(ctx, tmpCfg)
	if err != nil {
		return nil, fmt.Errorf("connect for db list: %w", err)
	}
	defer func() { _ = a.connManager.Disconnect(tmpID) }()

	return a.schemaInsp.ListDatabases(ctx, tmpID)
}

// ListTables 테이블/뷰 목록을 반환한다.
func (a *App) ListTables(ctx context.Context, connID, database string) ([]schema.TableInfo, error) {
	return a.schemaInsp.ListTables(ctx, connID, database)
}

// ListColumns 컬럼 목록을 반환한다.
func (a *App) ListColumns(ctx context.Context, connID, database, table string) ([]schema.ColumnInfo, error) {
	return a.schemaInsp.ListColumns(ctx, connID, database, table)
}

// ListIndexes 인덱스 목록을 반환한다.
func (a *App) ListIndexes(ctx context.Context, connID, database, table string) ([]schema.IndexInfo, error) {
	return a.schemaInsp.ListIndexes(ctx, connID, database, table)
}

// GetTableDDL CREATE TABLE DDL을 반환한다.
func (a *App) GetTableDDL(ctx context.Context, connID, database, table string) (string, error) {
	return a.schemaInsp.GetTableDDL(ctx, connID, database, table)
}

// GetForeignKeys 지정 데이터베이스의 모든 FK를 information_schema에서 조회한다.
// ER 다이어그램 FK 엣지 생성에 사용한다.
func (a *App) GetForeignKeys(ctx context.Context, connID, database string) ([]schema.FKInfo, error) {
	return a.schemaInsp.GetForeignKeys(ctx, connID, database)
}

// ─── Query Profiler ────────────────────────────────────────────────────────

// GetExplain EXPLAIN 결과를 반환한다.
func (a *App) GetExplain(ctx context.Context, connID, sql string) ([]schema.ExplainRow, error) {
	return a.profiler.GetExplain(ctx, connID, sql)
}

// GetProfile SHOW PROFILE 결과를 반환한다.
func (a *App) GetProfile(ctx context.Context, connID string) ([]schema.ProfileRow, error) {
	return a.profiler.GetProfile(ctx, connID)
}

// GetExplainJSON EXPLAIN FORMAT=JSON 결과를 원시 JSON 문자열로 반환한다.
// 트리/그래프 시각화 목적으로 사용한다.
func (a *App) GetExplainJSON(ctx context.Context, connID, sql string) (string, error) {
	return a.profiler.GetExplainJSON(ctx, connID, sql)
}

// ─── Stored Objects ────────────────────────────────────────────────────────

// ListProcedures 저장 프로시저 목록을 반환한다.
func (a *App) ListProcedures(ctx context.Context, connID, database string) ([]schema.ObjectInfo, error) {
	return a.schemaInsp.ListObjects(ctx, connID, database, "PROCEDURE")
}

// ListFunctions 함수 목록을 반환한다.
func (a *App) ListFunctions(ctx context.Context, connID, database string) ([]schema.ObjectInfo, error) {
	return a.schemaInsp.ListObjects(ctx, connID, database, "FUNCTION")
}

// ListTriggers 트리거 목록을 반환한다.
func (a *App) ListTriggers(ctx context.Context, connID, database, table string) ([]schema.ObjectInfo, error) {
	return a.schemaInsp.ListTriggers(ctx, connID, database, table)
}

// ListEvents 이벤트 목록을 반환한다.
func (a *App) ListEvents(ctx context.Context, connID, database string) ([]schema.ObjectInfo, error) {
	return a.schemaInsp.ListObjects(ctx, connID, database, "EVENT")
}

// GetObjectDDL SP/Function/Trigger/Event 의 DDL을 반환한다.
func (a *App) GetObjectDDL(ctx context.Context, connID, database, objType, name string) (string, error) {
	return a.schemaInsp.GetObjectDDL(ctx, connID, database, objType, name)
}
