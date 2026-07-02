# OrcaSQL 로컬 개발 환경 설정 가이드

## 1. 사전 요구사항 설치

### Go 1.25+
```bash
# macOS
brew install go

# Windows
# https://go.dev/dl/ 에서 .msi 다운로드 후 설치

go version  # go1.25.x 확인
```

### Wails v3 CLI
```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@latest

wails3 version  # 버전 확인 (현재 v3.0.0-alpha.74 기준)
```

### Bun
```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"

bun --version  # 확인
```

### Task (Taskfile runner)
```bash
# macOS
brew install go-task

# 그 외
go install github.com/go-task/task/v3/cmd/task@latest
```

---

## 2. 프로젝트 초기 설정

```bash
# 저장소 클론 후 루트 디렉토리에서 실행
task setup
```

`task setup` 은 다음을 순차 실행합니다:
1. `go mod tidy` — Go 의존성 정리 (Wails v3.0.0-alpha.74 등 모듈 다운로드)
2. `bun install` (frontend/) — 프론트엔드 의존성 설치
3. `wails3 generate bindings` — Go 구조체 → TypeScript 바인딩 자동 생성

> 생성된 `frontend/src/wailsjs/` 는 자동 산출물이므로 직접 수정 금지.

---

## 3. 개발 서버 실행

```bash
# 권장: Taskfile
task dev

# 직접 실행
wails3 dev
```

Hot-reload 동작:
- Go 파일 변경 → 자동 재컴파일
- Frontend 파일 변경 → Vite HMR

> dev 모드는 메뉴바 버전 뱃지가 `v0.1.0-dev` 로 표시됩니다 (의도된 동작 — 개발 중임을 명시).

---

## 4. 프로덕션 빌드

```bash
# 현재 플랫폼 자동 감지
task build

# 명시적으로 플랫폼 지정
task darwin:build      # macOS 바이너리 (bin/OrcaSQL)
task windows:build     # Windows 바이너리 (bin/OrcaSQL.exe)

# 패키징
task package           # darwin=.app+tar.gz / windows=.zip
task dmg               # macOS DMG (build 후 실행)

# 빌드 + 실행
task run
```

산출물 위치는 모두 `bin/` 입니다.

### 버전 자동 주입
`task build` (`darwin:build` / `windows:build`) 는 `git describe --tags --always --dirty` 결과를
`-X main.Version=...` ldflags 로 자동 주입합니다.

| 상태 | 주입 결과 (메뉴바 뱃지) |
|------|------------------------|
| 깨끗한 태그 커밋 | `v0.1.8` |
| 태그 위 추가 커밋 | `v0.1.8-2-gabc1234` |
| 변경사항 있음 | `v0.1.8-2-gabc1234-dirty` |
| 태그/git 외부 | `v0.1.0-dev` (fallback) |

릴리스 빌드(GitHub Actions, `v*` 태그 push)는 git 태그값을 사용하며 `Info.plist` 의
`CFBundleVersion` / `CFBundleShortVersionString` / `NSHumanReadableCopyright` 도 sed 로 자동 동기화됩니다.

---

## 5. 개발 중 자주 쓰는 명령

```bash
# Go → TS 바인딩 재생성 (Go 구조체 변경 시 필수)
task generate

# TypeScript 타입 검사 (빌드 없이)
task frontend:typecheck

# Go 정적 분석
task vet

# Go 유닛 테스트
task test

# 의존성 정리
task tidy
```

---

## 6. 주요 기능 안내

### 환경설정 (Settings)
- 메뉴 `Tools → 환경설정...` 또는 `Ctrl+,`
- **에디터 탭**: 폰트 크기/종류, 탭 크기, 줄바꿈, 미니맵, 줄 번호
- **쿼리 탭**: SELECT 기본 LIMIT, 쿼리 타임아웃 (5~300초, Go 백엔드 즉시 반영)
- **표시 탭**: NULL 셀 표시 텍스트 (기본 `NULL`)
- **SSH 탭**: 신뢰된 호스트 키 목록 조회 및 삭제
- 설정값은 `localStorage` 에 자동 저장되며 앱 재시작 후에도 유지됨

### SSH 호스트 키 검증 (TOFU)
SSH 터널 연결 시 **TOFU(Trust On First Use)** 방식으로 호스트 공개키를 검증합니다.

- **첫 연결**: 서버 공개키를 `~/.orcasql/known_hosts` 에 자동 저장
- **이후 연결**: 저장된 키와 다르면 연결 차단 (MITM 방지)
- **키 불일치 시**: Settings → SSH 탭에서 해당 항목 삭제 후 재연결

```bash
cat ~/.orcasql/known_hosts
```

### 쿼리 타임아웃
- 기본값: **30초** (SELECT 쿼리)
- Settings → 쿼리 탭에서 5~300초 범위에서 변경 가능
- 변경 즉시 Go 백엔드에 반영됨 (앱 재시작 불필요)
- 스트리밍 쿼리(대용량)는 항상 10분 타임아웃 적용

### 프록시 연결
SSH 터널 없이 SOCKS5 또는 HTTP CONNECT 프록시를 통해 MySQL 에 접속할 수 있습니다.

```bash
# SOCKS5 프록시 예시 (SSH 동적 포워딩)
ssh -D 1080 user@jumphost
# → 연결 모달 → 프록시 탭: SOCKS5, 127.0.0.1:1080
```

> SSH 터널과 프록시는 동시에 사용할 수 없습니다 (상호 배타).

---

## 7. 주의사항

- `frontend/src/wailsjs/` 디렉토리는 직접 수정 금지 (자동 생성)
- Go 구조체(`ConnectConfig`, `QueryResult` 등) 변경 시 항상 `task generate` 실행
- 비밀번호·SSH 비밀번호·프록시 비밀번호는 OS 키체인에만 저장됨 (파일 평문 저장 금지)
- 연결 설정은 `~/.orcasql/connections.json` 에 저장됨 (비밀번호 제외)
- SSH known_hosts 는 `~/.orcasql/known_hosts` 에 저장됨
- 앱 설정(환경설정)은 브라우저 `localStorage` 에 저장됨
- 에러 로그는 `~/.orcasql/log/error.log` 에 일단위로 자동 분할 저장됨 (BugFix-M)
- 모든 사용자 데이터(연결·히스토리·즐겨찾기·세션·키체인 비밀번호)를 한 번에 정리하려면 **도움말 → 모든 설정 초기화...** 사용 (Phase 42)
