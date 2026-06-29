// Package reset은 사용자 데이터 일괄 삭제(공장 초기화) 기능을 제공한다.
// 도움말 메뉴의 "모든 설정 초기화"와 MSI 사용자 데이터 정리 옵션이 동일한 로직을 공유할 수 있도록
// 키체인 백엔드를 인터페이스로 추상화했다.
package reset

import (
	"errors"
	"fmt"
	"log/slog"
	"os"

	"orcasql/internal/keychain"
)

// Keychain은 reset이 의존하는 키체인 인터페이스다.
// 테스트에서 모킹하기 위해 *keychain.Store 의 부분 집합만 노출한다.
type Keychain interface {
	DeleteCredential(service, user string) error
}

// ResetAllUserData는 모든 사용자 데이터를 best-effort로 삭제한다.
//  1. connIDs 각각에 대해 키체인 3개 서비스(DB/SSH/Proxy) 항목 삭제
//  2. baseDir 디렉토리 통째로 RemoveAll
//
// 부분 실패는 errors.Join 으로 묶여 반환되며 호출자는 사용자에게 안내할 수 있다.
// baseDir 가 ""이면 디렉토리 삭제는 건너뛴다.
func ResetAllUserData(baseDir string, ks Keychain, connIDs []string) error {
	var errs []error

	if ks != nil {
		services := []string{keychain.ServiceDB, keychain.ServiceSSH, keychain.ServiceProxy}
		for _, id := range connIDs {
			if id == "" {
				continue
			}
			for _, svc := range services {
				if err := ks.DeleteCredential(svc, id); err != nil {
					errs = append(errs, fmt.Errorf("keychain %s/%s: %w", svc, id, err))
					slog.Warn("reset: keychain delete failed", "service", svc, "id", id, "error", err)
				}
			}
		}
	}

	if baseDir != "" {
		if err := os.RemoveAll(baseDir); err != nil {
			errs = append(errs, fmt.Errorf("remove %s: %w", baseDir, err))
			slog.Error("reset: RemoveAll failed", "path", baseDir, "error", err)
		}
	}

	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	return nil
}
