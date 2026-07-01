import type { SelectionRect } from './hooks/useCellSelection'

/** 채우기 한 셀의 변경 단위 — 본체가 pendingEdits.enqueue 로 적재. */
export interface FillEdit {
  /** 시각 행 인덱스 (sortedRows 기준) */
  rowIdx: number
  /** result.columns 인덱스 */
  colIdx: number
  /** 채울 값 (문자열). setNull=true 면 무시. */
  value: string
  setNull: boolean
}

export type FillDirection = 'down' | 'right'

interface ComputeFillArgs {
  /** 현재 선택 사각형 (result.columns 인덱스 기준, 양끝 포함) */
  rect: SelectionRect
  direction: FillDirection
  /** 시각 정렬·필터 적용 후 행 배열 (각 행은 result.columns 인덱스로 접근) */
  sortedRows: unknown[][]
  /** 선택 span [minC,maxC] 안의 가시 컬럼 result.columns 인덱스 (표시 순서) */
  visibleColsInSpan: number[]
  /** 컬럼이 편집 가능한지 (PK·non-editable·읽기전용 제외) */
  isColEditable: (colIdx: number) => boolean
}

/** null/undefined → setNull, 그 외 → String() 로 정규화한 FillEdit 생성 */
function makeEdit(rowIdx: number, colIdx: number, v: unknown): FillEdit {
  const isNull = v === null || v === undefined
  return { rowIdx, colIdx, value: isNull ? '' : String(v), setNull: isNull }
}

/**
 * Phase 60 — Excel 채우기(Fill)의 순수 계산. UI/상태/네트워크와 분리해 단위 테스트로 고정.
 *
 * - `down`  : 선택 첫 행(minR)의 각 셀 값을 같은 컬럼 아래 행(minR+1..maxR)으로 복사
 * - `right` : 선택 첫(가시) 컬럼의 각 셀 값을 같은 행 오른쪽 컬럼으로 복사
 *
 * 편집 불가(PK 등) 컬럼은 건너뛴다. 원본(첫 행/첫 컬럼)은 변경하지 않는다.
 * 채울 대상이 없으면 빈 배열(한 행/한 컬럼만 선택 등).
 */
export function computeFillEdits({
  rect,
  direction,
  sortedRows,
  visibleColsInSpan,
  isColEditable,
}: ComputeFillArgs): FillEdit[] {
  const edits: FillEdit[] = []

  if (direction === 'down') {
    if (rect.maxR <= rect.minR) return edits // 한 행뿐 → 채울 대상 없음
    for (const cc of visibleColsInSpan) {
      if (!isColEditable(cc)) continue
      const srcVal = sortedRows[rect.minR]?.[cc]
      for (let rr = rect.minR + 1; rr <= rect.maxR; rr++) {
        if (!sortedRows[rr]) continue
        edits.push(makeEdit(rr, cc, srcVal))
      }
    }
    return edits
  }

  // right
  if (visibleColsInSpan.length < 2) return edits // 한 컬럼뿐 → 채울 대상 없음
  const firstCol = visibleColsInSpan[0]
  for (let rr = rect.minR; rr <= rect.maxR; rr++) {
    const row = sortedRows[rr]
    if (!row) continue
    const srcVal = row[firstCol]
    for (let i = 1; i < visibleColsInSpan.length; i++) {
      const cc = visibleColsInSpan[i]
      if (!isColEditable(cc)) continue
      edits.push(makeEdit(rr, cc, srcVal))
    }
  }
  return edits
}
