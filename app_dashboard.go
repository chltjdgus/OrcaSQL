package main

// ─── Database Overview Dashboard (Phase 65) ────────────────────────────────
//
// 선택한 데이터베이스의 요약(읽기 전용). information_schema.TABLES 단일 조회 후
// Go 에서 엔진 분포·합계를 집계한다. UI: DatabaseOverview 컴포넌트.

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"time"
)

// TableOverviewRow는 개요 대시보드의 테이블 한 행.
type TableOverviewRow struct {
	Name        string `json:"name"`
	Type        string `json:"type"` // "BASE TABLE" | "VIEW"
	Engine      string `json:"engine"`
	Rows        int64  `json:"rows"` // information_schema 근사값
	DataLength  int64  `json:"dataLength"`
	IndexLength int64  `json:"indexLength"`
	TotalLength int64  `json:"totalLength"`
	DataFree    int64  `json:"dataFree"`
	Collation   string `json:"collation"`
}

// EngineStat는 엔진별 집계.
type EngineStat struct {
	Engine string `json:"engine"`
	Tables int64  `json:"tables"`
	Size   int64  `json:"size"`
}

// DatabaseOverview는 GetDatabaseOverview 반환 페이로드.
type DatabaseOverview struct {
	Database   string             `json:"database"`
	TableCount int64              `json:"tableCount"`
	ViewCount  int64              `json:"viewCount"`
	TotalRows  int64              `json:"totalRows"`
	TotalSize  int64              `json:"totalSize"`
	DataSize   int64              `json:"dataSize"`
	IndexSize  int64              `json:"indexSize"`
	DataFree   int64              `json:"dataFree"`
	Engines    []EngineStat       `json:"engines"`
	Tables     []TableOverviewRow `json:"tables"`
}

// GetDatabaseOverview는 선택 DB 의 요약을 반환한다.
func (a *App) GetDatabaseOverview(ctx context.Context, connID, database string) (*DatabaseOverview, error) {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return nil, fmt.Errorf("get db: %w", err)
	}
	qctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	const q = `SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS,
	                  DATA_LENGTH, INDEX_LENGTH, DATA_FREE, TABLE_COLLATION
	           FROM information_schema.TABLES
	           WHERE TABLE_SCHEMA = ?
	           ORDER BY (COALESCE(DATA_LENGTH,0) + COALESCE(INDEX_LENGTH,0)) DESC`
	rows, err := db.QueryContext(qctx, q, database)
	if err != nil {
		return nil, fmt.Errorf("query tables overview: %w", err)
	}
	defer rows.Close()

	overview := &DatabaseOverview{Database: database, Tables: []TableOverviewRow{}, Engines: []EngineStat{}}
	engineMap := map[string]*EngineStat{}

	for rows.Next() {
		var (
			name      string
			tableType string
			engine    sql.NullString
			tblRows   sql.NullInt64
			dataLen   sql.NullInt64
			idxLen    sql.NullInt64
			dataFree  sql.NullInt64
			collation sql.NullString
		)
		if err := rows.Scan(&name, &tableType, &engine, &tblRows, &dataLen, &idxLen, &dataFree, &collation); err != nil {
			continue
		}
		row := TableOverviewRow{
			Name:        name,
			Type:        tableType,
			Engine:      engine.String,
			Rows:        tblRows.Int64,
			DataLength:  dataLen.Int64,
			IndexLength: idxLen.Int64,
			TotalLength: dataLen.Int64 + idxLen.Int64,
			DataFree:    dataFree.Int64,
			Collation:   collation.String,
		}
		overview.Tables = append(overview.Tables, row)

		if tableType == "VIEW" {
			overview.ViewCount++
			continue // 뷰는 크기·행수·엔진 집계 제외 (NULL)
		}
		overview.TableCount++
		overview.TotalRows += row.Rows
		overview.DataSize += row.DataLength
		overview.IndexSize += row.IndexLength
		overview.DataFree += row.DataFree

		if engine.Valid && engine.String != "" {
			st := engineMap[engine.String]
			if st == nil {
				st = &EngineStat{Engine: engine.String}
				engineMap[engine.String] = st
			}
			st.Tables++
			st.Size += row.TotalLength
		}
	}
	overview.TotalSize = overview.DataSize + overview.IndexSize

	for _, st := range engineMap {
		overview.Engines = append(overview.Engines, *st)
	}
	sort.Slice(overview.Engines, func(i, j int) bool {
		return overview.Engines[i].Size > overview.Engines[j].Size
	})

	return overview, nil
}
