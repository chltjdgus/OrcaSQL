import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { SortingState } from '@tanstack/react-table'
import type { ColumnMeta, QueryResult } from '@/types'

/**
 * ResultGrid 본체의 클라이언트 필터·정렬 파이프라인.
 *
 * - `filterText` 입력 → `useDeferredValue` 로 지연 처리(대용량 행 키 입력 반응성)
 * - `filteredRows` = `localRows` 의 부분 일치 필터링 결과
 * - `sortedRows` = `filteredRows` 위에서 단일 컬럼 정렬 적용
 *
 * BugFix-BO 의 단일 소스 원칙(`sortedRows` 만이 시각 인덱스 매핑의 진실) 을
 * 유지하기 위해 호출자는 `sortedRows` 를 그대로 받아쓴다. TanStack 의
 * `getSortedRowModel` 은 사용하지 않으며 sorting state 는 헤더 화살표 토글용.
 *
 * `result` 가 바뀌면 `filterText` 만 reset (정렬 상태는 의도적으로 유지 —
 * 원본 ResultGrid 와 동일 동작).
 */
export function useFilterAndSort(
  localRows: unknown[][],
  columns: ColumnMeta[],
  result: QueryResult,
  /**
   * true 면 클라이언트 측 정렬을 건너뛰고 `sortedRows = filteredRows` 를 반환.
   * 정렬을 서버(DB ORDER BY) 가 책임지는 ResultPanel 의 TableDataTab 호출부에서
   * 사용. `sorting` state 는 여전히 헤더 ↑/↓ 인디케이터를 위해 보존된다.
   */
  externalSorting: boolean = false,
) {
  const [filterText, setFilterText] = useState('')
  const deferredFilterText = useDeferredValue(filterText)
  const [sorting, setSorting] = useState<SortingState>([])

  useEffect(() => {
    setFilterText('')
  }, [result])

  const isFilterStale = filterText !== deferredFilterText

  const filteredRows = useMemo(() => {
    if (!deferredFilterText.trim()) return localRows
    const q = deferredFilterText.toLowerCase()
    return localRows.filter((row) =>
      row.some((cell) => cell !== null && cell !== undefined && String(cell).toLowerCase().includes(q)),
    )
  }, [localRows, deferredFilterText])

  const sortedRows = useMemo(() => {
    if (externalSorting) return filteredRows
    if (sorting.length === 0) return filteredRows
    const s = sorting[0]
    const colIdx = columns.findIndex((c) => c.name === s.id)
    if (colIdx < 0) return filteredRows
    const dir = s.desc ? -1 : 1
    const cmp = (av: unknown, bv: unknown): number => {
      const aNull = av === null || av === undefined
      const bNull = bv === null || bv === undefined
      if (aNull && bNull) return 0
      if (aNull) return 1
      if (bNull) return -1
      if (typeof av === 'number' && typeof bv === 'number') {
        return av < bv ? -1 : av > bv ? 1 : 0
      }
      const an = Number(av), bn = Number(bv)
      if (!isNaN(an) && !isNaN(bn) && av !== '' && bv !== '') {
        return an < bn ? -1 : an > bn ? 1 : 0
      }
      return String(av).localeCompare(String(bv))
    }
    return [...filteredRows].sort((a, b) => cmp(a[colIdx], b[colIdx]) * dir)
  }, [filteredRows, sorting, columns, externalSorting])

  return {
    filterText,
    setFilterText,
    deferredFilterText,
    isFilterStale,
    sorting,
    setSorting,
    filteredRows,
    sortedRows,
  }
}
