package main

// app_mcp_test.go — MCP 도메인의 모킹 없이 가능한 분기 단위 테스트.
//
// 커버:
//   1. isMCPBenignStartError (app.go의 부팅 시 에러 분류 헬퍼)
//   2. MCP 메서드들의 nil-guard 분기 (mcpServer/mcpConfigStore == nil)
//   3. CheckMCPPortAvailable 의 port 범위 검증 (1024-65535)
//
// mcpServer/mcpConfigStore 의 동작 분기는 internal/mcp 자체 테스트로 검증 — 본 파일은
// App 레이어의 가드 코드만 가드.

import (
	"context"
	"errors"
	"fmt"
	"testing"

	mcppkg "orcasql/internal/mcp"
)

// TestIsMCPBenignStartError 부팅 시 OnStartup 이 mcp.Start() 의 에러를 받았을 때
// "정상 흐름의 일부" 인 두 에러를 식별하는 가드. ErrDisabled / ErrAlreadyRunning 만 true.
// errors.Is 를 사용하므로 wrap 된 에러도 정확히 인식해야 한다.
func TestIsMCPBenignStartError(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil is not benign", nil, false},
		{"ErrDisabled direct", mcppkg.ErrDisabled, true},
		{"ErrAlreadyRunning direct", mcppkg.ErrAlreadyRunning, true},
		{"ErrDisabled wrapped", fmt.Errorf("init: %w", mcppkg.ErrDisabled), true},
		{"ErrAlreadyRunning wrapped", fmt.Errorf("start: %w", mcppkg.ErrAlreadyRunning), true},
		{"unrelated error", errors.New("connection refused"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := isMCPBenignStartError(tc.err)
			if got != tc.want {
				t.Fatalf("isMCPBenignStartError(%v) = %v; want %v", tc.err, got, tc.want)
			}
		})
	}
}

// TestMCPNilGuards mcpServer 또는 mcpConfigStore 가 nil 인 App 인스턴스에서
// 각 MCP 메서드의 nil-가드 분기가 의도대로 동작하는지 확인한다.
//
// 이 가드는 NewApp 의 mcp 초기화 실패 시 (예: 키체인 접근 실패) 다른 도메인이
// 동작 가능하도록 만든 안전망 — 회귀 시 nil dereference panic 으로 앱 크래시.
func TestMCPNilGuards(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	emptyApp := &App{} // mcpServer / mcpConfigStore 모두 nil

	t.Run("GetMCPConfig returns DefaultConfig", func(t *testing.T) {
		cfg, err := emptyApp.GetMCPConfig(ctx)
		if err != nil {
			t.Fatalf("err = %v; want nil (graceful default)", err)
		}
		def := mcppkg.DefaultConfig()
		if cfg.Port != def.Port {
			t.Fatalf("cfg.Port = %d; want default %d", cfg.Port, def.Port)
		}
	})

	t.Run("UpdateMCPConfig returns error", func(t *testing.T) {
		err := emptyApp.UpdateMCPConfig(ctx, mcppkg.Config{})
		if err == nil {
			t.Fatalf("err = nil; want error")
		}
	})

	t.Run("StartMCPServer returns error", func(t *testing.T) {
		err := emptyApp.StartMCPServer(ctx)
		if err == nil {
			t.Fatalf("err = nil; want error")
		}
	})

	t.Run("StopMCPServer returns nil (no-op)", func(t *testing.T) {
		// Stop 은 idempotent — 서버가 없으면 그냥 nil 반환 (이미 정지 상태)
		if err := emptyApp.StopMCPServer(ctx); err != nil {
			t.Fatalf("err = %v; want nil", err)
		}
	})

	t.Run("GetMCPStatus returns empty Status", func(t *testing.T) {
		st := emptyApp.GetMCPStatus(ctx)
		if st.Running {
			t.Fatalf("st.Running = true; want false")
		}
	})

	t.Run("RegenerateMCPToken returns error", func(t *testing.T) {
		_, err := emptyApp.RegenerateMCPToken(ctx)
		if err == nil {
			t.Fatalf("err = nil; want error")
		}
	})

	t.Run("RevealMCPToken returns error", func(t *testing.T) {
		_, err := emptyApp.RevealMCPToken(ctx)
		if err == nil {
			t.Fatalf("err = nil; want error")
		}
	})

	t.Run("GetMCPClientConfigSnippet returns error", func(t *testing.T) {
		_, err := emptyApp.GetMCPClientConfigSnippet(ctx, "claude-code")
		if err == nil {
			t.Fatalf("err = nil; want error")
		}
	})

	t.Run("TestMCPConnection returns error", func(t *testing.T) {
		_, err := emptyApp.TestMCPConnection(ctx)
		if err == nil {
			t.Fatalf("err = nil; want error")
		}
	})

	t.Run("GetMCPAIPromptSnippet returns error", func(t *testing.T) {
		_, err := emptyApp.GetMCPAIPromptSnippet(ctx)
		if err == nil {
			t.Fatalf("err = nil; want error")
		}
	})
}

// TestCheckMCPPortAvailable_RangeValidation MCP 서버가 listen 가능한 포트 범위 (1024-65535)
// 가드. mcpServer/mcpConfigStore 의존 없음 — 순수 net.Listen 시도.
//
// 가운데 포트(예: 8080) 실제 listen 시도는 환경에 따라 점유 여부가 달라질 수 있어
// 본 테스트는 **range validation** 만 검증 (true/false 자체는 검증하지 않음).
func TestCheckMCPPortAvailable_RangeValidation(t *testing.T) {
	t.Parallel()
	a := &App{}
	ctx := context.Background()

	t.Run("port below 1024 returns error", func(t *testing.T) {
		_, err := a.CheckMCPPortAvailable(ctx, 1023)
		if err == nil {
			t.Fatalf("port=1023: err = nil; want error")
		}
	})

	t.Run("port above 65535 returns error", func(t *testing.T) {
		_, err := a.CheckMCPPortAvailable(ctx, 65536)
		if err == nil {
			t.Fatalf("port=65536: err = nil; want error")
		}
	})

	// 유효 범위 가장자리는 에러 없음 (실제 listen 결과 true/false 는 환경 의존이라 무시)
	t.Run("port 1024 is within range", func(t *testing.T) {
		_, err := a.CheckMCPPortAvailable(ctx, 1024)
		if err != nil {
			t.Fatalf("port=1024: err = %v; want nil (in range)", err)
		}
	})

	t.Run("port 65535 is within range", func(t *testing.T) {
		_, err := a.CheckMCPPortAvailable(ctx, 65535)
		if err != nil {
			t.Fatalf("port=65535: err = %v; want nil (in range)", err)
		}
	})
}
