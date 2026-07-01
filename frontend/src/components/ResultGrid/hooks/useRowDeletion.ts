import { useCallback, useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import toast from 'react-hot-toast'
import { runLoggedQuery } from '@/utils/queryLog'
import { t, type Language } from '@/i18n'
import type { QueryResult, TableEditContext } from '@/types'
import { confirmRowDelete } from '../confirmRowDelete'
import type { EditingCell } from '../types'

interface UseRowDeletionArgs {
  result: QueryResult
  editCtx: TableEditContext | undefined
  connId: string | undefined
  canDelete: boolean
  selectedRows: Set<number>
  sortedRows: unknown[][]
  editingCell: EditingCell | null
  /** 활성 셀 컬럼 인덱스 — null 이면 "행만 선택"(거터) 상태라 Delete 키가 행 삭제로 동작 */
  focusedColIdx: number | null
  language: Language
  setLocalRows: Dispatch<SetStateAction<unknown[][]>>
  setSelectedRows: Dispatch<SetStateAction<Set<number>>>
  lastSelectedRow: MutableRefObject<number | null>
  setFocusedRowIdx: Dispatch<SetStateAction<number | null>>
}

/**
 * ResultGrid 본체의 다중 행 삭제 chain (Phase 47 · Wave 2c).
 *
 * - `selectedRows` (시각 인덱스 Set) 을 sortedRows 매핑 후 행 참조로 변환
 * - 각 행마다 PK WHERE 절을 빌드해 LIMIT 1 DELETE 직렬 실행
 * - 성공 시 `localRows` 에서 참조 동일성으로 필터링 + 선택/anchor/focus reset
 * - Delete/Backspace 키 핸들러 (편집 중 가드 + confirmRowDelete dialog 분기)
 *
 * 선택 관련 setter (`setSelectedRows`/`lastSelectedRow`/`setFocusedRowIdx`)
 * 는 `useRowSelection` hook 의 반환값을 그대로 받음 — 책임 분리 (선택 책임은
 * useRowSelection, 삭제 후 reset 만 본 hook 이 위임 수행).
 */
export function useRowDeletion({
  result,
  editCtx,
  connId,
  canDelete,
  selectedRows,
  sortedRows,
  editingCell,
  focusedColIdx,
  language,
  setLocalRows,
  setSelectedRows,
  lastSelectedRow,
  setFocusedRowIdx,
}: UseRowDeletionArgs) {
  const [isDeleting, setIsDeleting] = useState(false)

  const deleteSelectedRows = useCallback(async () => {
    if (!canDelete || !editCtx || !connId || selectedRows.size === 0) return
    const colNames = result.columns.map((c) => c.name)
    // selectedRows 는 시각 인덱스 (sortedRows 기준) — 숫자 정렬 후 매핑
    const rowsToDelete = [...selectedRows]
      .sort((a, b) => a - b)
      .map((idx) => sortedRows[idx])
      .filter((r): r is unknown[] => Array.isArray(r))

    const sqls = rowsToDelete.map((row) => {
      const where = editCtx.pkColumns.map((pk) => {
        const idx = colNames.indexOf(pk)
        const val = row?.[idx]
        if (val === null || val === undefined) return `\`${pk}\` IS NULL`
        return `\`${pk}\` = '${String(val).replace(/'/g, "''")}'`
      }).join(' AND ')
      return `DELETE FROM \`${editCtx.database}\`.\`${editCtx.table}\` WHERE ${where} LIMIT 1`
    })

    setIsDeleting(true)
    try {
      for (const sql of sqls) {
        // BugFix-CW: 각 DELETE 를 Messages 영역에 누적 (history 는 Go 측 자동 저장)
        await runLoggedQuery({
          connId,
          database: editCtx.database,
          sql,
          sourceLabel: t('qlLabelRowDelete', language),
        })
      }
      // localRows에서 삭제한 행 제거 (참조 동일성으로 매핑)
      const deletedOriginalRows = new Set(rowsToDelete.map((r) => r))
      setLocalRows((prev) => prev.filter((r) => !deletedOriginalRows.has(r)))
      setSelectedRows(new Set())
      lastSelectedRow.current = null
      setFocusedRowIdx(null)
      toast.success(`${sqls.length}${t('gridRowsDeletedSuffix', language)}`)
    } catch (e) {
      toast.error(`${t('gridDeleteFailed', language)}: ${e}`)
    } finally {
      setIsDeleting(false)
    }
  }, [canDelete, editCtx, connId, selectedRows, result.columns, sortedRows, language, setLocalRows, setSelectedRows, lastSelectedRow, setFocusedRowIdx])

  // Delete/Backspace 키 핸들러
  useEffect(() => {
    if (!canDelete || selectedRows.size === 0) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      // 편집 중인 셀이 있으면 무시
      if (editingCell) return
      // 활성 셀(focusedColIdx)이 있으면 Delete = 셀 NULL 처리(useKeyboardNav 담당)라 행 삭제 미발동.
      // 행 삭제는 행 번호 거터로 행을 선택(focusedColIdx=null)했을 때만 키로 트리거한다.
      if (focusedColIdx !== null) return
      // 포커스가 입력 요소(필터/검색/다른 패널 인풋 등)에 있으면 무시 — 그 인풋의 백스페이스를
      // 가로채 행 삭제 컨펌이 뜨던 회귀 방지.
      const el = (e.target as HTMLElement | null) ?? (document.activeElement as HTMLElement | null)
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      e.preventDefault()
      void confirmRowDelete(selectedRows.size, language).then((ok) => {
        if (ok) void deleteSelectedRows()
      })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canDelete, selectedRows, editingCell, focusedColIdx, deleteSelectedRows, language])

  return { isDeleting, deleteSelectedRows }
}
