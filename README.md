# My OrcaSql

**My OrcaSql** — Windows 11 · macOS 네이티브 MySQL GUI 클라이언트 (앱 이름: OrcaSQL). Wails v3 기반.

> 소스 공개 + 릴리스 바이너리를 한 저장소에서 제공합니다. 최신 설치 파일은 [Releases](https://github.com/chltjdgus/my-orcasql/releases/latest) 에서 받으세요.

---

## 제공 기능

### 연결 관리
- MySQL 직접 연결 및 SSH 터널 연결 (TOFU 호스트 키 검증)
- HTTP/HTTPS 프록시 터널 지원
- 연결별 색상 태그로 시각적 구분
- 연결 그룹화, 설정 Import/Export
- 비밀번호·자격증명 OS 키체인 저장 (평문 저장 없음)

### 쿼리 편집기
- Monaco 기반 SQL 에디터 (VS Code 동일 엔진)
- 스키마 인식 자동완성 (테이블·컬럼·함수, `db.table` 형식·별칭 prefix)
- SQL 포매터 (들여쓰기·키워드 스타일 설정 가능)
- 멀티 탭, 탭 이름 편집, 탭 컨텍스트 메뉴 (모두 닫기·오른쪽 탭 닫기)
- 쿼리 실행 취소, 장시간 쿼리 알림
- DELIMITER 지원 (Stored Procedure 실행)
- WITH CTE, 멀티 스테이트먼트 지원
- SQL 스니펫/즐겨찾기 저장·검색·삽입
- Placeholder 모달 — `?param` SQL 변수 입력 UI

### 결과 그리드
- 인라인 셀 편집 (UPDATE 자동 생성)
- 타입별 셀 에디터 — DatePicker / Boolean 토글 / Numeric 검증 / ENUM 드롭다운 / SET 멀티셀렉트 / JSON 포맷
- 신규 행 INSERT, 명시적 NULL 설정 (Ctrl+0)
- 다중 행 선택·삭제
- 헤더에 PK / UNIQUE / INDEX / FK 뱃지 표시 (스키마 기반)
- 컬럼 고정 (Freeze), 컬럼 가시성 토글
- 컬럼 통계 팝오버 (count / null / distinct / min / max / avg / sum / 빈도값)
- 행 복사 포맷: TSV / CSV / JSON / INSERT SQL (단일·다중 행)
- 클라이언트 사이드 필터
- 헤더 클릭 정렬 (ORDER BY)
- Row Detail 모달, 컨텍스트 메뉴

### 오브젝트 브라우저
- 데이터베이스 트리 (Tables / Views / Stored Procedures / Functions / Triggers / Users)
- 스키마 트리 검색
- 테이블 우클릭 컨텍스트 메뉴 (Open, Copy, Rename, Drop, Truncate 등)
- DB 컨텍스트 메뉴 (CREATE / DROP DATABASE, 새로고침)

### 테이블 관리
- Table Designer: 컬럼·인덱스·외래키 GUI 편집
- RENAME TABLE, COPY TABLE (구조/데이터)
- Table Info 탭: 컬럼·인덱스·FK·트리거 상세 보기
- CREATE TABLE DDL 탭: `SHOW CREATE TABLE` 결과를 Monaco SQL 하이라이트로 표시 + 복사

### 데이터 조회 (Table Data)
- 페이지네이션 (25 / 50 / 100 / 200행), First/Last, 페이지 번호 직접 입력
- WHERE 서버 필터, 총 행 수 표시
- 컬럼 정렬

### 고급 기능
- Schema Sync: 두 DB 스키마 비교·동기화
- Data Sync: 두 DB 데이터 비교·동기화
- Backup (mysqldump 래핑)
- ER Diagram (React Flow 기반, FK 자동 연결)
- Data Search (전체 테이블 문자열 검색)
- EXPLAIN 실행 계획 트리
- 사용자·권한 관리 (GRANT/REVOKE UI, 비밀번호 변경, 계정 잠금)
- 프로세스 리스트 / 실행 중 쿼리 모니터 (Kill Query 지원)
- Query Profiler

### MCP 서버 통합 (AI 클라이언트 연동)
Claude Code · Cursor · Claude Desktop 등 MCP 클라이언트가 OrcaSQL 활성 연결을 통해 DB 질의 가능. 환경설정 → MCP 탭에서 활성화.

- 127.0.0.1 전용 listen, OS 키체인 보관 Bearer 토큰 인증, Origin 화이트리스트
- 5 도구: `list_connections` / `list_databases` / `list_tables` / `describe_table` / `execute_query`
- 권한 게이트 3단계: read-only(기본) / +쓰기 / +DDL — 각 단계 명시 활성화 필요
- Connection allowlist (기본 비활성, 사용자가 노출할 연결 선택)
- AI 부트스트랩 프롬프트 복사 — 채팅창에 붙여넣으면 자동 탐색
- Claude Code / Cursor 용 설정 JSON 원클릭 복사
- 자가 헬스체크 ("연결 테스트") + StatusBar 인디케이터 (재시작·테스트·설정 바로가기)
- MCP 경로 호출은 쿼리 히스토리에 `MCP` 배지로 기록

상세: [.claude/plans/phase-43-mcp-server.md](.claude/plans/phase-43-mcp-server.md)

### 생산성 / 편의
- 쿼리 히스토리 (상태 필터·정렬·SQL 전문 펼치기·복사·느린 쿼리 강조)
- 세션 복원 (앱 재시작 시 열린 탭·연결 상태 복원)
- 메뉴바 앱 버전 뱃지 (macOS, git 태그 자동 동기화)
- 다크 모드
- 한국어 / 영어 UI 전환
- 설정 JSON 가져오기/내보내기
- CSV 임포트
- ESC 로 팝업 닫기, 키보드 단축키 안내 다이얼로그
- 에러 로그 일단위 자동 분할 (`~/.orcasql/log/error.log`)

---

## 설치

> 최신 설치 파일은 [Releases](https://github.com/chltjdgus/my-orcasql/releases/latest) 에서 다운로드할 수 있습니다.

### Windows

1. [Releases](https://github.com/chltjdgus/my-orcasql/releases/latest) 페이지에서 `OrcaSQL-{버전}-Setup.msi` 다운로드
2. 다운로드한 `.msi` 파일 실행
3. 설치 마법사 안내에 따라 진행

설치 경로: `C:\Program Files\OrcaSQL\`  
시작 메뉴 및 바탕화면 바로가기 자동 생성.

### macOS

1. [Releases](https://github.com/chltjdgus/my-orcasql/releases/latest) 페이지에서 `OrcaSQL.dmg` 다운로드
2. DMG 파일 마운트 후 `OrcaSQL.app`을 `Applications` 폴더로 드래그

> **주의**: 공증(notarization) 없이 배포된 경우, 첫 실행 시 시스템 환경설정 > 개인 정보 보호 및 보안에서 "확인 없이 열기"를 허용해야 할 수 있습니다.

---

## 업데이트

별도 자동 업데이트 기능은 없습니다. 새 버전이 출시되면 [Releases](https://github.com/chltjdgus/my-orcasql/releases/latest)에서 최신 설치 파일을 다운받아 재설치하세요.

- **Windows**: 새 MSI를 실행하면 기존 버전을 자동 감지하여 업그레이드합니다. 별도 언인스톨 불필요.
- **macOS**: 새 `.app`을 Applications 폴더에 덮어쓰기하면 됩니다.

---

## 제거 (Uninstall)

OrcaSQL은 다음 위치에 사용자 데이터를 보관합니다.

| 위치 | 내용 |
|------|------|
| `~/.orcasql/` | 연결 설정, 쿼리 히스토리, 즐겨찾기, 세션, SSH known_hosts, 로그 |
| OS 키체인 (`orcasql`, `orcasql-ssh`, `orcasql-proxy`) | MySQL/SSH/프록시 비밀번호 |

### 모든 설정 초기화 (앱 내)
도움말 메뉴 → **모든 설정 초기화...** 를 통해 위 모든 데이터를 한 번에 정리하고 앱을 종료할 수 있습니다. 두 단계 확인(경고 모달 + `OrcaSQL` 텍스트 입력)을 거칩니다.

### Windows
제어판 → 프로그램 추가/제거에서 OrcaSQL 제거. 마법사에서 **Also delete user data** 체크박스가 표시됩니다 (기본 OFF — 데이터 보존).

- **체크 OFF**: 앱 파일·바로가기만 제거, 사용자 데이터 보존 (재설치 시 그대로 복원됨)
- **체크 ON**: 위 + `%USERPROFILE%\.orcasql` + Credential Manager의 `orcasql*` 항목 모두 삭제

### macOS
별도 언인스톨러가 없습니다. `Applications` 에서 `OrcaSQL.app` 을 휴지통으로 드래그하세요. 사용자 데이터까지 정리하려면 사전에 **도움말 → 모든 설정 초기화** 를 실행하세요.

---

## 시스템 요구사항

| 항목 | 최소 사양 |
|------|----------|
| Windows | Windows 10 22H2 이상 (x64) |
| macOS | macOS 10.15 Catalina 이상 (Apple Silicon / Intel) |
| MySQL | 5.7 / 8.0 / 8.4 (MariaDB 10.3+ 호환) |
| 메모리 | 512 MB 이상 권장 |

---

## 기술 스택

- [Wails v3](https://wails.io) (`v3.0.0-alpha.74`) + Go 1.25 — 네이티브 앱 프레임워크
- React 19 + TypeScript (strict) — 프론트엔드
- Monaco Editor — SQL 편집기
- Tailwind CSS v4 + Zustand v5 + TanStack Query/Table
- Bun (npm 미사용)

로컬 개발 환경 구축은 [SETUP.md](SETUP.md) 참조.

---

## 라이선스

프리웨어 — 무료 사용 가능. 재배포·역공학·수정·상업적 이용은 허용되지 않습니다.
