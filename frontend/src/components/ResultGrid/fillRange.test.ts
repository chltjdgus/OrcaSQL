/**
 * Phase 60 — Excel 채우기(Fill) 순수 계산 회귀 가드.
 * computeFillEdits 의 down/right 방향·편집가능 가드·NULL 정규화·경계(단일 행/컬럼)를 고정.
 */
import { describe, it, expect } from 'vitest'
import { computeFillEdits } from './fillRange'
import type { SelectionRect } from './hooks/useCellSelection'

// 4행 × 4열 샘플. 컬럼 0 은 PK(편집 불가) 가정.
const rows: unknown[][] = [
  [1, 'a', 10, null],
  [2, 'b', 20, 'x'],
  [3, 'c', 30, 'y'],
  [4, 'd', 40, 'z'],
]
const editableExceptPk = (c: number) => c !== 0

const rect = (minR: number, maxR: number, minC: number, maxC: number): SelectionRect => ({ minR, maxR, minC, maxC })

describe('computeFillEdits — down', () => {
  it('첫 행 값을 아래 행으로 컬럼별 복사하고 원본 행은 제외', () => {
    const edits = computeFillEdits({
      rect: rect(0, 2, 1, 2),
      direction: 'down',
      sortedRows: rows,
      visibleColsInSpan: [1, 2],
      isColEditable: editableExceptPk,
    })
    // 행 1·2 × 컬럼 1·2 = 4건, 값은 행0 의 셀
    expect(edits).toHaveLength(4)
    expect(edits).toContainEqual({ rowIdx: 1, colIdx: 1, value: 'a', setNull: false })
    expect(edits).toContainEqual({ rowIdx: 2, colIdx: 1, value: 'a', setNull: false })
    expect(edits).toContainEqual({ rowIdx: 1, colIdx: 2, value: '10', setNull: false })
    expect(edits).toContainEqual({ rowIdx: 2, colIdx: 2, value: '10', setNull: false })
  })

  it('편집 불가(PK) 컬럼은 건너뛴다', () => {
    const edits = computeFillEdits({
      rect: rect(0, 3, 0, 1),
      direction: 'down',
      sortedRows: rows,
      visibleColsInSpan: [0, 1],
      isColEditable: editableExceptPk,
    })
    expect(edits.every((e) => e.colIdx === 1)).toBe(true)
    expect(edits).toHaveLength(3) // 행 1·2·3 × 컬럼 1
  })

  it('NULL 원본은 setNull=true 로 채운다', () => {
    const edits = computeFillEdits({
      rect: rect(0, 1, 3, 3),
      direction: 'down',
      sortedRows: rows,
      visibleColsInSpan: [3],
      isColEditable: editableExceptPk,
    })
    expect(edits).toEqual([{ rowIdx: 1, colIdx: 3, value: '', setNull: true }])
  })

  it('한 행만 선택하면 채울 대상이 없다', () => {
    const edits = computeFillEdits({
      rect: rect(2, 2, 1, 2),
      direction: 'down',
      sortedRows: rows,
      visibleColsInSpan: [1, 2],
      isColEditable: editableExceptPk,
    })
    expect(edits).toEqual([])
  })
})

describe('computeFillEdits — right', () => {
  it('첫(가시) 컬럼 값을 행별로 오른쪽 컬럼에 복사', () => {
    const edits = computeFillEdits({
      rect: rect(1, 2, 1, 3),
      direction: 'right',
      sortedRows: rows,
      visibleColsInSpan: [1, 2, 3],
      isColEditable: editableExceptPk,
    })
    // 행 1·2 × 대상 컬럼 2·3 = 4건, 값은 각 행의 컬럼 1
    expect(edits).toHaveLength(4)
    expect(edits).toContainEqual({ rowIdx: 1, colIdx: 2, value: 'b', setNull: false })
    expect(edits).toContainEqual({ rowIdx: 1, colIdx: 3, value: 'b', setNull: false })
    expect(edits).toContainEqual({ rowIdx: 2, colIdx: 2, value: 'c', setNull: false })
    expect(edits).toContainEqual({ rowIdx: 2, colIdx: 3, value: 'c', setNull: false })
  })

  it('한 컬럼만 선택하면 채울 대상이 없다', () => {
    const edits = computeFillEdits({
      rect: rect(0, 3, 2, 2),
      direction: 'right',
      sortedRows: rows,
      visibleColsInSpan: [2],
      isColEditable: editableExceptPk,
    })
    expect(edits).toEqual([])
  })

  it('가시 span 순서를 따르고 숨겨진 컬럼은 visibleColsInSpan 에서 이미 빠져 있다', () => {
    // 컬럼 2 가 숨겨진 상황: span 은 [1,3] 만 전달됨
    const edits = computeFillEdits({
      rect: rect(0, 0, 1, 3),
      direction: 'right',
      sortedRows: rows,
      visibleColsInSpan: [1, 3],
      isColEditable: editableExceptPk,
    })
    expect(edits).toEqual([{ rowIdx: 0, colIdx: 3, value: 'a', setNull: false }])
  })
})
