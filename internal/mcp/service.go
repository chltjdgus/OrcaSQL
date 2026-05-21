package mcp

import (
	"context"

	"orcasql/internal/connection"
	"orcasql/internal/history"
	"orcasql/internal/query"
	"orcasql/internal/schema"
)

// Deps MCP 서버가 의존하는 외부 컴포넌트 모음.
// App 측에서 NewServer 호출 시 주입한다.
//
// 모든 필드 필수. nil 이면 NewServer 에서 즉시 에러.
type Deps struct {
	ConnManager   *connection.Manager
	QueryExecutor *query.Executor
	SchemaInsp    *schema.Inspector
	HistoryStore  *history.Store

	// LoadSavedConnections 저장된 연결 목록(평문 비밀번호 제외)을 반환한다.
	// App.GetSavedConnections 와 동일 동작 — 패키지 경계를 깨지 않기 위해 closure 로 주입.
	LoadSavedConnections func(ctx context.Context) ([]connection.ConnectConfig, error)
}

// validate 의존성이 모두 주입됐는지 검사한다.
func (d Deps) validate() error {
	if d.ConnManager == nil {
		return errMissingDep("ConnManager")
	}
	if d.QueryExecutor == nil {
		return errMissingDep("QueryExecutor")
	}
	if d.SchemaInsp == nil {
		return errMissingDep("SchemaInsp")
	}
	if d.HistoryStore == nil {
		return errMissingDep("HistoryStore")
	}
	if d.LoadSavedConnections == nil {
		return errMissingDep("LoadSavedConnections")
	}
	return nil
}

type missingDepError struct{ name string }

func (e *missingDepError) Error() string { return "mcp: missing dependency: " + e.name }

func errMissingDep(name string) error { return &missingDepError{name: name} }
