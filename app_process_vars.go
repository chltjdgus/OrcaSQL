package main

// ─── Process List + Server Variables / Status ─────────────────────────────
//
// SHOW [FULL] PROCESSLIST 조회 + KILL CONNECTION|QUERY, SHOW [GLOBAL|SESSION] VARIABLES/STATUS.
// UI: ProcessList, ServerVars 컴포넌트.

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// ─── Process List ─────────────────────────────────────────────────────────

// ProcessRow는 SHOW PROCESSLIST 한 행을 나타낸다.
type ProcessRow struct {
	ID      int64  `json:"id"`
	User    string `json:"user"`
	Host    string `json:"host"`
	DB      string `json:"db"`
	Command string `json:"command"`
	Time    int64  `json:"time"`
	State   string `json:"state"`
	Info    string `json:"info"`
}

// GetProcessList SHOW FULL PROCESSLIST를 반환한다.
func (a *App) GetProcessList(ctx context.Context, connID string) ([]ProcessRow, error) {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return nil, fmt.Errorf("get db: %w", err)
	}
	qctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	rows, err := db.QueryContext(qctx, "SHOW FULL PROCESSLIST")
	if err != nil {
		return nil, fmt.Errorf("query processlist: %w", err)
	}
	defer rows.Close()

	var result []ProcessRow
	for rows.Next() {
		var r ProcessRow
		var dbNull, infoNull sql.NullString
		var stateNull sql.NullString
		if err := rows.Scan(&r.ID, &r.User, &r.Host, &dbNull, &r.Command, &r.Time, &stateNull, &infoNull); err != nil {
			continue
		}
		r.DB = dbNull.String
		r.State = stateNull.String
		r.Info = infoNull.String
		result = append(result, r)
	}
	return result, nil
}

// KillProcess KILL [CONNECTION|QUERY] <id>를 실행한다.
func (a *App) KillProcess(ctx context.Context, connID string, processID int64, killQuery bool) error {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return fmt.Errorf("get db: %w", err)
	}
	qctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	verb := "CONNECTION"
	if killQuery {
		verb = "QUERY"
	}
	_, err = db.ExecContext(qctx, fmt.Sprintf("KILL %s %d", verb, processID))
	return err
}

// ─── Server Variables / Status ────────────────────────────────────────────

// VariableRow는 SHOW VARIABLES / SHOW STATUS 한 행.
type VariableRow struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// GetServerVariables SHOW [GLOBAL|SESSION] VARIABLES 반환.
func (a *App) GetServerVariables(ctx context.Context, connID, scope string) ([]VariableRow, error) {
	return a.queryVariables(ctx, connID, "VARIABLES", scope)
}

// GetServerStatus SHOW [GLOBAL|SESSION] STATUS 반환.
func (a *App) GetServerStatus(ctx context.Context, connID, scope string) ([]VariableRow, error) {
	return a.queryVariables(ctx, connID, "STATUS", scope)
}

func (a *App) queryVariables(ctx context.Context, connID, kind, scope string) ([]VariableRow, error) {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return nil, fmt.Errorf("get db: %w", err)
	}
	if scope != "SESSION" {
		scope = "GLOBAL"
	}
	qctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	rows, err := db.QueryContext(qctx, fmt.Sprintf("SHOW %s %s", scope, kind))
	if err != nil {
		return nil, fmt.Errorf("query %s %s: %w", scope, kind, err)
	}
	defer rows.Close()

	var result []VariableRow
	for rows.Next() {
		var r VariableRow
		if err := rows.Scan(&r.Name, &r.Value); err != nil {
			continue
		}
		result = append(result, r)
	}
	return result, nil
}
