/**
 * ResultGrid 분해 (Phase 44 · Wave 1) 시 본체와 sub-component 가 공유하는
 * 타입·상수 정의. `Props` 는 본체 전용이라 `index.tsx` 에 유지하고,
 * `EditingCell` 은 Phase 47 (Wave 2c) 에서 hook 들이 공유하면서 이 곳으로 이동.
 */
import type { ColumnInfo } from '@/types'
import type { IndexFlag } from '@/components/common/IndexFlagIcon'

/** 테이블 스키마 메타 — editCtx 가 있을 때 ListColumns + ListIndexes + GetForeignKeys 로 채워짐 */
export interface TableSchemaMeta {
  /** 컬럼명 → ColumnInfo (DATA_TYPE, COLUMN_TYPE 등) */
  columns: Map<string, ColumnInfo>
  /** 컬럼명 → 인덱스·FK 플래그 집합 */
  flags: Map<string, Set<IndexFlag>>
}

/** 인라인 편집 중인 셀 식별자. 시각 인덱스(rowIdx) 와 실제 데이터 인덱스(localRowIdx) 를 분리해 BugFix-BO 의 정렬 안전성 유지. */
export interface EditingCell {
  /** 시각(정렬·필터 적용 후) 인덱스 — 화면 위치 표시·편집 UI 위치용 */
  rowIdx: number
  /** 원본 localRows 배열 인덱스 — 값 읽기·setLocalRows 변형용 */
  localRowIdx: number
  /** columns 배열 인덱스 */
  colIdx: number
  colName: string
}

/**
 * 행 단위 dirty 큐(usePendingEdits) 의 한 셀 변경 기록.
 * 셀 편집 종료 시 즉시 `UpdateRowValue` 를 호출하지 않고 본 구조로 누적했다가
 * 행 이동 시(또는 Ctrl+Enter) 컬럼별 순차 commit 한다.
 */
export interface PendingEdit {
  /** 새 값 (NULL_SENTINEL 가능 — 실제 commit 시 setNull=true 로 변환) */
  newValue: string
  /** 명시적 NULL 설정 여부 (true 면 UpdateRowValue setNull 인자 true) */
  setNull: boolean
  /** 적재 직전의 원본 값 — 롤백·중복 비교용 */
  originalValue: unknown
}

/** 한 행의 컬럼별 PendingEdit 모음 (key = columns 배열 인덱스) */
export type PendingRowMap = Map<number, PendingEdit>

/**
 * 서버 측 정렬 외부 제어 인터페이스.
 *
 * ResultGrid 가 클라이언트 측 정렬(useFilterAndSort) 대신 부모가 관리하는 정렬
 * 상태(DB ORDER BY) 와 양방향 동기화될 때 사용. 헤더 클릭 시 `onChange` 가
 * 호출되고, `col`/`dir` 이 변하면 헤더의 ↑/↓ 인디케이터가 자동 갱신된다.
 *
 * - `col = null` : 정렬 없음 (ORDER BY 절 미적용)
 * - 사이클: 미정렬 컬럼 클릭 → ASC → DESC → 미정렬
 */
export interface ServerSortControl {
  col: string | null
  dir: 'ASC' | 'DESC'
  onChange: (col: string | null, dir: 'ASC' | 'DESC') => void
}

/** ColumnStatsPopover 가 받는 단일 컬럼 통계 */
export interface ColStats {
  total: number
  nullCount: number
  distinctCount: number
  fillRate: number
  isNumeric: boolean
  min: number | null
  max: number | null
  avg: number | null
  sum: number | null
  topValues: [string, number][]
}

/** 긴 텍스트 임계값 (이 글자 수 초과 시 전체 보기 버튼 표시) */
export const LONG_TEXT_THRESHOLD = 200

/** 편집 인풋에서 명시적 NULL 을 나타내는 내부 센티넬 값 */
export const NULL_SENTINEL = '\x00NULL\x00'

/** 그리드 행 높이 (px) — 본체 가상화·신규 행 렌더 양쪽이 공유 */
export const ROW_HEIGHT = 28

/** NewRowCell 의 입력 위젯 분기용 — 날짜·시간 타입 집합 */
export const NEW_ROW_DATETIME_TYPES = new Set([
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
])

/** NewRowCell 의 입력 위젯 분기용 — 숫자 타입 집합 */
export const NEW_ROW_NUMERIC_TYPES = new Set([
  'INT', 'BIGINT', 'SMALLINT', 'MEDIUMINT', 'TINYINT',
  'DECIMAL', 'FLOAT', 'DOUBLE', 'NUMERIC',
])

/** NewRowCell 의 입력 위젯 분기용 — 긴 텍스트·BLOB·JSON 타입 집합 */
export const NEW_ROW_LONG_TEXT_TYPES = new Set([
  'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYTEXT',
  'JSON', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
])
