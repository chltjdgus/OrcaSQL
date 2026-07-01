// Package keychain은 OS 네이티브 키체인을 이용한 자격증명 저장소다.
// 비밀번호/자격증명을 로컬 파일에 평문 저장하는 것을 방지한다.
package keychain

import (
	"fmt"

	gokeyring "github.com/zalando/go-keyring"
)

// 자격증명 네임스페이스 상수.
// 모든 호출부는 리터럴 대신 이 상수를 사용해 typo 와 누락을 방지한다.
const (
	ServiceDB    = "orcasql"       // MySQL 연결 비밀번호
	ServiceSSH   = "orcasql-ssh"   // SSH 터널 비밀번호
	ServiceProxy = "orcasql-proxy" // SOCKS5/HTTP 프록시 비밀번호
)

// Store OS 키체인 래퍼.
type Store struct{}

// NewStore Store 인스턴스를 생성한다.
func NewStore() *Store {
	return &Store{}
}

// SaveCredential 자격증명을 OS 키체인에 저장한다.
// service: 앱 식별자 (예: "orcasql")
// user: 연결 ID (키체인 계정 구분자)
// password: 저장할 비밀번호
func (s *Store) SaveCredential(service, user, password string) error {
	if err := gokeyring.Set(service, user, password); err != nil {
		return fmt.Errorf("keychain set [%s/%s]: %w", service, user, err)
	}
	return nil
}

// GetCredential OS 키체인에서 자격증명을 조회한다.
func (s *Store) GetCredential(service, user string) (string, error) {
	password, err := gokeyring.Get(service, user)
	if err != nil {
		if err == gokeyring.ErrNotFound {
			return "", nil
		}
		return "", fmt.Errorf("keychain get [%s/%s]: %w", service, user, err)
	}
	return password, nil
}

// DeleteCredential OS 키체인에서 자격증명을 삭제한다.
// 연결이 삭제될 때 잔류 비밀번호를 정리하기 위해 호출된다.
func (s *Store) DeleteCredential(service, user string) error {
	if err := gokeyring.Delete(service, user); err != nil {
		if err == gokeyring.ErrNotFound {
			return nil
		}
		return fmt.Errorf("keychain delete [%s/%s]: %w", service, user, err)
	}
	return nil
}
