package main

import (
	"context"
	"embed"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"orcasql/internal/logger"
)

// multiHandler는 여러 slog.Handler 를 하나로 묶는다.
type multiHandler struct {
	handlers []slog.Handler
}

func (m multiHandler) Enabled(ctx context.Context, level slog.Level) bool {
	for _, h := range m.handlers {
		if h.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

func (m multiHandler) Handle(ctx context.Context, r slog.Record) error {
	for _, h := range m.handlers {
		if h.Enabled(ctx, r.Level) {
			_ = h.Handle(ctx, r)
		}
	}
	return nil
}

func (m multiHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	hs := make([]slog.Handler, len(m.handlers))
	for i, h := range m.handlers {
		hs[i] = h.WithAttrs(attrs)
	}
	return multiHandler{handlers: hs}
}

func (m multiHandler) WithGroup(name string) slog.Handler {
	hs := make([]slog.Handler, len(m.handlers))
	for i, h := range m.handlers {
		hs[i] = h.WithGroup(name)
	}
	return multiHandler{handlers: hs}
}

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

// Version 빌드 시 -ldflags로 주입되는 앱 버전 문자열.
// 예: go build -ldflags "-X main.Version=1.0.0"
// GitHub Actions CI에서 Git 태그로 자동 설정됨.
var Version = "0.1.0-dev"

func main() {
	// 기존 핸들러: Debug+ 전체 로그 (Windows: LOCALAPPDATA 파일, 그 외: stdout)
	baseHandler := slog.NewTextHandler(logWriter(), &slog.HandlerOptions{
		Level: slog.LevelDebug,
	})

	// 로테이션 에러 핸들러: ~/.orcasql/log/error.log 에 Error 레벨만 기록
	var errWriter *logger.RotatingWriter
	home, _ := os.UserHomeDir()
	logDir := filepath.Join(home, ".orcasql", "log")
	if rw, err := logger.New(logDir); err == nil {
		errWriter = rw
	}

	var h slog.Handler
	if errWriter != nil {
		defer errWriter.Close()
		errHandler := slog.NewTextHandler(errWriter, &slog.HandlerOptions{
			Level: slog.LevelError,
		})
		h = multiHandler{handlers: []slog.Handler{baseHandler, errHandler}}
	} else {
		h = baseHandler
	}
	// 다중 인스턴스 실행 시 로그에서 어느 인스턴스인지 식별하기 위해 PID를 전역 attr로 추가
	slog.SetDefault(slog.New(h).With("pid", os.Getpid()))

	appInstance := NewApp()
	appInstance.SetVersion(Version)

	app := application.New(application.Options{
		Name:        "OrcaSQL",
		Description: "Native MySQL GUI client for Windows and macOS",
		Icon:        appIcon,
		Services: []application.Service{
			application.NewService(appInstance),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "OrcaSQL",
		Width:     1440,
		Height:    900,
		MinWidth:  900,
		MinHeight: 600,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 36,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHidden,
		},
		BackgroundColour: application.NewRGBA(15, 17, 23, 1),
		URL:              "/",
		DevToolsEnabled:  true,
	})

	if err := app.Run(); err != nil {
		slog.Error("app failed", "error", err)
		os.Exit(1)
	}
}

// logWriter는 플랫폼에 따라 적절한 로그 출력 대상을 반환한다.
// Windows: %LOCALAPPDATA%\OrcaSQL\orcasql.log (콘솔 없는 GUI 앱)
// 그 외:   stdout
func logWriter() io.Writer {
	if runtime.GOOS != "windows" {
		return os.Stdout
	}
	logDir := filepath.Join(os.Getenv("LOCALAPPDATA"), "OrcaSQL")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return io.Discard
	}
	f, err := os.OpenFile(filepath.Join(logDir, "orcasql.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return io.Discard
	}
	return f
}
