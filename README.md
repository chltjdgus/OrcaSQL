# OrcaSQL

**OrcaSQL**은 Windows 11 및 macOS를 지원하는 MySQL 데스크톱 GUI 클라이언트입니다.  
SQLyog·DataGrip 수준의 생산성을 목표로 개발된 네이티브 앱입니다.

> 소스 코드는 Private 저장소에서 관리됩니다. 이 저장소는 릴리스 바이너리만 제공합니다.

---

## 주요 기능

### 연결 관리
- 다중 MySQL 연결 동시 운용 (연결 탭)
- SSH 터널 / HTTP 프록시 경유 연결
- 연결 그룹화, 색상 태그, 드래그 정렬
- OS 키체인(Keychain / Credential Manager) 비밀번호 보안 저장
- 다중 인스턴스 동시 실행 지원

### SQL 에디터
- Monaco 기반 SQL 에디터 (VS Code와 동일한 엔진)
- DataGrip 스타일 자동완성 — 테이블·컬럼·`db.table` 형식·별칭 prefix
- `SELECT *` 컬럼 목록 자동 확장 Snippet
- SQL 자동 포맷 (키워드 대소문자·들여쓰기 설정 가능)
- 다중 쿼리 동시 실행 (세미콜론 구분)
- 쿼리 실행 취소 (Stop 버튼)

### 결과 그리드
- 인라인 셀 편집 (INSERT / UPDATE / DELETE 자동 생성)
- 신규 행 직접 입력 (INSERT), 명시적 NULL 설정 (`Ctrl+0`)
- 컬럼 고정 (Freeze) — 스크롤 시 좌측 고정
- 컬럼 통계 팝오버 — COUNT / NULL 수 / DISTINCT / MIN / MAX / AVG / 상위 빈도값
- 행 복사 포맷 — TSV / CSV / JSON / INSERT SQL (단일·다중 행)
- 클라이언트 필터 (결과 내 실시간 검색)

### 오브젝트 브라우저
- 데이터베이스·테이블·뷰·프로시저·함수·트리거·사용자 트리
- 테이블 클릭 → Data / Info 탭 자동 열기
- 컨텍스트 메뉴 — CREATE / DROP DATABASE, RENAME / COPY TABLE

### 테이블 디자이너
- 컬럼 추가·수정·삭제 (데이터 타입, NOT NULL, DEFAULT, AUTO_INCREMENT, CHARSET)
- 인덱스 관리 (PRIMARY / UNIQUE / INDEX / FULLTEXT)
- 외래 키(FK) 설정
- DDL 미리보기 및 실행

### 테이블 데이터 탭
- 서버 사이드 WHERE 필터, 컬럼 클릭 ORDER BY
- 페이지네이션 (페이지 번호 직접 입력, First / Last, 25 / 50행 선택)
- 총 행 수 표시

### 쿼리 히스토리
- 일(日)단위 파일 분리, 연결별 필터
- 성공 / 오류 상태 필터, 실행 시간 정렬
- 느린 쿼리 색상 강조, SQL 전문 펼치기, 클립보드 복사

### SQL 스니펫
- 에디터 선택 영역 저장, 태그 검색, 커서 위치 삽입

### 사용자 및 권한 관리
- GRANT / REVOKE UI, 비밀번호 변경, 계정 잠금 토글

### 프로세스 리스트
- `SHOW PROCESSLIST` 실시간 조회, 쿼리 Kill, 장시간 쿼리 필터

### 내보내기
- CSV, JSON, TSV, Excel(.xlsx), INSERT SQL

### UI / UX
- 다크 모드 / 라이트 모드 전환
- 한국어 / 영어 UI 전환
- ESC로 팝업 닫기, 키보드 단축키 설정
- 패널 크기 자유 조절 (리사이저)

---

## 시스템 요구사항

| 플랫폼 | 최소 사양 |
|--------|-----------|
| Windows | Windows 10 22H2 이상 (x64) |
| macOS | macOS 10.15 Catalina 이상 (Apple Silicon / Intel 모두 지원) |

MySQL 5.7 / 8.0 / 8.4 호환.

---

## 설치 방법

### Windows
1. 아래 **Assets**에서 `OrcaSQL-*-Setup.msi` 파일을 다운로드합니다.
2. 설치 파일을 실행하고 화면의 안내를 따릅니다.
3. 시작 메뉴에서 **OrcaSQL**을 실행합니다.

### macOS
1. 아래 **Assets**에서 `OrcaSQL.dmg` 파일을 다운로드합니다.
2. DMG 파일을 마운트한 뒤 `OrcaSQL.app`을 **Applications** 폴더로 드래그합니다.
3. 처음 실행 시 Gatekeeper 경고가 표시될 경우: **시스템 설정 → 개인정보 및 보안 → "확인 없이 열기"** 클릭.

---

## 릴리스 채널

| 파일 | 설명 |
|------|------|
| `OrcaSQL-*-Setup.msi` | Windows 설치 파일 (권장) |
| `OrcaSQL-windows-amd64.zip` | Windows 이식형 (설치 불필요) |
| `OrcaSQL.dmg` | macOS 디스크 이미지 (권장) |
| `OrcaSQL-darwin-universal.tar.gz` | macOS Universal 바이너리 압축 파일 |

pre-release 버전(버전명에 `-` 포함, 예: `v0.2.0-beta.1`)은 실험적 기능을 포함할 수 있습니다.

---

## 라이선스

이 소프트웨어는 프리웨어로 무료 사용이 가능합니다.  
재배포·역공학·수정·상업적 이용은 허용되지 않습니다.

---

*이 저장소는 OrcaSQL의 공개 릴리스 전용 저장소입니다. 소스 코드 기여(PR/Issue)는 받지 않습니다.*
