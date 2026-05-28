import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  type ColumnDef,
  type ColumnPinningState,
  type OnChangeFn,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ReactNode } from 'react'
import type { QueryResult } from '@/types'
import type { Language } from '@/i18n'
import { IndexFlagBadges } from '@/components/common/IndexFlagIcon'
import CellValue from '../CellValue'
import { ROW_HEIGHT, type TableSchemaMeta } from '../types'

interface UseGridTableArgs {
  result: QueryResult
  sorting: SortingState
  setSorting: OnChangeFn<SortingState>
  sortedRows: unknown[][]
  schemaMeta: TableSchemaMeta | null
  effectiveColType: (colName: string, fallback: string) => string
  language: Language
}

/**
 * ResultGrid 본체의 TanStack 통합 hook (Phase 48 · Wave 2d).
 *
 * - `columnVisibility` / `columnPinning` / `colMenuOpen` state 보관
 * - `columns` ColumnDef memo (헤더 type 배지·인덱스 아이콘·번호 라벨 포함)
 * - `useReactTable` + `useVirtualizer` 통합
 * - `result` 변경 시 visibility/pinning reset
 *
 * TanStack 의 sorting state 는 헤더 화살표 토글용으로만 보존되고 (BugFix-BO 가
 * sortedRows useMemo 단일 소스로 변경) `getSortedRowModel` 은 미사용 — 그대로 유지.
 *
 * `sorting`/`setSorting` 은 `useFilterAndSort` 가 관리하므로 외부에서 주입.
 */
export function useGridTable({
  result,
  sorting,
  setSorting,
  sortedRows,
  schemaMeta,
  effectiveColType,
  language,
}: UseGridTableArgs) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({})
  const [colMenuOpen, setColMenuOpen] = useState(false)
  const parentRef = useRef<HTMLDivElement>(null)

  // result 변경 시 사용자 토글 상태 reset
  useEffect(() => {
    setColumnVisibility({})
    setColumnPinning({})
  }, [result])

  const columns = useMemo<ColumnDef<unknown[]>[]>(
    () =>
      result.columns.map((col, i) => {
        const displayType = effectiveColType(col.name, col.type)
        const flags = schemaMeta?.flags.get(col.name)
        const headerNode: ReactNode = (
          <div className="flex items-center gap-1 min-w-0" title={displayType}>
            <span className="shrink-0 text-[9px] text-[var(--color-null)] font-mono w-5 text-right leading-none">
              {i + 1}
            </span>
            {flags && flags.size > 0 && <IndexFlagBadges flags={flags} language={language} />}
            <span className="truncate font-medium text-[var(--color-text-primary)]">{col.name}</span>
          </div>
        )
        return {
          id: col.name,
          // 타입 배지는 Info 탭과 중복되므로 헤더에서는 제거, title 속성으로 hover 시에만 노출.
          header: () => headerNode,
          accessorFn: (row: unknown[]) => row[i],
          size: Math.max(100, col.name.length * 9 + 48),
          enableResizing: true,
          cell: ({ getValue }) => <CellValue value={getValue()} />,
        }
      }),
    [result.columns, effectiveColType, schemaMeta, language],
  )

  const table = useReactTable({
    // 정렬은 컴포넌트 측 sortedRows 가 이미 적용 — TanStack 은 getSortedRowModel 미사용.
    // sorting state 는 헤더 화살표(↑/↓) 토글과 onSortingChange 핸들러 유지를 위해 보존.
    data: sortedRows as unknown[][],
    columns,
    state: { sorting, columnVisibility, columnPinning },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnPinningChange: setColumnPinning,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    enableColumnPinning: true,
  })

  const { rows } = table.getRowModel()

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const totalHeight = rowVirtualizer.getTotalSize()

  // Phase 57 — 키보드 네비용 가시 컬럼 인덱스 리스트 (핀+일반, 숨김 제외, 표시 순서).
  // 각 visible Column.id (=컬럼명) 를 result.columns 인덱스로 매핑.
  const visibleLeafColumns = table.getVisibleLeafColumns()
  const visibleColIdxList: number[] = useMemo(() => {
    const out: number[] = []
    for (const col of visibleLeafColumns) {
      const idx = result.columns.findIndex((c) => c.name === col.id)
      if (idx >= 0) out.push(idx)
    }
    return out
    // visibleLeafColumns 의 reference 가 매 렌더 새로 만들어지므로 의존성을 변동 요인으로 좁힘
  }, [columnVisibility, columnPinning, result.columns])  // eslint-disable-line react-hooks/exhaustive-deps

  return {
    table,
    parentRef,
    columnVisibility,
    setColumnVisibility,
    columnPinning,
    colMenuOpen,
    setColMenuOpen,
    rowVirtualizer,
    rows,
    virtualRows,
    totalHeight,
    visibleColIdxList,
  }
}
