package main

// ─── User Manager ─────────────────────────────────────────────────────────
//
// mysql.user 테이블 기반 사용자/권한 관리. UI: UserManager 컴포넌트.

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// UserRow는 MySQL 사용자 한 행.
type UserRow struct {
	User            string `json:"user"`
	Host            string `json:"host"`
	Plugin          string `json:"plugin"`
	PasswordExpired string `json:"passwordExpired"`
	AccountLocked   string `json:"accountLocked"`
}

// ListUsers mysql.user 테이블에서 사용자 목록을 반환한다.
func (a *App) ListUsers(ctx context.Context, connID string) ([]UserRow, error) {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return nil, fmt.Errorf("get db: %w", err)
	}
	qctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	rows, err := db.QueryContext(qctx,
		`SELECT User, Host, plugin,
		        IF(password_expired='Y','Y','N') AS password_expired,
		        IF(account_locked='Y','Y','N') AS account_locked
		 FROM mysql.user
		 ORDER BY User, Host`,
	)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var result []UserRow
	for rows.Next() {
		var r UserRow
		if err := rows.Scan(&r.User, &r.Host, &r.Plugin, &r.PasswordExpired, &r.AccountLocked); err != nil {
			continue
		}
		result = append(result, r)
	}
	return result, nil
}

// CreateUser 새 MySQL 사용자를 생성한다.
func (a *App) CreateUser(ctx context.Context, connID, user, host, password string) error {
	if user == "" || host == "" {
		return fmt.Errorf("user and host are required")
	}
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return fmt.Errorf("get db: %w", err)
	}
	qctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	sql := fmt.Sprintf("CREATE USER '%s'@'%s' IDENTIFIED BY '%s'",
		strings.ReplaceAll(user, "'", "''"),
		strings.ReplaceAll(host, "'", "''"),
		strings.ReplaceAll(password, "'", "''"),
	)
	_, err = db.ExecContext(qctx, sql)
	return err
}

// DropUser MySQL 사용자를 삭제한다.
func (a *App) DropUser(ctx context.Context, connID, user, host string) error {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return fmt.Errorf("get db: %w", err)
	}
	qctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	sql := fmt.Sprintf("DROP USER '%s'@'%s'",
		strings.ReplaceAll(user, "'", "''"),
		strings.ReplaceAll(host, "'", "''"),
	)
	_, err = db.ExecContext(qctx, sql)
	return err
}

// GetUserGrants 특정 사용자의 GRANT 목록을 반환한다.
func (a *App) GetUserGrants(ctx context.Context, connID, user, host string) ([]string, error) {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return nil, fmt.Errorf("get db: %w", err)
	}
	qctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	rows, err := db.QueryContext(qctx,
		fmt.Sprintf("SHOW GRANTS FOR '%s'@'%s'",
			strings.ReplaceAll(user, "'", "''"),
			strings.ReplaceAll(host, "'", "''"),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("show grants: %w", err)
	}
	defer rows.Close()

	var grants []string
	for rows.Next() {
		var g string
		if err := rows.Scan(&g); err != nil {
			continue
		}
		grants = append(grants, g)
	}
	return grants, nil
}

// GrantPrivileges 사용자에게 권한을 부여한다.
func (a *App) GrantPrivileges(ctx context.Context, connID, privileges, onClause, user, host string) error {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return fmt.Errorf("get db: %w", err)
	}
	qctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	sql := fmt.Sprintf("GRANT %s ON %s TO '%s'@'%s'",
		privileges, onClause,
		strings.ReplaceAll(user, "'", "''"),
		strings.ReplaceAll(host, "'", "''"),
	)
	if _, err := db.ExecContext(qctx, sql); err != nil {
		return err
	}
	_, err = db.ExecContext(qctx, "FLUSH PRIVILEGES")
	return err
}

// RevokePrivileges 사용자의 권한을 회수한다.
func (a *App) RevokePrivileges(ctx context.Context, connID, privileges, onClause, user, host string) error {
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return fmt.Errorf("get db: %w", err)
	}
	qctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	sql := fmt.Sprintf("REVOKE %s ON %s FROM '%s'@'%s'",
		privileges, onClause,
		strings.ReplaceAll(user, "'", "''"),
		strings.ReplaceAll(host, "'", "''"),
	)
	if _, err := db.ExecContext(qctx, sql); err != nil {
		return err
	}
	_, err = db.ExecContext(qctx, "FLUSH PRIVILEGES")
	return err
}

// ChangeUserPassword 기존 사용자의 비밀번호를 변경한다.
func (a *App) ChangeUserPassword(ctx context.Context, connID, user, host, newPassword string) error {
	if user == "" || host == "" {
		return fmt.Errorf("user and host are required")
	}
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return fmt.Errorf("get db: %w", err)
	}
	qctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	sqlStr := fmt.Sprintf("ALTER USER '%s'@'%s' IDENTIFIED BY '%s'",
		strings.ReplaceAll(user, "'", "''"),
		strings.ReplaceAll(host, "'", "''"),
		strings.ReplaceAll(newPassword, "'", "''"),
	)
	if _, err := db.ExecContext(qctx, sqlStr); err != nil {
		return fmt.Errorf("change password: %w", err)
	}
	_, err = db.ExecContext(qctx, "FLUSH PRIVILEGES")
	return err
}

// SetAccountLock 계정 잠금 상태를 변경한다.
func (a *App) SetAccountLock(ctx context.Context, connID, user, host string, lock bool) error {
	if user == "" || host == "" {
		return fmt.Errorf("user and host are required")
	}
	db, err := a.connManager.GetDB(connID)
	if err != nil {
		return fmt.Errorf("get db: %w", err)
	}
	qctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	lockStr := "ACCOUNT UNLOCK"
	if lock {
		lockStr = "ACCOUNT LOCK"
	}
	sqlStr := fmt.Sprintf("ALTER USER '%s'@'%s' %s",
		strings.ReplaceAll(user, "'", "''"),
		strings.ReplaceAll(host, "'", "''"),
		lockStr,
	)
	if _, err := db.ExecContext(qctx, sqlStr); err != nil {
		return fmt.Errorf("set account lock: %w", err)
	}
	_, err = db.ExecContext(qctx, "FLUSH PRIVILEGES")
	return err
}
