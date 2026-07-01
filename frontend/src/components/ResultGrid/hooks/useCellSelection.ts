import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SortingState } from '@tanstack/react-table'
import type { QueryResult } from '@/types'

/** 시각 좌표 — 정렬·필터 적용 후 행 인덱스 + 표시(가시 셀) 컬럼 인덱스 */
export interface CellCoord {
  r: number
  c: number
}

/** 현재 선택 사각형 (시각 인덱스 기준, 양끝 포함) */
export interface SelectionRect {
  minR: number
  maxR: number
  minC: number
  maxC: number
}

interface Args {
  result: QueryResult
  sorting: SortingState
  /** 활성 셀(anchor) — useRowSelection 의 focusedRowIdx/ColIdx */
  focusedRowIdx: number | null
  focusedColIdx: number | null
  /** 현재 시각 행 수(sortedRows.length) — 필터 변경 시 선택 사각형을 데이터 범위로 clamp 하기 위함 */
  rowCount: number
  /** 드래그 중 pointer→셀 판별 + 가장자리 자동 스크롤용 스크롤 컨테이너 */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Phase 58 — Excel-style 직사각형 셀 범위 선택.
 *
 * 활성 셀(anchor = `focusedRowIdx/ColIdx`) 은 `useRowSelection` 이 계속 소유한다
 * (편집·dirty commit 의미 보존 — 범위 확장은 anchor 행을 바꾸지 않으므로 commit 미발동).
 * 본 훅은 "반대쪽 모서리"(lead) 만 관리하며 선택 사각형 = anchor↔lead 의 bounding box.
 * `lead === null` 이면 활성 셀 단일 선택.
 *
 * - 마우스: 셀 mousedown → `beginDrag()` (lead 축소 후 드래그 시작), 드래그 중 전역
 *   mousemove 가 pointer 아래 셀로 lead 확장 + viewport 가장자리 자동 스크롤,
 *   전역 mouseup 으로 종료
 * - 키보드(`useKeyboardNav` 가 호출): `extendLead` 로 Shift+이동 확장, `clearLead` 로 일반 이동 축소
 *
 * `result`/`sorting` 변경 시 시각 인덱스 의미가 휘발하므로 선택을 초기화한다
 * (`useRowSelection` 의 selectedRows reset 과 동일 정책).
 */
export function useCellSelection({ result, sorting, focusedRowIdx, focusedColIdx, rowCount, scrollContainerRef }: Args) {
  const [lead, setLead] = useState<CellCoord | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const draggingRef = useRef(false)

  useEffect(() => {
    setLead(null)
    setIsDragging(false)
    draggingRef.current = false
  }, [result])
  useEffect(() => { setLead(null) }, [sorting])

  // BugFix-DN(bug_003): 필터 변경은 result/sorting 과 달리 lead reset 을 트리거하지 않아
  // (의도적 — 행 삭제 시 선택 유지) 시각 인덱스가 데이터 밖을 가리킬 수 있다. 행 인덱스를
  // 현재 rowCount 로 clamp 해 Ctrl+C 가 빈 TSV 행을 복사하거나 범위가 데이터 밖으로 새는 것을 막는다.
  const selectionRect = useMemo<SelectionRect | null>(() => {
    if (focusedRowIdx === null || focusedColIdx === null) return null
    const maxRow = Math.max(0, rowCount - 1)
    const fr = Math.min(focusedRowIdx, maxRow)
    const l = lead ?? { r: focusedRowIdx, c: focusedColIdx }
    const lr = Math.min(l.r, maxRow)
    return {
      minR: Math.min(fr, lr),
      maxR: Math.max(fr, lr),
      minC: Math.min(focusedColIdx, l.c),
      maxC: Math.max(focusedColIdx, l.c),
    }
  }, [lead, focusedRowIdx, focusedColIdx, rowCount])

  const isCellInRange = useCallback((r: number, c: number): boolean => {
    const s = selectionRect
    return !!s && r >= s.minR && r <= s.maxR && c >= s.minC && c <= s.maxC
  }, [selectionRect])

  /** 사각형 외곽 모서리 판정 — Excel 선택 테두리(boxShadow) 그리기용 */
  const selectionEdges = useCallback((r: number, c: number) => {
    const s = selectionRect
    if (!s || r < s.minR || r > s.maxR || c < s.minC || c > s.maxC) {
      return { top: false, right: false, bottom: false, left: false }
    }
    return { top: r === s.minR, bottom: r === s.maxR, left: c === s.minC, right: c === s.maxC }
  }, [selectionRect])

  const isMultiCell = useMemo(() => {
    const s = selectionRect
    return !!s && (s.minR !== s.maxR || s.minC !== s.maxC)
  }, [selectionRect])

  const clearLead = useCallback(() => setLead(null), [])
  const extendLead = useCallback((r: number, c: number) => setLead({ r, c }), [])

  /** 새 anchor 기준으로 lead 를 축소한 뒤 드래그 확장 모드 진입 */
  const beginDrag = useCallback(() => {
    setLead(null)
    setIsDragging(true)
    draggingRef.current = true
  }, [])

  // 드래그: 전역 mousemove(pointer→cell 확장 + 가장자리 auto-scroll) + mouseup(종료).
  // 자동 스크롤 중에는 pointer 가 멈춰 있어도 마지막 좌표로 셀을 재판별해 범위가 따라 확장된다.
  useEffect(() => {
    if (!isDragging) return
    let rafId: number | null = null
    let scrollDir = 0  // -1 위 / +1 아래
    let lastX = 0
    let lastY = 0

    const pickCell = (x: number, y: number) => {
      const target = document.elementFromPoint(x, y) as HTMLElement | null
      const cell = target?.closest('[data-osql-cell-key]') as HTMLElement | null
      const key = cell?.getAttribute('data-osql-cell-key')
      if (!key) return
      const dash = key.indexOf('-')
      if (dash < 0) return
      const r = Number(key.slice(0, dash))
      const c = Number(key.slice(dash + 1))
      if (Number.isFinite(r) && Number.isFinite(c)) setLead({ r, c })
    }

    const tick = () => {
      rafId = null
      if (scrollDir === 0 || !draggingRef.current) return
      const el = scrollContainerRef.current
      if (el) {
        el.scrollTop += scrollDir * 24
        pickCell(lastX, lastY)
      }
      rafId = requestAnimationFrame(tick)
    }

    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      lastX = e.clientX
      lastY = e.clientY
      pickCell(e.clientX, e.clientY)
      const el = scrollContainerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const EDGE = 28
      scrollDir = e.clientY < rect.top + EDGE ? -1 : e.clientY > rect.bottom - EDGE ? 1 : 0
      if (scrollDir !== 0 && rafId === null) rafId = requestAnimationFrame(tick)
    }
    const onUp = () => {
      setIsDragging(false)
      draggingRef.current = false
      scrollDir = 0
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [isDragging, scrollContainerRef])

  return {
    lead,
    setLead,
    clearLead,
    extendLead,
    beginDrag,
    isDragging,
    selectionRect,
    isCellInRange,
    selectionEdges,
    isMultiCell,
  }
}
