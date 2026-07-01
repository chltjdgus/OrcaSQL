import { Plus, Copy, Eraser } from 'lucide-react'
import type { TableEditContext } from '@/types'
import { t, type Language } from '@/i18n'
import type { ContextMenuOption } from '@/components/ContextMenu'
import {
  generateSelectSQL,
  generateInsertSQL,
  generateUpdateSQL,
  generateDeleteSQL,
  generateRowJSON,
  generateRowsJSON,
  generateRowCSV,
  generateRowsCSV,
  generateMultiInsert,
} from './sqlGenerators'

/**
 * ResultGrid 우클릭 컨텍스트 메뉴 아이템 빌더 (Phase 48 · Wave 2d).
 *
 * 본체 `index.tsx` 에서 그대로 옮겨온 builder. 입력은 시각 인덱스(rowIdx) +
 * `sortedRows` (sortedRows 기반 — BugFix-BO 단일 소스). 본체 state 의존 없음 —
 * 모든 변형은 callback prop 으로 위임한다.
 */
export function buildContextMenuItems({
  rowIdx, colIdx, filteredRows, columns, nullText,
  canDelete, isDeleting, selectedRows,
  canEdit, editCtx, onInsertSQL, onSetNull,
  onRowDetail, onFilterByValue, onCopyCell, onCopyRow, onDeleteSelected,
  onInsertRow, onDuplicateRow, onResetView, language,
}: {
  rowIdx: number
  colIdx: number
  filteredRows: unknown[][]
  columns: string[]
  nullText: string
  canDelete: boolean
  isDeleting: boolean
  selectedRows: Set<number>
  canEdit: boolean
  editCtx?: TableEditContext
  onInsertSQL?: (sql: string) => void
  onSetNull?: (rowIdx: number, colIdx: number) => void
  onRowDetail: () => void
  onFilterByValue: (val: string) => void
  onCopyCell: (val: string) => void
  onCopyRow: (vals: string) => void
  onDeleteSelected: () => void
  /** 빈 newRow 진입 — 행 삽입 (canEdit 일 때만 정의) */
  onInsertRow?: () => void
  /** 클릭한 행을 newRow 로 복사하되 PK·AUTO_INCREMENT 컬럼은 비움 */
  onDuplicateRow?: (rowIdx: number) => void
  /** Table Data 탭에서만 주입 — 필터·정렬 초기화 (BugFix-DL) */
  onResetView?: () => void
  language: Language
}): ContextMenuOption[] {
  const row = filteredRows[rowIdx] ?? []
  const cellVal = row[colIdx]
  const cellStr = cellVal === null || cellVal === undefined ? nullText : String(cellVal)
  const rowStr = columns.map((_, i) => (row[i] === null || row[i] === undefined ? nullText : String(row[i]))).join('\t')
  const deleteLabel = selectedRows.size > 1 && selectedRows.has(rowIdx)
    ? `선택된 ${selectedRows.size}행 삭제`
    : '이 행 삭제'

  // 다중 행 선택 데이터
  const isMultiSelected = selectedRows.size > 1 && selectedRows.has(rowIdx)
  const selectedRowsData = isMultiSelected
    ? [...selectedRows].sort((a, b) => a - b).map((i) => filteredRows[i] ?? [])
    : null

  const items: ContextMenuOption[] = [
    { label: 'Row 상세 보기', onClick: onRowDetail },
    { separator: true },
    { label: `셀 값 복사 "${cellStr.slice(0, 30)}${cellStr.length > 30 ? '…' : ''}"`, onClick: () => onCopyCell(cellStr) },
    { separator: true },
    // 단일 행 복사 포맷
    { label: '행 복사 — TSV', onClick: () => onCopyRow(rowStr) },
    { label: '행 복사 — CSV', onClick: () => onCopyRow(generateRowCSV(columns, row)) },
    { label: '행 복사 — JSON', onClick: () => onCopyRow(generateRowJSON(columns, row)) },
    { separator: true },
    { label: '이 값으로 필터', onClick: () => onFilterByValue(cellStr) },
  ]

  // 필터·정렬 초기화 — Table Data 탭에서만 노출 (BugFix-DL)
  if (onResetView) {
    items.push({
      label: t('tableDataResetView', language),
      icon: <Eraser size={11} className="text-[var(--color-accent)]" />,
      onClick: onResetView,
    })
  }

  if (canEdit && onSetNull) {
    const isPKCol = editCtx?.pkColumns.includes(columns[colIdx] ?? '') ?? false
    if (!isPKCol) {
      items.push({ separator: true })
      items.push({ label: 'NULL로 설정 (Ctrl+0)', onClick: () => onSetNull(rowIdx, colIdx) })
    }
  }

  if (editCtx && onInsertSQL && editCtx.pkColumns.length > 0) {
    const { database: db, table, pkColumns } = editCtx
    items.push({ separator: true })
    items.push({ label: 'SQL 생성 — SELECT', onClick: () => onInsertSQL(generateSelectSQL(db, table, pkColumns, columns, row)) })
    items.push({ label: 'SQL 생성 — INSERT', onClick: () => onInsertSQL(generateInsertSQL(db, table, columns, row)) })
    items.push({ label: 'SQL 생성 — UPDATE', onClick: () => onInsertSQL(generateUpdateSQL(db, table, pkColumns, columns, row)) })
    items.push({ label: 'SQL 생성 — DELETE', onClick: () => onInsertSQL(generateDeleteSQL(db, table, pkColumns, columns, row)) })
  }

  // 행 삽입 / 행 복제 — 인라인 편집 가능한 단일 테이블 SELECT 일 때만
  if (canEdit && (onInsertRow || onDuplicateRow)) {
    items.push({ separator: true })
    if (onInsertRow) {
      items.push({
        label: t('ctxMenuInsertRow', language),
        icon: <Plus size={11} className="text-[var(--color-success)]" />,
        onClick: onInsertRow,
      })
    }
    if (onDuplicateRow) {
      items.push({
        label: t('ctxMenuDuplicateRow', language),
        icon: <Copy size={11} className="text-[var(--color-accent)]" />,
        onClick: () => onDuplicateRow(rowIdx),
      })
    }
  }

  // 다중 행 선택 시 일괄 복사 메뉴
  if (isMultiSelected && selectedRowsData) {
    items.push({ separator: true })
    items.push({ label: `선택 ${selectedRows.size}행 복사 — TSV`, onClick: () => onCopyRow(selectedRowsData.map((r) => columns.map((_, i) => r[i] === null || r[i] === undefined ? nullText : String(r[i])).join('\t')).join('\n')) })
    items.push({ label: `선택 ${selectedRows.size}행 복사 — CSV`, onClick: () => onCopyRow(generateRowsCSV(columns, selectedRowsData)) })
    items.push({ label: `선택 ${selectedRows.size}행 복사 — JSON`, onClick: () => onCopyRow(generateRowsJSON(columns, selectedRowsData)) })
    if (editCtx && onInsertSQL) {
      items.push({ label: `선택 ${selectedRows.size}행 복사 — INSERT SQL`, onClick: () => onInsertSQL(generateMultiInsert(editCtx.database, editCtx.table, columns, selectedRowsData)) })
    }
  }

  if (canDelete) {
    items.push({ separator: true })
    items.push({
      label: deleteLabel,
      onClick: onDeleteSelected,
      danger: true,
      disabled: isDeleting,
    })
  }
  return items
}
