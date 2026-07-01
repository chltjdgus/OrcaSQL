// Package logger provides a date-rotating file writer for error logs.
// Current day's log: ~/.orcasql/log/error.log
// Previous days:     ~/.orcasql/log/error_YYYYMMDD.log
package logger

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// RotatingWriter는 날짜가 바뀌면 자동으로 파일을 교체하는 io.Writer다.
// 당일 로그는 error.log, 지난 날짜 로그는 error_YYYYMMDD.log 로 보관된다.
type RotatingWriter struct {
	dir         string
	file        *os.File
	currentDate string // "20060102" 포맷
	mu          sync.Mutex
}

// New는 dir 디렉토리에 RotatingWriter를 생성한다.
// 디렉토리가 없으면 자동 생성하며, 기존 error.log 가 오늘 날짜가 아니면
// 즉시 로테이션한 뒤 새 파일을 연다.
func New(dir string) (*RotatingWriter, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("logger: mkdir %s: %w", dir, err)
	}
	w := &RotatingWriter{dir: dir}
	if err := w.open(); err != nil {
		return nil, err
	}
	return w, nil
}

// Write implements io.Writer. 날짜가 바뀐 경우 로테이션 후 기록한다.
func (w *RotatingWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	today := time.Now().Format("20060102")
	if today != w.currentDate {
		if err := w.rotate(today); err != nil {
			// 로테이션 실패 시 기존 파일에 계속 기록 (로그 유실 최소화)
			if w.file != nil {
				return w.file.Write(p)
			}
			return 0, err
		}
	}
	return w.file.Write(p)
}

// Close는 현재 로그 파일을 닫는다.
func (w *RotatingWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file != nil {
		return w.file.Close()
	}
	return nil
}

// open은 error.log 를 열거나, 날짜가 다르면 먼저 로테이션한다.
func (w *RotatingWriter) open() error {
	logPath := filepath.Join(w.dir, "error.log")
	today := time.Now().Format("20060102")

	// 기존 error.log 가 오늘 날짜가 아니면 즉시 아카이브
	if info, err := os.Stat(logPath); err == nil {
		fileDate := info.ModTime().Format("20060102")
		if fileDate != today {
			archived := filepath.Join(w.dir, "error_"+fileDate+".log")
			_ = os.Rename(logPath, archived) // 실패해도 계속 진행
		}
	}

	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("logger: open %s: %w", logPath, err)
	}
	w.file = f
	w.currentDate = today
	return nil
}

// rotate는 현재 error.log → error_YYYYMMDD.log 로 이름 변경 후 새 파일을 연다.
func (w *RotatingWriter) rotate(newDate string) error {
	if w.file != nil {
		_ = w.file.Close()
		w.file = nil
	}

	logPath := filepath.Join(w.dir, "error.log")
	archived := filepath.Join(w.dir, "error_"+w.currentDate+".log")
	_ = os.Rename(logPath, archived) // 실패해도 새 파일 생성 시도

	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("logger: rotate open %s: %w", logPath, err)
	}
	w.file = f
	w.currentDate = newDate
	return nil
}
