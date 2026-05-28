import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import toast from 'react-hot-toast'
import { UpdateRowValue } from '@/wailsjs/go/main/App'
import { recordEditOp } from '@/utils/queryLog'
import { t, type Language } from '@/i18n'
import type { ColumnMeta, QueryResult, TableEditContext } from '@/types'
import { validateCellValue } from '../editors/validators'
import { NULL_SENTINEL, type PendingEdit, type PendingRowMap } from '../types'

/** UPDATE 표시용 SQL (usePendingEdits 와 useInlineEdit 가 동일 로직 — 향후 공통화 여지). */
function buildPendingUpdateSQL(
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

interface UsePendingEditsArgs {
  result: QueryResult
  editCtx: TableEditContext | undefined
  connId: string | undefined
  localRows: unknown[][]
  setLocalRows: Dispatch<SetStateAction<unknown[][]>>
  effectiveColType: (colName: string, fallback: string) => string
  getEnumValues: (colName: string) => string[]
  language: Language
  /** commit 성공 컬럼별로 시각 위치 셀 키(`${visualRowIdx}-${colIdx}`)를 yellow flash 시킬 콜백 */
  onCellCommitted: (cellKey: string) => void
}

export interface CommitResult {
  ok: boolean
  /** ok=false 일 때 실패한 컬럼명들 */
  failedCols?: string[]
}

/** 본 hook 의 row key — `localRows[i]` 자체(배열 참조) 를 그대로 사용. */
type RowRef = unknown[]

/**
 * 행 단위 dirty 큐 (Excel-style row-level commit).
 *
 * 셀 편집을 종료해도 즉시 `UpdateRowValue` 를 호출하지 않고 본 hook 의
 * `pending: Map<RowRef, PendingRowMap>` 에 누적한다. 다른 행으로 이동하거나
 * Ctrl+Enter 단축키, "즉시 저장" 버튼이 눌리면 `commitRow` 가 컬럼별로 순차
 * `UpdateRowValue` 를 호출하고 성공 컬럼만 localRows 에 반영한다.
 *
 * **키 설계**: localRowIdx 가 아니라 `RowRef`(=localRows[i] 배열 참조) 를 키로 쓴다.
 * 이유:
 * - 행 삭제 시 localRows 가 shrink 하면 인덱스가 시프트하지만, RowRef 는 동일성
 *   유지 — pending 항목이 잘못된 행을 가리키는 버그(localIdx 시프트 문제) 방지.
 * - 삭제된 행은 localRows 에서 빠지므로 effect 에서 자동 cleanup 가능.
 * - 정렬·필터 변경에도 무관 (localRows ref 그대로).
 * commit 시점에 `localRows.indexOf(rowRef)` 로 현재 위치를 다시 구해 setLocalRows.
 *
 * **부분 실패 정책**: 한 행 N 개 컬럼 중 일부만 성공해도 트랜잭션이 아니라
 * 성공한 컬럼은 localRows 에 반영 + dirty 에서 제거하고, 실패한 컬럼은 dirty 에
 * 유지하며 toast 로 컬럼명을 알린다.
 */
export function usePendingEdits({
  result,
  editCtx,
  connId,
  localRows,
  setLocalRows,
  effectiveColType,
  getEnumValues,
  language,
  onCellCommitted,
}: UsePendingEditsArgs) {
  const [pending, setPending] = useState<Map<RowRef, PendingRowMap>>(new Map())
  const [savingRows, setSavingRows] = useState<Set<RowRef>>(new Set())

  // result 가 바뀌면(탭 전환·재실행) dirty 비움 — 의도된 폐기
  useEffect(() => {
    setPending(new Map())
    setSavingRows(new Set())
  }, [result])

  // localRows 가 줄어들면(행 삭제 등) 더 이상 존재하지 않는 RowRef 의 pending 항목 cleanup.
  // localRows 변경은 행 추가/삭제/commit 으로 자주 발생 — Set lookup 으로 O(N).
  useEffect(() => {
    setPending((prev) => {
      if (prev.size === 0) return prev
      const alive = new Set<RowRef>(localRows)
      let mutated = false
      const next = new Map<RowRef, PendingRowMap>()
      prev.forEach((rowMap, ref) => {
        if (alive.has(ref)) next.set(ref, rowMap)
        else mutated = true
      })
      return mutated ? next : prev
    })
  }, [localRows])

  // pending 의 최신 스냅샷을 동기 접근하기 위한 ref (commit 중 race 회피)
  const pendingRef = useRef(pending)
  useEffect(() => { pendingRef.current = pending }, [pending])

  const dirtyRowCount = pending.size
  const hasDirty = dirtyRowCount > 0

  const getCellPending = useCallback(
    (rowRef: RowRef, colIdx: number): PendingEdit | undefined => {
      return pending.get(rowRef)?.get(colIdx)
    },
    [pending],
  )

  const isSavingRow = useCallback(
    (rowRef: RowRef): boolean => savingRows.has(rowRef),
    [savingRows],
  )

  const isRowDirty = useCallback(
    (rowRef: RowRef): boolean => pending.has(rowRef),
    [pending],
  )

  /**
   * 셀 편집 결과를 dirty 큐에 적재. 같은 셀을 다시 편집해 원본 값으로 돌아오면
   * dirty 에서 제거(빈 행은 행 자체도 제거)한다.
   */
  const enqueue = useCallback(
    (rowRef: RowRef, colIdx: number, edit: { newValue: string; setNull: boolean }) => {
      const originalValue = rowRef[colIdx]
      const originalStr = originalValue === null || originalValue === undefined ? '' : String(originalValue)
      const isOriginalNull = originalValue === null || originalValue === undefined

      // 변경이 사실상 없음 → dirty 에서 제거(있었다면)
      const isNoop =
        (edit.setNull && isOriginalNull) ||
        (!edit.setNull && !isOriginalNull && edit.newValue === originalStr)

      setPending((prev) => {
        const next = new Map(prev)
        const row = new Map(next.get(rowRef) ?? new Map<number, PendingEdit>())
        if (isNoop) {
          row.delete(colIdx)
        } else {
          row.set(colIdx, { newValue: edit.newValue, setNull: edit.setNull, originalValue })
        }
        if (row.size === 0) next.delete(rowRef)
        else next.set(rowRef, row)
        return next
      })
    },
    [],
  )

  /** 행의 dirty 를 모두 폐기 — 값 자체는 localRows 에 손대지 않으므로 즉시 표시도 원복 */
  const discardRow = useCallback((rowRef: RowRef) => {
    setPending((prev) => {
      if (!prev.has(rowRef)) return prev
      const next = new Map(prev)
      next.delete(rowRef)
      return next
    })
  }, [])

  const discardAll = useCallback(() => {
    setPending(new Map())
  }, [])

  /**
   * 한 행의 dirty 를 모두 commit. 컬럼별로 순차 UpdateRowValue 호출.
   * 성공 컬럼은 localRows 반영 + flash + dirty 제거, 실패 컬럼은 dirty 유지.
   *
   * `visualRowIdx` 는 flash cellKey 용 — 호출자가 sortedRows 의 위치를 알고 있음.
   * editCtx/connId 가 없거나 PK 가 비어있으면 즉시 실패 반환.
   * commit 시점에 `localRows.indexOf(rowRef)` 로 현재 인덱스를 다시 구함 (행 삭제·정렬에도 안전).
   */
  const commitRow = useCallback(
    async (rowRef: RowRef, visualRowIdx: number): Promise<CommitResult> => {
      const rowDirty = pendingRef.current.get(rowRef)
      if (!rowDirty || rowDirty.size === 0) return { ok: true }
      if (!editCtx || !connId || editCtx.pkColumns.length === 0) {
        return { ok: false, failedCols: [...rowDirty.keys()].map((c) => result.columns[c]?.name ?? `col#${c}`) }
      }

      // ── 클라이언트 검증 우선 ─ 첫 실패에서 commit 시작 자체를 차단 ─
      for (const [colIdx, edit] of rowDirty) {
        const colMeta: ColumnMeta | undefined = result.columns[colIdx]
        if (!colMeta || edit.setNull) continue
        const effType = effectiveColType(colMeta.name, colMeta.type)
        const v = validateCellValue(edit.newValue, effType, {
          nullable: colMeta.nullable,
          isNull: false,
          enumValues: (effType === 'ENUM' || effType === 'SET') ? getEnumValues(colMeta.name) : undefined,
          language,
        })
        if (!v.ok) {
          toast.error(`${t('validationFailedPrefix', language)} (${colMeta.name}): ${v.error}`)
          return { ok: false, failedCols: [colMeta.name] }
        }
      }

      // PK 값 추출 (rowRef 의 원본 — dirty 가 PK 컬럼을 건드리지 않는다는 전제)
      const pkValues = editCtx.pkColumns.map((pkCol) => {
        const pkColIdx = result.columns.findIndex((c) => c.name === pkCol)
        const pkVal = pkColIdx >= 0 ? rowRef[pkColIdx] : undefined
        return { column: pkCol, value: pkVal === null || pkVal === undefined ? '' : String(pkVal) }
      })

      // 컬럼별 순차 호출 — 부분 실패 허용
      setSavingRows((prev) => { const n = new Set(prev); n.add(rowRef); return n })
      const failedCols: string[] = []
      const succeeded: Array<{ colIdx: number; setNull: boolean; newValue: string }> = []
      try {
        for (const [colIdx, edit] of rowDirty) {
          const colMeta = result.columns[colIdx]
          if (!colMeta) continue
          // BugFix-CW: 컬럼별 UPDATE 도 Messages·history 양쪽에 누적
          const sql = buildPendingUpdateSQL(editCtx.database, editCtx.table, colMeta.name, edit.newValue, edit.setNull, pkValues)
          const start = Date.now()
          try {
            await UpdateRowValue(
              connId,
              editCtx.database,
              editCtx.table,
              colMeta.name,
              edit.setNull ? '' : edit.newValue,
              edit.setNull,
              pkValues,
            )
            recordEditOp({
              connId,
              database: editCtx.database,
              sql,
              sourceLabel: t('qlLabelCellUpdate', language),
              affected: 1,
              durationMs: Date.now() - start,
            })
            succeeded.push({ colIdx, setNull: edit.setNull, newValue: edit.newValue })
          } catch (e) {
            recordEditOp({
              connId,
              database: editCtx.database,
              sql,
              sourceLabel: t('qlLabelCellUpdate', language),
              durationMs: Date.now() - start,
              errorMsg: e instanceof Error ? e.message : String(e),
            })
            failedCols.push(`${colMeta.name} (${String(e)})`)
          }
        }
      } finally {
        setSavingRows((prev) => { const n = new Set(prev); n.delete(rowRef); return n })
      }

      // 성공한 컬럼만 localRows 반영. commit 시점의 현재 인덱스를 다시 lookup.
      if (succeeded.length > 0) {
        setLocalRows((prev) => {
          const localIdx = prev.indexOf(rowRef)
          if (localIdx < 0) return prev
          const next = prev.map((r, i) => (i === localIdx ? [...r] : r))
          const row = next[localIdx]
          if (row) {
            for (const s of succeeded) {
              row[s.colIdx] = s.setNull ? null : s.newValue
            }
          }
          return next
        })
        // dirty 에서 성공 컬럼 제거 (실패는 유지).
        // setLocalRows 로 인해 row ref 가 새로 바뀌므로 pending 키도 갱신해야 함.
        // 하지만 setPending 시점에 새 ref 를 알 수 없음 → setLocalRows 의 callback 안에서
        // 동기적으로 처리하는 대신, 다음 effect(localRows 변경) cleanup 에서 잡힌다.
        // 따라서 일단 기존 ref 키로 dirty 컬럼 제거하고, 새 ref 에는 pending 항목 없음(올바름).
        setPending((prev) => {
          if (!prev.has(rowRef)) return prev
          const next = new Map(prev)
          const rowMap = new Map(next.get(rowRef)!)
          for (const s of succeeded) rowMap.delete(s.colIdx)
          if (rowMap.size === 0) next.delete(rowRef)
          else next.set(rowRef, rowMap)
          return next
        })
        // 2초 yellow flash — 시각 위치 기준
        for (const s of succeeded) onCellCommitted(`${visualRowIdx}-${s.colIdx}`)
      }

      if (failedCols.length > 0) {
        toast.error(
          (language === 'ko' ? '일부 컬럼 저장 실패: ' : 'Some columns failed: ') + failedCols.join(', '),
        )
        return { ok: false, failedCols }
      }
      return { ok: true }
    },
    [editCtx, connId, result.columns, effectiveColType, getEnumValues, language, setLocalRows, onCellCommitted],
  )

  /**
   * 전체 dirty 행을 순차 commit. 실패한 행이 있어도 다음 행 계속 진행.
   * visualRowIdx 매핑은 localRows.indexOf 로 추정(정렬 무시) — 일괄 저장은 상태바 버튼 등
   * 명시적 호출에서만 사용되므로 flash 위치 정밀도는 best-effort.
   */
  const commitAll = useCallback(async (): Promise<void> => {
    const snapshot = [...pendingRef.current.keys()]
    for (const rowRef of snapshot) {
      const visualRowIdx = localRows.indexOf(rowRef)
      await commitRow(rowRef, visualRowIdx >= 0 ? visualRowIdx : 0)
    }
  }, [commitRow, localRows])

  // NULL_SENTINEL 사용처에서 newValue 변환 헬퍼 — 외부에서 enqueue 전 변환을 까먹지 않도록 노출
  const normalizeEdit = useCallback(
    (rawValue: string): { newValue: string; setNull: boolean } => {
      if (rawValue === NULL_SENTINEL) return { newValue: '', setNull: true }
      return { newValue: rawValue, setNull: false }
    },
    [],
  )

  return {
    pending,
    dirtyRowCount,
    hasDirty,
    getCellPending,
    isRowDirty,
    isSavingRow,
    enqueue,
    discardRow,
    discardAll,
    commitRow,
    commitAll,
    normalizeEdit,
  }
}
