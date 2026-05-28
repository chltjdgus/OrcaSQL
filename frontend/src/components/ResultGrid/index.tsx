import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { flexRender } from '@tanstack/react-table'
import { Download, Copy, LayoutList, TableProperties, ChevronDown, Pencil, X, Search, Rows3, Trash2, Plus, Pin, PinOff, Save, Undo2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import type { QueryResult, TableEditContext } from '@/types'
import ContextMenu from '@/components/ContextMenu'
import { getCellEditor } from './editors'
import { NULL_SENTINEL, ROW_HEIGHT, type ServerSortControl } from './types'
import CellValue from './CellValue'
import ColumnStatsPopover from './ColumnStatsPopover'
import ColVisCombobox from './ColVisCombobox'
import FormView from './FormView'
import RowDetailModal from './RowDetailModal'
import TextViewModal from './TextViewModal'
import { renderNewRowTr } from './NewRowCell'
import { confirmRowDelete } from './confirmRowDelete'
import { buildContextMenuItems } from './buildContextMenuItems'
import { useTextViewModal } from './hooks/useTextViewModal'
import { useExportMenu } from './hooks/useExportMenu'
import { useColumnStatsPopover } from './hooks/useColumnStatsPopover'
import { useSchemaMeta } from './hooks/useSchemaMeta'
import { useLocalRows } from './hooks/useLocalRows'
import { useFilterAndSort } from './hooks/useFilterAndSort'
import { useRowSelection } from './hooks/useRowSelection'
import { useContextMenu } from './hooks/useContextMenu'
import { useInlineEdit } from './hooks/useInlineEdit'
import { usePendingEdits } from './hooks/usePendingEdits'
import { useKeyboardNav } from './hooks/useKeyboardNav'
import { useNewRowInsert } from './hooks/useNewRowInsert'
import { useRowDeletion } from './hooks/useRowDeletion'
import { useGridTable } from './hooks/useGridTable'
import { useRecentlyEdited } from './hooks/useRecentlyEdited'
import { useDetailRowIdx } from './hooks/useDetailRowIdx'
import { useViewMode } from './hooks/useViewMode'
import { useExporters } from './hooks/useExporters'

interface Props {
  result: QueryResult
  /** 인라인 편집 컨텍스트 (단일 테이블 SELECT 시 제공) */
  editCtx?: TableEditContext
  /** 연결 ID (UpdateRowValue 호출용) */
  connId?: string
  /** 행 우클릭 → SQL 생성 시 에디터에 삽입할 콜백 */
  onInsertSQL?: (sql: string) => void
  /** 헤더의 컬럼 통계(∑) 버튼·팝오버 노출 여부 (기본 true) */
  showColumnStats?: boolean
  /**
   * 서버 측 정렬 외부 제어 — 부모가 DB ORDER BY 와 동기화되는 정렬 상태를
   * 주입하면 클라이언트 정렬은 비활성화되고 헤더 클릭이 `onChange` 로 라우팅된다.
   */
  serverSort?: ServerSortControl
}

/**
 * TanStack Table v8 + TanStack Virtual 기반 결과 그리드.
 * - 컬럼 너비 드래그 조절
 * - NULL 값 시각적 구분
 * - CSV 내보내기
 * - 행 가상화 (10만+ 행 지원)
 */
export default function ResultGrid({ result, editCtx, connId, onInsertSQL, showColumnStats = true, serverSort }: Props) {
  const { viewMode, formRowIdx, setFormRowIdx, setViewModeGrid, setViewModeForm } = useViewMode()
  const nullText = useSettingsStore((s) => s.settings.display.nullDisplayText)
  const language = useLanguageStore((s) => s.language)

  // ─── BLOB / 긴 텍스트 전체 보기 상태 (hook) ──────────────────────────
  const { viewingText, openTextView, closeTextView } = useTextViewModal()

  // ─── 편집 성공 하이라이트 (hook) — useInlineEdit·FormView 공용 ───────
  const { recentlyEdited, flashRecentlyEdited } = useRecentlyEdited()

  // ─── 로컬 행 · 필터/정렬 (hooks) ────────────────────────────────────
  const { localRows, setLocalRows } = useLocalRows(result)
  const {
    filterText, setFilterText, isFilterStale,
    sorting, setSorting, filteredRows, sortedRows,
  } = useFilterAndSort(localRows, result.columns, result, !!serverSort)

  // serverSort 가 주입되면 외부 정렬 상태(col/dir) 를 헤더 ↑/↓ 인디케이터용
  // TanStack sorting state 로 단방향 미러링. 클라이언트 정렬은 위에서 비활성됨.
  useEffect(() => {
    if (!serverSort) return
    if (!serverSort.col) {
      setSorting([])
    } else {
      setSorting([{ id: serverSort.col, desc: serverSort.dir === 'DESC' }])
    }
  }, [serverSort?.col, serverSort?.dir, serverSort, setSorting])

  // 필터 활성 중 인라인 편집은 rowIdx 매핑 복잡도를 피해 비활성
  const canEdit = !!(editCtx && connId && editCtx.pkColumns.length > 0 && !filterText)
  const canDelete = !!(editCtx && connId && editCtx.pkColumns.length > 0)

  // ─── 테이블 스키마 메타 (hook) ──────────────────────────────────────
  // editCtx 가 있을 때 information_schema 에서 ColumnInfo + 인덱스 + FK 플래그를
  // 합쳐 TableSchemaMeta 로 보관 (캐시 hook 내부). 헤더 타입 배지 보정·인덱스
  // 아이콘·ENUM/SET 허용값 추출·저장 전 클라이언트 검증에 사용.
  const { schemaMeta, effectiveColType, getEnumValues } = useSchemaMeta(connId, editCtx)

  // ─── 행 단위 dirty 큐 (Excel-style row-level commit) ──────────────────
  // 셀 편집 종료 시 즉시 UPDATE 가 아니라 dirty 큐에 적재 → 다른 행으로 이동할 때
  // commitRow 가 컬럼별 순차 UpdateRowValue 호출. 부분 실패 시 dirty 유지.
  const pendingEdits = usePendingEdits({
    result, editCtx, connId, localRows, setLocalRows,
    effectiveColType, getEnumValues, language,
    onCellCommitted: flashRecentlyEdited,
  })

  // 행 이동 직전 dirty commit — useRowSelection 의 beforeRowChange 콜백으로 주입.
  // 시각 인덱스(prev) → sortedRows 행 참조(=rowRef) → pendingEdits.commitRow 호출.
  // dirty 가 없거나 매핑 실패면 통과. RowRef 키 설계로 정렬·필터·삭제 무관 안전.
  const beforeRowChange = useCallback(async (prevVisualRowIdx: number): Promise<boolean> => {
    const targetRow = sortedRows[prevVisualRowIdx]
    if (!targetRow) return true
    if (!pendingEdits.isRowDirty(targetRow)) return true
    const r = await pendingEdits.commitRow(targetRow, prevVisualRowIdx)
    return r.ok
  }, [sortedRows, pendingEdits])

  // ─── 인라인 편집 · 신규 행 삽입 · 행 삭제 · 행 선택 · 우클릭 메뉴 (hooks) ─
  // 호출 순서: useInlineEdit → useRowSelection(editingCell·beforeRowChange 의존) →
  // useNewRowInsert → useRowDeletion(editingCell·selection·sortedRows 의존) →
  // useContextMenu
  const {
    editingCell,
    editValue, setEditValue, isSaving,
    editEnumValues, editAnchorRect,
    startEdit, cancelEdit, confirmEdit,
    recomputeAnchorRect,
  } = useInlineEdit({
    result, canEdit, editCtx, connId, localRows, sortedRows, setLocalRows,
    effectiveColType, getEnumValues, language,
    onEditSuccess: flashRecentlyEdited,
    commitMode: 'pending',
    enqueuePending: pendingEdits.enqueue,
  })
  const {
    selectedRows, setSelectedRows, lastSelectedRow,
    focusedRowIdx, setFocusedRowIdx,
    focusedColIdx, setFocusedColIdx,
    handleRowNumClick, handleRowBodyClick,
    selectSingleRow,
  } = useRowSelection({ result, sorting, editingCell, beforeRowChange })
  const {
    newRow, setNewRow, isInserting,
    insertAfterRowIdx, setInsertAfterRowIdx,
    confirmInsert,
  } = useNewRowInsert({
    result, editCtx, connId, effectiveColType, getEnumValues, language, setLocalRows,
  })
  const { isDeleting, deleteSelectedRows } = useRowDeletion({
    result, editCtx, connId, canDelete, selectedRows, sortedRows, editingCell, language,
    setLocalRows, setSelectedRows, lastSelectedRow, setFocusedRowIdx,
  })
  const { ctxMenu, setCtxMenu } = useContextMenu(result, sorting)

  // 헤더(th) 우클릭 컨텍스트 메뉴 — 컬럼 고정/해제 진입점 (BugFix-CP).
  // result 변경 시 자동 닫힘. 행 ctxMenu 와 좌표·생명주기가 독립적이라 별도 state 로 유지.
  const [headerCtxMenu, setHeaderCtxMenu] = useState<{ x: number; y: number; colId: string } | null>(null)
  useEffect(() => { setHeaderCtxMenu(null) }, [result])

  // ─── 컬럼 통계 팝오버 (hook) ────────────────────────────────────────
  const { statsColIdx, setStatsColIdx, statsPopoverRef, statsAnchorRef, columnStats } =
    useColumnStatsPopover(localRows)

  // ─── TanStack 통합 hook (columns memo + useReactTable + useVirtualizer + columnVisibility/Pinning) ─
  const {
    table, parentRef,
    columnVisibility, colMenuOpen, setColMenuOpen,
    rowVirtualizer, rows, virtualRows, totalHeight,
    visibleColIdxList,
  } = useGridTable({
    result, sorting, setSorting, sortedRows, schemaMeta, effectiveColType, language,
  })

  // Phase 57 — 키보드 네비게이션 (화살표/Tab/F2/Enter/Escape/PageUp·Down/Home·End/Del 등).
  // 비편집 모드 셀 이동·편집 진입, 편집 모드 Tab=commit+이동.
  // 셀 클릭 후 그리드 컨테이너에 포커스 복귀하기 위한 헬퍼.
  const focusGridContainer = useCallback(() => {
    parentRef.current?.focus()
  }, [parentRef])

  // BugFix-DB — 셀 편집을 Enter/Escape 로 종료하면 에디터 input 이 unmount 되며 focus 가 body 로
  // 떨어진다. 그 결과 그리드 컨테이너가 비활성이라 화살표·Tab 키가 `onGridKeyDown` 에 도달하지 못해
  // Excel-style 네비게이션이 끊긴다. editingCell 이 non-null→null 로 전이되는 시점에 focus 가 정말
  // 유실됐을 때(=activeElement 가 body)만 그리드 컨테이너로 복귀시킨다 — 사용자가 외부 영역
  // (스키마 트리·다른 버튼 등) 으로 의도적으로 focus 를 옮긴 경우엔 그 focus 를 빼앗지 않는다.
  const wasEditingRef = useRef(false)
  useEffect(() => {
    const isEditing = editingCell !== null
    if (wasEditingRef.current && !isEditing) {
      const active = typeof document !== 'undefined' ? document.activeElement : null
      if (!active || active === document.body) {
        parentRef.current?.focus()
      }
    }
    wasEditingRef.current = isEditing
  }, [editingCell, parentRef])

  // BugFix-DK — 편집 중에 그리드 스크롤·창 리사이즈가 발생하면 td 의 viewport
  // 좌표가 바뀐다. 팝오버 에디터(TextAreaEditor/SetEditor)는 시작 시점에 캡처한
  // anchorRect 로 position:fixed 배치하므로, 갱신하지 않으면 셀과 분리돼 보인다.
  // 스크롤은 컨테이너 단위라 capture phase 로 들어야 하고, rAF 한 번으로 묶어
  // 연속 이벤트의 setState 폭주를 막는다 (가상화 리렌더와 자연스럽게 합쳐짐).
  useEffect(() => {
    if (!editingCell) return
    let rafId: number | null = null
    const schedule = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        recomputeAnchorRect()
      })
    }
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [editingCell, recomputeAnchorRect])

  // 좌측 sticky 영역 누적 width (행 번호 칸 40 + 핀 컬럼들의 합) — 가로 스크롤 보정 시
  // 일반 컬럼 셀이 핀 그림자 뒤에 가려지지 않도록 셀 좌단 임계로 사용.
  const getLeftStickyWidth = useCallback(() => {
    let total = 40
    table.getLeftLeafColumns().forEach((col) => { total += col.getSize() })
    return total
  }, [table])
  const { onKeyDown: onGridKeyDown } = useKeyboardNav({
    visibleColIdxList,
    rowCount: sortedRows.length,
    focusedRowIdx,
    focusedColIdx,
    setFocusedRowIdx,
    setFocusedColIdx,
    editingCell,
    startEdit,
    confirmEdit,
    beforeRowChange,
    resolveRowRef: (vIdx) => sortedRows[vIdx] ?? null,
    rowVirtualizer,
    isColEditable: (colIdx) => {
      if (!canEdit) return false
      const colName = result.columns[colIdx]?.name
      if (!colName) return false
      return !(editCtx?.pkColumns.includes(colName) ?? false)
    },
    isColNullable: (colIdx) => result.columns[colIdx]?.nullable ?? false,
    columnNameByIdx: (colIdx) => result.columns[colIdx]?.name ?? '',
    pendingEdits: {
      enqueue: pendingEdits.enqueue,
      discardRow: pendingEdits.discardRow,
      commitRow: pendingEdits.commitRow,
      isRowDirty: pendingEdits.isRowDirty,
    },
    newRowActive: !!newRow,
    focusContainer: focusGridContainer,
    onSelectRow: selectSingleRow,
    scrollContainerRef: parentRef,
    getLeftStickyWidth,
  })

  const { exportMenuOpen, closeExportMenu, toggleExportMenu } = useExportMenu()

  // ─── 내보내기 5종 + 클립보드 복사 (hook) ─────────────────────────────
  const { exportCSV, exportJSON, exportSQL, exportExcel, copyToClipboard } = useExporters({
    result, nullText, language, onComplete: closeExportMenu,
  })

  // ─── Row Detail 모달 (hook) — result 변경 자동 닫힘 + prev/next 분기 ─
  const { detailRowIdx, openDetail, closeDetail, prevDetail, nextDetail } = useDetailRowIdx({
    result, rowCount: sortedRows.length,
  })

  // ─── 실행 통계 표시 ────────────────────────────────────────────────────
  const ms = Math.round(result.duration / 1_000_000)
  const isSelect = result.columns.length > 0
  const statsText = isSelect
    ? filterText
      ? `${filteredRows.length.toLocaleString()} / ${localRows.length.toLocaleString()}행`
      : `${localRows.length.toLocaleString()}행 반환`
    : `${result.affected.toLocaleString()}행 영향`
  const isTruncated = result.truncated === true

  if (!isSelect && result.affected === 0 && result.columns.length === 0) {
    return (
      <div className="flex items-center gap-2 h-full px-4 text-xs text-[var(--color-text-muted)]">
        <span className="text-[var(--color-success)]">✓</span>
        쿼리 실행 완료 ({ms}ms)
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 상태 바 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
        <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-2 shrink-0">
          <span className={`font-medium ${filterText && filteredRows.length < localRows.length ? 'text-[var(--color-warning)]' : 'text-[var(--color-success)]'}`}>
            {statsText}
          </span>
          &nbsp;·&nbsp; {ms}ms
          {isTruncated && (
            <span className="flex items-center gap-1 text-[var(--color-warning)] text-[10px]" title="결과 행 상한선 초과 — 일부 행이 잘림. 설정에서 상한선을 조정하거나 WHERE/LIMIT로 범위를 좁히세요.">
              ⚠ 결과 잘림
            </span>
          )}
          {canEdit && (
            <span className="flex items-center gap-1 text-[var(--color-accent)] text-[10px]">
              <Pencil size={9} />
              {t('gridEditableHint', language)}
            </span>
          )}
          {pendingEdits.hasDirty && (
            <span className="osql-result-grid-statusbar-dirty flex items-center gap-1.5 text-[10px]">
              <span className="text-[var(--color-accent)]">
                <Pencil size={9} />
              </span>
              <span className="text-[var(--color-accent)] font-medium">
                {pendingEdits.dirtyRowCount} {t('gridDirtyRowsCountSuffix', language)}
              </span>
              <button
                onClick={() => void pendingEdits.commitAll()}
                className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[var(--color-accent)] hover:bg-[var(--color-accent)]/15 transition-colors"
                title={t('gridDirtyTooltipCtrlEnter', language)}
              >
                <Save size={9} />
                {t('gridDirtyCommitAllBtn', language)}
              </button>
              <button
                onClick={() => pendingEdits.discardAll()}
                className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10 transition-colors"
                title={t('gridDirtyTooltipEsc', language)}
              >
                <Undo2 size={9} />
                {t('gridDirtyDiscardAllBtn', language)}
              </button>
            </span>
          )}
          {selectedRows.size > 0 && (
            <span className="flex items-center gap-1.5 text-[10px]">
              <span className="text-[var(--color-warning)]">
                <Rows3 size={9} />
              </span>
              <span className="text-[var(--color-warning)]">{selectedRows.size} {t('gridDeleteRowsSelectedSuffix', language)}</span>
              {canDelete && (
                <button
                  onClick={() => {
                    void confirmRowDelete(selectedRows.size, language).then((ok) => {
                      if (ok) void deleteSelectedRows()
                    })
                  }}
                  disabled={isDeleting}
                  className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[var(--color-error)] hover:bg-[var(--color-error)]/15 transition-colors disabled:opacity-40"
                  title={t('gridDeleteSelectedTip', language)}
                >
                  <Trash2 size={9} />
                  {t('gridDeleteSelectedBtn', language)}
                </button>
              )}
              <button
                onClick={() => { setSelectedRows(new Set()); lastSelectedRow.current = null; setFocusedRowIdx(null); setFocusedColIdx(null) }}
                className="text-[var(--color-null)] hover:text-[var(--color-text-muted)]"
                title="선택 해제"
              >
                <X size={9} />
              </button>
            </span>
          )}
        </span>

        {/* 클라이언트 필터 인풋 */}
        {isSelect && (
          <div className={`flex items-center gap-1 flex-1 max-w-[220px] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-0.5 transition-opacity ${isFilterStale ? 'opacity-60' : ''}`}>
            <Search size={10} className="text-[var(--color-null)] shrink-0" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={t('phResultFilter', language)}
              className="flex-1 bg-transparent text-[10px] text-[var(--color-text-primary)] placeholder-[var(--color-null)] outline-none min-w-0"
            />
            {filterText && (
              <button onClick={() => setFilterText('')} className="text-[var(--color-null)] hover:text-[var(--color-text-muted)]">
                <X size={9} />
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-1 ml-auto">
          {/* View 토글 (Grid / Form) */}
          {isSelect && (
            <div className="flex items-center border border-[var(--color-border)] rounded overflow-hidden mr-1">
              <button
                onClick={setViewModeGrid}
                className={`p-1 transition-colors ${viewMode === 'grid' ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'}`}
                title="그리드 보기"
              >
                <TableProperties size={12} />
              </button>
              <button
                onClick={setViewModeForm}
                className={`p-1 transition-colors ${viewMode === 'form' ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'}`}
                title="폼 보기"
              >
                <LayoutList size={12} />
              </button>
            </div>
          )}
          {/* 컬럼 가시성 콤보박스 */}
          {isSelect && result.columns.length > 1 && (
            <ColVisCombobox
              table={table}
              columnVisibility={columnVisibility}
              open={colMenuOpen}
              onOpenChange={setColMenuOpen}
            />
          )}
          <button
            onClick={copyToClipboard}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
            title="클립보드에 복사"
          >
            <Copy size={12} />
          </button>
          {/* 내보내기 드롭다운 */}
          <div className="relative">
            <button
              onClick={toggleExportMenu}
              className="flex items-center gap-0.5 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
              title="내보내기"
            >
              <Download size={12} />
              <ChevronDown size={9} />
            </button>
            {exportMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={closeExportMenu}
                />
                <div className="absolute right-0 top-full mt-1 z-20 min-w-[120px] rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-lg overflow-hidden">
                  {[
                    { label: 'CSV', onClick: exportCSV },
                    { label: 'JSON', onClick: exportJSON },
                    { label: 'SQL INSERT', onClick: exportSQL },
                    { label: 'Excel', onClick: exportExcel },
                  ].map(({ label, onClick }) => (
                    <button
                      key={label}
                      onClick={onClick}
                      className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Form View */}
      {viewMode === 'form' && isSelect ? (
        <FormView
          result={result}
          rowIdx={formRowIdx}
          onNavigate={setFormRowIdx}
          editCtx={editCtx}
          connId={connId}
          rows={localRows}
          schemaMeta={schemaMeta}
          onRowUpdate={(rIdx, cIdx, value) => {
            setLocalRows((prev) => {
              const next = prev.map((r) => [...r])
              next[rIdx][cIdx] = value
              return next
            })
            flashRecentlyEdited(`${rIdx}-${cIdx}`)
          }}
        />
      ) : (
      /* 테이블 — Phase 57: 키보드 네비 활성. tabIndex=0 로 포커스 가능, onKeyDown 으로 셀 이동. */
      <div
        ref={parentRef}
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        className="osql-result-grid-scroll flex-1 overflow-auto outline-none focus:outline-none"
      >
        <table
          style={{ width: table.getTotalSize(), tableLayout: 'fixed' }}
          className="border-collapse text-xs"
        >
          {/* 헤더 */}
          <thead className="sticky top-0 z-10 bg-[var(--color-bg-secondary)]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {/* 행 번호 컬럼 */}
                <th className="w-10 text-right pr-2 text-[var(--color-text-muted)] font-normal border-b border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] select-none">
                  #
                </th>
                {hg.headers.map((header, hIdx) => {
                  const isPinned = header.column.getIsPinned()
                  const pinLeft = isPinned === 'left' ? header.column.getStart('left') + 40 : undefined // +40 for row-num col
                  return (
                  <th
                    key={header.id}
                    style={{
                      width: header.getSize(),
                      ...(isPinned ? {
                        position: 'sticky',
                        left: pinLeft,
                        zIndex: 20,
                      } : {}),
                    }}
                    className={`osql-result-th relative px-2 py-1.5 text-left border-b border-r border-[var(--color-border)] whitespace-nowrap select-none group/th
                      ${isPinned ? 'bg-[var(--color-bg-tertiary)] shadow-[2px_0_4px_rgba(0,0,0,0.3)]' : 'bg-[var(--color-bg-secondary)]'}`}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setHeaderCtxMenu({ x: e.clientX, y: e.clientY, colId: header.column.id })
                    }}
                  >
                    <div
                      className="flex items-center gap-1 cursor-pointer"
                      onClick={(e) => {
                        if (serverSort) {
                          const colName = header.column.id
                          // 사이클: 미정렬/타 컬럼 클릭 → ASC, ASC → DESC, DESC → 미정렬
                          if (serverSort.col !== colName) serverSort.onChange(colName, 'ASC')
                          else if (serverSort.dir === 'ASC') serverSort.onChange(colName, 'DESC')
                          else serverSort.onChange(null, 'ASC')
                        } else {
                          header.column.getToggleSortingHandler()?.(e)
                        }
                      }}
                    >
                      {isPinned && <Pin size={9} className="text-[var(--color-accent)] shrink-0" />}
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{
                        asc: ' ↑',
                        desc: ' ↓',
                      }[header.column.getIsSorted() as string] ?? ''}
                    </div>
                    {/* 통계 버튼 (핀/언핀은 th 우클릭 컨텍스트 메뉴로 이동 — BugFix-CP) */}
                    {showColumnStats && (
                      <button
                        className="absolute top-1/2 -translate-y-1/2 right-3 opacity-0 group-hover/th:opacity-100 transition-opacity text-[var(--color-null)] hover:text-[var(--color-accent)] text-[9px] leading-none px-0.5"
                        title="컬럼 통계"
                        onClick={(e) => {
                          e.stopPropagation()
                          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                          statsAnchorRef.current = { x: rect.left, y: rect.bottom + 4, colIdx: hIdx }
                          setStatsColIdx((prev) => prev === hIdx ? null : hIdx)
                        }}
                      >
                        ∑
                      </button>
                    )}
                    {/* 컬럼 너비 조절 핸들 */}
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--color-accent)] transition-colors"
                      />
                    )}
                  </th>
                  )
                })}
              </tr>
            ))}
          </thead>

          {/* 가상화된 바디 */}
          <tbody>
            {/* 상단 패딩 */}
            {virtualRows.length > 0 && virtualRows[0].start > 0 && (
              <tr><td style={{ height: virtualRows[0].start }} /></tr>
            )}

            {virtualRows.map((vRow) => {
              const row = rows[vRow.index]
              const rowIdx = vRow.index
              const isRowSelected = selectedRows.has(rowIdx)
              const isFocused = focusedRowIdx === rowIdx
              // dirty 큐 조회용 — 시각 인덱스(rowIdx) → sortedRows 행 참조(=RowRef key)
              const targetRow = sortedRows[rowIdx]
              const isRowDirty = !!targetRow && pendingEdits.isRowDirty(targetRow)
              return (
                <Fragment key={row.id}>
                <tr
                  data-osql-row-idx={rowIdx}
                  style={{ height: ROW_HEIGHT }}
                  className={`osql-result-row transition-colors group cursor-default
                    ${isRowDirty ? 'osql-result-grid-row-dirty' : ''}
                    ${isRowSelected ? 'bg-[var(--color-bg-selected)]/60 hover:bg-[var(--color-bg-selected)]/75' : 'hover:bg-[var(--color-bg-tertiary)]'}
                    ${isFocused ? 'ring-1 ring-inset ring-[var(--color-accent)] bg-[var(--color-bg-selected)]/80' : ''}`}
                  onClick={(e) => {
                    // BugFix-CU: 편집 중인 셀(td) 안(에디터 popover 포함) 클릭은 행 선택·focus 변경·컨테이너 focus 모두 무시
                    // — textarea/select 의 focus 가 풀려 input 이 즉시 blur 되거나 셀 단위 focus 가 엉뚱한 위치로 점프하는 회귀 방지
                    if ((e.target as HTMLElement).closest('[data-osql-editor="true"]')) return
                    void handleRowBodyClick(e, rowIdx); focusGridContainer()
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    // 우클릭 시 선택·포커스 동기화 (단일 선택 갱신)
                    if (!selectedRows.has(rowIdx)) {
                      setSelectedRows(new Set([rowIdx]))
                      lastSelectedRow.current = rowIdx
                    }
                    setFocusedRowIdx(rowIdx)
                    // 우클릭한 열 인덱스 파악
                    const td = (e.target as HTMLElement).closest('td')
                    const cells = (e.currentTarget as HTMLTableRowElement).querySelectorAll('td')
                    let colIdx = -1
                    cells.forEach((cell, i) => { if (cell === td) colIdx = i - 1 }) // -1 for row-num col
                    const safeColIdx = Math.max(colIdx, 0)
                    setFocusedColIdx(safeColIdx) // BugFix-CS: 우클릭한 셀도 강조
                    setCtxMenu({ x: e.clientX, y: e.clientY, rowIdx, colIdx: safeColIdx })
                  }}
                >
                  {/* 행 번호 — 클릭: 선택, 더블클릭: Row Detail. dirty 시 좌측 컬러바 마커 */}
                  <td
                    className={`relative w-10 text-right pr-2 text-[10px] border-b border-r border-[var(--color-bg-tertiary)] select-none cursor-pointer
                      ${isRowSelected ? `font-medium text-[var(--color-accent-light)] ${isFocused ? 'bg-[var(--color-bg-selected)]/90' : 'bg-[var(--color-bg-selected)]/75'}` : 'text-[var(--color-null)] hover:text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-hover)]'}`}
                    onClick={(e) => handleRowNumClick(e, rowIdx)}
                    onDoubleClick={() => openDetail(rowIdx)}
                    title="클릭: 행 선택 / 더블클릭: 상세 보기"
                  >
                    {isRowDirty && (
                      <span className="absolute inset-y-0 left-0 w-0.5 bg-[var(--color-accent)] pointer-events-none" />
                    )}
                    {rowIdx + 1}
                  </td>
                  {row.getVisibleCells().map((cell, colIdx) => {
                    const colName = result.columns[colIdx]?.name ?? ''
                    const isPK = editCtx?.pkColumns.includes(colName) ?? false
                    const isEditing = editingCell?.rowIdx === rowIdx && editingCell?.colIdx === colIdx
                    const isEditableCol = canEdit && !isPK
                    const isCellPinned = cell.column.getIsPinned() === 'left'
                    const cellPinLeft = isCellPinned ? cell.column.getStart('left') + 40 : undefined
                    // BugFix-CS: 행 포커스 + 컬럼 포커스 교집합 = 활성 셀 (행 강조 위 더 진한 강조)
                    const isCellFocused = isFocused && focusedColIdx === colIdx
                    const isRowHighlighted = isRowSelected || isFocused
                    const isRecent = recentlyEdited.has(`${rowIdx}-${colIdx}`)
                    // Wave 2 — dirty 셀 표시. 사용자가 편집 종료(Enter/blur/Tab) 했지만 아직
                    // 행 이동 commit 전인 변경. 값은 pendingEdit.newValue 로 우선 표시.
                    const pendingEdit = targetRow ? pendingEdits.getCellPending(targetRow, colIdx) : undefined
                    const isDirty = !!pendingEdit
                    const displayValue: unknown = pendingEdit
                      ? (pendingEdit.setNull ? null : pendingEdit.newValue)
                      : sortedRows[rowIdx]?.[colIdx]

                    // BugFix-CT + Phase 57: 우선순위 단일 bg 결정.
                    //   1) 활성 셀(focus 교집합) → accent ring (최상위)
                    //   2) 최근 commit yellow flash (2초)
                    //   3) dirty (미저장 변경) → 옅은 accent 배경 + 좌측 컬러바
                    //   4) 핀 컬럼  → sticky 라 opaque 필요 — 선택/포커스 시 bg-selected 로 합류
                    //   5) 행 선택/포커스 → td bg 생략 → tr bg 가 그대로 노출
                    //   6) PK 컬럼  → 옅은 tertiary
                    //   7) 기본    → transparent (+ editable hover)
                    let cellBg = ''
                    let cellRing = ''
                    if (isCellFocused) {
                      cellBg = 'bg-[var(--color-accent)]/40'
                      cellRing = 'ring-1 ring-inset ring-[var(--color-accent-light)]'
                    } else if (isRecent) {
                      cellBg = 'bg-yellow-500/15'
                    } else if (isDirty) {
                      cellBg = 'bg-[var(--color-accent)]/15'
                    } else if (isCellPinned) {
                      if (isFocused) cellBg = 'bg-[var(--color-bg-selected)] shadow-[2px_0_4px_rgba(0,0,0,0.3)]'
                      else if (isRowSelected) cellBg = 'bg-[var(--color-bg-selected)]/85 shadow-[2px_0_4px_rgba(0,0,0,0.3)]'
                      else cellBg = 'bg-[var(--color-bg-tertiary)] shadow-[2px_0_4px_rgba(0,0,0,0.3)]'
                    } else if (isRowHighlighted) {
                      cellBg = '' // tr bg 그대로
                    } else if (isPK) {
                      cellBg = 'bg-[var(--color-bg-tertiary)]/40'
                    }
                    const editableHover = isEditableCol && !isEditing
                      ? (isRowHighlighted ? 'cursor-text' : 'cursor-text hover:bg-[var(--color-bg-hover)]')
                      : ''

                    return (
                      <td
                        key={cell.id}
                        style={{
                          width: cell.column.getSize(),
                          ...(isCellPinned ? {
                            position: 'sticky',
                            left: cellPinLeft,
                            zIndex: 1,
                          } : {}),
                        }}
                        className={`osql-result-grid-cell relative border-b border-r border-[var(--color-bg-tertiary)] truncate max-w-[400px] transition-colors
                          ${isEditing ? 'p-0' : 'px-2'}
                          ${editableHover}
                          ${cellBg}
                          ${cellRing}
                          ${isDirty ? 'osql-result-grid-cell-dirty' : ''}
                        `}
                        data-osql-cell-key={`${rowIdx}-${colIdx}`}
                        data-osql-editor={isEditing ? 'true' : undefined}
                        title={isDirty ? t('gridDirtyCellTitle', language) : undefined}
                        onDoubleClick={(e) => {
                          if (!isEditableCol) return
                          // BugFix-CU: 더블클릭 편집 진입 시 셀 focus 상태도 함께 설정.
                          // 그렇지 않으면 편집 종료(Enter/blur/click-outside) 후 focusedRowIdx/ColIdx 가 null 상태로 남아
                          // Tab 키가 "현재 셀 다음" 이 아닌 (0, firstCol) 로 점프하는 회귀가 발생.
                          setFocusedRowIdx(rowIdx)
                          setFocusedColIdx(colIdx)
                          startEdit(rowIdx, colIdx, colName, e.currentTarget as HTMLElement)
                        }}
                      >
                        {/* dirty 좌측 컬러바 — 미저장 변경 시각 마커 */}
                        {isDirty && !isEditing && (
                          <span className="absolute inset-y-0 left-0 w-0.5 bg-[var(--color-accent)] pointer-events-none" />
                        )}
                        {isEditing ? (
                          /* 편집 중 — 타입별 에디터 (BugFix-CQ 이후 항상 non-null). */
                          (() => {
                            const rawMeta = result.columns[colIdx]
                            if (!rawMeta) return null
                            const effType = effectiveColType(rawMeta.name, rawMeta.type)
                            const EditorComp = getCellEditor(effType)
                            // 에디터에 실제 타입(ENUM/SET 등)을 전달하기 위해 columnMeta.type를 override
                            const metaForEditor = { ...rawMeta, type: effType }
                            return (
                              <EditorComp
                                value={editValue === NULL_SENTINEL ? '' : editValue}
                                isNull={editValue === NULL_SENTINEL}
                                onChange={(v) => setEditValue(v)}
                                onSetNull={() => setEditValue(NULL_SENTINEL)}
                                onConfirm={() => void confirmEdit()}
                                onCancel={cancelEdit}
                                disabled={isSaving}
                                columnMeta={metaForEditor}
                                nullable={rawMeta.nullable}
                                mode="inline"
                                anchorRect={editAnchorRect}
                                enumValues={editEnumValues}
                              />
                            )
                          })()
                        ) : (
                          <CellValue
                            value={displayValue}
                            onExpand={(content) => openTextView(content, colName)}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>

                {/* 선택된 행 바로 아래에 신규 행 inline 삽입 UI 그리기 */}
                {canEdit && newRow && insertAfterRowIdx === rowIdx && renderNewRowTr({
                  result, newRow, setNewRow, isInserting, confirmInsert,
                  effectiveColType, getEnumValues, schemaMeta, setInsertAfterRowIdx,
                  language,
                })}
                </Fragment>
              )
            })}

            {/* 하단 패딩 */}
            {virtualRows.length > 0 && (
              <tr>
                <td
                  style={{
                    height: totalHeight - (virtualRows[virtualRows.length - 1]?.end ?? 0),
                  }}
                />
              </tr>
            )}

            {/* 신규 행 삽입 UI — 그리드 맨 아래 (insertAfterRowIdx === null 일 때만) */}
            {canEdit && (
              newRow && insertAfterRowIdx === null ? (
                renderNewRowTr({
                  result, newRow, setNewRow, isInserting, confirmInsert,
                  effectiveColType, getEnumValues, schemaMeta, setInsertAfterRowIdx,
                  language,
                })
              ) : !newRow ? (
                <tr>
                  <td
                    colSpan={result.columns.length + 1}
                    className="border-b border-[var(--color-bg-tertiary)] px-3 py-1"
                  >
                    <button
                      onClick={() => {
                        const row: Record<string, string> = {}
                        result.columns.forEach((c) => { row[c.name] = '' })
                        setNewRow(row)
                        // 선택된 행이 있으면 그 아래로 그리되, 없으면 그리드 맨 아래(null)
                        if (focusedRowIdx !== null) {
                          setInsertAfterRowIdx(focusedRowIdx)
                          rowVirtualizer.scrollToIndex(focusedRowIdx, { align: 'center' })
                        } else {
                          setInsertAfterRowIdx(null)
                        }
                      }}
                      className="flex items-center gap-1 text-[10px] text-[var(--color-null)] hover:text-[var(--color-accent)] transition-colors"
                    >
                      <Plus size={10} /> 행 추가
                    </button>
                  </td>
                </tr>
              ) : null
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* BLOB / 긴 텍스트 전체 보기 모달 */}
      {viewingText && (
        <TextViewModal
          content={viewingText.content}
          colName={viewingText.colName}
          onClose={closeTextView}
        />
      )}

      {/* Row Detail 모달 */}
      {detailRowIdx !== null && (
        <RowDetailModal
          row={sortedRows[detailRowIdx] ?? []}
          columns={result.columns.map((c) => c.name)}
          rowNum={detailRowIdx + 1}
          onClose={closeDetail}
          onPrev={prevDetail}
          onNext={nextDetail}
          nullText={nullText}
        />
      )}

      {/* 우클릭 컨텍스트 메뉴 */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={buildContextMenuItems({
            rowIdx: ctxMenu.rowIdx,
            colIdx: ctxMenu.colIdx,
            filteredRows: sortedRows,
            columns: result.columns.map((c) => c.name),
            nullText,
            canDelete,
            isDeleting,
            selectedRows,
            canEdit,
            editCtx,
            onInsertSQL: onInsertSQL ? (sql) => { onInsertSQL(sql); setCtxMenu(null) } : undefined,
            onSetNull: canEdit ? (rIdx, cIdx) => {
              setCtxMenu(null)
              const colName = result.columns[cIdx]?.name
              if (!colName || !editCtx || !connId) return
              const targetRow = sortedRows[rIdx]
              if (!targetRow) return
              // Phase 57 — dirty 큐로 적재 (즉시 UPDATE 미호출). 행 이동 시 commit.
              pendingEdits.enqueue(targetRow, cIdx, { newValue: '', setNull: true })
            } : undefined,
            onRowDetail: () => { openDetail(ctxMenu.rowIdx); setCtxMenu(null) },
            onFilterByValue: (val) => { setFilterText(val); setCtxMenu(null) },
            onCopyCell: (val) => { navigator.clipboard.writeText(val); toast.success(t('gridCellCopied', language)); setCtxMenu(null) },
            onCopyRow: (vals) => { navigator.clipboard.writeText(vals); toast.success(t('gridRowCopied', language)); setCtxMenu(null) },
            onDeleteSelected: () => {
              setCtxMenu(null)
              // 우클릭 행을 선택에 포함
              const nextSel = new Set(selectedRows)
              nextSel.add(ctxMenu.rowIdx)
              setSelectedRows(nextSel)
              void confirmRowDelete(nextSel.size, language).then((ok) => {
                if (ok) void deleteSelectedRows()
              })
            },
            // 행 삽입 — 빈 newRow 객체 진입 (우클릭한 행 바로 아래에 노출)
            onInsertRow: canEdit ? () => {
              setCtxMenu(null)
              const empty: Record<string, string> = {}
              result.columns.forEach((c) => { empty[c.name] = '' })
              setNewRow(empty)
              setInsertAfterRowIdx(ctxMenu.rowIdx)
            } : undefined,
            // 행 복제 — 클릭한 행 값 복사하되 PK·AUTO_INCREMENT 컬럼은 비움
            onDuplicateRow: canEdit ? (rIdx) => {
              setCtxMenu(null)
              const srcRow = sortedRows[rIdx] ?? []
              const pkSet = new Set(editCtx?.pkColumns ?? [])
              const dup: Record<string, string> = {}
              result.columns.forEach((c, i) => {
                const isPK = pkSet.has(c.name)
                const colInfo = schemaMeta?.columns.get(c.name)
                const isAutoInc = (colInfo?.extra ?? '').toLowerCase().includes('auto_increment')
                if (isPK || isAutoInc) {
                  dup[c.name] = ''
                  return
                }
                const v = srcRow[i]
                if (v === null) dup[c.name] = NULL_SENTINEL
                else if (v === undefined) dup[c.name] = ''
                else dup[c.name] = String(v)
              })
              setNewRow(dup)
              setInsertAfterRowIdx(rIdx)
            } : undefined,
            language,
          })}
        />
      )}

      {/* 헤더(th) 우클릭 컨텍스트 메뉴 — 컬럼 고정/해제 (BugFix-CP) */}
      {headerCtxMenu && (() => {
        const col = table.getColumn(headerCtxMenu.colId)
        if (!col) return null
        const isColPinned = col.getIsPinned() === 'left'
        return (
          <ContextMenu
            x={headerCtxMenu.x}
            y={headerCtxMenu.y}
            onClose={() => setHeaderCtxMenu(null)}
            items={[
              {
                label: t(isColPinned ? 'ctxMenuUnpinColumn' : 'ctxMenuPinColumn', language),
                icon: isColPinned
                  ? <PinOff size={11} className="text-[var(--color-accent)]" />
                  : <Pin size={11} className="text-[var(--color-accent)]" />,
                onClick: () => col.pin(isColPinned ? false : 'left'),
              },
            ]}
          />
        )
      })()}

      {/* 컬럼 통계 팝오버 */}
      {showColumnStats && statsColIdx !== null && columnStats && statsAnchorRef.current && (
        <ColumnStatsPopover
          ref={statsPopoverRef}
          colName={result.columns[statsColIdx]?.name ?? ''}
          colType={result.columns[statsColIdx]?.type ?? ''}
          stats={columnStats}
          anchorX={statsAnchorRef.current.x}
          anchorY={statsAnchorRef.current.y}
          onClose={() => setStatsColIdx(null)}
        />
      )}
    </div>
  )
}
