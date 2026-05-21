import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import toast from 'react-hot-toast'
import { UpdateRowValue } from '@/wailsjs/go/main/App'
import { recordEditOp } from '@/utils/queryLog'
import { t, type Language } from '@/i18n'
import type { ColumnMeta, QueryResult, TableEditContext } from '@/types'
import { validateCellValue } from '../editors/validators'
import { NULL_SENTINEL, type EditingCell } from '../types'

/** UPDATE 표시용 SQL 빌더 — 값은 단순 인용 (table designer 와 동일 정책). */
function buildUpdateSQL(
  database: string,
  table: string,
  column: string,
  newValue: string,
  setNull: boolean,
  pkValues: { column: string; value: string }[],
): string {
  const setClause = setNull
    ? `\`${column}\` = NULL`
    : `\`${column}\` = '${newValue.replace(/'/g, "''")}'`
  const where = pkValues
    .map((p) => `\`${p.column}\` = '${p.value.replace(/'/g, "''")}'`)
    .join(' AND ')
  return `UPDATE \`${database}\`.\`${table}\` SET ${setClause} WHERE ${where} LIMIT 1`
}

interface UseInlineEditArgs {
  result: QueryResult
  canEdit: boolean
  editCtx: TableEditContext | undefined
  connId: string | undefined
  localRows: unknown[][]
  sortedRows: unknown[][]
  setLocalRows: Dispatch<SetStateAction<unknown[][]>>
  effectiveColType: (colName: string, fallback: string) => string
  getEnumValues: (colName: string) => string[]
  language: Language
  /** 편집 성공 시 시각 위치 셀 키(`${rowIdx}-${colIdx}`) 를 본체 recentlyEdited 에 추가 */
  onEditSuccess: (cellKey: string) => void
  /**
   * Commit 모델 선택. 기본 `'immediate'` 는 셀 편집 종료 시 즉시 `UpdateRowValue`
   * 호출(Wave 1 도입 시 회귀 0 동작). `'pending'` 은 dirty 큐(usePendingEdits) 에
   * 적재만 하고 즉시 UPDATE 호출하지 않는다 — 행 이동 시 일괄 commit (Wave 2+).
   */
  commitMode?: 'immediate' | 'pending'
  /** `commitMode = 'pending'` 일 때 호출되는 dirty 큐 enqueue 함수.
   *  rowRef 는 localRows[localRowIdx] (행 삭제 시 인덱스 시프트 안전성 — usePendingEdits 참조). */
  enqueuePending?: (rowRef: unknown[], colIdx: number, edit: { newValue: string; setNull: boolean }) => void
}

/**
 * ResultGrid 본체의 인라인 셀 편집 chain (Phase 47 · Wave 2c).
 *
 * - 시각 인덱스(rowIdx) ↔ 실제 인덱스(localRowIdx) 분리 (BugFix-BO 패턴)
 * - 클라이언트 측 validation (ENUM/SET 허용값 포함) 후 `UpdateRowValue` 호출
 * - 성공 시 `setLocalRows` 로 optimistic update + `onEditSuccess` 콜백
 * - `editingCell` 변경 시 input 자동 focus
 * - `result` 변경 시 `editingCell` reset
 *
 * `recentlyEdited` Set 은 FormView 도 동일 setter 를 사용하므로 본체에 유지하고
 * 콜백으로만 깨운다 (책임 분리).
 */
export function useInlineEdit({
  result,
  canEdit,
  editCtx,
  connId,
  localRows,
  sortedRows,
  setLocalRows,
  effectiveColType,
  getEnumValues,
  language,
  onEditSuccess,
  commitMode = 'immediate',
  enqueuePending,
}: UseInlineEditArgs) {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [editValue, _setEditValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [editEnumValues, setEditEnumValues] = useState<string[]>([])
  const [editAnchorRect, setEditAnchorRect] = useState<DOMRect | undefined>(undefined)
  /**
   * BugFix-CV — Esc 취소 직후 onBlur 가 비동기로 발사돼 stale closure 의 confirmEdit 가
   * 변경값을 enqueue 해버리는 race 방지용 가드 ref. `cancelEdit` 호출 시 true 로 세팅하고
   * `confirmEdit` 가장 앞에서 검사 후 false 로 리셋. 새 `startEdit` 도 진입 시 false 로 초기화.
   * `useState` 가 아닌 `useRef` 인 이유: 동기적으로 가드해야 race 를 잡을 수 있음(state 는 batched).
   */
  const cancelRequestedRef = useRef(false)
  /**
   * BugFix-DD — editValue 최신값 동기 추적 ref. `setTimeout(onConfirm, 0)` 패턴
   * (NULL 버튼 / BooleanEditor / SetEditor 즉시 commit) 에서 `setEditValue(NULL_SENTINEL)`
   * 직후 같은 이벤트 핸들러 안에서 `onConfirm` 을 macrotask 로 큐잉할 때,
   * setTimeout 이 캡처한 `onConfirm` 는 이전 render 의 `confirmEdit` 인데 그
   * confirmEdit 의 closure 안 `editValue` 도 이전 값(NULL_SENTINEL 아님) 이라
   * NULL 처리가 누락되던 회귀. ref 에 동기적으로 최신 값을 적어두고 confirmEdit 가
   * closure 가 아닌 ref 에서 읽도록 한다.
   */
  const editValueRef = useRef('')

  /** setEditValue wrapper — state 갱신과 동시에 ref 도 동기 업데이트(BugFix-DD). */
  const setEditValue = useCallback((v: string | ((prev: string) => string)) => {
    if (typeof v === 'function') {
      _setEditValue((prev) => {
        const next = v(prev)
        editValueRef.current = next
        return next
      })
    } else {
      editValueRef.current = v
      _setEditValue(v)
    }
  }, [])

  useEffect(() => {
    setEditingCell(null)
  }, [result])

  /** 셀 더블클릭 — 편집 모드 시작.
   *  rowIdx 는 시각(정렬·필터 적용 후) 인덱스 → sortedRows 의 행 참조로
   *  localRows 의 실제 인덱스를 찾아 둠 (정렬 활성 시에도 정확한 셀을 변형).
   *
   *  `prefillValue` (Phase 57 키보드 네비용) — 비편집 모드에서 인쇄 가능 문자를
   *  타이핑하면 편집 진입과 함께 그 문자를 editValue 로 시드. undefined 면 셀의
   *  현재 값을 시드(기존 동작). */
  const startEdit = useCallback((rowIdx: number, colIdx: number, colName: string, tdElement?: HTMLElement, prefillValue?: string) => {
    if (!canEdit) return
    const targetRow = sortedRows[rowIdx]
    const localRowIdx = targetRow ? localRows.indexOf(targetRow) : -1
    if (localRowIdx < 0) return
    // BugFix-CV: 새 편집 진입 시 cancel 가드 초기화 (이전 cancel 상태가 새 commit 을 막지 않도록)
    cancelRequestedRef.current = false
    if (prefillValue !== undefined) {
      setEditValue(prefillValue)
    } else {
      const currentVal = localRows[localRowIdx]?.[colIdx]
      setEditValue(currentVal === null || currentVal === undefined ? '' : String(currentVal))
    }
    setEditingCell({ rowIdx, localRowIdx, colIdx, colName })
    setEditAnchorRect(tdElement?.getBoundingClientRect())
    // ENUM/SET 컬럼이면 허용 값 로드 (executor는 ENUM을 CHAR로 보고하므로 schemaMeta 우선)
    const effType = effectiveColType(colName, result.columns[colIdx]?.type ?? '')
    if (effType === 'ENUM' || effType === 'SET') {
      setEditEnumValues(getEnumValues(colName))
    } else {
      setEditEnumValues([])
    }
  }, [canEdit, localRows, sortedRows, result.columns, getEnumValues, effectiveColType])

  /** 편집 취소 — Esc 또는 "취소" 버튼.
   *  `cancelRequestedRef` 를 동기적으로 true 로 세팅해, 직후 onBlur 등으로 발사되는
   *  stale `confirmEdit` 가 변경값을 enqueue 하지 못하도록 가드한다 (BugFix-CV). */
  const cancelEdit = useCallback(() => {
    cancelRequestedRef.current = true
    setEditingCell(null)
  }, [])

  /** 편집 확인 — commitMode 분기.
   *
   *  `immediate` (기본): 즉시 `UpdateRowValue` 호출 + optimistic localRows 반영 + flash.
   *  `pending`        : dirty 큐(usePendingEdits.enqueue) 에 적재하고 editingCell 만 닫음.
   *                     실제 UPDATE 는 행 이동 시 commitRow 가 일괄 처리.
   *
   *  값 읽기·PK 추출·setLocalRows 변형 모두 startEdit 진입 시 확보한 localRowIdx 기준
   *  (시각 인덱스 rowIdx 는 정렬·필터에 따라 흔들리므로 시각 강조에만 사용). */
  const confirmEdit = useCallback(async () => {
    // BugFix-CV: Esc 직후 race 로 발사되는 onBlur 가 stale closure 의 editingCell 을 보고
    // 변경값을 enqueue 하던 회귀 차단. cancelEdit 가 ref 를 true 로 세팅했으면 즉시 no-op.
    if (cancelRequestedRef.current) {
      cancelRequestedRef.current = false
      return
    }
    if (!editingCell || !editCtx || !connId || isSaving) return
    const { rowIdx, localRowIdx, colIdx, colName } = editingCell
    const originalVal = localRows[localRowIdx]?.[colIdx]

    // 값이 변경되지 않았으면 편집 취소
    // BugFix-DD: closure 의 editValue 가 아닌 editValueRef.current 를 읽어 setTimeout(onConfirm, 0)
    // 패턴에서 NULL_SENTINEL 누락되던 회귀 차단 (NULL 버튼 즉시 commit).
    const newValStr = editValueRef.current
    const originalStr = originalVal === null || originalVal === undefined ? '' : String(originalVal)
    if (newValStr === originalStr && newValStr !== NULL_SENTINEL) {
      setEditingCell(null)
      return
    }

    // NULL 센티넬이면 setNull=true, 그렇지 않으면 기존 로직
    const setNull = newValStr === NULL_SENTINEL

    // ── pending 모드: 검증/저장은 commitRow 가 담당 — 여기서는 enqueue 만 ──
    if (commitMode === 'pending') {
      const rowRef = localRows[localRowIdx]
      if (rowRef && enqueuePending) {
        enqueuePending(rowRef, colIdx, { newValue: setNull ? '' : newValStr, setNull })
      }
      setEditingCell(null)
      return
    }

    // ── immediate 모드: 기존 동작 — 클라이언트 검증 후 즉시 UPDATE ──
    const colMeta: ColumnMeta | undefined = result.columns[colIdx]
    if (colMeta && !setNull) {
      const effType = effectiveColType(colName, colMeta.type)
      const v = validateCellValue(newValStr, effType, {
        nullable: colMeta.nullable,
        isNull: false,
        enumValues: (effType === 'ENUM' || effType === 'SET') ? getEnumValues(colName) : undefined,
        language,
      })
      if (!v.ok) {
        toast.error(`${t('validationFailedPrefix', language)} (${colName}): ${v.error}`)
        return
      }
    }

    // PK 값 추출
    const pkValues = editCtx.pkColumns.map((pkCol) => {
      const pkColIdx = result.columns.findIndex((c) => c.name === pkCol)
      const pkVal = pkColIdx >= 0 ? localRows[localRowIdx]?.[pkColIdx] : undefined
      return { column: pkCol, value: pkVal === null || pkVal === undefined ? '' : String(pkVal) }
    })

    setIsSaving(true)
    const updateSql = buildUpdateSQL(editCtx.database, editCtx.table, colName, newValStr, setNull, pkValues)
    const updateStart = Date.now()
    try {
      await UpdateRowValue(connId, editCtx.database, editCtx.table, colName, setNull ? '' : newValStr, setNull, pkValues)
      // BugFix-CW: Messages·history 양쪽에 누적 (UpdateRowValue 는 Go 측 자동 history 저장 우회)
      recordEditOp({
        connId,
        database: editCtx.database,
        sql: updateSql,
        sourceLabel: t('qlLabelCellUpdate', language),
        affected: 1,
        durationMs: Date.now() - updateStart,
      })
      // 로컬 행 데이터 즉시 업데이트
      setLocalRows((prev) => {
        const next = prev.map((r, i) => (i === localRowIdx ? [...r] : r))
        if (next[localRowIdx]) next[localRowIdx][colIdx] = setNull ? null : newValStr
        return next
      })
      setEditingCell(null)
      toast.success(`${colName} 업데이트됨`)
      // 편집 성공 셀 2초 하이라이트 — 시각 위치 기준 (rowIdx). 본체 recentlyEdited 에 위임.
      onEditSuccess(`${rowIdx}-${colIdx}`)
    } catch (e) {
      recordEditOp({
        connId,
        database: editCtx.database,
        sql: updateSql,
        sourceLabel: t('qlLabelCellUpdate', language),
        durationMs: Date.now() - updateStart,
        errorMsg: e instanceof Error ? e.message : String(e),
      })
      // 실패 시 편집 닫기 (onBlur 연속 재시도 방지)
      setEditingCell(null)
      toast.error(`업데이트 실패: ${e}`)
    } finally {
      setIsSaving(false)
    }
  }, [editingCell, editCtx, connId, isSaving, editValue, localRows, result.columns, effectiveColType, getEnumValues, language, setLocalRows, onEditSuccess, commitMode, enqueuePending])

  return {
    editingCell,
    setEditingCell,
    editValue,
    setEditValue,
    isSaving,
    editEnumValues,
    editAnchorRect,
    startEdit,
    cancelEdit,
    confirmEdit,
  }
}
