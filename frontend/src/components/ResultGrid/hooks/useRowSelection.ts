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
 * 셀 클릭 → focus/선택은 ResultGrid 본체의 `handleCellMouseDown` 이 담당(Phase 58 이관).
 */
export function useRowSelection({
  result,
  sorting,
  beforeRowChange,
}: {
  result: QueryResult
  sorting: SortingState
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

  // 반환값: 선택/포커스가 실제로 갱신됐는지(true) 또는 dirty commit 실패로 차단됐는지(false).
  // BugFix-DN(bug_007): 마우스 드래그 시작(beginDrag)이 이 결과를 await 해 anchor 갱신 이후에만
  // 드래그를 시작하도록 — commit 대기/실패 중 stale anchor 로 잘못된 범위가 잡히던 회귀 방지.
  const handleRowSelect = useCallback(async (e: React.MouseEvent, rowIdx: number, toggleOnRepeat: boolean, colIdx: number | null): Promise<boolean> => {
    e.stopPropagation()
    // Wave 2 — 다른 행으로 이동하기 직전 dirty commit 가드.
    // shift/ctrl 다중 선택도 focus 행은 바뀌므로 동일하게 적용.
    const prev = focusedRowIdxRef.current
    if (beforeRowChange && prev !== null && prev !== rowIdx) {
      const ok = await beforeRowChange(prev)
      if (!ok) return false  // commit 실패 → 이동 차단
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
    return true
  }, [beforeRowChange])

  const handleRowNumClick = useCallback((e: React.MouseEvent, rowIdx: number) => {
    // 행 번호 클릭은 셀 단위 강조가 없음 — colIdx=null
    handleRowSelect(e, rowIdx, true, null)
  }, [handleRowSelect])

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
    selectSingleRow,
  }
}
