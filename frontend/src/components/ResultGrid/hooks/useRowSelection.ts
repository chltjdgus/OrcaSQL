import { useCallback, useEffect, useRef, useState } from 'react'
import type { SortingState } from '@tanstack/react-table'
import type { QueryResult } from '@/types'

/**
 * ResultGrid 본체의 행 선택·포커스 상태와 클릭 핸들러.
 *
 * - `selectedRows` (Set) 은 시각 인덱스(sortedRows 기준) — BugFix-BO 정책
 * - `lastSelectedRow` ref 는 Shift-range 선택 anchor
 * - `focusedRowIdx` 는 단일 강조 행 — 신규 행 삽입 위치(insertAfterRowIdx) 기본값
 * - `result` 변경 / `sorting` 변경 시 모두 초기화 (시각 인덱스 의미 휘발)
 *
 * `handleRowBodyClick` 의 "편집 중 셀 클릭 무시" 가드용으로 `editingCell` 의
 * rowIdx 만 외부에서 주입한다 (전체 EditingCell 타입 import 회피).
 */
export function useRowSelection({
  result,
  sorting,
  editingCell,
  beforeRowChange,
}: {
  result: QueryResult
  sorting: SortingState
  editingCell: { rowIdx: number } | null
  /**
   * Wave 2 — 행 이동 전 commit 가드. focusedRowIdx 가 prev → next 로 바뀌기 직전
   * 호출되어 `false` 를 반환하면 이동을 차단한다. dirty 큐(usePendingEdits)의
   * commitRow 결과로 매핑된다. 인자는 시각 인덱스(이전 행).
   */
  beforeRowChange?: (prevVisualRowIdx: number) => Promise<boolean>
}) {
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const lastSelectedRow = useRef<number | null>(null)
  const [focusedRowIdx, setFocusedRowIdx] = useState<number | null>(null)
  // BugFix-CS: 클릭한 셀(컬럼) 시각 인덱스 — 행 강조 위에 더 진한 셀 강조용
  const [focusedColIdx, setFocusedColIdx] = useState<number | null>(null)
  // beforeRowChange 가 async 라 handleRowSelect 가 await 동안에도 최신 focused 값 참조용
  const focusedRowIdxRef = useRef<number | null>(null)
  useEffect(() => { focusedRowIdxRef.current = focusedRowIdx }, [focusedRowIdx])

  useEffect(() => {
    setSelectedRows(new Set())
    lastSelectedRow.current = null
    setFocusedRowIdx(null)
    setFocusedColIdx(null)
  }, [result])

  useEffect(() => {
    setSelectedRows(new Set())
    setFocusedRowIdx(null)
    setFocusedColIdx(null)
    lastSelectedRow.current = null
  }, [sorting])

  /**
   * 키보드 행 이동 시 selectedRows 를 단일 행으로 갱신하는 헬퍼 (Phase 57 키보드 네비용).
   * focusedRow 만 바뀌고 selectedRows 가 멈춰 있으면 사용자가 "선택된 row 가 따라온다"
   * 고 인지하기 어려워 마우스 클릭과 동작을 통일.
   */
  const selectSingleRow = useCallback((rowIdx: number) => {
    setSelectedRows(new Set([rowIdx]))
    lastSelectedRow.current = rowIdx
  }, [])

  const handleRowSelect = useCallback(async (e: React.MouseEvent, rowIdx: number, toggleOnRepeat: boolean, colIdx: number | null) => {
    e.stopPropagation()
    // Wave 2 — 다른 행으로 이동하기 직전 dirty commit 가드.
    // shift/ctrl 다중 선택도 focus 행은 바뀌므로 동일하게 적용.
    const prev = focusedRowIdxRef.current
    if (beforeRowChange && prev !== null && prev !== rowIdx) {
      const ok = await beforeRowChange(prev)
      if (!ok) return  // commit 실패 → 이동 차단
    }
    setSelectedRows((prev) => {
      const next = new Set(prev)
      if (e.shiftKey && lastSelectedRow.current !== null) {
        const from = Math.min(lastSelectedRow.current, rowIdx)
        const to   = Math.max(lastSelectedRow.current, rowIdx)
        for (let i = from; i <= to; i++) next.add(i)
      } else if (e.ctrlKey || e.metaKey) {
        next.has(rowIdx) ? next.delete(rowIdx) : next.add(rowIdx)
      } else {
        if (toggleOnRepeat && prev.size === 1 && prev.has(rowIdx)) {
          next.clear()
        } else {
          next.clear()
          next.add(rowIdx)
        }
      }
      return next
    })
    lastSelectedRow.current = rowIdx
    setFocusedRowIdx(rowIdx)
    setFocusedColIdx(colIdx)
  }, [beforeRowChange])

  const handleRowNumClick = useCallback((e: React.MouseEvent, rowIdx: number) => {
    // 행 번호 클릭은 셀 단위 강조가 없음 — colIdx=null
    handleRowSelect(e, rowIdx, true, null)
  }, [handleRowSelect])

  const handleRowBodyClick = useCallback((e: React.MouseEvent, rowIdx: number) => {
    // BugFix-CU: 편집 중인 셀(td 의 data-osql-editor) 안 클릭은 무시.
    // 기존 가드(`editingCell?.rowIdx === rowIdx`) 는 "편집 중인 행 전체" 를 스킵해
    // 같은 행 다른 셀 클릭이 focus 이동에 반영되지 않는 회귀를 만들었음. 이제 클릭 target
    // 의 td 마커 기준으로 정확히 "편집 셀 내부" 만 스킵.
    if ((e.target as HTMLElement).closest('[data-osql-editor="true"]')) return
    if ((e.target as HTMLElement).closest('[data-osql-newrow]')) return
    // 클릭한 td 의 시각 컬럼 인덱스 추출 (-1 = 행 번호 칸 → focus 없음)
    const td = (e.target as HTMLElement).closest('td')
    const tr = e.currentTarget as HTMLTableRowElement
    let colIdx: number | null = null
    if (td) {
      const cells = tr.querySelectorAll('td')
      cells.forEach((cell, i) => { if (cell === td) colIdx = i - 1 }) // -1 = 행 번호 컬럼 보정
      if (colIdx !== null && colIdx < 0) colIdx = null
    }
    handleRowSelect(e, rowIdx, false, colIdx)
  }, [editingCell, handleRowSelect])

  return {
    selectedRows,
    setSelectedRows,
    lastSelectedRow,
    focusedRowIdx,
    setFocusedRowIdx,
    focusedColIdx,
    setFocusedColIdx,
    handleRowSelect,
    handleRowNumClick,
    handleRowBodyClick,
    selectSingleRow,
  }
}
