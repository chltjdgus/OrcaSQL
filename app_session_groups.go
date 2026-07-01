package main

// ─── 세션 그룹 CRUD ────────────────────────────────────────────────────────
//
// 저장된 연결의 폴더 그룹화 (최대 2단계 중첩). connections.json 의 Groups 배열에 영속화.
// modifyAppConfig 로 exclusive lock 안에서 read-modify-write.

import (
	"context"

	"github.com/google/uuid"
	"orcasql/internal/connection"
	"orcasql/internal/keychain"
)

// GetSessionGroups 저장된 세션 그룹 목록을 반환한다.
func (a *App) GetSessionGroups(ctx context.Context) ([]connection.SessionGroup, error) {
	cfg, err := a.loadAppConfig()
	if err != nil {
		return []connection.SessionGroup{}, nil
	}
	if cfg.Groups == nil {
		return []connection.SessionGroup{}, nil
	}
	return cfg.Groups, nil
}

// SaveSessionGroup 그룹을 생성 또는 수정한다.
func (a *App) SaveSessionGroup(ctx context.Context, grp connection.SessionGroup) error {
	if grp.ID == "" {
		grp.ID = uuid.New().String()
	}
	return a.modifyAppConfig(func(cfg *appConfig) error {
		found := false
		for i, g := range cfg.Groups {
			if g.ID == grp.ID {
				cfg.Groups[i] = grp
				found = true
				break
			}
		}
		if !found {
			cfg.Groups = append(cfg.Groups, grp)
		}
		return nil
	})
}

// DeleteSessionGroup 그룹을 삭제한다. cascade=true이면 하위 세션도 함께 삭제한다.
func (a *App) DeleteSessionGroup(ctx context.Context, groupID string, cascade bool) error {
	return a.modifyAppConfig(func(cfg *appConfig) error {
		// 하위 그룹 ID 수집 (2단계 제한이므로 직접 자식만 확인)
		childGroupIDs := map[string]bool{groupID: true}
		for _, g := range cfg.Groups {
			if g.ParentID == groupID {
				childGroupIDs[g.ID] = true
			}
		}
		// 그룹 삭제
		groups := cfg.Groups[:0]
		for _, g := range cfg.Groups {
			if !childGroupIDs[g.ID] {
				groups = append(groups, g)
			}
		}
		cfg.Groups = groups
		if cascade {
			// 소속 세션 삭제 (키체인 포함 — MySQL / SSH / Proxy 모두)
			conns := cfg.Connections[:0]
			for _, c := range cfg.Connections {
				if childGroupIDs[c.GroupID] {
					_ = a.keychainSvc.DeleteCredential(keychain.ServiceDB, c.ID)
					_ = a.keychainSvc.DeleteCredential(keychain.ServiceSSH, c.ID)
					_ = a.keychainSvc.DeleteCredential(keychain.ServiceProxy, c.ID)
				} else {
					conns = append(conns, c)
				}
			}
			cfg.Connections = conns
		} else {
			// 세션을 루트로 이동
			for i := range cfg.Connections {
				if childGroupIDs[cfg.Connections[i].GroupID] {
					cfg.Connections[i].GroupID = ""
				}
			}
		}
		return nil
	})
}

// ReorderGroups 그룹 전체 목록을 덮어쓰기하여 순서/부모 관계를 일괄 반영한다.
func (a *App) ReorderGroups(ctx context.Context, groups []connection.SessionGroup) error {
	return a.modifyAppConfig(func(cfg *appConfig) error {
		cfg.Groups = groups
		return nil
	})
}
