package main

// ─── Backup / Schema Sync / Data Sync ──────────────────────────────────────
//
// 데이터 이동 도메인 3종: SQL 덤프 생성, 스키마 diff/적용, 테이블 데이터 비교/동기화.
// DumpDatabase 는 backup:progress Wails 이벤트로 진행률 emit.

import (
	"bytes"
	"context"
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
	"orcasql/internal/backup"
	"orcasql/internal/sync"
)

// ─── Backup / SQL Dump ─────────────────────────────────────────────────────

// DumpDatabase 데이터베이스를 SQL 파일로 덤프하고 내용을 문자열로 반환한다.
// 대용량 DB는 progress 이벤트(backup:progress)를 emit한다.
func (a *App) DumpDatabase(ctx context.Context, opts backup.DumpOptions) (string, error) {
	var buf bytes.Buffer
	err := a.dumper.Dump(ctx, opts, &buf, func(p backup.DumpProgress) {
		application.Get().Event.Emit("backup:progress", p)
	})
	if err != nil {
		return "", fmt.Errorf("dump: %w", err)
	}
	return buf.String(), nil
}

// GetDumpTableList 덤프 대상 테이블 목록을 반환한다.
func (a *App) GetDumpTableList(ctx context.Context, connID, database string) ([]string, error) {
	return a.schemaInsp.ListTableNames(ctx, connID, database)
}

// ─── Schema Synchronization ────────────────────────────────────────────────

// CompareSchemas 두 스키마를 비교해 diff 결과를 반환한다.
func (a *App) CompareSchemas(ctx context.Context, srcConnID, srcDB, dstConnID, dstDB string) (*sync.SchemaSyncResult, error) {
	return a.syncer.CompareSchemas(ctx, srcConnID, srcDB, dstConnID, dstDB)
}

// ApplySyncSQL 동기화 SQL을 대상 연결에 실행한다.
func (a *App) ApplySyncSQL(ctx context.Context, connID, database, sql string) error {
	return a.syncer.ApplySyncSQL(ctx, connID, database, sql)
}

// ─── Data Sync ─────────────────────────────────────────────────────────────

// CompareTableData 소스와 대상 테이블의 데이터를 PK 기준으로 비교한다.
// maxRows가 0이면 5000행으로 제한한다.
func (a *App) CompareTableData(
	ctx context.Context,
	srcConnID, srcDB, srcTable,
	dstConnID, dstDB, dstTable string,
	maxRows int,
) (*sync.DataSyncResult, error) {
	return a.syncer.CompareTableData(ctx, srcConnID, srcDB, srcTable, dstConnID, dstDB, dstTable, maxRows)
}

// SyncTableData 대상 DB에 생성된 동기화 SQL을 실행한다.
func (a *App) SyncTableData(ctx context.Context, dstConnID, dstDB, syncSQL string) error {
	return a.syncer.SyncTableData(ctx, dstConnID, dstDB, syncSQL)
}
