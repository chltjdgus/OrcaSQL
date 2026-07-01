import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flexRender } from '@tanstack/react-table'
import { Download, Copy, LayoutList, TableProperties, ChevronDown, Pencil, X, Search, Rows3, Trash2, Plus, Pin, PinOff, Save, Undo2, Sigma } from 'lucide-react'
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
import { computeFillEdits } from './fillRange'
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
import { useCellSelection } from './hooks/useCellSelection'

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
  /**
   * Table Data 탭에서 주입 — 우클릭 메뉴에 "필터·정렬 초기화" 항목을 노출.
   * 일반 쿼리 결과 그리드에서는 미주입(undefined) 이라 항목이 숨겨진다.
   */
  onResetView?: () => void
}

/**
 * TanStack Table v8 + TanStack Virtual 기반 결과 그리드.
 * - 컬럼 너비 드래그 조절
 * - NULL 값 시각적 구분
 * - CSV 내보내기
 * - 행 가상화 (10만+ 행 지원)
 */
export default function ResultGrid({ result, editCtx, connId, onInsertSQL, showColumnStats = true, serverSort, onResetView }: Props) {
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
    handleRowNumClick, handleRowSelect,
    selectSingleRow,
  } = useRowSelection({ result, sorting, beforeRowChange })
  const {
    newRow, setNewRow, isInserting,
    insertAfterRowIdx, setInsertAfterRowIdx,
    confirmInsert,
  } = useNewRowInsert({
    result, editCtx, connId, effectiveColType, getEnumValues, language, setLocalRows,
  })
  const { isDeleting, deleteSelectedRows } = useRowDeletion({
    result, editCtx, connId, canDelete, selectedRows, sortedRows, editingCell, focusedColIdx, language,
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

  // ─── Phase 58 — Excel-style 직사각형 셀 범위 선택 (drag · Shift · Ctrl+A) ────
  // 활성 셀(anchor)=focusedRowIdx/ColIdx 는 useRowSelection 이 소유(편집·commit 의미 보존),
  // 본 훅은 반대 모서리(lead)만 관리해 선택 사각형을 구성한다.
  const {
    lead, setLead, clearLead, extendLead, beginDrag, isDragging,
    selectionRect, isCellInRange, selectionEdges, isMultiCell,
  } = useCellSelection({ result, sorting, focusedRowIdx, focusedColIdx, rowCount: sortedRows.length, scrollContainerRef: parentRef })

  // 선택 범위(또는 행 선택)를 Excel 호환 TSV 로 클립보드 복사 (Ctrl+C — 컨텍스트 메뉴 복사와 별도).
  // 우선순위: 다중 셀 범위 > 단일 활성 셀 > 행 선택(전체 가시 컬럼). NULL→빈칸, 숫자 raw,
  // 탭/개행/따옴표 포함 값은 CSV 규칙으로 인용.
  const copySelection = useCallback(() => {
    const fmt = (v: unknown): string => {
      if (v === null || v === undefined) return ''
      const s = String(v)
      return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const rect = selectionRect
    if (rect && isMultiCell) {
      // merged_bug_002: raw minC..maxC 순회는 사용자가 숨긴 컬럼 값까지 복사한다.
      // 행 선택 분기와 동일하게 가시 컬럼(visibleColIdxList) 중 선택 span 에 든 것만 복사.
      const allCols = visibleColIdxList.length ? visibleColIdxList : result.columns.map((_, i) => i)
      const cols = allCols.filter((idx) => idx >= rect.minC && idx <= rect.maxC)
      const lines: string[] = []
      for (let rr = rect.minR; rr <= rect.maxR; rr++) {
        const row = sortedRows[rr] ?? []
        lines.push(cols.map((cc) => fmt(row[cc])).join('\t'))
      }
      void navigator.clipboard.writeText(lines.join('\n'))
      toast.success(t('gridRangeCopied', language))
    } else if (rect) {
      void navigator.clipboard.writeText(fmt((sortedRows[rect.minR] ?? [])[rect.minC]))
      toast.success(t('gridCellCopied', language))
    } else if (selectedRows.size > 0) {
      const cols = visibleColIdxList.length ? visibleColIdxList : result.columns.map((_, i) => i)
      const text = Array.from(selectedRows).sort((a, b) => a - b)
        .map((rr) => { const row = sortedRows[rr] ?? []; return cols.map((cc) => fmt(row[cc])).join('\t') })
        .join('\n')
      void navigator.clipboard.writeText(text)
      toast.success(t('gridRowCopied', language))
    }
  }, [selectionRect, isMultiCell, sortedRows, selectedRows, visibleColIdxList, result.columns, language])

  // Phase 59 — 선택 범위 집계 (Excel 상태표시줄: 개수/합/평균/최소/최대).
  // 다중 셀 선택일 때만, 복사와 동일하게 가시 컬럼(visibleColIdxList) 중 선택 span 에 든 셀만 집계.
  // count = 비어있지 않은 셀, numCount = 숫자로 해석 가능한 셀(합/평균/최소/최대 대상).
  const selectionAgg = useMemo(() => {
    const rect = selectionRect
    if (!rect || !isMultiCell) return null
    const allCols = visibleColIdxList.length ? visibleColIdxList : result.columns.map((_, i) => i)
    const cols = allCols.filter((idx) => idx >= rect.minC && idx <= rect.maxC)
    let count = 0
    let numCount = 0
    let sum = 0
    let min = Infinity
    let max = -Infinity
    for (let rr = rect.minR; rr <= rect.maxR; rr++) {
      const row = sortedRows[rr]
      if (!row) continue
      for (const cc of cols) {
        const v = row[cc]
        if (v === null || v === undefined) continue
        const sv = String(v)
        if (sv.trim() === '') continue
        count++
        const n = Number(sv)
        if (typeof v !== 'boolean' && Number.isFinite(n)) {
          numCount++
          sum += n
          if (n < min) min = n
          if (n > max) max = n
        }
      }
    }
    return { count, numCount, sum, avg: numCount ? sum / numCount : 0, min, max }
  }, [selectionRect, isMultiCell, sortedRows, visibleColIdxList, result.columns])

  // 집계 숫자 포맷 — 정수는 그대로, 소수는 최대 2자리 (천 단위 구분 포함).
  const fmtAgg = useCallback((n: number): string =>
    Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 }), [])

  // BugFix-DO(인덱스 공간 통일) — 컬럼명 → result.columns 인덱스 맵.
  // 렌더 순회(`row.getVisibleCells()`/`hg.headers`)는 핀/숨김 시 result.columns 와 순서·개수가
  // 어긋난다. 모든 셀·헤더가 이 맵으로 해석한 result.columns 인덱스를 colIdx 로 사용해
  // 편집 파이프라인(localRows[][colIdx])·focusedColIdx·selectionRect·pendingEdits 와 일치시킨다.
  const colIdxByName = useMemo(() => {
    const m = new Map<string, number>()
    result.columns.forEach((c, i) => m.set(c.name, i))
    return m
  }, [result.columns])

  // 컬럼 편집 가능 판정 (canEdit + PK 제외) — 키보드 네비·채우기 공용.
  const isColEditable = useCallback((colIdx: number): boolean => {
    if (!canEdit) return false
    const colName = result.columns[colIdx]?.name
    if (!colName) return false
    return !(editCtx?.pkColumns.includes(colName) ?? false)
  }, [canEdit, result.columns, editCtx])

  // Phase 60 — Ctrl+D 아래로 채우기. 선택 첫 행 값을 같은 컬럼 아래 행으로 복사해 dirty 큐에 적재
  // (즉시 DB 미반영 — 사용자가 dirty 셀을 검토 후 일괄 commit). 복사와 동일하게 가시 컬럼만 대상.
  const onFillDown = useCallback(() => {
    const rect = selectionRect
    if (!rect || !isMultiCell) return
    const allCols = visibleColIdxList.length ? visibleColIdxList : result.columns.map((_, i) => i)
    const visibleColsInSpan = allCols.filter((idx) => idx >= rect.minC && idx <= rect.maxC)
    const edits = computeFillEdits({ rect, direction: 'down', sortedRows, visibleColsInSpan, isColEditable })
    let applied = 0
    for (const ed of edits) {
      const rowRef = sortedRows[ed.rowIdx]
      if (!rowRef) continue
      pendingEdits.enqueue(rowRef, ed.colIdx, { newValue: ed.value, setNull: ed.setNull })
      applied++
    }
    if (applied > 0) toast.success(`${applied} ${t('gridFilledSuffix', language)}`)
  }, [selectionRect, isMultiCell, visibleColIdxList, result.columns, sortedRows, isColEditable, pendingEdits, language])

  // Ctrl+A — 전체 셀 선택. 활성 셀을 좌상단으로 옮기고 lead 를 우하단으로 확장.
  const selectAllCells = useCallback(async () => {
    if (sortedRows.length === 0 || visibleColIdxList.length === 0) return
    const prev = focusedRowIdx
    if (prev !== null && prev !== 0) {
      const ok = await beforeRowChange(prev)
      if (!ok) return
    }
    setFocusedRowIdx(0)
    setFocusedColIdx(visibleColIdxList[0])
    setLead({ r: sortedRows.length - 1, c: visibleColIdxList[visibleColIdxList.length - 1] })
  }, [sortedRows.length, visibleColIdxList, focusedRowIdx, beforeRowChange, setFocusedRowIdx, setFocusedColIdx, setLead])

  // 셀 mousedown — 일반/Ctrl = 기존 행 선택 로직 재사용(beforeRowChange 가드) + 범위 축소·드래그 시작,
  // Shift = 활성 셀(anchor) 유지한 채 범위 확장.
  const handleCellMouseDown = useCallback((e: React.MouseEvent, rIdx: number, cIdx: number) => {
    if (e.button !== 0) return  // 우클릭은 onContextMenu 가 처리
    // 열린 컨텍스트 메뉴 닫기 — handleRowSelect 의 stopPropagation 때문에 ContextMenu 의
    // document mousedown 리스너가 이벤트를 못 받아 자동으로 안 닫히던 회귀(Phase 58) 보정.
    setCtxMenu(null)
    setHeaderCtxMenu(null)
    const tgt = e.target as HTMLElement
    if (tgt.closest('[data-osql-editor="true"]')) return
    if (tgt.closest('[data-osql-newrow]')) return
    if (e.shiftKey) {
      e.preventDefault()  // shift-드래그 텍스트 선택 방지
      extendLead(rIdx, cIdx)
      focusGridContainer()
      return
    }
    // BugFix-DN(bug_007): handleRowSelect 는 dirty 행 commit 을 await 하므로 anchor(focusedRow/Col)
    // 갱신이 비동기다. beginDrag 를 동기로 먼저 부르면 selectionRect 가 직전 anchor 로 계산돼
    // 드래그 범위가 어긋난다(commit 실패 시 anchor 가 영영 안 바뀜). 선택이 실제로 적용된 뒤에만
    // 드래그를 시작한다. Ctrl/⌘ 다중선택은 드래그를 시작하지 않으므로 lead 만 즉시 축소.
    if (e.ctrlKey || e.metaKey) {
      void handleRowSelect(e, rIdx, false, cIdx)
      clearLead()
    } else {
      void handleRowSelect(e, rIdx, false, cIdx).then((ok) => { if (ok) beginDrag() })
    }
    focusGridContainer()
  }, [extendLead, clearLead, beginDrag, handleRowSelect, focusGridContainer, setCtxMenu, setHeaderCtxMenu])

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
    isColEditable,
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
    // Phase 58 — Excel-style 범위 선택
    selectionLead: lead,
    extendLead,
    clearLead,
    selectAllCells: () => { void selectAllCells() },
    onCopySelection: copySelection,
    onFillDown,
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
          {/* Phase 59 — 선택 범위 집계 (Excel 상태표시줄) */}
          {selectionAgg && selectionAgg.count > 0 && (
            <span className="osql-result-grid-statusbar-selagg flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
              <span className="text-[var(--color-accent)]">
                <Sigma size={9} />
              </span>
              <span>{t('gridSelCount', language)} <span className="font-medium text-[var(--color-text-primary)]">{selectionAgg.count.toLocaleString()}</span></span>
              {selectionAgg.numCount > 0 && (
                <>
                  <span>{t('gridSelSum', language)} <span className="font-medium text-[var(--color-text-primary)]">{fmtAgg(selectionAgg.sum)}</span></span>
                  <span>{t('gridSelAvg', language)} <span className="font-medium text-[var(--color-text-primary)]">{fmtAgg(selectionAgg.avg)}</span></span>
                  <span>{t('gridSelMin', language)} <span className="font-medium text-[var(--color-text-primary)]">{fmtAgg(selectionAgg.min)}</span></span>
                  <span>{t('gridSelMax', language)} <span className="font-medium text-[var(--color-text-primary)]">{fmtAgg(selectionAgg.max)}</span></span>
                </>
              )}
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
        className={`osql-result-grid-scroll flex-1 overflow-auto outline-none focus:outline-none ${isDragging ? 'select-none' : ''}`}
      >
        <table
          style={{ width: table.getTotalSize(), tableLayout: 'fixed' }}
          className="osql-result-grid-table border-collapse text-xs"
        >
          {/* 헤더 */}
          <thead className="sticky top-0 z-10 bg-[var(--color-bg-secondary)]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {/* 행 번호 컬럼 헤더 = Phase 59 전체선택 코너 (Excel 좌상단 모서리) */}
                <th
                  className="osql-result-grid-selectall-corner w-10 text-right pr-2 text-[var(--color-text-muted)] font-normal border-b border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] select-none cursor-pointer hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
                  title={t('gridSelectAllCorner', language)}
                  onClick={() => { focusGridContainer(); void selectAllCells() }}
                >
                  #
                </th>
                {hg.headers.map((header) => {
                  const isPinned = header.column.getIsPinned()
                  const pinLeft = isPinned === 'left' ? header.column.getStart('left') + 40 : undefined // +40 for row-num col
                  // BugFix-DO: 순회 위치가 아니라 컬럼명으로 result.columns 인덱스를 해석(핀/숨김 정합).
                  const colIdx = colIdxByName.get(header.column.id) ?? -1
                  // Phase 58 — 선택 범위에 포함된 열 머리글 강조 (Excel 열 헤더 하이라이트)
                  const headerColSelected = selectionRect !== null && colIdx >= selectionRect.minC && colIdx <= selectionRect.maxC
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
                      ${headerColSelected ? 'osql-result-th-selected' : ''}
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
                          statsAnchorRef.current = { x: rect.left, y: rect.bottom + 4, colIdx }
                          setStatsColIdx((prev) => prev === colIdx ? null : colIdx)
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
                    {/* Phase 58 — 선택 열 하단 accent 언더라인 */}
                    {headerColSelected && (
                      <span className="osql-result-th-selected-marker absolute left-0 right-0 bottom-0 h-0.5 bg-[var(--color-accent)] pointer-events-none" />
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
              // Phase 58 — 행 단위 선택/포커스 그룹 외곽 테두리 (range 드래그 중이 아닐 때).
              // 인접 선택 행은 한 블록으로 묶어 내부선 없이 그룹 박스를 그린다.
              // BugFix-DO: 우측 테두리는 colIdx(result.columns 인덱스)와 비교하므로, 마지막으로
              // 렌더된 셀의 result.columns 인덱스로 환산(핀/숨김 시 순회 length-1 과 어긋남).
              const visCells = row.getVisibleCells()
              const lastVisCell = visCells[visCells.length - 1]
              const lastColIdx = lastVisCell ? (colIdxByName.get(lastVisCell.column.id) ?? -1) : -1
              const rowInBlock = isFocused || isRowSelected
              const rowBorderMode = rowInBlock && !isMultiCell
              const rowBlockTop = rowInBlock && !(selectedRows.has(rowIdx - 1) || rowIdx - 1 === focusedRowIdx)
              const rowBlockBottom = rowInBlock && !(selectedRows.has(rowIdx + 1) || rowIdx + 1 === focusedRowIdx)
              // 행 번호 거터 accent 바 — 범위/행선택/포커스 어느 경우든 표시
              const rowNumSelected = (selectionRect !== null && rowIdx >= selectionRect.minR && rowIdx <= selectionRect.maxR) || rowInBlock
              return (
                <Fragment key={row.id}>
                <tr
                  data-osql-row-idx={rowIdx}
                  style={{ height: ROW_HEIGHT }}
                  className={`osql-result-row transition-colors group cursor-default
                    ${isRowDirty ? 'osql-result-grid-row-dirty' : ''}
                    ${isRowSelected ? 'bg-[var(--color-bg-selected)]/60 hover:bg-[var(--color-bg-selected)]/75' : 'hover:bg-[var(--color-bg-tertiary)]'}
                    ${isFocused ? 'bg-[var(--color-bg-selected)]/80' : ''}`}
                  onClick={(e) => {
                    // BugFix-CU: 편집 중인 셀(td) 안(에디터 popover 포함) 클릭은 컨테이너 focus 무시
                    // — textarea/select 의 focus 가 풀려 input 이 즉시 blur 되는 회귀 방지.
                    // Phase 58: 셀 선택/포커스는 td 의 onMouseDown(handleCellMouseDown) 으로 이관됨.
                    if ((e.target as HTMLElement).closest('[data-osql-editor="true"]')) return
                    focusGridContainer()
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    // BugFix-DO: 우클릭한 열의 result.columns 인덱스를 셀 data-osql-cell-key 에서 파싱
                    // (DOM td 위치는 핀/숨김 시 result.columns 인덱스와 어긋남). 행번호 칸엔 key 가 없어 0 fallback.
                    const td = (e.target as HTMLElement).closest('[data-osql-cell-key]') as HTMLElement | null
                    const key = td?.getAttribute('data-osql-cell-key')
                    let colIdx = -1
                    if (key) {
                      const dash = key.indexOf('-')
                      if (dash >= 0) {
                        const c = Number(key.slice(dash + 1))
                        if (Number.isFinite(c)) colIdx = c
                      }
                    }
                    const safeColIdx = Math.max(colIdx, 0)
                    // BugFix-DX: 다중 셀 범위 선택 안을 우클릭하면 Excel 처럼 범위를 유지한다.
                    // anchor(focusedRow/Col)를 클릭 셀로 옮기면 selectionRect = bbox(anchor, lead) 가
                    // 재계산돼 드래그 영역이 클릭 셀 기준으로 붕괴·이동하던 회귀. 범위 밖(또는 단일 셀)
                    // 우클릭일 때만 클릭 셀로 선택·포커스를 재설정한다.
                    const keepRange = isMultiCell && isCellInRange(rowIdx, safeColIdx)
                    if (!keepRange) {
                      // 우클릭 시 선택·포커스 동기화 (단일 선택 갱신)
                      if (!selectedRows.has(rowIdx)) {
                        setSelectedRows(new Set([rowIdx]))
                        lastSelectedRow.current = rowIdx
                      }
                      setFocusedRowIdx(rowIdx)
                      setFocusedColIdx(safeColIdx) // BugFix-CS: 우클릭한 셀도 강조
                    }
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
                    {/* Phase 58 — 선택 행 우측 accent 바 (Excel 행 헤더 하이라이트) */}
                    {rowNumSelected && (
                      <span className="osql-result-grid-rownum-selected absolute inset-y-0 right-0 w-0.5 bg-[var(--color-accent)] pointer-events-none" />
                    )}
                    {rowIdx + 1}
                  </td>
                  {visCells.map((cell) => {
                    // BugFix-DO: 순회 위치가 아니라 컬럼명으로 result.columns 인덱스를 해석(핀/숨김 정합).
                    const colIdx = colIdxByName.get(cell.column.id) ?? -1
                    const colName = cell.column.id
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

                    // Phase 58 — Excel-style 범위 선택 시각화
                    const inRange = isCellInRange(rowIdx, colIdx)
                    const edges = selectionEdges(rowIdx, colIdx)
                    // BugFix-CT + Phase 57/58: 우선순위 단일 bg 결정.
                    //   1) 활성 셀(focus 교집합) → accent box (최상위)
                    //   2) 최근 commit yellow flash (2초)
                    //   3) dirty (미저장 변경) → 옅은 accent 배경 + 좌측 컬러바
                    //   4) 핀 컬럼  → sticky 라 opaque 필요 — 선택/포커스 시 bg-selected 로 합류
                    //   5) 범위 선택 셀 → 옅은 accent fill
                    //   6) 행 선택/포커스 → td bg 생략 → tr bg 가 그대로 노출
                    //   7) PK 컬럼  → 옅은 tertiary
                    //   8) 기본    → transparent (+ editable hover)
                    let cellBg = ''
                    if (isCellFocused) {
                      cellBg = 'bg-[var(--color-accent)]/40'
                    } else if (isRecent) {
                      cellBg = 'bg-yellow-500/15'
                    } else if (isDirty) {
                      cellBg = 'bg-[var(--color-accent)]/15'
                    } else if (isCellPinned) {
                      if (isFocused) cellBg = 'bg-[var(--color-bg-selected)]'
                      else if (isRowSelected) cellBg = 'bg-[var(--color-bg-selected)]/85'
                      else cellBg = 'bg-[var(--color-bg-tertiary)]'
                    } else if (inRange) {
                      cellBg = 'bg-[var(--color-accent)]/12'
                    } else if (isRowHighlighted) {
                      cellBg = '' // tr bg 그대로
                    } else if (isPK) {
                      cellBg = 'bg-[var(--color-bg-tertiary)]/40'
                    }
                    // 핀 컬럼 깊이 그림자만 boxShadow 로 유지. 선택 테두리는 td 내부 자식 span 으로
                    // 그린다 — border-collapse 테이블에서 inset box-shadow 의 하단/우측이 셀의
                    // border-b/border-r 와 paint-order 충돌로 가려지는 문제 회피(헤더 언더라인·행번호 바와 동일 기법).
                    const cellBoxShadow = isCellPinned ? '2px 0 4px rgba(0,0,0,0.3)' : undefined
                    const editableHover = isEditableCol && !isEditing
                      ? (isRowHighlighted ? 'cursor-text' : 'cursor-text hover:bg-[var(--color-bg-hover)]')
                      : ''

                    return (
                      <td
                        key={cell.id}
                        style={{
                          width: cell.column.getSize(),
                          boxShadow: cellBoxShadow,
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
                          ${inRange ? 'osql-result-grid-cell-selected' : ''}
                          ${isDirty ? 'osql-result-grid-cell-dirty' : ''}
                        `}
                        data-osql-cell-key={`${rowIdx}-${colIdx}`}
                        data-osql-editor={isEditing ? 'true' : undefined}
                        title={isDirty ? t('gridDirtyCellTitle', language) : undefined}
                        onMouseDown={(e) => handleCellMouseDown(e, rowIdx, colIdx)}
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
                        {/* Phase 58 — 선택 테두리 (자식 span 으로 그려 border-collapse paint-order 영향 회피).
                            ① 행 단위 선택/포커스 그룹 외곽(accent) — range 드래그가 아닐 때
                            ② 셀 범위 외곽 / 활성 셀 박스(accent-light) */}
                        {!isEditing && (() => {
                          const E = 'osql-result-grid-sel-edge pointer-events-none absolute z-[1]'
                          const spans: ReactNode[] = []
                          if (rowBorderMode) {
                            const c = 'var(--color-accent)'
                            if (rowBlockTop) spans.push(<span key="rt" className={`${E} left-0 right-0 top-0 h-[2px]`} style={{ background: c }} />)
                            if (rowBlockBottom) spans.push(<span key="rb" className={`${E} left-0 right-0 bottom-0 h-[2px]`} style={{ background: c }} />)
                            if (colIdx === 0) spans.push(<span key="rl" className={`${E} top-0 bottom-0 left-0 w-[2px]`} style={{ background: c }} />)
                            if (colIdx === lastColIdx) spans.push(<span key="rr" className={`${E} top-0 bottom-0 right-0 w-[2px]`} style={{ background: c }} />)
                          }
                          if (isCellFocused || inRange) {
                            const c = isCellFocused ? 'var(--color-accent-light)' : 'var(--color-accent)'
                            if (isCellFocused || edges.top) spans.push(<span key="ct" className={`${E} left-0 right-0 top-0 h-[2px]`} style={{ background: c }} />)
                            if (isCellFocused || edges.bottom) spans.push(<span key="cb" className={`${E} left-0 right-0 bottom-0 h-[2px]`} style={{ background: c }} />)
                            if (isCellFocused || edges.left) spans.push(<span key="cl" className={`${E} top-0 bottom-0 left-0 w-[2px]`} style={{ background: c }} />)
                            if (isCellFocused || edges.right) spans.push(<span key="cr" className={`${E} top-0 bottom-0 right-0 w-[2px]`} style={{ background: c }} />)
                          }
                          return spans.length ? <>{spans}</> : null
                        })()}
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
            onResetView: onResetView ? () => { onResetView(); setCtxMenu(null) } : undefined,
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
