import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Table2, Info, RefreshCw, X, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, ArrowUp, ArrowDown } from 'lucide-react'
import { ListColumns } from '@/wailsjs/go/main/App'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import { runLoggedQuery } from '@/utils/queryLog'
import type { TableInfo, ColumnInfo, QueryResult } from '@/types'

interface Props {
  connId: string
  db: string
  table: TableInfo
  /** 패널 닫기 */
  onClose: () => void
}

type PanelTab = 'info' | 'data'

const PAGE_SIZES = [50, 100, 500, 1000] as const

/**
 * SQLyog 스타일 하단 Table Properties 패널.
 * 트리에서 테이블 단일 클릭 시 표시.
 * - Table Data 탭: SELECT * LIMIT/OFFSET 페이지네이션 + WHERE 필터 + COUNT
 * - Info 탭: 컬럼 정보 (DESCRIBE)
 */
export default function TablePropertiesPanel({ connId, db, table, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<PanelTab>('info')
  const [dataKey, setDataKey] = useState(0)

  const tabs: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'info', label: 'Info', icon: <Info size={11} /> },
    { id: 'data', label: 'Data', icon: <Table2 size={11} /> },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden border-t border-[var(--color-border)] bg-[var(--color-bg-primary)]">
      {/* 헤더 탭 바 */}
      <div className="flex items-center border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] border-b-2 transition-colors
              ${activeTab === tab.id
                ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-bg-primary)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
              }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}

        {/* 테이블 이름 표시 */}
        <span className="ml-3 text-[10px] text-[var(--color-null)] font-mono">
          {db}.{table.name}
        </span>

        <div className="ml-auto flex items-center gap-1 pr-1">
          {activeTab === 'data' && (
            <button
              onClick={() => setDataKey((k) => k + 1)}
              title="새로고침"
              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]"
            >
              <RefreshCw size={11} />
            </button>
          )}
          <button
            onClick={onClose}
            title="닫기"
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-bg-tertiary)]"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'data' && (
          <TableDataTab connId={connId} db={db} table={table.name} refreshKey={dataKey} />
        )}
        {activeTab === 'info' && (
          <TableInfoTab connId={connId} db={db} table={table.name} />
        )}
      </div>
    </div>
  )
}

// ─── Table Data 탭 ────────────────────────────────────────────────────────

function TableDataTab({
  connId, db, table, refreshKey,
}: {
  connId: string; db: string; table: string; refreshKey: number
}) {
  const language = useLanguageStore((s) => s.language)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<typeof PAGE_SIZES[number]>(100)
  const [whereInput, setWhereInput] = useState('')
  const [activeWhere, setActiveWhere] = useState('')
  const [orderByCol, setOrderByCol] = useState<string | null>(null)
  const [orderByDir, setOrderByDir] = useState<'ASC' | 'DESC'>('ASC')
  const pageInputRef = useRef<HTMLInputElement>(null)

  // 테이블/새로고침 변경 시 상태 리셋
  useEffect(() => {
    setPage(1)
    setWhereInput('')
    setActiveWhere('')
    setOrderByCol(null)
    setOrderByDir('ASC')
  }, [connId, db, table, refreshKey])

  const offset = (page - 1) * pageSize

  // 데이터 쿼리
  const whereClause = activeWhere.trim() ? ` WHERE ${activeWhere.trim()}` : ''
  const orderClause = orderByCol ? ` ORDER BY \`${orderByCol}\` ${orderByDir}` : ''
  const dataSql = `SELECT * FROM \`${db}\`.\`${table}\`${whereClause}${orderClause} LIMIT ${pageSize} OFFSET ${offset};`

  // BugFix-CW: Messages 라벨링 — 정렬·필터·페이지 이동을 구분 표시
  const dataSourceLabel = (() => {
    if (activeWhere) return t('qlLabelFilter', language)
    if (orderByCol) return t('qlLabelSort', language)
    if (page > 1) return t('qlLabelPage', language)
    return t('qlLabelTableLoad', language)
  })()

  const { data, isLoading, error } = useQuery<QueryResult>({
    queryKey: ['tableData', connId, db, table, pageSize, offset, activeWhere, orderByCol, orderByDir, refreshKey],
    queryFn: () => runLoggedQuery({
      connId,
      database: db,
      sql: dataSql,
      sourceLabel: dataSourceLabel,
    }),
    staleTime: 0,
    retry: false,
    placeholderData: (prev) => prev,
  })

  // 총 행 수 쿼리 (WHERE 포함)
  const countSql = `SELECT COUNT(*) AS cnt FROM \`${db}\`.\`${table}\`${whereClause};`
  const { data: countData } = useQuery<QueryResult>({
    queryKey: ['tableDataCount', connId, db, table, activeWhere, refreshKey],
    queryFn: () => runLoggedQuery({
      connId,
      database: db,
      sql: countSql,
      sourceLabel: t('qlLabelTableCount', language),
    }),
    staleTime: 0,
    retry: false,
  })

  const totalCount = countData?.rows?.[0]?.[0] != null ? Number(countData.rows[0][0]) : null
  const totalPages = totalCount != null ? Math.max(1, Math.ceil(totalCount / pageSize)) : null
  const rows = data?.rows ?? []
  const hasNext = totalPages != null ? page < totalPages : rows.length === pageSize

  function applyWhere() {
    setPage(1)
    setActiveWhere(whereInput)
  }

  function toggleSort(col: string) {
    if (orderByCol === col) {
      if (orderByDir === 'ASC') setOrderByDir('DESC')
      else { setOrderByCol(null); setOrderByDir('ASC') }
    } else {
      setOrderByCol(col)
      setOrderByDir('ASC')
    }
    setPage(1)
  }

  function goToPage(p: number) {
    const max = totalPages ?? 9999
    setPage(Math.max(1, Math.min(p, max)))
  }

  function handlePageInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const val = parseInt((e.currentTarget as HTMLInputElement).value, 10)
      if (!isNaN(val)) goToPage(val)
    }
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-error)] text-xs px-4 text-center">
        {error instanceof Error ? error.message : '데이터 로드 실패'}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 툴바 */}
      <div className="flex items-center gap-2 px-2 py-1 bg-[var(--color-bg-primary)] border-b border-[var(--color-bg-tertiary)] shrink-0 flex-wrap">
        {/* WHERE 필터 */}
        <div className="flex items-center gap-1 flex-1 min-w-[160px] max-w-[300px] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-0.5">
          <span className="text-[9px] text-[var(--color-null)] shrink-0 font-mono">WHERE</span>
          <input
            type="text"
            value={whereInput}
            onChange={(e) => setWhereInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyWhere() }}
            placeholder="id > 100 AND status = 'active'"
            className="flex-1 bg-transparent text-[10px] text-[var(--color-text-primary)] placeholder-[var(--color-border)] outline-none min-w-0"
          />
          {whereInput && (
            <button
              onClick={() => { setWhereInput(''); setActiveWhere(''); setPage(1) }}
              className="text-[var(--color-null)] hover:text-[var(--color-text-muted)]"
            >
              <X size={9} />
            </button>
          )}
          <button
            onClick={applyWhere}
            className="text-[var(--color-null)] hover:text-[var(--color-accent)] transition-colors"
            title="필터 적용 (Enter)"
          >
            <Search size={9} />
          </button>
        </div>

        {/* 총 행 수 */}
        <span className="text-[9px] text-[var(--color-null)] shrink-0">
          {isLoading ? (
            <Loader2 size={10} className="animate-spin text-[var(--color-null)]" />
          ) : (
            <>
              {totalCount != null
                ? `${totalCount.toLocaleString()}행`
                : `${rows.length}행`
              }
              {activeWhere && <span className="ml-1 text-[var(--color-warning)]">필터됨</span>}
            </>
          )}
        </span>

        {/* 페이지 크기 선택 */}
        <select
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value) as typeof PAGE_SIZES[number]); setPage(1) }}
          className="h-5 px-1 text-[10px] bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded text-[var(--color-text-subtle)] outline-none cursor-pointer"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>{s}행</option>
          ))}
        </select>

        {/* 페이지네이션 */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => goToPage(1)}
            disabled={page === 1}
            className="p-0.5 rounded text-[var(--color-null)] hover:text-[var(--color-text-primary)] disabled:opacity-30 disabled:cursor-default transition-colors"
            title="첫 페이지"
          >
            <ChevronsLeft size={12} />
          </button>
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page === 1}
            className="p-0.5 rounded text-[var(--color-null)] hover:text-[var(--color-text-primary)] disabled:opacity-30 disabled:cursor-default transition-colors"
            title="이전 페이지"
          >
            <ChevronLeft size={12} />
          </button>

          {/* 페이지 번호 입력 */}
          <div className="flex items-center gap-0.5 text-[10px] text-[var(--color-text-muted)]">
            <input
              ref={pageInputRef}
              type="number"
              defaultValue={page}
              key={page}
              onKeyDown={handlePageInputKeyDown}
              className="w-8 h-5 text-center bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] text-[10px] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              min={1}
              max={totalPages ?? 9999}
            />
            {totalPages != null && (
              <span>/ {totalPages.toLocaleString()}</span>
            )}
          </div>

          <button
            onClick={() => goToPage(page + 1)}
            disabled={!hasNext}
            className="p-0.5 rounded text-[var(--color-null)] hover:text-[var(--color-text-primary)] disabled:opacity-30 disabled:cursor-default transition-colors"
            title="다음 페이지"
          >
            <ChevronRight size={12} />
          </button>
          <button
            onClick={() => totalPages && goToPage(totalPages)}
            disabled={!hasNext || totalPages == null}
            className="p-0.5 rounded text-[var(--color-null)] hover:text-[var(--color-text-primary)] disabled:opacity-30 disabled:cursor-default transition-colors"
            title="마지막 페이지"
          >
            <ChevronsRight size={12} />
          </button>
        </div>
      </div>

      {/* 데이터 테이블 */}
      {isLoading && rows.length === 0 ? (
        <div className="flex items-center justify-center flex-1 gap-2 text-[var(--color-text-muted)]">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-xs">로딩 중...</span>
        </div>
      ) : !data || data.columns.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-[var(--color-text-muted)] text-xs">
          결과 없음
        </div>
      ) : (
        <div className={`flex-1 overflow-auto transition-opacity ${isLoading ? 'opacity-50' : ''}`}>
          <table className="w-full text-[11px] border-collapse">
            <thead className="sticky top-0 bg-[var(--color-bg-secondary)] z-10">
              <tr>
                <th className="px-2 py-1.5 text-right text-[var(--color-null)] border-b border-[var(--color-border)] font-normal text-[9px] w-8 select-none">#</th>
                {data.columns.map((col) => {
                  const isSorted = orderByCol === col.name
                  return (
                    <th
                      key={col.name}
                      onClick={() => toggleSort(col.name)}
                      className="px-2 py-1.5 text-left border-b border-[var(--color-border)] whitespace-nowrap font-medium text-[10px] cursor-pointer select-none group hover:bg-[var(--color-bg-tertiary)] transition-colors"
                    >
                      <span className={`flex items-center gap-1 ${isSorted ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`}>
                        {col.name}
                        <span className="ml-0.5 text-[8px] font-normal text-[var(--color-null)]">{col.type}</span>
                        {isSorted
                          ? (orderByDir === 'ASC'
                              ? <ArrowUp size={9} className="shrink-0" />
                              : <ArrowDown size={9} className="shrink-0" />)
                          : <ArrowUp size={9} className="shrink-0 opacity-0 group-hover:opacity-30" />
                        }
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-[var(--color-bg-tertiary)] border-b border-[var(--color-bg-primary)]">
                  <td className="px-2 py-1 text-right text-[9px] text-[var(--color-null)] border-r border-[var(--color-bg-secondary)] select-none w-8">
                    {offset + ri + 1}
                  </td>
                  {(row as unknown[]).map((cell, ci) => {
                    const isNull = cell === null
                    const display = isNull ? 'NULL' : String(cell)
                    const isTooLong = display.length > 80
                    return (
                      <td
                        key={ci}
                        className="px-2 py-1 border-r border-[var(--color-bg-secondary)] max-w-[200px] truncate"
                        style={{ color: isNull ? 'var(--color-null)' : 'var(--color-text-primary)' }}
                        title={isTooLong ? display : undefined}
                      >
                        {isTooLong ? display.slice(0, 80) + '…' : display}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Info 탭 ─────────────────────────────────────────────────────────────

function TableInfoTab({ connId, db, table }: { connId: string; db: string; table: string }) {
  const { data: columns, isLoading } = useQuery<ColumnInfo[]>({
    queryKey: ['columns', connId, db, table],
    queryFn: () => ListColumns(connId, db, table),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-[var(--color-text-muted)]">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-xs">로딩 중...</span>
      </div>
    )
  }

  if (!columns || columns.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-xs">
        컬럼 정보 없음
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead className="sticky top-0 bg-[var(--color-bg-secondary)] z-10">
          <tr>
            {['#', '컬럼명', '타입', 'Null', '키', 'Default', 'Extra', '설명'].map((h) => (
              <th
                key={h}
                className="px-2 py-1.5 text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)] whitespace-nowrap font-medium text-[10px]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((col, i) => (
            <tr key={col.name} className="hover:bg-[var(--color-bg-tertiary)] border-b border-[var(--color-bg-primary)]">
              <td className="px-2 py-1 text-[var(--color-null)] border-r border-[var(--color-bg-secondary)]">{col.ordinalPos ?? i + 1}</td>
              <td className="px-2 py-1 font-mono text-[var(--color-text-primary)] border-r border-[var(--color-bg-secondary)]">{col.name}</td>
              <td className="px-2 py-1 text-[var(--color-warning)] font-mono border-r border-[var(--color-bg-secondary)]">{col.columnType}</td>
              <td className="px-2 py-1 border-r border-[var(--color-bg-secondary)]">
                {col.nullable
                  ? <span className="text-[var(--color-success)]">YES</span>
                  : <span className="text-[var(--color-text-muted)]">NO</span>}
              </td>
              <td className="px-2 py-1 border-r border-[var(--color-bg-secondary)]">
                {col.key && (
                  <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                    col.key === 'PRI'
                      ? 'text-[var(--color-warning)] bg-[var(--color-warning)/15]'
                      : col.key === 'UNI'
                      ? 'text-[var(--color-accent)] bg-[var(--color-accent)/15]'
                      : 'text-[var(--color-text-muted)] bg-[var(--color-text-muted)/15]'
                  }`}>{col.key}</span>
                )}
              </td>
              <td className="px-2 py-1 text-[var(--color-text-subtle)] font-mono border-r border-[var(--color-bg-secondary)]">
                {col.default === '' ? <span className="text-[var(--color-null)]">NULL</span> : col.default}
              </td>
              <td className="px-2 py-1 text-[var(--color-text-muted)] border-r border-[var(--color-bg-secondary)]">{col.extra}</td>
              <td className="px-2 py-1 text-[var(--color-text-muted)] max-w-[150px] truncate" title={col.comment}>{col.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
