import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RefreshCw, Loader2, Search, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import ResultGrid from '@/components/ResultGrid'
import QueryHistory from '@/components/QueryHistory'
import TableInfoDesigner from '@/components/TableInfo'
import { useThemeStore } from '@/stores/useThemeStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import { runLoggedQuery } from '@/utils/queryLog'
import type { QueryResult, TableInfo, ToolTab } from '@/types'
import toast from 'react-hot-toast'

/** 다크/라이트 여부를 서브컴포넌트에 전달하기 위한 Context */
const DarkCtx = React.createContext(true)

interface SelectedTable {
  connId: string
  db: string
  table: TableInfo
}

interface Props {
  /** TableInfoDesigner 용 — 현재 활성 탭의 마지막 SELECT 결과 (미사용, 하위 호환) */
  currentResult?: QueryResult | null
  selectedTable?: SelectedTable | null
  /** App.tsx가 항상 제어하는 활성 도구 탭 (required) */
  externalActiveTab: ToolTab
  /** History 탭의 닫기 버튼 클릭 시 호출 (query workspace로 복귀) */
  onCloseToolTab?: () => void
}

/**
 * 도구 탭 컨테이너: Query Profile / History / Table Data / Info.
 * 탭 바는 App.tsx의 UnifiedTabBar가 렌더링하므로 여기서는 콘텐츠만 렌더링.
 */
export default function ResultPanel({
  selectedTable,
  externalActiveTab, onCloseToolTab,
}: Props) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeTabId, updateTab } = useConnectionStore()
  const [tableDataKey, setTableDataKey] = useState(0)

  /** 생성된 SQL을 현재 탭 에디터에 삽입 */
  const handleInsertSQL = useCallback((sql: string) => {
    if (!activeTabId) return
    updateTab(activeTabId, { sql })
    toast.success('SQL이 에디터에 삽입되었습니다')
  }, [activeTabId, updateTab])

  // selectedTable 변경 시 TableDataTab 리셋
  useEffect(() => {
    if (selectedTable) setTableDataKey((k) => k + 1)
  }, [selectedTable?.connId, selectedTable?.db, selectedTable?.table.name])

  return (
    <DarkCtx.Provider value={isDark}>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 overflow-hidden flex flex-col">
          {externalActiveTab === 'history' && (
            <QueryHistory
              onClose={onCloseToolTab ?? (() => {})}
              embedded
            />
          )}

          {externalActiveTab === 'tableData' && selectedTable && (
            <TableDataTab
              connId={selectedTable.connId}
              db={selectedTable.db}
              tableName={selectedTable.table.name}
              refreshKey={tableDataKey}
              onRefresh={() => setTableDataKey((k) => k + 1)}
            />
          )}

          {externalActiveTab === 'info' && (
            <TableInfoDesigner
              connId={selectedTable?.connId ?? ''}
              connName={selectedTable?.connId ?? ''}
              database={selectedTable?.db ?? ''}
              table={selectedTable?.table.name ?? ''}
              onInsertSQL={handleInsertSQL}
            />
          )}
        </div>
      </div>
    </DarkCtx.Provider>
  )
}

// ─── Table Data 탭 ────────────────────────────────────────────────────────

const PAGE_SIZES = [50, 100, 500, 1000] as const
type PageSize = (typeof PAGE_SIZES)[number]

function TableDataTab({
  connId, db, tableName, refreshKey, onRefresh,
}: {
  connId: string; db: string; tableName: string; refreshKey: number
  onRefresh: () => void
}) {
  const isDark = React.useContext(DarkCtx)
  const language = useLanguageStore((s) => s.language)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<PageSize>(500)
  const [whereInput, setWhereInput] = useState('')
  const [activeWhere, setActiveWhere] = useState('')
  const [orderByCol, setOrderByCol] = useState<string | null>(null)
  const [orderByDir, setOrderByDir] = useState<'ASC' | 'DESC'>('ASC')
  const pageInputRef = useRef<HTMLInputElement>(null)

  // 테이블/새로고침 변경 시 첫 페이지로 리셋
  useEffect(() => {
    setPage(0); setWhereInput(''); setActiveWhere('')
    setOrderByCol(null); setOrderByDir('ASC')
  }, [connId, db, tableName, refreshKey])

  const whereClause = activeWhere.trim() ? ` WHERE ${activeWhere.trim()}` : ''
  const orderClause = orderByCol ? ` ORDER BY \`${orderByCol}\` ${orderByDir}` : ''

  // BugFix-CW: 어떤 사용자 행위로 인한 쿼리인지 라벨링 — Messages footer 가
  // 정렬·필터·페이지 이동을 구분해 표시할 수 있도록 한다.
  // (queryKey 변경 원인을 useQuery 내부에서는 알 수 없으므로 호출 직전 라벨 계산)
  const dataSourceLabel = (() => {
    if (activeWhere) return t('qlLabelFilter', language)
    if (orderByCol) return t('qlLabelSort', language)
    if (page > 0) return t('qlLabelPage', language)
    return t('qlLabelTableLoad', language)
  })()

  // 전체 행 수 (페이지 수 계산용)
  const { data: countData } = useQuery<QueryResult>({
    queryKey: ['tableCount', connId, db, tableName, activeWhere],
    queryFn: () => runLoggedQuery({
      connId,
      database: db,
      sql: `SELECT COUNT(*) AS cnt FROM \`${db}\`.\`${tableName}\`${whereClause};`,
      sourceLabel: t('qlLabelTableCount', language),
    }),
    staleTime: 30_000,
    retry: false,
  })
  const totalRows = countData ? Number((countData.rows[0] as unknown[])?.[0] ?? 0) : null
  const totalPages = totalRows !== null ? Math.max(1, Math.ceil(totalRows / pageSize)) : null

  // 현재 페이지 데이터
  const { data, isLoading, error } = useQuery<QueryResult>({
    queryKey: ['tableData', connId, db, tableName, page, pageSize, activeWhere, orderByCol, orderByDir, refreshKey],
    queryFn: () => runLoggedQuery({
      connId,
      database: db,
      sql: `SELECT * FROM \`${db}\`.\`${tableName}\`${whereClause}${orderClause} LIMIT ${pageSize} OFFSET ${page * pageSize};`,
      sourceLabel: dataSourceLabel,
    }),
    staleTime: 0,
    retry: false,
    placeholderData: (prev) => prev,
  })

  // 첫 데이터 로드 후 컬럼 목록 확보
  const columns = data?.columns.map((c) => c.name) ?? []

  // ResultGrid 헤더 ↔ 상단 정렬 선택 박스 양방향 동기화용 control 객체.
  // 정렬 변경 시 페이지를 0 으로 되돌리고 ASC default 를 보장한다.
  const serverSort = useMemo(() => ({
    col: orderByCol,
    dir: orderByDir,
    onChange: (col: string | null, dir: 'ASC' | 'DESC') => {
      setOrderByCol(col)
      setOrderByDir(col ? dir : 'ASC')
      setPage(0)
    },
  }), [orderByCol, orderByDir])

  function applyWhere() {
    setPage(0)
    setActiveWhere(whereInput)
  }

  function goToPage(p: number) {
    const max = (totalPages ?? 1) - 1
    setPage(Math.max(0, Math.min(p, max)))
  }

  const toolbarCls = isDark ? 'bg-[#0f1117] border-[#2d3748]' : 'bg-[#f1f5f9] border-[#e2e8f0]'
  const metaCls    = isDark ? 'text-[#718096]' : 'text-[#64748b]'
  const btnCls     = isDark ? 'text-[#718096] hover:text-[#e2e8f0] hover:bg-[#1e2230]' : 'text-[#64748b] hover:text-[#1e293b] hover:bg-[#e2e8f0]'
  const selectCls  = isDark ? 'bg-[#1a1f2e] text-[#a0aec0] border-[#2d3748]' : 'bg-[#ffffff] text-[#374151] border-[#cbd5e0]'
  const inputCls   = isDark ? 'bg-[#1a1f2e] text-[#e2e8f0] border-[#2d3748] placeholder-[#2d3748]' : 'bg-[#ffffff] text-[#1e293b] border-[#cbd5e0] placeholder-[#94a3b8]'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 페이지네이션 툴바 */}
      <div className={`flex items-center gap-2 px-2 py-1 border-b shrink-0 flex-wrap ${toolbarCls}`}>
        {/* WHERE 필터 */}
        <div className={`flex items-center gap-1 flex-1 min-w-[160px] max-w-[280px] border rounded px-2 py-0.5 ${inputCls.replace('placeholder-[#2d3748]', '').replace('placeholder-[#94a3b8]', '')} border-${isDark ? '[#2d3748]' : '[#cbd5e0]'} bg-${isDark ? '[#1a1f2e]' : '[#ffffff]'}`}
          style={{ background: isDark ? '#1a1f2e' : '#ffffff', borderColor: isDark ? '#2d3748' : '#cbd5e0' }}
        >
          <span className={`text-[9px] shrink-0 font-mono ${metaCls}`}>WHERE</span>
          <input
            type="text"
            value={whereInput}
            onChange={(e) => setWhereInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyWhere() }}
            placeholder="id > 0"
            className={`flex-1 bg-transparent text-[10px] outline-none min-w-0 ${isDark ? 'text-[#e2e8f0] placeholder-[#2d3748]' : 'text-[#1e293b] placeholder-[#94a3b8]'}`}
          />
          {whereInput && (
            <button onClick={() => { setWhereInput(''); setActiveWhere(''); setPage(0) }}
              className={`${metaCls} hover:text-[#e2e8f0]`}>
              <X size={9} />
            </button>
          )}
          <button onClick={applyWhere} className={`${metaCls} hover:text-[#4299e1] transition-colors`} title="필터 적용 (Enter)">
            <Search size={9} />
          </button>
        </div>

        {/* ORDER BY 컨트롤 */}
        {columns.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            <ArrowUpDown size={10} className={metaCls} />
            <select
              value={orderByCol ?? ''}
              onChange={(e) => { const v = e.target.value; setOrderByCol(v || null); setOrderByDir('ASC'); setPage(0) }}
              className={`text-[10px] border rounded px-1 py-0.5 outline-none max-w-[120px] truncate ${selectCls}`}
            >
              <option value="">정렬 없음</option>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {orderByCol && (
              <button
                onClick={() => { setOrderByDir((d) => d === 'ASC' ? 'DESC' : 'ASC'); setPage(0) }}
                className={`p-0.5 rounded transition-colors ${btnCls}`}
                title={orderByDir === 'ASC' ? '오름차순 → 내림차순' : '내림차순 → 오름차순'}
              >
                {orderByDir === 'ASC' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
              </button>
            )}
          </div>
        )}

        {/* 총 행 수 */}
        <span className={`text-[10px] shrink-0 ${metaCls}`}>
          {totalRows !== null ? (
            <>
              <span className={`font-medium ${activeWhere ? 'text-[#f6ad55]' : 'text-[#68d391]'}`}>{totalRows.toLocaleString()}</span>행
              &nbsp;·&nbsp;
              {(page * pageSize + 1).toLocaleString()}–{Math.min((page + 1) * pageSize, totalRows).toLocaleString()}
            </>
          ) : (
            data ? `${(data.rows.length + page * pageSize).toLocaleString()}행+` : '...'
          )}
        </span>

        {/* 페이지네이션 버튼 */}
        <div className="flex items-center gap-0.5 ml-auto">
          <button onClick={() => goToPage(0)} disabled={page === 0 || isLoading}
            className={`p-1 rounded disabled:opacity-30 transition-colors ${btnCls}`} title="첫 페이지">
            <ChevronsLeft size={12} />
          </button>
          <button onClick={() => goToPage(page - 1)} disabled={page === 0 || isLoading}
            className={`p-1 rounded disabled:opacity-30 transition-colors ${btnCls}`} title="이전 페이지">
            <ChevronLeft size={12} />
          </button>

          {/* 페이지 번호 입력 */}
          <div className={`flex items-center gap-0.5 text-[10px] ${metaCls}`}>
            <input
              ref={pageInputRef}
              type="number"
              key={`${page}-${tableName}`}
              defaultValue={page + 1}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = parseInt((e.currentTarget as HTMLInputElement).value, 10)
                  if (!isNaN(v)) goToPage(v - 1)
                }
              }}
              className={`w-9 h-5 text-center border rounded text-[10px] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none ${selectCls}`}
              min={1}
              max={totalPages ?? 9999}
            />
            {totalPages !== null && <span>/ {totalPages.toLocaleString()}</span>}
          </div>

          <button
            onClick={() => goToPage((totalPages ?? 1) - 1 > page ? page + 1 : page)}
            disabled={(totalPages !== null && page >= totalPages - 1) || isLoading}
            className={`p-1 rounded disabled:opacity-30 transition-colors ${btnCls}`} title="다음 페이지">
            <ChevronRight size={12} />
          </button>
          <button
            onClick={() => totalPages && goToPage(totalPages - 1)}
            disabled={(totalPages !== null && page >= totalPages - 1) || isLoading}
            className={`p-1 rounded disabled:opacity-30 transition-colors ${btnCls}`} title="마지막 페이지">
            <ChevronsRight size={12} />
          </button>
        </div>

        <select
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value) as PageSize); setPage(0) }}
          className={`text-[10px] border rounded px-1 py-0.5 outline-none ${selectCls}`}
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>{s}행</option>
          ))}
        </select>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className={`p-1 rounded disabled:opacity-30 transition-colors ${btnCls}`}
          title="새로고침"
        >
          <RefreshCw size={11} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {error && (
          <div className="flex items-center justify-center h-full text-[#fc8181] text-xs">
            {error instanceof Error ? error.message : '데이터 로드 실패'}
          </div>
        )}
        {!error && !data && isLoading && (
          <div className="flex items-center justify-center h-full gap-2 text-[#718096]">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">로딩 중...</span>
          </div>
        )}
        {!error && data && (
          <>
            {isLoading && (
              <div className="absolute inset-0 bg-[#0f1117]/40 z-10 flex items-center justify-center">
                <Loader2 size={18} className="animate-spin text-[#4299e1]" />
              </div>
            )}
            <ResultGrid
              result={data}
              editCtx={data.editCtx}
              connId={connId}
              showColumnStats={false}
              serverSort={serverSort}
            />
          </>
        )}
      </div>
    </div>
  )
}

