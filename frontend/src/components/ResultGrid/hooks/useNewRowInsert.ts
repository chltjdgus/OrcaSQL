import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import toast from 'react-hot-toast'
import { InsertRow } from '@/wailsjs/go/main/App'
import { recordEditOp, runLoggedQuery } from '@/utils/queryLog'
import { t, type Language } from '@/i18n'
import type { QueryResult, TableEditContext } from '@/types'
import { validateCellValue } from '../editors/validators'
import { NULL_SENTINEL } from '../types'

/** UPDATE/INSERT 표시용 SQL — 값을 그대로 인용 (역따옴표 escape 만 처리). */
function quoteSQLValue(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

function buildInsertSQL(database: string, table: string, cols: { column: string; value: string; setNull: boolean }[]): string {
  const colList = cols.map((c) => `\`${c.column}\``).join(', ')
  const valList = cols.map((c) => (c.setNull ? 'NULL' : quoteSQLValue(c.value))).join(', ')
  return `INSERT INTO \`${database}\`.\`${table}\` (${colList}) VALUES (${valList})`
}

interface UseNewRowInsertArgs {
  result: QueryResult
  editCtx: TableEditContext | undefined
  connId: string | undefined
  effectiveColType: (colName: string, fallback: string) => string
  getEnumValues: (colName: string) => string[]
  language: Language
  setLocalRows: Dispatch<SetStateAction<unknown[][]>>
}

/**
 * ResultGrid 본체의 신규 행 인라인 삽입 chain (Phase 47 · Wave 2c).
 *
 * - `newRow` 가 비어있지 않으면 그리드에 inline 입력 위젯 노출
 * - `insertAfterRowIdx` 가 null 이면 그리드 맨 아래, 그렇지 않으면 그 행 직후
 * - `confirmInsert` 호출 시 빈 필드 제외 (AUTO_INCREMENT 등 DB 기본값 처리)
 * - 클라이언트 측 validation 후 `InsertRow` + 원본 SQL 재실행으로 `localRows` 새로고침
 * - `result` 변경 시 `newRow`/`insertAfterRowIdx` reset
 */
export function useNewRowInsert({
  result,
  editCtx,
  connId,
  effectiveColType,
  getEnumValues,
  language,
  setLocalRows,
}: UseNewRowInsertArgs) {
  const [newRow, setNewRow] = useState<Record<string, string> | null>(null)
  const [isInserting, setIsInserting] = useState(false)
  /** 신규 행을 어떤 기존 행 바로 아래에 그릴지 — null 이면 그리드 맨 아래(기존 동작) */
  const [insertAfterRowIdx, setInsertAfterRowIdx] = useState<number | null>(null)

  useEffect(() => {
    setNewRow(null)
    setInsertAfterRowIdx(null)
  }, [result])

  /** 신규 행 삽입 확인 — InsertRow 호출 후 그리드 새로고침 */
  const confirmInsert = useCallback(async () => {
    if (!newRow || !editCtx || !connId || isInserting) return
    // 빈 필드 제외 (AUTO_INCREMENT 등 DB 기본값 처리)
    const columnValues = (Object.entries(newRow) as [string, string][])
      .filter(([, val]) => val !== '')
      .map(([col, val]) => ({
        column: col,
        value: val === NULL_SENTINEL ? '' : val,
        setNull: val === NULL_SENTINEL,
      }))
    if (columnValues.length === 0) { setNewRow(null); setInsertAfterRowIdx(null); return }

    // ── 클라이언트 측 타입 검증 ─────────────────────────────────────────
    for (const cv of columnValues) {
      if (cv.setNull) continue
      const colMeta = result.columns.find((c) => c.name === cv.column)
      if (!colMeta) continue
      const effType = effectiveColType(cv.column, colMeta.type)
      const v = validateCellValue(cv.value, effType, {
        nullable: colMeta.nullable,
        isNull: false,
        enumValues: (effType === 'ENUM' || effType === 'SET') ? getEnumValues(cv.column) : undefined,
        language,
      })
      if (!v.ok) {
        toast.error(`${t('validationFailedPrefix', language)} (${cv.column}): ${v.error}`)
        return
      }
    }

    setIsInserting(true)
    // BugFix-CW: InsertRow 는 Go 측이 history 에 저장하지 않는 우회 경로 → Messages·history 양쪽에 명시 기록
    const insertSql = buildInsertSQL(editCtx.database, editCtx.table, columnValues)
    const insertStart = Date.now()
    try {
      await InsertRow(connId, editCtx.database, editCtx.table, columnValues)
      recordEditOp({
        connId,
        database: editCtx.database,
        sql: insertSql,
        sourceLabel: t('qlLabelRowInsert', language),
        affected: 1,
        durationMs: Date.now() - insertStart,
      })
      // 원본 쿼리 재실행으로 그리드 새로고침 (DB 기본값·AUTO_INCREMENT 반영) — Messages 누적
      const freshResult = await runLoggedQuery({
        connId,
        database: editCtx.database,
        sql: result.sql,
        sourceLabel: t('qlLabelRowReload', language),
      })
      setLocalRows([...(freshResult.rows ?? [])])
      setNewRow(null)
      setInsertAfterRowIdx(null)
      toast.success('행이 추가되었습니다')
    } catch (e) {
      recordEditOp({
        connId,
        database: editCtx.database,
        sql: insertSql,
        sourceLabel: t('qlLabelRowInsert', language),
        durationMs: Date.now() - insertStart,
        errorMsg: e instanceof Error ? e.message : String(e),
      })
      toast.error(`삽입 실패: ${e}`)
    } finally {
      setIsInserting(false)
    }
  }, [newRow, editCtx, connId, isInserting, result.sql, result.columns, effectiveColType, getEnumValues, language, setLocalRows])

  return {
    newRow,
    setNewRow,
    isInserting,
    insertAfterRowIdx,
    setInsertAfterRowIdx,
    confirmInsert,
  }
}
