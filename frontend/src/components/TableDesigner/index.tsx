import { useState, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { X, Plus, Trash2, Check, RefreshCw, GripVertical, ArrowUp, ArrowDown } from 'lucide-react'
import toast from 'react-hot-toast'
import ContextMenu, { type ContextMenuOption } from '@/components/ContextMenu'
import {
  GetTableDefinition,
  GenerateAlterSQL,
  ExecuteAlterTable,
} from '@/wailsjs/go/main/App'
import type { TableDefinition, ColumnDef, IndexDef, ForeignKeyDef } from '@/types'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t, type Language } from '@/i18n'

interface Props {
  connId: string
  database: string
  table: string
  onClose: () => void
}

type Tab = 'columns' | 'indexes' | 'foreignkeys' | 'options' | 'ddl'

const DATA_TYPES = [
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
  'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC',
  'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYTEXT',
  'BLOB', 'MEDIUMBLOB', 'LONGBLOB', 'TINYBLOB',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'BOOLEAN', 'BIT', 'ENUM', 'SET', 'JSON',
]

const FK_RULES = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION']

/**
 * SQLyog 스타일 Table Designer.
 * 컬럼/인덱스/외래키 탭 + DDL 미리보기 + Apply 버튼.
 */
export default function TableDesigner({ connId, database, table, onClose }: Props) {
  const language = useLanguageStore((s) => s.language)
  const [activeTab, setActiveTab] = useState<Tab>('columns')
  const [original, setOriginal] = useState<TableDefinition | null>(null)
  const [current, setCurrent] = useState<TableDefinition | null>(null)
  const [alterSQL, setAlterSQL] = useState('')
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)

  // ── 초기 로드 ────────────────────────────────────────────────────────
  const loadDefinition = useCallback(async () => {
    setLoading(true)
    try {
      const def = await GetTableDefinition(connId, database, table)
      setOriginal(JSON.parse(JSON.stringify(def)) as TableDefinition)
      setCurrent(def)
    } catch (e) {
      toast.error(`${t('tdLoadFailPrefix', language)}${e}`)
    } finally {
      setLoading(false)
    }
  }, [connId, database, table])

  useEffect(() => { loadDefinition() }, [loadDefinition])

  // ── DDL 미리보기 자동 갱신 ────────────────────────────────────────────
  useEffect(() => {
    if (!original || !current) { setAlterSQL(''); return }
    GenerateAlterSQL(database, table, original, current)
      .then((stmt) => setAlterSQL(stmt.sql || t('tdNoChangeComment', language)))
      .catch(() => setAlterSQL(t('tdSqlGenFail', language)))
  }, [current, original, database, table, language])

  // ── Apply ─────────────────────────────────────────────────────────────
  async function handleApply() {
    if (!alterSQL || alterSQL.startsWith('--')) {
      toast(t('tdsNoChanges', language))
      return
    }
    setApplying(true)
    try {
      await ExecuteAlterTable(connId, alterSQL)
      toast.success(t('tdAlterDone', language))
      await loadDefinition()
    } catch (e) {
      toast.error(`${t('tdApplyFailPrefix', language)}${e}`)
    } finally {
      setApplying(false)
    }
  }

  if (loading || !current) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
        <RefreshCw size={16} className="animate-spin mr-2" /> {t('tdLoadingStructure', language)}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
          {database}.{table}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)] ml-1">Table Designer</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleApply}
            disabled={applying}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors disabled:opacity-50"
          >
            <Check size={12} />
            {applying ? t('tdApplying', language) : 'Apply'}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 탭 바 */}
      <div className="flex border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
        {(['columns', 'indexes', 'foreignkeys', 'options', 'ddl'] as Tab[]).map((tb) => (
          <button
            key={tb}
            onClick={() => setActiveTab(tb)}
            className={`px-4 py-2 text-xs capitalize transition-colors border-b-2 ${
              activeTab === tb
                ? 'border-[var(--color-accent)] text-[var(--color-text-primary)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {tabLabel(tb, language)}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'columns' && (
          <ColumnsTab
            columns={current.columns ?? []}
            onChange={(cols) => setCurrent((prev) => prev ? { ...prev, columns: cols } : prev)}
          />
        )}
        {activeTab === 'indexes' && (
          <IndexesTab
            indexes={current.indexes ?? []}
            columns={(current.columns ?? []).map((c) => c.name)}
            onChange={(idxs) => setCurrent((prev) => prev ? { ...prev, indexes: idxs } : prev)}
          />
        )}
        {activeTab === 'foreignkeys' && (
          <ForeignKeysTab
            fks={current.foreignKeys ?? []}
            columns={(current.columns ?? []).map((c) => c.name)}
            onChange={(fks) => setCurrent((prev) => prev ? { ...prev, foreignKeys: fks } : prev)}
          />
        )}
        {activeTab === 'options' && (
          <OptionsTab
            def={current}
            onChange={(opts) => setCurrent((prev) => prev ? { ...prev, ...opts } : prev)}
          />
        )}
        {activeTab === 'ddl' && (
          <div className="h-full">
            <Editor
              language="sql"
              value={alterSQL}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                padding: { top: 8 },
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Columns 탭 ──────────────────────────────────────────────────────────────

function ColumnsTab({
  columns,
  onChange,
}: {
  columns: ColumnDef[]
  onChange: (cols: ColumnDef[]) => void
}) {
  const language = useLanguageStore((s) => s.language)
  const [selected, setSelected] = useState<number>(0)

  function updateCol(idx: number, patch: Partial<ColumnDef>) {
    const next = columns.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    onChange(next)
  }

  function addColumn() {
    const newCol: ColumnDef = {
      name: `col${columns.length + 1}`,
      dataType: 'VARCHAR',
      length: '255',
      notNull: false,
      default: '',
      autoInc: false,
      primaryKey: false,
      unique: false,
      unsigned: false,
      zeroFill: false,
      comment: '',
      ordinalPos: columns.length + 1,
      collation: '',
      onUpdate: '',
    }
    onChange([...columns, newCol])
    setSelected(columns.length)
  }

  function removeColumn(idx: number) {
    onChange(columns.filter((_, i) => i !== idx))
    setSelected(Math.max(0, idx - 1))
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* 컬럼 목록 */}
      <div className="w-56 border-r border-[var(--color-border)] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-2 py-1 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0">
          <span className="text-[10px] text-[var(--color-text-muted)]">{t('tdColumnList', language)}</span>
          <button
            onClick={addColumn}
            className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-success)] hover:bg-[var(--color-border)] transition-colors"
            title={t('tdAddColumn', language)}
          >
            <Plus size={12} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {columns.map((col, i) => (
            <div
              key={i}
              onClick={() => setSelected(i)}
              className={`group flex items-center justify-between px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                selected === i ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-tertiary)]'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {col.primaryKey && <span className="text-[var(--color-pk)] text-[9px]">PK</span>}
                <span className="truncate">{col.name || '(unnamed)'}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeColumn(i) }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-[var(--color-error)] hover:bg-[var(--color-border)] transition-opacity shrink-0"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 컬럼 편집 폼 */}
      <div className="flex-1 overflow-y-auto p-4">
        {columns[selected] ? (
          <ColEditForm
            col={columns[selected]}
            onChange={(patch) => updateCol(selected, patch)}
          />
        ) : (
          <div className="text-[var(--color-text-muted)] text-sm text-center mt-8">
            {t('tdSelectOrAddColumn', language)}
          </div>
        )}
      </div>
    </div>
  )
}

function ColEditForm({ col, onChange }: { col: ColumnDef; onChange: (p: Partial<ColumnDef>) => void }) {
  const language = useLanguageStore((s) => s.language)
  return (
    <div className="grid grid-cols-2 gap-3 max-w-lg">
      <Field label={t('tdColName', language)}>
        <input
          value={col.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label={t('tdDataType', language)}>
        <select
          value={col.dataType}
          onChange={(e) => onChange({ dataType: e.target.value })}
          className={inputCls}
        >
          {DATA_TYPES.map((dt) => <option key={dt}>{dt}</option>)}
        </select>
      </Field>
      <Field label={t('tdLengthValue', language)}>
        <input
          value={col.length}
          onChange={(e) => onChange({ length: e.target.value })}
          placeholder={t('tdPhLength', language)}
          className={inputCls}
        />
      </Field>
      <Field label={t('tdDefault', language)}>
        <input
          value={col.default}
          onChange={(e) => onChange({ default: e.target.value })}
          placeholder="NULL"
          className={inputCls}
        />
      </Field>
      <Field label="ON UPDATE">
        <input
          value={col.onUpdate}
          onChange={(e) => onChange({ onUpdate: e.target.value })}
          placeholder="CURRENT_TIMESTAMP"
          className={inputCls}
        />
      </Field>
      <Field label={t('tdComment', language)}>
        <input
          value={col.comment}
          onChange={(e) => onChange({ comment: e.target.value })}
          className={inputCls}
        />
      </Field>

      <div className="col-span-2 flex flex-wrap gap-4 mt-1">
        {(
          [
            ['notNull', 'NOT NULL'],
            ['primaryKey', 'Primary Key'],
            ['autoInc', 'Auto Increment'],
            ['unique', 'Unique'],
          ] as [keyof ColumnDef, string][]
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!col[key]}
              onChange={(e) => onChange({ [key]: e.target.checked } as Partial<ColumnDef>)}
              className="rounded border-[var(--color-border)] bg-[var(--color-bg-tertiary)] accent-[var(--color-accent)]"
            />
            <span className="text-[var(--color-text-subtle)]">{label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

// ─── Indexes 탭 ──────────────────────────────────────────────────────────────

function IndexesTab({
  indexes,
  columns,
  onChange,
}: {
  indexes: IndexDef[]
  columns: string[]
  onChange: (idxs: IndexDef[]) => void
}) {
  const language = useLanguageStore((s) => s.language)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; idxI: number } | null>(null)
  const [dragSrcIdx, setDragSrcIdx] = useState<number | null>(null)
  const [dragSrcCol, setDragSrcCol] = useState<{ idxI: number; colI: number } | null>(null)

  function update(i: number, patch: Partial<IndexDef>) {
    onChange(indexes.map((idx, j) => (j === i ? { ...idx, ...patch } : idx)))
  }
  function remove(i: number) {
    onChange(indexes.filter((_, j) => j !== i))
    setExpanded((prev) => {
      if (prev === i) return null
      if (prev !== null && prev > i) return prev - 1
      return prev
    })
  }
  function addIndex() {
    const newIdx: IndexDef = {
      name: `idx_new_${indexes.length + 1}`,
      columns: [],
      columnDirections: [],
      unique: false,
      fullText: false,
      indexType: 'BTREE',
      isPrimary: false,
    }
    onChange([...indexes, newIdx])
    setExpanded(indexes.length)
  }
  function resetColumns(i: number) {
    update(i, { columns: [], columnDirections: [] })
  }
  function addColumn(idxI: number, col: string) {
    const cur = indexes[idxI]
    if (cur.columns.includes(col)) return
    update(idxI, {
      columns: [...cur.columns, col],
      columnDirections: [...(cur.columnDirections ?? []), 'ASC'],
    })
  }
  function removeColumn(idxI: number, colI: number) {
    const cur = indexes[idxI]
    update(idxI, {
      columns: cur.columns.filter((_, i) => i !== colI),
      columnDirections: (cur.columnDirections ?? []).filter((_, i) => i !== colI),
    })
  }
  function toggleDirection(idxI: number, colI: number) {
    const cur = indexes[idxI]
    const dirs = [...(cur.columnDirections ?? cur.columns.map(() => 'ASC'))]
    dirs[colI] = dirs[colI] === 'DESC' ? 'ASC' : 'DESC'
    update(idxI, { columnDirections: dirs })
  }

  // ── 인덱스 드래그앤드롭 ──────────────────────────────────────────────────
  function handleIdxDragStart(i: number) { setDragSrcIdx(i) }
  function handleIdxDragOver(e: React.DragEvent, i: number) {
    e.preventDefault()
    if (dragSrcIdx === null || dragSrcIdx === i) return
    const next = [...indexes]
    const [moved] = next.splice(dragSrcIdx, 1)
    next.splice(i, 0, moved)
    onChange(next)
    setExpanded((prev) => {
      if (prev === dragSrcIdx) return i
      if (prev === i) return dragSrcIdx
      return prev
    })
    setDragSrcIdx(i)
  }
  function handleIdxDragEnd() { setDragSrcIdx(null) }

  // ── 컬럼 순서 드래그앤드롭 ───────────────────────────────────────────────
  function handleColDragStart(idxI: number, colI: number) { setDragSrcCol({ idxI, colI }) }
  function handleColDragOver(e: React.DragEvent, idxI: number, colI: number) {
    e.preventDefault()
    if (!dragSrcCol || dragSrcCol.idxI !== idxI || dragSrcCol.colI === colI) return
    const cur = indexes[idxI]
    const cols = [...cur.columns]
    const dirs = [...(cur.columnDirections ?? cur.columns.map(() => 'ASC'))]
    const [mc] = cols.splice(dragSrcCol.colI, 1)
    const [md] = dirs.splice(dragSrcCol.colI, 1)
    cols.splice(colI, 0, mc)
    dirs.splice(colI, 0, md)
    update(idxI, { columns: cols, columnDirections: dirs })
    setDragSrcCol({ idxI, colI })
  }
  function handleColDragEnd() { setDragSrcCol(null) }

  // ── 컨텍스트 메뉴 ────────────────────────────────────────────────────────
  function handleContextMenu(e: React.MouseEvent, idxI: number) {
    if (indexes[idxI].isPrimary) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, idxI })
  }

  const ctxItems: ContextMenuOption[] = contextMenu
    ? [
        { label: t('tdIdxAdd', language), icon: <Plus size={12} />, onClick: addIndex },
        { separator: true },
        {
          label: t('tdIdxResetCols', language),
          icon: <RefreshCw size={12} />,
          onClick: () => resetColumns(contextMenu.idxI),
        },
        { separator: true },
        {
          label: t('tdIdxDelete', language),
          icon: <Trash2 size={12} />,
          danger: true,
          onClick: () => remove(contextMenu.idxI),
        },
      ]
    : []

  return (
    <div className="p-4 overflow-y-auto h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[var(--color-text-muted)]">{t('tdIndexes', language)} ({indexes.length})</span>
        <button
          onClick={addIndex}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          <Plus size={11} /> {t('tdAdd', language)}
        </button>
      </div>

      {indexes.length === 0 && (
        <div className="text-center text-[var(--color-text-muted)] text-xs mt-8">{t('tdNoIndexes', language)}</div>
      )}

      {/* 아코디언 카드 목록 */}
      <div className="space-y-1">
        {indexes.map((idx, i) => {
          const isExpanded = expanded === i
          const dirs = idx.columnDirections ?? idx.columns.map(() => 'ASC')
          const availableCols = columns.filter((c) => !idx.columns.includes(c))
          const isDragging = dragSrcIdx === i

          return (
            <div
              key={i}
              className={`border rounded transition-opacity ${isDragging ? 'opacity-40' : 'opacity-100'} ${
                isExpanded ? 'border-[var(--color-null)]' : 'border-[var(--color-border)]'
              } bg-[var(--color-bg-secondary)]`}
              draggable={!idx.isPrimary}
              onDragStart={(e) => { e.stopPropagation(); handleIdxDragStart(i) }}
              onDragOver={(e) => handleIdxDragOver(e, i)}
              onDragEnd={handleIdxDragEnd}
            >
              {/* 인덱스 헤더 */}
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--color-bg-tertiary)] rounded transition-colors select-none"
                onClick={() => setExpanded(isExpanded ? null : i)}
                onContextMenu={(e) => handleContextMenu(e, i)}
              >
                {/* 확장 토글 */}
                <span className="text-[var(--color-text-muted)] text-[9px] w-3 shrink-0 font-mono">
                  {isExpanded ? '▼' : '▶'}
                </span>
                {/* 드래그 핸들 */}
                {!idx.isPrimary && (
                  <GripVertical
                    size={13}
                    className="text-[var(--color-null)] shrink-0 cursor-grab active:cursor-grabbing"
                  />
                )}
                {/* 인덱스 이름 */}
                {idx.isPrimary ? (
                  <span className="text-[var(--color-pk)] text-xs font-medium">PRIMARY</span>
                ) : (
                  <input
                    value={idx.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => { e.stopPropagation(); handleContextMenu(e, i) }}
                    className="bg-transparent text-xs text-[var(--color-text-primary)] border-b border-transparent hover:border-[var(--color-null)] focus:border-[var(--color-accent)] focus:outline-none w-36 shrink-0"
                    title={t('tdRightClickMenu', language)}
                  />
                )}
                {/* 배지 */}
                <div className="flex items-center gap-1 ml-1 flex-1 min-w-0">
                  {(idx.unique || idx.isPrimary) && (
                    <span className="px-1 py-0.5 text-[9px] rounded bg-[var(--color-success)]/20 text-[var(--color-success)] shrink-0">
                      UNIQUE
                    </span>
                  )}
                  <span className="px-1 py-0.5 text-[9px] rounded bg-[var(--color-border)] text-[var(--color-text-subtle)] shrink-0">
                    {idx.indexType}
                  </span>
                  <span className="px-1 py-0.5 text-[9px] rounded bg-[var(--color-border)] text-[var(--color-accent-light)] shrink-0">
                    {idx.columns.length}{t('tdColsSuffix', language)}
                  </span>
                </div>
                {/* 삭제 버튼 */}
                {!idx.isPrimary && (
                  <button
                    onClick={(e) => { e.stopPropagation(); remove(i) }}
                    className="ml-auto text-[var(--color-null)] hover:text-[var(--color-error)] transition-colors shrink-0"
                    title={t('tdIdxDelete', language)}
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>

              {/* 확장 본문 */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-[var(--color-border)] pt-3 space-y-3">
                  {/* 타입 / Unique 옵션 */}
                  <div className="flex items-center gap-4 text-xs">
                    <label className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
                      {t('tdType', language)}
                      <select
                        value={idx.indexType}
                        onChange={(e) => update(i, { indexType: e.target.value, fullText: e.target.value === 'FULLTEXT' })}
                        disabled={idx.isPrimary}
                        className={`${inputCls} w-24 h-6 ml-1`}
                      >
                        <option>BTREE</option>
                        <option>HASH</option>
                        <option>FULLTEXT</option>
                      </select>
                    </label>
                    {!idx.isPrimary && (
                      <label className="flex items-center gap-1.5 cursor-pointer select-none text-[var(--color-text-subtle)]">
                        <input
                          type="checkbox"
                          checked={idx.unique}
                          onChange={(e) => update(i, { unique: e.target.checked })}
                          className="accent-[var(--color-accent)]"
                        />
                        Unique
                      </label>
                    )}
                  </div>

                  {/* 인덱스 컬럼 목록 */}
                  <div>
                    <div className="text-[10px] text-[var(--color-text-muted)] mb-1.5">
                      {t('tdIdxColOrder', language)} <span className="text-[var(--color-null)]">{t('tdDragToReorder', language)}</span>
                    </div>
                    {idx.columns.length === 0 && (
                      <div className="text-[10px] text-[var(--color-null)] italic py-1 pl-1">{t('tdNoColumns', language)}</div>
                    )}
                    <div className="space-y-1">
                      {idx.columns.map((col, ci) => {
                        const dir = dirs[ci] ?? 'ASC'
                        const isColDragging = dragSrcCol?.idxI === i && dragSrcCol?.colI === ci
                        return (
                          <div
                            key={ci}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded bg-[var(--color-bg-primary)] border border-[var(--color-border)] transition-opacity ${
                              isColDragging ? 'opacity-40' : 'opacity-100'
                            }`}
                            draggable
                            onDragStart={(e) => { e.stopPropagation(); handleColDragStart(i, ci) }}
                            onDragOver={(e) => handleColDragOver(e, i, ci)}
                            onDragEnd={handleColDragEnd}
                          >
                            <GripVertical size={10} className="text-[var(--color-null)] cursor-grab shrink-0" />
                            <span className="text-[10px] text-[var(--color-text-subtle)] shrink-0 w-4">{ci + 1}.</span>
                            <span className="text-xs text-[var(--color-text-primary)] flex-1 truncate">{col}</span>
                            {/* ASC / DESC 토글 */}
                            <button
                              onClick={() => toggleDirection(i, ci)}
                              className={`flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded font-medium transition-colors ${
                                dir === 'DESC'
                                  ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent-light)] hover:bg-[var(--color-accent)]/30'
                                  : 'bg-[var(--color-border)] text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
                              }`}
                              title={t('tdToggleSort', language)}
                            >
                              {dir === 'DESC'
                                ? <><ArrowDown size={9} /> DESC</>
                                : <><ArrowUp size={9} /> ASC</>
                              }
                            </button>
                            {!idx.isPrimary && (
                              <button
                                onClick={() => removeColumn(i, ci)}
                                className="text-[var(--color-null)] hover:text-[var(--color-error)] transition-colors shrink-0"
                                title={t('tdRemoveColumn', language)}
                              >
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* 추가 가능한 컬럼 */}
                  {!idx.isPrimary && availableCols.length > 0 && (
                    <div>
                      <div className="text-[10px] text-[var(--color-text-muted)] mb-1.5">{t('tdAddColumn', language)}</div>
                      <div className="flex flex-wrap gap-1">
                        {availableCols.map((col) => (
                          <button
                            key={col}
                            onClick={() => addColumn(i, col)}
                            className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] hover:border-[var(--color-accent)] transition-colors"
                          >
                            <Plus size={9} />
                            {col}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 컨텍스트 메뉴 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={ctxItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

// ─── Foreign Keys 탭 ─────────────────────────────────────────────────────────

function ForeignKeysTab({
  fks,
  columns,
  onChange,
}: {
  fks: ForeignKeyDef[]
  columns: string[]
  onChange: (fks: ForeignKeyDef[]) => void
}) {
  const language = useLanguageStore((s) => s.language)
  function add() {
    onChange([
      ...fks,
      { name: `fk_${fks.length + 1}`, column: columns[0] ?? '', refTable: '', refColumn: '', onDelete: 'RESTRICT', onUpdate: 'RESTRICT' },
    ])
  }
  function update(i: number, patch: Partial<ForeignKeyDef>) {
    onChange(fks.map((fk, j) => (j === i ? { ...fk, ...patch } : fk)))
  }
  function remove(i: number) {
    onChange(fks.filter((_, j) => j !== i))
  }

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[var(--color-text-muted)]">{t('tdForeignKeys', language)}</span>
        <button
          onClick={add}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          <Plus size={11} /> {t('tdAdd', language)}
        </button>
      </div>

      {fks.length === 0 && (
        <div className="text-center text-[var(--color-text-muted)] text-xs mt-8">{t('tdNoForeignKeys', language)}</div>
      )}

      {fks.map((fk, i) => (
        <div key={i} className="border border-[var(--color-border)] rounded p-3 mb-3 bg-[var(--color-bg-secondary)]">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('tdName', language)}>
              <input value={fk.name} onChange={(e) => update(i, { name: e.target.value })} className={inputCls} />
            </Field>
            <Field label={t('tdColumn', language)}>
              <select value={fk.column} onChange={(e) => update(i, { column: e.target.value })} className={inputCls}>
                {columns.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label={t('tdRefTable', language)}>
              <input value={fk.refTable} onChange={(e) => update(i, { refTable: e.target.value })} className={inputCls} placeholder="table_name" />
            </Field>
            <Field label={t('tdRefColumn', language)}>
              <input value={fk.refColumn} onChange={(e) => update(i, { refColumn: e.target.value })} className={inputCls} placeholder="column_name" />
            </Field>
            <Field label="ON DELETE">
              <select value={fk.onDelete} onChange={(e) => update(i, { onDelete: e.target.value })} className={inputCls}>
                {FK_RULES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="ON UPDATE">
              <select value={fk.onUpdate} onChange={(e) => update(i, { onUpdate: e.target.value })} className={inputCls}>
                {FK_RULES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex justify-end mt-2">
            <button onClick={() => remove(i)} className="flex items-center gap-1 text-xs text-[var(--color-error)] hover:text-[var(--color-error)] transition-colors">
              <Trash2 size={11} /> {t('tdDelete', language)}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Options 탭 ──────────────────────────────────────────────────────────────

function OptionsTab({
  def,
  onChange,
}: {
  def: TableDefinition
  onChange: (opts: Partial<TableDefinition>) => void
}) {
  const language = useLanguageStore((s) => s.language)
  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-3 max-w-lg">
        <Field label={t('tdStorageEngine', language)}>
          <select value={def.engine} onChange={(e) => onChange({ engine: e.target.value })} className={inputCls}>
            {['InnoDB', 'MyISAM', 'MEMORY', 'CSV', 'ARCHIVE', 'BLACKHOLE'].map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </Field>
        <Field label="Charset">
          <select value={def.charset} onChange={(e) => onChange({ charset: e.target.value })} className={inputCls}>
            {['utf8mb4', 'utf8', 'latin1', 'ascii'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Collation">
          <input
            value={def.collation}
            onChange={(e) => onChange({ collation: e.target.value })}
            className={inputCls}
            placeholder="utf8mb4_general_ci"
          />
        </Field>
        <Field label={t('tdComment', language)}>
          <input
            value={def.comment}
            onChange={(e) => onChange({ comment: e.target.value })}
            className={inputCls}
          />
        </Field>
      </div>
    </div>
  )
}

// ─── 공통 컴포넌트 ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-[var(--color-text-muted)]">{label}</label>
      {children}
    </div>
  )
}

function tabLabel(tab: Tab, language: Language): string {
  const map: Record<Tab, string> = {
    columns: t('tdTabColumns', language),
    indexes: t('tdIndexes', language),
    foreignkeys: t('tdForeignKeys', language),
    options: t('tdTabOptions', language),
    ddl: t('tdTabDdl', language),
  }
  return map[tab]
}

const inputCls =
  'h-7 px-2 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] transition-colors w-full'
