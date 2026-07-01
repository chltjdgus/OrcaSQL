import { useCallback } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { EditingCell } from '../types'

interface UseKeyboardNavArgs {
  /** 가시(핀+일반·숨김 제외) 컬럼의 result.columns 인덱스 리스트 (표시 순서) */
  visibleColIdxList: number[]
  /** sortedRows 의 행 수 (시각 기준) */
  rowCount: number
  /** 현재 포커스된 시각 행 인덱스 (null = 미포커스) */
  focusedRowIdx: number | null
  /** 현재 포커스된 컬럼 인덱스 (result.columns 기준) */
  focusedColIdx: number | null
  /** 포커스 set — beforeRowChange 가드 후 호출 (useRowSelection 의 setter 직접 노출용) */
  setFocusedRowIdx: (r: number | null) => void
  setFocusedColIdx: (c: number | null) => void
  /** 현재 편집 중인 셀 (null = 비편집) */
  editingCell: EditingCell | null
  /** 셀 편집 진입 — colName 과 선택적 prefillValue 지원 */
  startEdit: (rowIdx: number, colIdx: number, colName: string, tdElement?: HTMLElement, prefillValue?: string) => void
  /** 현재 편집 commit (Tab 이동 직전 사용) */
  confirmEdit: () => Promise<void>
  /** 행 이동 직전 dirty commit 가드 (시각 인덱스 기준) */
  beforeRowChange: (prevVisualRowIdx: number) => Promise<boolean>
  /** 시각 행 → localRows 의 RowRef 매핑 (null = 매핑 실패) */
  resolveRowRef: (visualRowIdx: number) => unknown[] | null
  /** 가상화 스크롤 (가시 영역 밖 이동 시) */
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>
  /** 컬럼이 편집 가능한지 (PK·non-editable 가드) */
  isColEditable: (colIdx: number) => boolean
  /** 컬럼이 nullable 인지 (Delete/Backspace NULL 토글용) */
  isColNullable: (colIdx: number) => boolean
  /** 컬럼 인덱스 → 컬럼 이름 */
  columnNameByIdx: (colIdx: number) => string
  /** dirty 큐 — Esc 롤백 / Ctrl+Enter commit / Delete NULL. rowRef 기반 API. */
  pendingEdits: {
    enqueue: (rowRef: unknown[], colIdx: number, edit: { newValue: string; setNull: boolean }) => void
    discardRow: (rowRef: unknown[]) => void
    commitRow: (rowRef: unknown[], visualRowIdx: number) => Promise<{ ok: boolean }>
    isRowDirty: (rowRef: unknown[]) => boolean
  }
  /** 신규 행(newRow) 활성 여부 — 키보드 네비를 비활성하기 위한 가드 */
  newRowActive: boolean
  /** 편집 종료 후 그리드 컨테이너로 포커스 복귀 — 외부 ref(parentRef) 의 focus 호출 */
  focusContainer: () => void
  /**
   * 키보드로 행이 바뀔 때 selectedRows 도 단일 행 선택으로 갱신하는 콜백.
   * 마우스 클릭 시처럼 focusedRow 와 selectedRows 가 동기화돼야 사용자가 "선택된 row 가
   * 함께 따라온다" 고 인지함. useRowSelection 의 `selectSingleRow` 를 그대로 wiring.
   */
  onSelectRow: (visualRowIdx: number) => void
  /** 가로 스크롤 보정용 — 스크롤 컨테이너 (parentRef) */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  /**
   * 좌측 sticky 영역 총 width (행 번호 칸 + 핀 컬럼들의 누적 width).
   * 일반 컬럼 셀이 sticky 영역 뒤에 가려지지 않도록 가로 스크롤 보정 시 사용.
   */
  getLeftStickyWidth: () => number
  // ─── Phase 58 — Excel-style 범위 선택 ────────────────────────────────────
  /** 현재 lead 좌표 (null = 범위 축소 상태 → 활성 셀 단일) */
  selectionLead: { r: number; c: number } | null
  /** 범위 확장 — anchor(focused) 유지한 채 lead 만 이동 */
  extendLead: (r: number, c: number) => void
  /** 범위 축소 — 일반 이동 시 lead=null */
  clearLead: () => void
  /** 전체 셀 선택 (Ctrl/⌘+A) */
  selectAllCells: () => void
  /** 선택 범위 TSV 복사 (Ctrl/⌘+C) */
  onCopySelection: () => void
  /** 선택 범위 아래로 채우기 (Ctrl/⌘+D — Excel Fill Down) */
  onFillDown: () => void
}

/**
 * ResultGrid 키보드 네비게이션 (Phase 57 · Excel-style, Phase 58 범위 선택 확장).
 *
 * **비편집 모드**
 * - `←↑↓→` : 한 셀 이동 (핀/숨김 컬럼 자동 skip — visibleColIdxList 기준) + 범위 축소
 * - `Shift+←↑↓→` : 범위 확장 (활성 셀 anchor 고정, lead 만 이동)
 * - `Ctrl+Shift+←↑↓→` : 가장자리(첫/끝 행·열)까지 범위 확장
 * - `Tab` / `Shift+Tab` : 다음/이전 셀. 행 끝 → 다음 행 첫 셀 (Excel wrap)
 * - `Enter` / `F2` : 편집 진입 (편집 가능 컬럼에 한해)
 * - `Escape` : 행에 dirty 가 있으면 롤백, 없으면 focus 해제
 * - `PageUp` / `PageDown` : viewport 행 수만큼 이동 (Shift = 확장)
 * - `Home` / `End` : 행 첫/끝 셀, `Ctrl+Home`/`Ctrl+End` : 전체 첫/끝 (Shift = 확장)
 * - `Delete` / `Backspace` : nullable 컬럼이면 NULL 로 enqueue
 * - `Ctrl+Enter` : 현재 행 dirty 즉시 commit
 * - `Ctrl/⌘+A` : 전체 셀 선택, `Ctrl/⌘+C` : 선택 범위 TSV 복사, `Ctrl/⌘+D` : 아래로 채우기(Fill Down)
 * - 인쇄 가능 문자 : 편집 진입 + 첫 글자 prefill
 *
 * **편집 모드**
 * - `Tab` / `Shift+Tab` : commit → 오른쪽/왼쪽 셀로 이동 (행 끝 wrap)
 * - 그 외 키 : 에디터 자체에서 처리 (Enter/Escape/화살표 등)
 *
 * 행 이동 시 `beforeRowChange` 를 await 해 dirty commit 후 진행 — 실패 시 차단.
 * 범위 확장은 anchor 행을 바꾸지 않으므로 commit 을 발동시키지 않는다.
 *
 * 결정: 신규 행(newRow) 영역은 키보드 네비 범위 밖. newRowActive 일 때는
 * 키보드 핸들러가 모든 키를 통과시킨다(편집 UI 자체 핸들러 우선).
 */
export function useKeyboardNav({
  visibleColIdxList,
  rowCount,
  focusedRowIdx,
  focusedColIdx,
  setFocusedRowIdx,
  setFocusedColIdx,
  editingCell,
  startEdit,
  confirmEdit,
  beforeRowChange,
  resolveRowRef,
  rowVirtualizer,
  isColEditable,
  isColNullable,
  columnNameByIdx,
  pendingEdits,
  newRowActive,
  focusContainer,
  onSelectRow,
  scrollContainerRef,
  getLeftStickyWidth,
  selectionLead,
  extendLead,
  clearLead,
  selectAllCells,
  onCopySelection,
  onFillDown,
}: UseKeyboardNavArgs) {
  /** 시각 가시 영역 한 페이지에 들어가는 대략적인 행 수 (PageUp/Down 용) */
  const getPageSize = useCallback((): number => {
    const items = rowVirtualizer.getVirtualItems()
    if (items.length > 0) return Math.max(1, items.length - 2)  // overscan 일부 제외
    return 10
  }, [rowVirtualizer])

  /**
   * BugFix-CV — 시각 (r, c) 의 `<td>` 엘리먼트를 DOM 에서 찾아 반환.
   * F2 / Enter / 인쇄가능문자로 편집 진입할 때 popover 위치 계산용 anchorRect 를
   * 더블클릭 (`onDoubleClick={(e) => startEdit(.., e.currentTarget)}`) 과 동일한
   * tdElement 로 넘기기 위해 사용. cell key 는 `${rowIdx}-${visibleColIdx}` 형식.
   */
  const findCellTd = useCallback((r: number, c: number): HTMLElement | undefined => {
    const container = scrollContainerRef.current
    if (!container) return undefined
    const el = container.querySelector(`[data-osql-cell-key="${r}-${c}"]`)
    return (el as HTMLElement | null) ?? undefined
  }, [scrollContainerRef])

  const scrollCellIntoViewHorizontally = useCallback((r: number, c: number) => {
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      if (!container) return
      const cell = container.querySelector(`[data-osql-cell-key="${r}-${c}"]`) as HTMLElement | null
      if (!cell) return
      const containerRect = container.getBoundingClientRect()
      const cellRect = cell.getBoundingClientRect()
      const leftStickyOffset = getLeftStickyWidth()
      // 좌측 sticky 영역 직후의 가시 경계 — 셀 좌단이 이보다 작으면 가려짐
      const visibleLeftEdge = containerRect.left + leftStickyOffset
      const PADDING = 4  // 셀 가장자리가 정확히 sticky 그림자에 닿지 않도록 작은 여유
      if (cellRect.left < visibleLeftEdge) {
        container.scrollLeft -= (visibleLeftEdge - cellRect.left + PADDING)
      } else if (cellRect.right > containerRect.right) {
        container.scrollLeft += (cellRect.right - containerRect.right + PADDING)
      }
    })
  }, [scrollContainerRef, getLeftStickyWidth])

  /**
   * 셀 이동의 단일 진입점. row 변경이면 beforeRowChange 가드 + selectedRows 단일 동기화.
   * 행/컬럼 인덱스 모두 clamp. 가상화 영역 밖이면 자동 세로 scroll. 가로도 보정.
   * 일반 이동은 항상 범위를 축소(clearLead)한다.
   */
  const moveTo = useCallback(async (nextRow: number, nextCol: number) => {
    if (rowCount === 0 || visibleColIdxList.length === 0) return
    const r = Math.max(0, Math.min(nextRow, rowCount - 1))
    // 컬럼은 이미 visibleColIdxList[validPos] 에서 추출된 값으로 들어옴 — 별도 clamp 불필요
    const c = nextCol

    const prev = focusedRowIdx
    if (prev !== null && r !== prev) {
      const ok = await beforeRowChange(prev)
      if (!ok) return
    }
    clearLead()  // Phase 58 — 일반 이동 시 범위 축소
    setFocusedRowIdx(r)
    setFocusedColIdx(c)
    // 키보드 row 이동 시 단일 선택을 함께 갱신 — 마우스 클릭과 동일한 selectedRows 동작
    onSelectRow(r)
    // 세로 스크롤 (가상화)
    rowVirtualizer.scrollToIndex(r, { align: 'auto' })
    // 가로 스크롤 (컬럼 width 가변 + 핀 컬럼 가림 보정)
    scrollCellIntoViewHorizontally(r, c)
  }, [rowCount, visibleColIdxList.length, focusedRowIdx, beforeRowChange, clearLead, setFocusedRowIdx, setFocusedColIdx, onSelectRow, rowVirtualizer, scrollCellIntoViewHorizontally])

  /**
   * Phase 58 — 범위 확장(lead 이동). anchor(focused) 는 그대로 두고 lead 만 옮긴다.
   * row 가 바뀌어도 beforeRowChange 를 부르지 않음(편집 컨텍스트는 anchor 유지).
   * targetCol 은 반드시 visibleColIdxList 의 값(가시 컬럼) 이어야 한다.
   */
  const extendTo = useCallback((targetRow: number, targetCol: number) => {
    if (rowCount === 0 || visibleColIdxList.length === 0) return
    const r = Math.max(0, Math.min(targetRow, rowCount - 1))
    extendLead(r, targetCol)
    rowVirtualizer.scrollToIndex(r, { align: 'auto' })
    scrollCellIntoViewHorizontally(r, targetCol)
  }, [rowCount, visibleColIdxList.length, extendLead, rowVirtualizer, scrollCellIntoViewHorizontally])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    // 신규 행 inline 입력 활성 시 키보드 네비 비활성
    if (newRowActive) return

    // 입력 가능한 요소(필터/검색 input 등) 안에서 발생한 키는 무시
    const target = e.target as HTMLElement
    const inEditor = !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable))
    // 편집 중이라도 editor 안에서의 키는 일부만 가로채기
    if (editingCell) {
      if (e.key === 'Tab') {
        // 편집 중 Tab: commit 후 다음/이전 셀 이동
        e.preventDefault()
        const curRow = editingCell.rowIdx
        const curCol = editingCell.colIdx
        const pos = visibleColIdxList.indexOf(curCol)
        if (pos < 0) return
        const lastPos = visibleColIdxList.length - 1
        let nextRow = curRow
        let nextPos = pos + (e.shiftKey ? -1 : 1)
        if (nextPos > lastPos) { nextPos = 0; nextRow += 1 }
        if (nextPos < 0) { nextPos = lastPos; nextRow -= 1 }
        if (nextRow < 0 || nextRow >= rowCount) return
        const nextCol = visibleColIdxList[nextPos]
        void confirmEdit().then(() => {
          focusContainer()
          void moveTo(nextRow, nextCol)
        })
      }
      return
    }

    // 비편집 모드 — input/textarea 안에서의 키는 무시
    if (inEditor) return

    // Phase 58 — Ctrl/⌘+A 전체 선택 · Ctrl/⌘+C 범위 복사 (포커스 유무와 무관)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      selectAllCells()
      return
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault()
      onCopySelection()
      return
    }
    // Phase 60 — Ctrl/⌘+D 선택 범위 아래로 채우기 (Excel Fill Down). 본체가 selectionRect·편집가능
    // 가드 후 dirty 큐에 적재(즉시 DB 미반영 — 사용자가 검토 후 commit). Ctrl+R(오른쪽 채우기)은
    // 전역 단축키(focus:result)와 충돌해 미배선.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault()
      onFillDown()
      return
    }

    // 미포커스 상태에서 첫 네비 키 → 좌상단 셀로 (단일 선택 + 가로 스크롤도 함께)
    if (focusedRowIdx === null || focusedColIdx === null) {
      const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'F2', 'Home', 'End', 'PageUp', 'PageDown']
      if (navKeys.includes(e.key)) {
        e.preventDefault()
        if (rowCount === 0 || visibleColIdxList.length === 0) return
        const firstCol = visibleColIdxList[0]
        clearLead()
        setFocusedRowIdx(0)
        setFocusedColIdx(firstCol)
        onSelectRow(0)
        rowVirtualizer.scrollToIndex(0, { align: 'auto' })
        scrollCellIntoViewHorizontally(0, firstCol)
      }
      return
    }

    const r = focusedRowIdx
    const c = focusedColIdx
    const pos = visibleColIdxList.indexOf(c)
    const lastPos = visibleColIdxList.length - 1
    const toEdge = e.ctrlKey || e.metaKey  // Ctrl+Shift+화살표 = 가장자리까지 확장
    // Phase 58 — 범위 확장의 기준점(현재 lead, 없으면 활성 셀)
    const ld = selectionLead ?? { r, c }
    const ldPos0 = visibleColIdxList.indexOf(ld.c)
    const ldPos = ldPos0 < 0 ? pos : ldPos0

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        if (e.shiftKey) extendTo(toEdge ? 0 : ld.r - 1, ld.c)
        else void moveTo(r - 1, c)
        return
      case 'ArrowDown':
        e.preventDefault()
        if (e.shiftKey) extendTo(toEdge ? rowCount - 1 : ld.r + 1, ld.c)
        else void moveTo(r + 1, c)
        return
      case 'ArrowLeft':
        e.preventDefault()
        // BugFix-DN(bug_004): clearLead 는 moveTo 안에서만 호출되므로, 경계에서 moveTo 를
        // 건너뛰면 범위가 안 접힌다(다음 Ctrl+C 가 전체 범위 복사). 경계에서도 명시 축소.
        if (e.shiftKey) extendTo(ld.r, visibleColIdxList[toEdge ? 0 : Math.max(0, ldPos - 1)])
        else if (pos > 0) void moveTo(r, visibleColIdxList[pos - 1])
        else clearLead()
        return
      case 'ArrowRight':
        e.preventDefault()
        if (e.shiftKey) extendTo(ld.r, visibleColIdxList[toEdge ? lastPos : Math.min(lastPos, ldPos + 1)])
        else if (pos < lastPos) void moveTo(r, visibleColIdxList[pos + 1])
        else clearLead()
        return
      case 'Tab': {
        e.preventDefault()
        let nextR = r
        let nextPos = pos + (e.shiftKey ? -1 : 1)
        if (nextPos > lastPos) { nextPos = 0; nextR += 1 }
        if (nextPos < 0) { nextPos = lastPos; nextR -= 1 }
        // BugFix-DN(bug_004): 그리드 코너(첫/끝 셀)에서 Tab 은 이동이 없어 moveTo 미호출 → 범위 축소.
        if (nextR < 0 || nextR >= rowCount) { clearLead(); return }
        void moveTo(nextR, visibleColIdxList[nextPos])
        return
      }
      case 'Home':
        e.preventDefault()
        if (e.shiftKey) extendTo(toEdge ? 0 : ld.r, visibleColIdxList[0])
        else if (toEdge) void moveTo(0, visibleColIdxList[0])
        else void moveTo(r, visibleColIdxList[0])
        return
      case 'End':
        e.preventDefault()
        if (e.shiftKey) extendTo(toEdge ? rowCount - 1 : ld.r, visibleColIdxList[lastPos])
        else if (toEdge) void moveTo(rowCount - 1, visibleColIdxList[lastPos])
        else void moveTo(r, visibleColIdxList[lastPos])
        return
      case 'PageUp':
        e.preventDefault()
        if (e.shiftKey) extendTo(ld.r - getPageSize(), ld.c)
        else void moveTo(r - getPageSize(), c)
        return
      case 'PageDown':
        e.preventDefault()
        if (e.shiftKey) extendTo(ld.r + getPageSize(), ld.c)
        else void moveTo(r + getPageSize(), c)
        return
      case 'Enter':
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+Enter — 현재 행 dirty 즉시 commit
          e.preventDefault()
          const rowRef = resolveRowRef(r)
          if (rowRef && pendingEdits.isRowDirty(rowRef)) {
            void pendingEdits.commitRow(rowRef, r)
          }
        } else if (isColEditable(c)) {
          e.preventDefault()
          // BugFix-CV: 더블클릭 경로(`onDoubleClick={(e) => startEdit(.., e.currentTarget)}`) 와
          // 동일하게 td 엘리먼트를 anchor 로 전달 — popover 위치 계산용
          startEdit(r, c, columnNameByIdx(c), findCellTd(r, c))
        }
        return
      case 'F2':
        if (isColEditable(c)) {
          e.preventDefault()
          // BugFix-CV: F2 도 더블클릭과 동일한 popover anchor 로 진입
          startEdit(r, c, columnNameByIdx(c), findCellTd(r, c))
        }
        return
      case 'Escape': {
        e.preventDefault()
        const rowRef = resolveRowRef(r)
        if (rowRef && pendingEdits.isRowDirty(rowRef)) {
          pendingEdits.discardRow(rowRef)
        } else {
          clearLead()
          setFocusedRowIdx(null)
          setFocusedColIdx(null)
        }
        return
      }
      case 'Delete':
      case 'Backspace':
        if (isColEditable(c) && isColNullable(c)) {
          e.preventDefault()
          const rowRef = resolveRowRef(r)
          if (rowRef) {
            pendingEdits.enqueue(rowRef, c, { newValue: '', setNull: true })
          }
        }
        return
      default:
        // 인쇄 가능 문자 → 편집 진입 + 첫 글자 prefill
        if (
          e.key.length === 1 &&
          !e.ctrlKey && !e.metaKey && !e.altKey &&
          isColEditable(c)
        ) {
          e.preventDefault()
          // BugFix-CV: 인쇄가능 문자 진입도 더블클릭과 동일한 popover anchor 로
          startEdit(r, c, columnNameByIdx(c), findCellTd(r, c), e.key)
        }
    }
  }, [
    newRowActive, editingCell, focusedRowIdx, focusedColIdx, rowCount, visibleColIdxList,
    setFocusedRowIdx, setFocusedColIdx, rowVirtualizer, moveTo, confirmEdit, focusContainer,
    isColEditable, isColNullable, columnNameByIdx, startEdit, findCellTd,
    resolveRowRef, pendingEdits, getPageSize,
    onSelectRow, scrollCellIntoViewHorizontally,
    selectionLead, extendTo, clearLead, selectAllCells, onCopySelection, onFillDown,
  ])

  return { onKeyDown }
}
