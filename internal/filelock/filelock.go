// Package filelock은 프로세스 간 파일 동기화를 위한 유틸리티를 제공한다.
//
// 다중 인스턴스 실행 시 ~/.orcasql/ 하위의 JSON 파일에 대해
// 원자적 쓰기(tmp → fsync → rename)와 프로세스 간 exclusive lock을 제공한다.
package filelock

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/gofrs/flock"
)

// ErrLockTimeout은 지정한 시간 안에 파일 락을 획득하지 못했을 때 반환된다.
var ErrLockTimeout = errors.New("filelock: timeout waiting for exclusive lock")

// DefaultTimeout은 WithExclusiveLock의 기본 타임아웃이다.
const DefaultTimeout = 5 * time.Second

// WithExclusiveLock은 lockPath 파일에 exclusive lock을 잡고 fn을 실행한 뒤 해제한다.
// timeout 내에 락을 획득하지 못하면 ErrLockTimeout을 반환한다.
// 락 파일이 없으면 자동으로 생성한다.
func WithExclusiveLock(lockPath string, timeout time.Duration, fn func() error) error {
	fl := flock.New(lockPath)

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	locked, err := fl.TryLockContext(ctx, 20*time.Millisecond)
	if err != nil {
		return fmt.Errorf("filelock acquire [%s]: %w", lockPath, err)
	}
	if !locked {
		return ErrLockTimeout
	}
	defer fl.Unlock() //nolint:errcheck

	return fn()
}

// AtomicWriteFile은 data를 tmpPath에 쓰고 fsync 후 destPath로 rename한다.
//
// 중간에 크래시해도 destPath는 이전 값이 그대로 남거나 새 값으로 교체된다.
// 부분 쓰기가 destPath에 남지 않는다.
func AtomicWriteFile(destPath, tmpPath string, data []byte, perm os.FileMode) error {
	f, err := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, perm)
	if err != nil {
		return fmt.Errorf("create tmp [%s]: %w", tmpPath, err)
	}

	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("write tmp [%s]: %w", tmpPath, err)
	}

	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("fsync tmp [%s]: %w", tmpPath, err)
	}

	if err := f.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("close tmp [%s]: %w", tmpPath, err)
	}

	if err := os.Rename(tmpPath, destPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("rename tmp→dest [%s]: %w", destPath, err)
	}

	return nil
}
