package main

// ─── Connection Import / Export ────────────────────────────────────────────
//
// 저장된 연결/그룹을 JSON 으로 내보내고/가져오기. v2 포맷(그룹 포함) + v1 폴백(flat array).
// 비밀번호는 항상 빈 값으로 export (키체인은 별도 처리 대상).

import (
	"context"
	"encoding/json"
	"fmt"

	"orcasql/internal/connection"
)

// exportPayload 내보내기/가져오기 JSON 포맷 (v2: 그룹 포함).
type exportPayload struct {
	Version     int                        `json:"version"`
	Connections []connection.ConnectConfig `json:"connections"`
	Groups      []connection.SessionGroup  `json:"groups,omitempty"`
}

// ExportConnections 저장된 연결 설정을 JSON 문자열로 내보낸다 (비밀번호 제외, 그룹 포함).
func (a *App) ExportConnections(ctx context.Context) (string, error) {
	cfg, err := a.loadAppConfig()
	if err != nil {
		return "", err
	}
	// 비밀번호 필드 제거
	for i := range cfg.Connections {
		cfg.Connections[i].Password = ""
	}
	payload := exportPayload{
		Version:     2,
		Connections: cfg.Connections,
		Groups:      cfg.Groups,
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal connections: %w", err)
	}
	return string(data), nil
}

// ImportConnections JSON 문자열에서 연결 설정을 가져온다.
// v2 포맷(그룹 포함)과 v1 포맷(flat array) 모두 지원.
// 기존 연결/그룹과 중복된 ID는 덮어쓴다.
func (a *App) ImportConnections(ctx context.Context, jsonStr string) (int, error) {
	// v2 포맷 시도 (object with version key)
	var payload exportPayload
	if err := json.Unmarshal([]byte(jsonStr), &payload); err == nil && payload.Version >= 2 {
		return a.mergeImport(payload.Connections, payload.Groups)
	}
	// v1 폴백 (flat array)
	var imported []connection.ConnectConfig
	if err := json.Unmarshal([]byte(jsonStr), &imported); err != nil {
		return 0, fmt.Errorf("parse import: %w", err)
	}
	return a.mergeImport(imported, nil)
}

// mergeImport 연결/그룹을 기존 설정에 병합한다.
func (a *App) mergeImport(conns []connection.ConnectConfig, groups []connection.SessionGroup) (int, error) {
	cfg, err := a.loadAppConfig()
	if err != nil {
		cfg = appConfig{Version: 2}
	}

	// 연결 병합
	existingMap := make(map[string]int, len(cfg.Connections))
	for i, c := range cfg.Connections {
		existingMap[c.ID] = i
	}
	added := 0
	for _, imp := range conns {
		imp.Password = "" // 비밀번호 평문 저장 금지
		if i, exists := existingMap[imp.ID]; exists {
			cfg.Connections[i] = imp
		} else {
			cfg.Connections = append(cfg.Connections, imp)
			added++
		}
	}

	// 그룹 병합
	if len(groups) > 0 {
		existingGroups := make(map[string]int, len(cfg.Groups))
		for i, g := range cfg.Groups {
			existingGroups[g.ID] = i
		}
		for _, grp := range groups {
			if i, exists := existingGroups[grp.ID]; exists {
				cfg.Groups[i] = grp
			} else {
				cfg.Groups = append(cfg.Groups, grp)
			}
		}
	}

	if err := a.saveAppConfig(cfg); err != nil {
		return 0, err
	}
	return added, nil
}
