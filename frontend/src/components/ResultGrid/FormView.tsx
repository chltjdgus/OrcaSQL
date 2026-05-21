import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Lock, LockOpen } from 'lucide-react'
import toast from 'react-hot-toast'
import { ListColumns, UpdateRowValue } from '@/wailsjs/go/main/App'
import { recordEditOp } from '@/utils/queryLog'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import type { QueryResult, TableEditContext, ColumnMeta } from '@/types'
import { IndexFlagBadges } from '@/components/common/IndexFlagIcon'
import { getCellEditor } from './editors'
import { validateCellValue } from './editors/validators'
import type { TableSchemaMeta } from './types'

function buildFormUpdateSQL(
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

interface FormViewProps {
  result: QueryResult
  rowIdx: number
  onNavigate: (idx: number) => void
  editCtx?: TableEditContext
  connId?: string
  rows: unknown[][]
  schemaMeta: TableSchemaMeta | null
  onRowUpdate?: (rowIdx: number, colIdx: number, value: unknown) => void
}

export default function FormView({
  result,
  rowIdx,
  onNavigate,
  editCtx,
  connId,
  rows,
  schemaMeta,
  onRowUpdate,
}: FormViewProps) {
  const language = useLanguageStore((s) => s.language)
  const totalRows = rows.length
  const safeIdx = Math.min(Math.max(rowIdx, 0), totalRows - 1)
  const row = rows[safeIdx] ?? []

  const [isLocked, setIsLocked] = useState(true)
  const [unlockHint, setUnlockHint] = useState(false)
  const [formSaving, setFormSaving] = useState<number | null>(null)

  const canEdit = !!(editCtx && connId && editCtx.pkColumns.length > 0)

  // 행 이동 시 잠금 상태 초기화
  const handleNavigate = useCallback((idx: number) => {
    setIsLocked(true)
    setUnlockHint(false)
    onNavigate(idx)
  }, [onNavigate])

  const triggerUnlock = useCallback(() => {
    setIsLocked(false)
    setUnlockHint(true)
    setTimeout(() => setUnlockHint(false), 2500)
  }, [])

  const handleCommit = useCallback(async (colIdx: number, colName: string, newValue: string, setNull: boolean) => {
    if (!editCtx || !connId) return

    // ── 클라이언트 측 타입 검증 ──────────────────────────────────────────
    const colMeta = result.columns[colIdx]
    if (colMeta && !setNull) {
      const info = schemaMeta?.columns.get(colName)
      const effType = (info?.dataType ? info.dataType.toUpperCase() : colMeta.type)
      const enumVals = (effType === 'ENUM' || effType === 'SET') && info?.columnType
        ? info.columnType.match(/^(?:enum|set)\((.+)\)$/i)?.[1]
            .split(',').map((v) => v.trim().replace(/^'|'$/g, '')) ?? []
        : undefined
      const v = validateCellValue(newValue, effType, {
        nullable: colMeta.nullable,
        isNull: false,
        enumValues: enumVals,
        language,
      })
      if (!v.ok) {
        toast.error(`${t('validationFailedPrefix', language)} (${colName}): ${v.error}`)
        return
      }
    }

    const pkValues = editCtx.pkColumns.map((pkCol) => {
      const pkColIdx = result.columns.findIndex((c) => c.name === pkCol)
      const pkVal = pkColIdx >= 0 ? row[pkColIdx] : undefined
      return { column: pkCol, value: pkVal === null || pkVal === undefined ? '' : String(pkVal) }
    })
    setFormSaving(colIdx)
    const formSql = buildFormUpdateSQL(editCtx.database, editCtx.table, colName, newValue, setNull, pkValues)
    const formStart = Date.now()
    try {
      await UpdateRowValue(connId, editCtx.database, editCtx.table, colName, setNull ? '' : newValue, setNull, pkValues)
      recordEditOp({
        connId,
        database: editCtx.database,
        sql: formSql,
        sourceLabel: t('qlLabelCellUpdate', language),
        affected: 1,
        durationMs: Date.now() - formStart,
      })
      onRowUpdate?.(safeIdx, colIdx, setNull ? null : newValue)
      toast.success(`${colName} 업데이트됨`)
    } catch (e) {
      recordEditOp({
        connId,
        database: editCtx.database,
        sql: formSql,
        sourceLabel: t('qlLabelCellUpdate', language),
        durationMs: Date.now() - formStart,
        errorMsg: e instanceof Error ? e.message : String(e),
      })
      toast.error(`업데이트 실패: ${e}`)
    } finally {
      setFormSaving(null)
    }
  }, [editCtx, connId, row, result.columns, safeIdx, onRowUpdate, schemaMeta, language])

  return (
    <div className="osql-result-grid-form-view flex-1 overflow-hidden flex flex-col">
      {/* 네비게이션 바 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
        {/* 잠금/잠금해제 버튼 — 편집 가능한 경우만 표시 */}
        {canEdit && (
          <button
            onClick={() => isLocked ? triggerUnlock() : setIsLocked(true)}
            className={`p-1 rounded transition-colors mr-0.5 ${
              isLocked
                ? 'text-[var(--color-text-muted)] hover:text-[var(--color-warning)] hover:bg-[var(--color-bg-hover)]'
                : 'text-[var(--color-warning)] bg-[var(--color-warning)]/10 hover:text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]'
            }`}
            title={isLocked ? t('formViewUnlockTitle', language) : t('formViewLockTitle', language)}
          >
            {isLocked ? <Lock size={13} /> : <LockOpen size={13} />}
          </button>
        )}

        {/* 구분선 */}
        {canEdit && <div className="w-px h-4 bg-[var(--color-border)] shrink-0" />}

        <button
          onClick={() => handleNavigate(0)}
          disabled={safeIdx === 0}
          className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-30 transition-colors"
          title="첫 행"
        >
          <span className="text-[10px]">|◀</span>
        </button>
        <button
          onClick={() => handleNavigate(safeIdx - 1)}
          disabled={safeIdx === 0}
          className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-30 transition-colors"
          title="이전 행"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-[11px] text-[var(--color-text-muted)]">
          <span className="text-[var(--color-text-primary)] font-medium">{safeIdx + 1}</span>
          {' '}/{' '}{totalRows.toLocaleString()}
        </span>
        <button
          onClick={() => handleNavigate(safeIdx + 1)}
          disabled={safeIdx >= totalRows - 1}
          className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-30 transition-colors"
          title="다음 행"
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={() => handleNavigate(totalRows - 1)}
          disabled={safeIdx >= totalRows - 1}
          className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-30 transition-colors"
          title="마지막 행"
        >
          <span className="text-[10px]">▶|</span>
        </button>
      </div>

      {/* 잠금 해제 힌트 배너 */}
      {unlockHint && (
        <div className="px-3 py-1 bg-[var(--color-warning)]/10 border-b border-[var(--color-warning)]/25 text-[10px] text-[var(--color-warning)] flex items-center gap-1.5 shrink-0 animate-pulse">
          <LockOpen size={10} />
          {t('formViewUnlockHint', language)}
        </div>
      )}

      {/* 폼 필드 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl space-y-2">
          {result.columns.map((col, i) => {
            const isPK = editCtx?.pkColumns.includes(col.name) ?? false
            const editable = canEdit && !isPK
            const schemaCol = schemaMeta?.columns.get(col.name)
            const displayType = schemaCol?.dataType ? schemaCol.dataType.toUpperCase() : col.type
            const metaForCell = displayType === col.type ? col : { ...col, type: displayType }
            const flags = schemaMeta?.flags.get(col.name)
            return (
              <div key={col.name} className="flex items-start gap-3">
                <div className="w-40 shrink-0 flex items-center justify-end pt-1.5 gap-1">
                  {flags && flags.size > 0 && <IndexFlagBadges flags={flags} language={language} />}
                  <span className="text-[11px] text-[var(--color-text-muted)] truncate text-right" title={col.name}>
                    {col.name}
                  </span>
                  <span className="ml-1.5 text-[9px] text-[var(--color-null)] bg-[var(--color-bg-tertiary)] px-1 py-0.5 rounded shrink-0">
                    {displayType}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <FormCell
                    value={row[i]}
                    colName={col.name}
                    columnMeta={metaForCell}
                    editable={editable}
                    isLocked={isLocked}
                    isSaving={formSaving === i}
                    onDoubleClickLocked={editable ? triggerUnlock : undefined}
                    onCommit={editable ? (v, setNull) => handleCommit(i, col.name, v, setNull) : undefined}
                    lockedCursorHint={t('formViewLockedCursorHint', language)}
                    connId={connId}
                    editCtx={editCtx}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface FormCellProps {
  value: unknown
  colName?: string
  columnMeta?: ColumnMeta
  editable?: boolean
  isLocked?: boolean
  isSaving?: boolean
  onDoubleClickLocked?: () => void
  onCommit?: (value: string, setNull: boolean) => void | Promise<void>
  lockedCursorHint?: string
  connId?: string
  editCtx?: TableEditContext
}

function FormCell({
  value,
  colName,
  columnMeta,
  editable = false,
  isLocked = true,
  isSaving = false,
  onDoubleClickLocked,
  onCommit,
  lockedCursorHint,
  connId,
  editCtx,
}: FormCellProps) {
  const nullText = useSettingsStore((s) => s.settings.display.nullDisplayText)
  const [localValue, setLocalValue] = useState(() => value === null || value === undefined ? '' : String(value))
  const [isNull, setIsNull] = useState(value === null || value === undefined)
  const [formEnumValues, setFormEnumValues] = useState<string[]>([])

  // 행 이동 등으로 value가 바뀌면 로컬 상태 동기화
  useEffect(() => {
    setLocalValue(value === null || value === undefined ? '' : String(value))
    setIsNull(value === null || value === undefined)
  }, [value])

  // ENUM/SET 값 로드 (잠금 해제 시)
  useEffect(() => {
    if (!editable || isLocked || !columnMeta || !connId || !editCtx) return
    const ct = columnMeta.type.toUpperCase()
    if (ct !== 'ENUM' && ct !== 'SET') return
    void (async () => {
      try {
        const cols = await ListColumns(connId, editCtx.database, editCtx.table)
        const colInfo = cols.find((c) => c.name === columnMeta.name)
        if (!colInfo) return
        const match = colInfo.columnType.match(/^(?:enum|set)\((.+)\)$/i)
        if (!match) return
        setFormEnumValues(match[1].split(',').map((v) => v.trim().replace(/^'|'$/g, '')))
      } catch { /* ignore */ }
    })()
  }, [editable, isLocked, columnMeta, connId, editCtx])

  const handleCommit = useCallback(async () => {
    const originalStr = value === null || value === undefined ? '' : String(value)
    const originalIsNull = value === null || value === undefined
    if (isNull === originalIsNull && localValue === originalStr) return // 변경 없음
    await onCommit?.(localValue, isNull)
  }, [value, localValue, isNull, onCommit])

  const str = value === null || value === undefined ? '' : String(value)
  const displayIsLong = str.length > 80

  // ── 편집 가능 & 잠금 해제 상태 ──────────────────────────────────────────
  if (editable && !isLocked) {
    // 타입별 에디터 사용
    const EditorComp = columnMeta ? getCellEditor(columnMeta.type) : null
    if (EditorComp) {
      return (
        <EditorComp
          value={localValue}
          isNull={isNull}
          onChange={(v) => { setLocalValue(v); setIsNull(false) }}
          onSetNull={() => { setIsNull(true); setLocalValue('') }}
          onConfirm={() => void handleCommit()}
          onCancel={() => { setLocalValue(str); setIsNull(value === null || value === undefined) }}
          disabled={isSaving}
          columnMeta={columnMeta!}
          nullable={columnMeta!.nullable}
          mode="form"
          enumValues={formEnumValues}
        />
      )
    }

    // 기본 에디터 (기존 로직 유지)
    const editLen = Math.max(str.length, localValue.length)
    if (displayIsLong || editLen > 80) {
      return (
        <textarea
          value={isNull ? '' : localValue}
          placeholder={isNull ? (nullText || 'NULL') : colName}
          onChange={(e) => { setLocalValue(e.target.value); setIsNull(false) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleCommit() }
            if (e.key === 'Escape') { setLocalValue(str); setIsNull(value === null || value === undefined) }
          }}
          onBlur={() => void handleCommit()}
          disabled={isSaving}
          rows={Math.min(5, Math.max(2, Math.ceil(editLen / 80)))}
          className={`w-full px-2 py-1.5 text-xs rounded border bg-[var(--color-bg-primary)] resize-y outline-none transition-colors disabled:opacity-50
            ${isNull
              ? 'italic text-[var(--color-null)] border-[var(--color-border)] focus:border-[var(--color-accent)]'
              : 'text-[var(--color-text-primary)] border-[var(--color-accent)]/60 focus:border-[var(--color-accent)]'}`}
        />
      )
    }
    return (
      <input
        autoFocus
        value={isNull ? '' : localValue}
        placeholder={isNull ? (nullText || 'NULL') : colName}
        onChange={(e) => { setLocalValue(e.target.value); setIsNull(false) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void handleCommit() }
          if (e.key === 'Escape') { setLocalValue(str); setIsNull(value === null || value === undefined) }
          if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setIsNull(true); setLocalValue('') }
        }}
        onBlur={() => void handleCommit()}
        disabled={isSaving}
        className={`w-full h-8 px-2 text-xs rounded border bg-[var(--color-bg-primary)] outline-none transition-colors disabled:opacity-50
          ${isNull
            ? 'italic text-[var(--color-null)] border-[var(--color-border)] focus:border-[var(--color-accent)]'
            : 'text-[var(--color-text-primary)] border-[var(--color-accent)]/60 focus:border-[var(--color-accent)]'}`}
      />
    )
  }

  // ── 읽기 전용 표시 (잠금 상태이거나 편집 불가) ──────────────────────────
  const lockedEditableCls = editable && isLocked
    ? 'cursor-text hover:border-[var(--color-accent)]/40'
    : ''
  const lockedTitle = editable && isLocked ? lockedCursorHint : undefined

  if (value === null || value === undefined) {
    return (
      <div
        className={`h-8 px-2 flex items-center rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] ${lockedEditableCls}`}
        onDoubleClick={editable && isLocked ? onDoubleClickLocked : undefined}
        title={lockedTitle}
      >
        <span className="text-[10px] text-[var(--color-null)] italic">{nullText || <>&nbsp;</>}</span>
      </div>
    )
  }

  if (displayIsLong) {
    return (
      <textarea
        readOnly
        value={str}
        rows={Math.min(5, Math.ceil(str.length / 80))}
        onDoubleClick={editable && isLocked ? onDoubleClickLocked : undefined}
        title={lockedTitle}
        className={`w-full px-2 py-1.5 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] resize-y focus:outline-none focus:border-[var(--color-accent)] transition-colors ${lockedEditableCls}`}
      />
    )
  }

  return (
    <div
      className={`h-8 px-2 flex items-center rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-xs text-[var(--color-text-primary)] overflow-hidden transition-colors ${lockedEditableCls}`}
      title={lockedTitle ?? (str.length > 40 ? str : undefined)}
      onDoubleClick={editable && isLocked ? onDoubleClickLocked : undefined}
    >
      {typeof value === 'number'
        ? <span className="text-[var(--color-warning)]">{value.toLocaleString()}</span>
        : typeof value === 'boolean'
        ? <span className={value ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>{str}</span>
        : str
      }
    </div>
  )
}
