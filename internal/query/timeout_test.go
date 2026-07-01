package query

// timeout_test.go — Executor.Execute() context timeout 동작 검증.
//
// 원리:
//   - openSlowDB(500ms) → 쿼리 응답에 500ms 걸리는 mock DB
//   - context.WithTimeout(ctx, 100ms) → 외부 ctx가 100ms 후 만료
//   - Execute() 내부에서 context.WithTimeout(ctx, e.Timeout()) 호출 시
//     외부 ctx 데드라인(100ms)이 내부 타임아웃(30s)보다 짧으므로 100ms 후 만료
//   - slowConn.QueryContext가 ctx.Done()을 select해 즉시 반환
//   → Execute()는 DeadlineExceeded 에러를 반환해야 한다.

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"orcasql/internal/connection"
	"orcasql/internal/keychain"
)

func newTestManager() *connection.Manager {
	return connection.NewManager(keychain.NewStore())
}

func TestExecuteTimeout_ContextDeadline(t *testing.T) {
	// 500ms 동안 블로킹하는 mock DB
	slowDB, err := openSlowDB(500 * time.Millisecond)
	if err != nil {
		t.Fatalf("openSlowDB: %v", err)
	}
	defer slowDB.Close()

	mgr := newTestManager()
	const connID = "test-timeout-conn"
	mgr.InjectTestDB(connID, slowDB)

	exec := NewExecutor(mgr)
	// 기본 타임아웃(30초)보다 짧은 100ms deadline을 외부 ctx로 설정
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, execErr := exec.Execute(ctx, connID, connID, "", "SELECT 1")
	elapsed := time.Since(start)

	if execErr == nil {
		t.Fatal("timeout이 발생해야 하는데 Execute()가 성공을 반환함")
	}

	isTimeout := errors.Is(execErr, context.DeadlineExceeded) ||
		strings.Contains(execErr.Error(), "deadline exceeded") ||
		errors.Is(execErr, context.Canceled)
	if !isTimeout {
		t.Errorf("timeout 관련 에러를 기대했으나 got: %v", execErr)
	}

	// 500ms 블로킹 DB보다 일찍 반환돼야 한다 (충분한 여유: 400ms 이내)
	if elapsed >= 400*time.Millisecond {
		t.Errorf("너무 오래 걸림 (%v) — timeout이 제대로 작동하지 않은 것 같음", elapsed)
	}
	t.Logf("timeout error (elapsed=%v): %v", elapsed, execErr)
}

// TestExecuteTimeout_SetTimeout SetTimeout(5)으로 타임아웃 설정 후
// 더 긴 블로킹 DB에서 에러가 발생하는지 검증한다.
// CI -short 모드에서는 스킵.
func TestExecuteTimeout_SetTimeout(t *testing.T) {
	if testing.Short() {
		t.Skip("slow test — skipped in -short mode")
	}

	slowDB, err := openSlowDB(7 * time.Second) // 7초 블로킹
	if err != nil {
		t.Fatalf("openSlowDB: %v", err)
	}
	defer slowDB.Close()

	mgr := newTestManager()
	const connID = "test-settimeout-conn"
	mgr.InjectTestDB(connID, slowDB)

	exec := NewExecutor(mgr)
	exec.SetTimeout(5) // 최솟값 5초

	start := time.Now()
	_, execErr := exec.Execute(context.Background(), connID, connID, "", "SELECT 1")
	elapsed := time.Since(start)

	if execErr == nil {
		t.Fatal("timeout이 발생해야 하는데 Execute()가 성공을 반환함")
	}
	// 5초 타임아웃이므로 7초 이전에 반환돼야 한다
	if elapsed >= 7*time.Second {
		t.Errorf("7초 이상 소요 (%v) — SetTimeout(5)이 적용되지 않음", elapsed)
	}
	t.Logf("SetTimeout(5) error (elapsed=%v): %v", elapsed, execErr)
}
