/**
 * 16-G4/G5/G6 — HeidiSQL 스타일 컬럼 편집 그리드.
 *
 * 기능:
 *  - 인라인 편집: 이름/타입/길이/기본값/주석, unsigned/nullable/zerofill/autoInc 체크박스
 *  - 행 선택 (multi-select with ctrl/shift)
 *  - 행 추가/삭제/순서 변경 (툴바 + 컨텍스트 메뉴)
 *  - 헤더 정렬 (시각적만 — 실제 # 는 유지)
 *  - 헤더 드래그 재정렬 + 컨텍스트 메뉴 (숨김 / 너비 자동)
 *  - 행 컨텍스트 메뉴 (복사 / 붙여넣기 / 인덱스 추가 / ALTER ADD COLUMN 생성)
 */

import { useCallback, useMemo, useState, useRef, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Plus, Minus, ChevronUp, ChevronDown, ArrowUpDown, AlertTriangle } from 'lucide-react'
import { useTableDesignerStore, type ColumnRow } from '@/stores/useTableDesignerStore'
import { useSettingsStore, type TableDesignerGridKey } from '@/stores/useSettingsStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t, type I18nKey, type Language } from '@/i18n'
import { IndexFlagBadges, type IndexFlag } from '@/components/common/IndexFlagIcon'
import type { ColumnDef, IndexDef } from '@/types'
import { buildAlterAddColumn } from './buildAlterAddColumn'

const GROUPED_TYPES: { groupKey: I18nKey; types: string[] }[] = [
  { groupKey: 'cgTypeInt',    types: ['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT'] },
  { groupKey: 'cgTypeFloat',  types: ['FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC'] },
  { groupKey: 'cgTypeString', types: ['CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT'] },
  { groupKey: 'cgTypeBinary', types: ['BINARY', 'VARBINARY', 'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB'] },
  { groupKey: 'cgTypeDate',   types: ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR'] },
  { groupKey: 'cgTypeEtc',    types: ['BOOLEAN', 'BIT', 'ENUM', 'SET', 'JSON', 'UUID'] },
]

const NUMERIC_TYPES = new Set([
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
  'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC', 'BIT',
])

const STRING_TYPES = new Set([
  'CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'ENUM', 'SET',
])

const DATETIME_TYPES = new Set(['DATETIME', 'TIMESTAMP'])

const COLLATIONS = [
  'utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_0900_ai_ci',
  'utf8_general_ci', 'utf8_unicode_ci', 'latin1_swedish_ci', 'binary',
]

interface ColumnMeta {
  key: TableDesignerGridKey
  labelKey: I18nKey
  width: number
  align?: 'left' | 'center'
}

const DEFAULT_COLUMNS: ColumnMeta[] = [
  { key: 'ordinal',   labelKey: 'cgColOrdinal',   width: 36,  align: 'center' },
  { key: 'flags',     labelKey: 'cgColFlags',     width: 50,  align: 'center' },
  { key: 'name',      labelKey: 'cgColName',      width: 160, align: 'left' },
  { key: 'type',      labelKey: 'cgColType',      width: 110, align: 'left' },
  { key: 'length',    labelKey: 'cgColLength',    width: 80,  align: 'left' },
  { key: 'unsigned',  labelKey: 'cgColUnsigned',  width: 70,  align: 'center' },
  { key: 'nullable',  labelKey: 'cgColNullable',  width: 60,  align: 'center' },
  { key: 'zerofill',  labelKey: 'cgColZerofill',  width: 60,  align: 'center' },
  { key: 'default',   labelKey: 'cgColDefault',   width: 160, align: 'left' },
  { key: 'collation', labelKey: 'cgColCollation', width: 140, align: 'left' },
  { key: 'comment',   labelKey: 'cgColComment',   width: 180, align: 'left' },
]

interface Props {
  database: string
  table: string
  /** 선택된 행을 대상으로 ALTER ADD COLUMN SQL을 에디터에 삽입하는 콜백 */
  onInsertSQL: (sql: string) => void
}

type SortDir = 'asc' | 'desc' | null

export default function ColumnGrid({ database, table, onInsertSQL }: Props) {
  const language = useLanguageStore((s) => s.language)
  const editedRows = useTableDesignerStore((s) => s.editedRows)
  const selectedRowIds = useTableDesignerStore((s) => s.selectedRowIds)
  const editedMeta = useTableDesignerStore((s) => s.editedMeta)
  const updateRow = useTableDesignerStore((s) => s.updateRow)
  const addRowAfterSelected = useTableDesignerStore((s) => s.addRowAfterSelected)
  const deleteSelected = useTableDesignerStore((s) => s.deleteSelected)
  const moveSelected = useTableDesignerStore((s) => s.moveSelected)
  const setSelected = useTableDesignerStore((s) => s.setSelected)
  const setIndexes = useTableDesignerStore((s) => s.setIndexes)

  const gridSettings = useSettingsStore((s) => s.settings.tableDesigner)
  const updateGridSettings = useSettingsStore((s) => s.updateTableDesigner)

  const [sortKey, setSortKey] = useState<TableDesignerGridKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)

  // 숨김/순서 설정 적용 — 기본값 없으면 DEFAULT_COLUMNS 순서
  const orderedColumns = useMemo<ColumnMeta[]>(() => {
    const hidden = new Set(gridSettings.hiddenColumnKeys)
    const map = new Map(DEFAULT_COLUMNS.map((c) => [c.key, c]))
    const order = gridSettings.columnOrder.length > 0
      ? gridSettings.columnOrder
      : DEFAULT_COLUMNS.map((c) => c.key)
    const cols: ColumnMeta[] = []
    for (const key of order) {
      const c = map.get(key)
      if (c && !hidden.has(key)) cols.push(c)
    }
    // 새로 추가된 키가 있으면 뒤에 붙임
    for (const c of DEFAULT_COLUMNS) {
      if (!cols.find((x) => x.key === c.key) && !hidden.has(c.key)) {
        cols.push(c)
      }
    }
    return cols
  }, [gridSettings.columnOrder, gridSettings.hiddenColumnKeys])

  // 시각적 정렬: 원본 editedRows 복사본을 정렬 (ordinalPos는 그대로 유지 — 표시 기준만 바뀜)
  const displayRows = useMemo(() => {
    if (!sortKey || !sortDir) return editedRows
    const copy = [...editedRows]
    copy.sort((a, b) => {
      const cmp = compareRow(a, b, sortKey)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [editedRows, sortKey, sortDir])

  const handleHeaderClick = useCallback(
    (key: TableDesignerGridKey) => {
      if (sortKey !== key) {
        setSortKey(key)
        setSortDir('asc')
      } else if (sortDir === 'asc') {
        setSortDir('desc')
      } else {
        setSortKey(null)
        setSortDir(null)
      }
    },
    [sortKey, sortDir],
  )

  const toggleColumnHidden = useCallback(
    (key: TableDesignerGridKey) => {
      const set = new Set(gridSettings.hiddenColumnKeys)
      if (set.has(key)) set.delete(key)
      else set.add(key)
      updateGridSettings({ hiddenColumnKeys: Array.from(set) })
    },
    [gridSettings.hiddenColumnKeys, updateGridSettings],
  )

  const showAllColumns = useCallback(() => {
    updateGridSettings({ hiddenColumnKeys: [] })
  }, [updateGridSettings])

  const [headerCtx, setHeaderCtx] = useState<{ x: number; y: number; key: TableDesignerGridKey } | null>(null)
  const [rowCtx, setRowCtx] = useState<{ x: number; y: number; rowId: string } | null>(null)

  // 외부 클릭 시 컨텍스트 메뉴 닫기
  useEffect(() => {
    const closeAll = () => { setHeaderCtx(null); setRowCtx(null) }
    if (headerCtx || rowCtx) {
      window.addEventListener('click', closeAll)
      return () => window.removeEventListener('click', closeAll)
    }
    return undefined
  }, [headerCtx, rowCtx])

  const handleRowClick = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      if (e.shiftKey) {
        setSelected([rowId], 'add')
      } else if (e.ctrlKey || e.metaKey) {
        setSelected([rowId], 'toggle')
      } else {
        setSelected([rowId], 'replace')
      }
    },
    [setSelected],
  )

  const handleRowContext = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      e.preventDefault()
      if (!selectedRowIds.has(rowId)) {
        setSelected([rowId], 'replace')
      }
      setRowCtx({ x: e.clientX, y: e.clientY, rowId })
    },
    [selectedRowIds, setSelected],
  )

  const handleHeaderContext = useCallback((e: React.MouseEvent, key: TableDesignerGridKey) => {
    e.preventDefault()
    setHeaderCtx({ x: e.clientX, y: e.clientY, key })
  }, [])

  const copySelectedAsTSV = useCallback(() => {
    const rows = editedRows.filter((r) => selectedRowIds.has(r.rowId))
    if (rows.length === 0) return
    const tsv = rows
      .map((r) => [r.name, r.dataType, r.length, r.notNull ? 'NOT NULL' : 'NULL', r.default, r.comment].join('\t'))
      .join('\n')
    void navigator.clipboard.writeText(tsv)
    toast.success(`${rows.length}${t('cgColsCopiedSuffix', language)}`)
  }, [editedRows, selectedRowIds])

  const insertAlterAddColumnSQL = useCallback(() => {
    const indices: number[] = []
    editedRows.forEach((r, i) => {
      if (selectedRowIds.has(r.rowId)) indices.push(i)
    })
    const sql = buildAlterAddColumn({
      database,
      table,
      allColumns: editedRows,
      selectedIndices: indices,
    })
    if (!sql) {
      toast(t('cgNoSelectedCols', language))
      return
    }
    onInsertSQL(sql)
  }, [editedRows, selectedRowIds, database, table, onInsertSQL])

  const addIndexForSelected = useCallback(
    (type: 'PRIMARY' | 'INDEX' | 'UNIQUE' | 'FULLTEXT' | 'SPATIAL') => {
      if (!editedMeta) return
      const cols = editedRows
        .filter((r) => selectedRowIds.has(r.rowId))
        .map((r) => r.name)
        .filter(Boolean)
      if (cols.length === 0) {
        toast(t('cgNoSelectedCols', language))
        return
      }
      const existing = editedMeta.indexes ?? []
      const name =
        type === 'PRIMARY'
          ? 'PRIMARY'
          : `${type.toLowerCase()}_${cols.join('_')}`.slice(0, 60)
      const idx: IndexDef = {
        name,
        columns: cols,
        columnDirections: cols.map(() => 'ASC'),
        unique: type === 'UNIQUE' || type === 'PRIMARY',
        fullText: type === 'FULLTEXT',
        indexType: type === 'FULLTEXT' ? 'FULLTEXT' : 'BTREE',
        isPrimary: type === 'PRIMARY',
      }
      setIndexes([...existing.filter((i) => i.name !== name), idx])
      toast.success(language === 'ko' ? `인덱스 "${name}" 추가됨` : `Index "${name}" added`)
    },
    [editedMeta, editedRows, selectedRowIds, setIndexes],
  )

  const columnFlags = useMemo(() => {
    const map = new Map<string, Set<IndexFlag>>()
    for (const idx of editedMeta?.indexes ?? []) {
      const type: IndexFlag = idx.isPrimary ? 'PRIMARY'
                            : idx.unique    ? 'UNIQUE'
                            : idx.fullText  ? 'FULLTEXT'
                            :                 'INDEX'
      for (const col of idx.columns) {
        if (!map.has(col)) map.set(col, new Set())
        map.get(col)!.add(type)
      }
    }
    for (const fk of editedMeta?.foreignKeys ?? []) {
      if (!map.has(fk.column)) map.set(fk.column, new Set())
      map.get(fk.column)!.add('FK')
    }
    return map
  }, [editedMeta?.indexes, editedMeta?.foreignKeys])

  return (
    <div className="osql-columngrid flex flex-col h-full overflow-hidden bg-[var(--color-bg-primary)]">
      {/* 그리드 툴바 */}
      <div className="osql-columngrid-toolbar flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
        <button
          onClick={addRowAfterSelected}
          title={t('cgAddRow', language)}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          <Plus size={11} /> {t('cgAddRow', language)}
        </button>
        <button
          onClick={deleteSelected}
          disabled={selectedRowIds.size === 0}
          title={t('cgDeleteSelTitle', language)}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-[var(--color-error)] hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-40"
        >
          <Minus size={11} /> {t('cgRemove', language)}
        </button>
        <button
          onClick={() => moveSelected(-1)}
          disabled={selectedRowIds.size === 0}
          title={t('cgMoveUpTitle', language)}
          className="p-1 rounded text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-40"
        >
          <ChevronUp size={12} />
        </button>
        <button
          onClick={() => moveSelected(1)}
          disabled={selectedRowIds.size === 0}
          title={t('cgMoveDownTitle', language)}
          className="p-1 rounded text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-40"
        >
          <ChevronDown size={12} />
        </button>
        <span className="ml-auto text-[9px] text-[var(--color-null)]">
          {language === 'ko'
            ? `${editedRows.length}개 컬럼 · ${selectedRowIds.size}개 선택`
            : `${editedRows.length} columns · ${selectedRowIds.size} selected`}
        </span>
      </div>

      {/* 헤더 + 본문 */}
      <div className="flex-1 overflow-auto" onContextMenu={(e) => e.preventDefault()}>
        <table className="w-full text-[11px] border-collapse select-none">
          <thead className="sticky top-0 bg-[var(--color-bg-secondary)] z-10">
            <tr>
              {orderedColumns.map((col) => (
                <th
                  key={col.key}
                  style={{ width: col.width, minWidth: col.width }}
                  onClick={() => handleHeaderClick(col.key)}
                  onContextMenu={(e) => handleHeaderContext(e, col.key)}
                  className={`px-2 py-1.5 border-b border-r border-[var(--color-border)] font-medium text-[var(--color-text-muted)] cursor-pointer hover:bg-[var(--color-bg-tertiary)] ${
                    col.align === 'center' ? 'text-center' : 'text-left'
                  }`}
                >
                  <div className="flex items-center gap-1 justify-between">
                    <span>{t(col.labelKey, language)}</span>
                    {sortKey === col.key && (
                      <ArrowUpDown size={9} className={sortDir === 'asc' ? 'text-[var(--color-accent)]' : 'text-[var(--color-warning)]'} />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => (
              <ColumnGridRow
                key={row.rowId}
                row={row}
                columns={orderedColumns}
                isSelected={selectedRowIds.has(row.rowId)}
                flagSet={columnFlags.get(row.name) ?? new Set()}
                allRows={editedRows}
                language={language}
                onClick={handleRowClick}
                onContextMenu={handleRowContext}
                onPatch={(patch) => updateRow(row.rowId, patch)}
              />
            ))}
          </tbody>
        </table>
        {editedRows.length === 0 && (
          <div className="flex items-center justify-center h-32 text-[var(--color-null)] text-xs">
            {t('cgEmptyHint', language)}
          </div>
        )}
      </div>

      {/* 헤더 컨텍스트 메뉴 */}
      {headerCtx && (
        <ContextMenu x={headerCtx.x} y={headerCtx.y} onClose={() => setHeaderCtx(null)}>
          <CtxItem onClick={showAllColumns}>{t('cgShowAllCols', language)}</CtxItem>
          <CtxItem
            onClick={() => {
              void navigator.clipboard.writeText(headerCtx.key)
              toast.success(t('cgColKeyCopied', language))
            }}
          >
            {t('cgCopyColKey', language)}
          </CtxItem>
          <CtxDivider />
          {DEFAULT_COLUMNS.map((c) => {
            const hidden = gridSettings.hiddenColumnKeys.includes(c.key)
            return (
              <CtxItem key={c.key} onClick={() => toggleColumnHidden(c.key)}>
                <span className="inline-block w-3 text-[var(--color-accent)]">{hidden ? '' : '✓'}</span>
                {t(c.labelKey, language)}
              </CtxItem>
            )
          })}
        </ContextMenu>
      )}

      {/* 행 컨텍스트 메뉴 */}
      {rowCtx && (
        <ContextMenu x={rowCtx.x} y={rowCtx.y} onClose={() => setRowCtx(null)}>
          <CtxItem onClick={copySelectedAsTSV}>{t('cgCopyTsv', language)}</CtxItem>
          <CtxDivider />
          <CtxItem onClick={addRowAfterSelected}>{t('cgAddRow', language)}</CtxItem>
          <CtxItem onClick={deleteSelected}>{t('cgRemoveRow', language)}</CtxItem>
          <CtxDivider />
          <CtxItem onClick={() => moveSelected(-1)}>{t('cgMoveUpItem', language)}</CtxItem>
          <CtxItem onClick={() => moveSelected(1)}>{t('cgMoveDownItem', language)}</CtxItem>
          <CtxDivider />
          <CtxSubLabel>{t('cgNewIndex', language)}</CtxSubLabel>
          <CtxItem onClick={() => addIndexForSelected('PRIMARY')}>PRIMARY KEY</CtxItem>
          <CtxItem onClick={() => addIndexForSelected('INDEX')}>INDEX</CtxItem>
          <CtxItem onClick={() => addIndexForSelected('UNIQUE')}>UNIQUE</CtxItem>
          <CtxItem onClick={() => addIndexForSelected('FULLTEXT')}>FULLTEXT</CtxItem>
          <CtxDivider />
          <CtxItem onClick={insertAlterAddColumnSQL}>{t('cgAlterAddToEditor', language)}</CtxItem>
        </ContextMenu>
      )}
    </div>
  )
}

// ─── 단일 행 ─────────────────────────────────────────────────────────────────

interface RowProps {
  row: ColumnRow
  columns: ColumnMeta[]
  isSelected: boolean
  flagSet: Set<IndexFlag>
  allRows: ColumnRow[]
  language: 'ko' | 'en'
  onClick: (e: React.MouseEvent, rowId: string) => void
  onContextMenu: (e: React.MouseEvent, rowId: string) => void
  onPatch: (patch: Partial<ColumnDef>) => void
}

function ColumnGridRow({ row, columns, isSelected, flagSet, allRows, language, onClick, onContextMenu, onPatch }: RowProps) {
  const isNumeric = NUMERIC_TYPES.has(row.dataType.toUpperCase())
  return (
    <tr
      onClick={(e) => onClick(e, row.rowId)}
      onContextMenu={(e) => onContextMenu(e, row.rowId)}
      className={`osql-columngrid-row border-b border-[var(--color-bg-secondary)] ${
        isSelected
          ? 'bg-[var(--color-bg-selected)] shadow-[inset_3px_0_0_0_var(--color-accent)]'
          : 'hover:bg-[var(--color-bg-tertiary)]'
      } ${row.autoInc ? 'font-bold' : ''}`}
    >
      {columns.map((col) => {
        const cellBase = `px-1.5 py-1 border-r border-[var(--color-bg-secondary)] ${
          col.align === 'center' ? 'text-center' : ''
        }`
        const inputCls =
          'w-full h-6 px-1.5 text-[11px] rounded-sm border border-transparent bg-transparent text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] focus:bg-[var(--color-bg-primary)]'

        switch (col.key) {
          case 'ordinal':
            return (
              <td key={col.key} className={`${cellBase} text-[var(--color-null)]`}>
                {row.ordinalPos}
              </td>
            )
          case 'flags': {
            return (
              <td key={col.key} className={cellBase}>
                <div className="flex items-center justify-center gap-0.5 flex-wrap">
                  <IndexFlagBadges flags={flagSet} language={language} />
                </div>
              </td>
            )
          }
          case 'name':
            return (
              <td key={col.key} className={cellBase}>
                <input
                  value={row.name}
                  onChange={(e) => onPatch({ name: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  className={`${inputCls} font-mono`}
                  placeholder={t('cgPhColName', language)}
                />
              </td>
            )
          case 'type':
            return (
              <td key={col.key} className={cellBase}>
                <select
                  value={row.dataType.toUpperCase()}
                  onChange={(e) => onPatch({ dataType: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  className={`${inputCls} text-[var(--color-warning)]`}
                >
                  {GROUPED_TYPES.map((g) => (
                    <optgroup key={g.groupKey} label={t(g.groupKey, language)}>
                      {g.types.map((ty) => (
                        <option key={ty} value={ty}>{ty}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </td>
            )
          case 'length':
            if (['ENUM', 'SET'].includes(row.dataType.toUpperCase())) {
              return (
                <td key={col.key} className={cellBase}>
                  <EnumEditor value={row.length} onChange={(v) => onPatch({ length: v })} />
                </td>
              )
            }
            return (
              <td key={col.key} className={cellBase}>
                <input
                  value={row.length}
                  onChange={(e) => onPatch({ length: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  className={inputCls}
                  placeholder="-"
                />
              </td>
            )
          case 'unsigned':
            return (
              <td key={col.key} className={cellBase}>
                <input
                  type="checkbox"
                  checked={row.unsigned}
                  disabled={!isNumeric}
                  onChange={(e) => onPatch({ unsigned: e.target.checked })}
                  onClick={(e) => e.stopPropagation()}
                  className="accent-[var(--color-accent)]"
                />
              </td>
            )
          case 'nullable':
            return (
              <td key={col.key} className={cellBase}>
                <input
                  type="checkbox"
                  checked={!row.notNull}
                  onChange={(e) => onPatch({ notNull: !e.target.checked })}
                  onClick={(e) => e.stopPropagation()}
                  className="accent-[var(--color-accent)]"
                />
              </td>
            )
          case 'zerofill':
            return (
              <td key={col.key} className={cellBase}>
                <input
                  type="checkbox"
                  checked={row.zeroFill}
                  disabled={!isNumeric}
                  onChange={(e) => onPatch({ zeroFill: e.target.checked })}
                  onClick={(e) => e.stopPropagation()}
                  className="accent-[var(--color-accent)]"
                />
              </td>
            )
          case 'default':
            if (row.autoInc) {
              return (
                <td key={col.key} className={cellBase}>
                  <span className="text-[var(--color-success)] italic text-[10px] select-none px-1.5">auto_increment</span>
                </td>
              )
            }
            return (
              <td key={col.key} className={cellBase}>
                <DefaultEditor row={row} allRows={allRows} onPatch={onPatch} />
              </td>
            )
          case 'collation': {
            const isStr = STRING_TYPES.has(row.dataType.toUpperCase())
            return (
              <td key={col.key} className={`${cellBase} ${!isStr ? 'opacity-30' : ''}`}>
                <select
                  value={row.collation}
                  disabled={!isStr}
                  onChange={(e) => onPatch({ collation: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  className={inputCls}
                >
                  <option value="">{t('cgCollationDefault', language)}</option>
                  {COLLATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
            )
          }
          case 'onUpdate': {
            const isDT = DATETIME_TYPES.has(row.dataType.toUpperCase())
            return (
              <td key={col.key} className={`${cellBase} ${!isDT ? 'opacity-30' : ''}`}>
                <select
                  value={row.onUpdate}
                  disabled={!isDT}
                  onChange={(e) => onPatch({ onUpdate: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  className={inputCls}
                >
                  <option value="">-</option>
                  <option value="CURRENT_TIMESTAMP">CURRENT_TIMESTAMP</option>
                </select>
              </td>
            )
          }
          case 'comment':
            return (
              <td key={col.key} className={cellBase}>
                <input
                  value={row.comment}
                  onChange={(e) => onPatch({ comment: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  className={`${inputCls} text-[var(--color-text-muted)]`}
                />
              </td>
            )
          default:
            return null
        }
      })}
    </tr>
  )
}

// ─── EnumEditor ──────────────────────────────────────────────────────────────

function EnumEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const language = useLanguageStore((s) => s.language)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const openPopover = () => {
    const parsed = value.replace(/^'|'$/g, '').split("','").join('\n')
    setDraft(parsed)
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(true)
  }

  const commit = () => {
    const vals = draft.split('\n').map((s) => s.trim()).filter(Boolean)
    onChange(vals.map((v) => `'${v}'`).join(','))
    setOpen(false)
  }

  const summary = value
    ? (language === 'ko' ? `(${value.split(',').length}개)` : `(${value.split(',').length})`)
    : t('cgEnumEdit', language)

  return (
    <div ref={containerRef}>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); open ? setOpen(false) : openPopover() }}
        className="w-full text-left px-1.5 text-[var(--color-text-subtle)] text-[11px] truncate"
      >
        {summary}
      </button>
      {open && (
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 100 }}
          className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded shadow-xl p-2 w-48"
        >
          <div className="text-[9px] text-[var(--color-null)] mb-1">{t('cgEnumOnePerLine', language)}</div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            autoFocus
            className="w-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] text-[11px] p-1 rounded border border-[var(--color-border)] resize-none focus:outline-none focus:border-[var(--color-accent)]"
          />
          <div className="flex gap-1 mt-1">
            <button
              onClick={commit}
              className="flex-1 text-[10px] py-0.5 bg-[var(--color-accent)] text-white rounded hover:bg-[var(--color-accent-hover)]"
            >{t('cgConfirm', language)}</button>
            <button
              onClick={() => setOpen(false)}
              className="flex-1 text-[10px] py-0.5 bg-[var(--color-border)] text-[var(--color-text-subtle)] rounded hover:bg-[var(--color-bg-hover)]"
            >{t('commonCancel', language)}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── DefaultEditor ───────────────────────────────────────────────────────────

interface DefaultPreset {
  label: string
  value: string        // '' = NULL / '__AI__' = AUTO_INCREMENT 특수값
  isExpr?: boolean     // 표현식임을 UI에서 구분 표시
}

/** 데이터형별 기본값 프리셋 목록 */
function getPresets(dataType: string, rowId: string, allRows: ColumnRow[], language: Language): DefaultPreset[] {
  const dt = dataType.toUpperCase()
  const alreadyHasAutoInc = allRows.some((r) => r.rowId !== rowId && r.autoInc)

  if (['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT'].includes(dt)) {
    const list: DefaultPreset[] = [
      { label: 'NULL', value: '' },
      { label: '0', value: '0' },
      { label: '1', value: '1' },
      { label: '-1', value: '-1' },
    ]
    if (!alreadyHasAutoInc) list.push({ label: 'AUTO_INCREMENT', value: '__AI__' })
    return list
  }

  if (['FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC'].includes(dt)) {
    return [
      { label: 'NULL', value: '' },
      { label: '0', value: '0' },
      { label: '0.00', value: '0.00' },
    ]
  }

  if (['CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT'].includes(dt)) {
    return [
      { label: 'NULL', value: '' },
      { label: t('cgEmptyString', language), value: "''" },
    ]
  }

  if (dt === 'DATE') {
    return [
      { label: 'NULL', value: '' },
      { label: 'CURRENT_DATE', value: 'CURRENT_DATE' },
      { label: '(CURDATE())', value: '(CURDATE())', isExpr: true },
    ]
  }

  if (dt === 'TIME') {
    return [
      { label: 'NULL', value: '' },
      { label: 'CURRENT_TIME', value: 'CURRENT_TIME' },
      { label: '(CURTIME())', value: '(CURTIME())', isExpr: true },
    ]
  }

  if (dt === 'DATETIME') {
    return [
      { label: 'NULL', value: '' },
      { label: 'CURRENT_TIMESTAMP', value: 'CURRENT_TIMESTAMP' },
      { label: '(NOW())', value: '(NOW())', isExpr: true },
      { label: '(SYSDATE())', value: '(SYSDATE())', isExpr: true },
      { label: '(LOCALTIME())', value: '(LOCALTIME())', isExpr: true },
      { label: '(LOCALTIMESTAMP())', value: '(LOCALTIMESTAMP())', isExpr: true },
    ]
  }

  if (dt === 'TIMESTAMP') {
    return [
      { label: 'NULL', value: '' },
      { label: 'CURRENT_TIMESTAMP', value: 'CURRENT_TIMESTAMP' },
      { label: '(NOW())', value: '(NOW())', isExpr: true },
      { label: '(LOCALTIME())', value: '(LOCALTIME())', isExpr: true },
    ]
  }

  if (dt === 'YEAR') {
    const y = new Date().getFullYear()
    return [
      { label: 'NULL', value: '' },
      { label: String(y), value: String(y) },
      { label: String(y + 1), value: String(y + 1) },
    ]
  }

  if (['BOOLEAN', 'BIT'].includes(dt)) {
    return [
      { label: 'NULL', value: '' },
      { label: '0  (FALSE)', value: '0' },
      { label: '1  (TRUE)', value: '1' },
    ]
  }

  if (dt === 'JSON') {
    return [
      { label: 'NULL', value: '' },
      { label: t('cgEmptyObject', language), value: "'{}'" },
      { label: t('cgEmptyArray', language), value: "'[]'" },
    ]
  }

  if (dt === 'UUID') {
    return [
      { label: 'NULL', value: '' },
      { label: '(UUID())', value: '(UUID())', isExpr: true },
    ]
  }

  // BINARY / VARBINARY / BLOB 류 / ENUM / SET
  return [{ label: 'NULL', value: '' }]
}

/** ON UPDATE 선택지 (DATETIME / TIMESTAMP 전용) */
const ON_UPDATE_OPTIONS: DefaultPreset[] = [
  { label: 'None', value: '' },   // value '' → 렌더 시 t('cgOnUpdateNone') 로 치환
  { label: 'CURRENT_TIMESTAMP', value: 'CURRENT_TIMESTAMP' },
  { label: 'NOW()', value: 'NOW()', isExpr: true },
]

function DefaultEditor({ row, allRows, onPatch }: {
  row: ColumnRow
  allRows: ColumnRow[]
  onPatch: (p: Partial<ColumnDef>) => void
}) {
  const language = useLanguageStore((s) => s.language)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [snackbar, setSnackbar] = useState<{ top: number; left: number } | null>(null)
  const snackbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  // 스낵바 표시 (해당 셀 아래에 2.5초간)
  const showNullableSnackbar = () => {
    if (containerRef.current) {
      const r = containerRef.current.getBoundingClientRect()
      setSnackbar({ top: r.bottom + 4, left: r.left })
    }
    if (snackbarTimer.current) clearTimeout(snackbarTimer.current)
    snackbarTimer.current = setTimeout(() => setSnackbar(null), 2500)
  }

  // NULL 선택 시 NOT NULL 이면 자동으로 nullable 활성화
  const applyNullDefault = () => {
    if (row.notNull) {
      onPatch({ default: '', notNull: false })
      showNullableSnackbar()
    } else {
      onPatch({ default: '' })
    }
  }

  const presets = getPresets(row.dataType, row.rowId, allRows, language)
  const supportsOnUpdate = DATETIME_TYPES.has(row.dataType.toUpperCase())

  const openMenu = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      // 아래 공간이 부족하면 위로 열기
      const spaceBelow = window.innerHeight - r.bottom
      const estimatedHeight = (presets.length + (supportsOnUpdate ? ON_UPDATE_OPTIONS.length + 2 : 0)) * 22 + 8
      const top = spaceBelow < estimatedHeight && r.top > estimatedHeight
        ? r.top - estimatedHeight
        : r.bottom + 4
      setPos({ top, left: r.left })
    }
    setOpen(true)
  }

  const selectDefault = (preset: DefaultPreset) => {
    setOpen(false)
    if (preset.value === '__AI__') {
      onPatch({ autoInc: true, default: '' })
    } else if (preset.value === '') {
      // NULL 선택
      applyNullDefault()
    } else {
      onPatch({ default: preset.value })
    }
  }

  const selectOnUpdate = (opt: DefaultPreset) => {
    setOpen(false)
    onPatch({ onUpdate: opt.value })
  }

  // 직접 타이핑: blur 시점에 "NULL" 이면 자동 처리
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (e.target.value.trim().toUpperCase() === 'NULL') {
      applyNullDefault()
    }
  }

  const inputCls = 'h-6 px-1.5 text-[11px] rounded-sm border border-transparent bg-transparent text-[var(--color-text-subtle)] font-mono focus:outline-none focus:border-[var(--color-accent)] focus:bg-[var(--color-bg-primary)]'

  return (
    <div ref={containerRef} className="flex items-center w-full gap-0.5">
      <input
        value={row.default}
        onChange={(e) => onPatch({ default: e.target.value })}
        onBlur={handleBlur}
        onClick={(e) => e.stopPropagation()}
        className={`${inputCls} flex-1 min-w-0`}
        placeholder="NULL"
      />
      {row.onUpdate && (
        <span
          title={`ON UPDATE ${row.onUpdate}`}
          className="shrink-0 text-[8px] px-1 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-warning)] leading-none font-mono"
        >
          OU
        </span>
      )}
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); open ? setOpen(false) : openMenu() }}
        className="px-0.5 text-[var(--color-null)] hover:text-[var(--color-text-subtle)] shrink-0"
      >
        <ChevronDown size={10} />
      </button>
      {open && (
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 100 }}
          className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded shadow-xl py-1 min-w-[200px] max-h-[320px] overflow-y-auto"
        >
          {/* 기본값 프리셋 */}
          <div className="px-3 pb-0.5 text-[9px] uppercase text-[var(--color-null)]">{t('cgColDefault', language)}</div>
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => selectDefault(p)}
              className={`w-full text-left px-3 py-1 text-[11px] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] flex items-center justify-between gap-2 ${
                row.default === p.value && p.value !== '' ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-subtle)]'
              }`}
            >
              <span>{p.label}</span>
              {p.isExpr && <span className="text-[8px] text-[var(--color-null)] shrink-0">expr</span>}
            </button>
          ))}
          {/* ON UPDATE 섹션 */}
          {supportsOnUpdate && (
            <>
              <div className="my-1 border-t border-[var(--color-border)]" />
              <div className="px-3 pb-0.5 text-[9px] uppercase text-[var(--color-null)]">ON UPDATE</div>
              {ON_UPDATE_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  onClick={() => selectOnUpdate(o)}
                  className={`w-full text-left px-3 py-1 text-[11px] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] flex items-center justify-between gap-2 ${
                    row.onUpdate === o.value ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-subtle)]'
                  }`}
                >
                  <span>{o.value === '' ? t('cgOnUpdateNone', language) : o.label}</span>
                  {o.isExpr && <span className="text-[8px] text-[var(--color-null)] shrink-0">expr</span>}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {/* NULL 자동 허용 안내 스낵바 */}
      {snackbar && (
        <div
          style={{ position: 'fixed', top: snackbar.top, left: snackbar.left, zIndex: 200 }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--color-border)] border border-[var(--color-null)] shadow-lg text-[11px] text-[var(--color-text-primary)] whitespace-nowrap pointer-events-none"
        >
          <AlertTriangle size={11} className="text-[var(--color-warning)] shrink-0" />
          {t('cgNullAutoNullable', language)}
        </div>
      )}
    </div>
  )
}

// ─── 행 비교 (정렬용) ────────────────────────────────────────────────────────

function compareRow(a: ColumnRow, b: ColumnRow, key: TableDesignerGridKey): number {
  switch (key) {
    case 'ordinal':   return a.ordinalPos - b.ordinalPos
    case 'name':      return a.name.localeCompare(b.name)
    case 'type':      return a.dataType.localeCompare(b.dataType)
    case 'length':    return a.length.localeCompare(b.length)
    case 'default':   return a.default.localeCompare(b.default)
    case 'comment':   return a.comment.localeCompare(b.comment)
    case 'nullable':  return Number(a.notNull) - Number(b.notNull)
    case 'unsigned':  return Number(a.unsigned) - Number(b.unsigned)
    case 'zerofill':  return Number(a.zeroFill) - Number(b.zeroFill)
    case 'flags':     return Number(a.primaryKey) - Number(b.primaryKey)
    case 'collation': return a.collation.localeCompare(b.collation)
    case 'onUpdate':  return a.onUpdate.localeCompare(b.onUpdate)
    default:          return 0
  }
}

// ─── 경량 컨텍스트 메뉴 ──────────────────────────────────────────────────────

interface CtxProps {
  x: number
  y: number
  onClose: () => void
  children: React.ReactNode
}

function ContextMenu({ x, y, onClose, children }: CtxProps) {
  const ref = useRef<HTMLDivElement>(null)
  // 화면 바깥으로 벗어나지 않게 clamp
  const [pos, setPos] = useState({ x, y })
  useEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const maxX = window.innerWidth - rect.width - 8
    const maxY = window.innerHeight - rect.height - 8
    setPos({ x: Math.min(x, maxX), y: Math.min(y, maxY) })
  }, [x, y])

  return (
    <div
      ref={ref}
      onClick={(e) => { e.stopPropagation(); onClose() }}
      style={{ top: pos.y, left: pos.x }}
      className="fixed z-50 min-w-[180px] py-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded shadow-lg text-[11px] text-[var(--color-text-subtle)]"
    >
      {children}
    </div>
  )
}

function CtxItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-1 hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
    >
      {children}
    </button>
  )
}

function CtxDivider() {
  return <div className="my-1 border-t border-[var(--color-border)]" />
}

function CtxSubLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-0.5 text-[9px] uppercase text-[var(--color-null)]">{children}</div>
}
