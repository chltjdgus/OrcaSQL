import { useState, useCallback, useEffect, useRef, useDeferredValue, useTransition } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useThemeStore } from '@/stores/useThemeStore'

/** 스키마 캐시 TTL: 5분 fresh, 30분 GC */
const SCHEMA_STALE = 5 * 60 * 1000
const SCHEMA_GC    = 30 * 60 * 1000
/** 컬럼/트리거는 변경 빈도가 낮으므로 10분 fresh */
const COL_STALE    = 10 * 60 * 1000
import {
  Database, Table2, Eye, Columns, ChevronRight, ChevronDown, Loader2,
  Play, Code, Copy, Wrench, Zap, Calendar, GitBranch, FunctionSquare,
  Settings, Trash2, RefreshCw, Download, Upload, Search, X,
  Pencil, CopyPlus, Plus,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  ListDatabases, ListTables, ListColumns, GetTableDDL,
  ListProcedures, ListFunctions, ListTriggers, ListEvents, GetObjectDDL,
  ExportTableData,
  RenameTable, CopyTable, CreateDatabase, DropDatabase,
} from '@/wailsjs/go/main/App'
import { runLoggedQuery } from '@/utils/queryLog'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import { nativeConfirm } from '@/utils/nativeConfirm'
import ContextMenu, { type ContextMenuOption } from '@/components/ContextMenu'
import ImportModal from '@/components/ImportModal'
import type { TableInfo, ColumnInfo, ObjectInfo } from '@/types'

type CategoryType = 'tables' | 'views' | 'procedures' | 'functions' | 'triggers' | 'events'

export interface SchemaTreeProps {
  /** 테이블 단일 클릭: 하단 TablePropertiesPanel에 데이터/정보 표시 */
  onTableSelect?: (connId: string, db: string, table: TableInfo) => void
  /** 테이블/DB명 더블클릭: 호출 측이 쿼리 탭 활성 상태를 보고 커서 삽입 or 새 탭 생성 선택 */
  onNameDoubleClick?: (text: string, connId: string, db: string) => void
  /** Open Table 우클릭 메뉴: 새 탭 생성 + 즉시 실행 */
  onOpenTableDirectly?: (connId: string, db: string, tableName: string) => void
  /** 신규 테이블 생성 진입점 — 메인 Info 도구 탭을 create 모드로 활성화 */
  onOpenNewTable?: (connId: string, db: string) => void
  /** 앱 시작 시 복원할 확장 노드 키 목록 */
  initialExpanded?: string[]
}

/**
 * 좌측 사이드바: Connection → Database → [카테고리] → 객체 트리.
 * 레이지 로딩 기반. 테이블 우클릭으로 Table Designer 오픈 가능.
 */
/** 스키마 캐시를 한 번에 무효화하는 쿼리 키 목록 */
const SCHEMA_KEYS = ['databases', 'tables', 'columns', 'views', 'procedures', 'functions', 'triggers', 'events'] as const

/** 대소문자 무시 사전순 비교자 (한글/유니코드 자연 정렬 포함) */
const byNameCI = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' })

/** 용량 포맷: 바이트 → KB/MB/GB/TB */
function formatSize(bytes: number): string {
  if (bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  return `${(bytes / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`
}

export default function SchemaTree({ onTableSelect, onNameDoubleClick, onOpenTableDirectly, onOpenNewTable, initialExpanded }: SchemaTreeProps) {
  const { activeConnections, selectedConnId, setSelectedConn, setSelectedDatabase, selectedDatabase } = useConnectionStore()
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { settings } = useSettingsStore()
  const language = useLanguageStore((s) => s.language)
  const showRowCount = settings.schemaTree.showRowCount
  const [expandedSet, setExpandedSet] = useState<Set<string>>(
    initialExpanded && initialExpanded.length > 0 ? new Set(initialExpanded) : new Set()
  )
  // BugFix-BC: 자식 노드(테이블/SP/함수/이벤트/트리거) 선택 하이라이트 키
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null)
  const [importTarget, setImportTarget] = useState<{ connId: string; database: string; table: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  // React 19: 트리 필터링을 지연 처리해 입력 즉각 반응 유지
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const isSearchStale = searchQuery !== deferredSearchQuery

  // React 19: useTransition으로 리프레시를 비긴급 전환으로 처리
  const [isRefreshing, startRefreshTransition] = useTransition()
  const queryClient = useQueryClient()

  // F5 단축키 컨텍스트: 트리 내부에 포커스가 있을 때만 새로고침 발화
  const containerRef = useRef<HTMLDivElement>(null)

  // 확장 상태를 window에 노출 → beforeunload에서 수집하여 세션 저장
  useEffect(() => {
    window.__schemaExpandedKeys = Array.from(expandedSet)
  }, [expandedSet])

  /** 모든 스키마 관련 캐시를 무효화하고 즉시 refetch */
  const handleRefresh = useCallback(() => {
    startRefreshTransition(async () => {
      await Promise.all(
        SCHEMA_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] }))
      )
      toast.success('스키마를 새로고침했습니다.')
    })
  }, [queryClient, startRefreshTransition])

  // MenuBar / 단축키에서 dispatch한 'schema:refresh' 이벤트 수신
  useEffect(() => {
    window.addEventListener('schema:refresh', handleRefresh)
    return () => window.removeEventListener('schema:refresh', handleRefresh)
  }, [handleRefresh])

  // BugFix-AZ: Ctrl+B / ⌘B 단축키 → 트리 컨테이너에 포커스
  useEffect(() => {
    const h = () => containerRef.current?.focus()
    window.addEventListener('focus:tree', h)
    return () => window.removeEventListener('focus:tree', h)
  }, [])

  // 트리 컨테이너 포커스 시 F5 → 새로고침
  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'F5') {
      e.preventDefault()
      handleRefresh()
    }
  }, [handleRefresh])

  // 트리 행(non-focusable div) 클릭 시 컨테이너로 포커스 위임 — 사용자가
  // 클릭만으로 단축키 컨텍스트에 진입할 수 있도록. 검색 input/버튼 클릭은
  // native focus 가 우선해야 하므로 위임 스킵.
  const handleContainerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('input, button, textarea, select')) return
    if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
      containerRef.current.focus()
    }
  }, [])

  // DB 노드가 펼쳐질 때 함께 펼쳐야 할 카테고리 키들.
  // 사용자가 DB 를 펼치면 테이블/뷰/프로시저/함수/이벤트가 곧바로 보이도록.
  // 카테고리를 명시적으로 다시 접으면 expandedSet 에서 빠지고 그 상태가 유지됨.
  const DB_CATEGORIES = ['tables', 'views', 'procedures', 'functions', 'events'] as const
  const categoryKeysFor = useCallback((connId: string, db: string): string[] =>
    DB_CATEGORIES.map(c => `cat:${connId}:${db}:${c}`)
  , [])

  const toggleKey = useCallback((key: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
        return next
      }
      next.add(key)
      // db: 키가 펼쳐질 때 카테고리 5개 동시 추가 — 사용자 요구
      const dbMatch = key.match(/^db:([^:]+):(.+)$/)
      if (dbMatch) {
        const [, connId, db] = dbMatch
        for (const ck of categoryKeysFor(connId, db)) next.add(ck)
      }
      return next
    })
  }, [categoryKeysFor])

  // Toolbar 등에서 DB가 선택되면 해당 연결 노드 + DB 노드 + 카테고리들을 자동 확장.
  // 사용자가 외부에서 DB 를 고른 경우에도 트리에서 곧바로 테이블 목록이 보이도록.
  useEffect(() => {
    if (!selectedConnId || !selectedDatabase) return
    const connKey = `conn:${selectedConnId}`
    const dbKey = `db:${selectedConnId}:${selectedDatabase}`
    setExpandedSet((prev) => {
      const cats = categoryKeysFor(selectedConnId, selectedDatabase)
      if (prev.has(connKey) && prev.has(dbKey) && cats.every(k => prev.has(k))) return prev
      const next = new Set(prev)
      next.add(connKey)
      next.add(dbKey)
      for (const ck of cats) next.add(ck)
      return next
    })
  }, [selectedDatabase, selectedConnId, categoryKeysFor])

  // 세션 복원 등으로 db: 키만 있고 카테고리 키는 없는 케이스 백필.
  // 한 번만 실행 — initialExpanded 가 비결정적으로 바뀌지는 않음.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setExpandedSet(prev => {
      let changed = false
      const next = new Set(prev)
      for (const key of prev) {
        const m = key.match(/^db:([^:]+):(.+)$/)
        if (!m) continue
        for (const ck of categoryKeysFor(m[1], m[2])) {
          if (!next.has(ck)) {
            next.add(ck)
            changed = true
          }
        }
      }
      return changed ? next : prev
    })
  }, [])

  return (
    <DarkCtx.Provider value={isDark}>
    <>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleContainerKeyDown}
        onMouseDown={handleContainerMouseDown}
        className="osql-schema-tree flex flex-col h-full outline-none"
      >
        {/* 헤더: 검색 인풋 + 새로고침 버튼 */}
        <div className={`osql-schema-tree-search px-2 py-1.5 border-b shrink-0 ${isDark ? 'border-[#2d3748]' : 'border-[#d1d5db]'}`}>
          <div className="flex items-center gap-1">
            <div className={`flex items-center gap-1 rounded px-2 py-1 flex-1 min-w-0 transition-opacity ${isSearchStale ? 'opacity-60' : ''} ${isDark ? 'bg-[#1a1f2e]' : 'bg-[#eef0f4] border border-[#d1d5db]'}`}>
              <Search size={11} className={`shrink-0 ${isDark ? 'text-[#4a5568]' : 'text-[#9ca3af]'}`} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('phTableDbSearch', language)}
                className={`flex-1 bg-transparent text-[11px] outline-none min-w-0
                  ${isDark ? 'text-[#e2e8f0] placeholder-[#4a5568]' : 'text-[#1a202c] placeholder-[#9ca3af]'}`}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className={isDark ? 'text-[#4a5568] hover:text-[#718096]' : 'text-[#9ca3af] hover:text-[#6b7280]'}>
                  <X size={10} />
                </button>
              )}
            </div>
            {/* 스키마 새로고침 버튼 */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="스키마 새로고침 (캐시 초기화)"
              className={`shrink-0 p-1 rounded disabled:opacity-40 transition-colors
                ${isDark ? 'text-[#4a5568] hover:text-[#a0aec0] hover:bg-[#2d3748]' : 'text-[#9ca3af] hover:text-[#374151] hover:bg-[#e2e8f0]'}`}
            >
              <RefreshCw size={11} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="osql-schema-tree-list flex-1 overflow-y-auto text-xs">
          {/* BugFix-BQ: 탭(=활성 연결) 별로 자기 트리만 표시. */}
          {/* 종전엔 activeConnections 전체를 평면 렌더 → 탭이 늘어날수록 다른 연결의 DB 가 함께 누적되어 표시되던 결함. */}
          {/* 선택된 connId 가 없으면(초기 진입) activeConnections[0] 으로 fallback. */}
          {activeConnections.length === 0 ? (
            <div className="px-3 py-4 text-[#718096] text-center select-none">
              {t('noServerConnection', language)}
            </div>
          ) : (
            (() => {
              const visibleConn =
                activeConnections.find((c) => c.id === selectedConnId) ?? activeConnections[0]
              return (
                <ConnectionNode
                  key={visibleConn.id}
                  connId={visibleConn.id}
                  name={visibleConn.name}
                  isSelected={selectedConnId === visibleConn.id}
                  onSelect={() => setSelectedConn(visibleConn.id)}
                  selectedDatabase={selectedDatabase}
                  onSelectDatabase={(db) => { setSelectedConn(visibleConn.id); setSelectedDatabase(db) }}
                  expandedSet={expandedSet}
                  toggleKey={toggleKey}
                  onOpenNewTable={(connId, db) => onOpenNewTable?.(connId, db)}
                  onOpenImport={(connId, db, table) => setImportTarget({ connId, database: db, table })}
                  onTableSelect={onTableSelect}
                  onNameDoubleClick={onNameDoubleClick}
                  onOpenTableDirectly={onOpenTableDirectly}
                  searchQuery={deferredSearchQuery}
                  showRowCount={showRowCount}
                  selectedNodeKey={selectedNodeKey}
                  setSelectedNodeKey={setSelectedNodeKey}
                />
              )
            })()
          )}
        </div>
      </div>

      {/* CSV 임포트 모달 */}
      {importTarget && (
        <ImportModal
          connId={importTarget.connId}
          database={importTarget.database}
          table={importTarget.table}
          onClose={() => setImportTarget(null)}
        />
      )}
    </>
    </DarkCtx.Provider>
  )
}

// ─── Connection 노드 ──────────────────────────────────────────────────────

interface CommonProps {
  expandedSet: Set<string>
  toggleKey: (key: string) => void
  /** 신규 테이블 생성 — 메인 Info 도구 탭을 create 모드로 진입 */
  onOpenNewTable: (connId: string, db: string) => void
  onOpenImport: (connId: string, db: string, table: string) => void
  selectedDatabase: string | null
  onSelectDatabase: (db: string) => void
  /** 테이블 단일 클릭 → 하단 패널 표시 */
  onTableSelect?: (connId: string, db: string, table: TableInfo) => void
  /** 더블클릭 → 새 쿼리 탭 생성 + 초기 SQL 에 이름 삽입 */
  onNameDoubleClick?: (text: string, connId: string, db: string) => void
  /** Open Table 직접 실행 */
  onOpenTableDirectly?: (connId: string, db: string, tableName: string) => void
  /** 검색 쿼리 (빈 문자열이면 필터 없음) */
  searchQuery: string
  /** true이면 row count 배지, false이면 size 배지 (기본 false) */
  showRowCount?: boolean
  /** 현재 선택된 자식 노드 키 (table:.../obj:.../trig:...) — 행 하이라이트용 */
  selectedNodeKey: string | null
  /** 자식 노드 클릭 시 호출 — 선택 상태 갱신 */
  setSelectedNodeKey: (key: string | null) => void
}

function ConnectionNode({
  connId, isSelected,
  expandedSet, toggleKey, onOpenNewTable, onOpenImport, selectedDatabase, onSelectDatabase,
  onTableSelect, onNameDoubleClick, onOpenTableDirectly, searchQuery, showRowCount = false,
  selectedNodeKey, setSelectedNodeKey,
}: { connId: string; name: string; isSelected: boolean; onSelect: () => void } & CommonProps) {
  // 트리에서 연결(세션) 헤더는 노출하지 않고 DB 목록만 평면 렌더 — 사용자 요구.
  // 다중 연결 활성 시에도 DB 들이 하나의 평면 리스트로 표시.
  // 검색 / DB 클릭 시 setSelectedConn 이 함께 호출되어 활성 연결 전환은 implicit 으로 동작.

  // DB 목록은 항상 fetch — 헤더 토글이 없어졌으므로 enabled=true.
  const { data: databases } = useQuery({
    queryKey: ['databases', connId],
    queryFn: () => ListDatabases(connId),
    enabled: true,
    staleTime: SCHEMA_STALE,
    gcTime: SCHEMA_GC,
  })

  // BugFix-T: 세션 cfg.databases 가 설정되어 있으면 그 목록만 노출 (강제 필터)
  // BugFix-BP: 활성 connId 는 ConnectNew 휘발 UUID(BugFix-BA) → cfgId 로 조회해야 saved cfg 매칭됨.
  const allowed = useConnectionStore((s) => {
    const cfgId = s.activeConnections.find((c) => c.id === connId)?.cfgId
    const lookupId = cfgId ?? connId
    return s.savedConnections.find((c) => c.id === lookupId)?.databases
  })
  const rawDatabases = databases ?? []
  const visibleDatabases = (allowed && allowed.length > 0
    ? rawDatabases.filter((d) => allowed.includes(d))
    : [...rawDatabases]
  ).sort(byNameCI)

  return (
    <>
      {visibleDatabases.map((db) => (
        <DatabaseNode
          key={`${connId}:${db}`}
          connId={connId}
          db={db}
          isSelected={selectedDatabase === db && isSelected}
          onSelect={() => onSelectDatabase(db)}
          expandedSet={expandedSet}
          toggleKey={toggleKey}
          onOpenNewTable={onOpenNewTable}
          onOpenImport={onOpenImport}
          selectedDatabase={selectedDatabase}
          onSelectDatabase={onSelectDatabase}
          onTableSelect={onTableSelect}
          onNameDoubleClick={onNameDoubleClick}
          onOpenTableDirectly={onOpenTableDirectly}
          searchQuery={searchQuery}
          showRowCount={showRowCount}
          selectedNodeKey={selectedNodeKey}
          setSelectedNodeKey={setSelectedNodeKey}
        />
      ))}
    </>
  )
}

// ─── Database 노드 ────────────────────────────────────────────────────────

function DatabaseNode({
  connId, db, isSelected, onSelect,
  expandedSet, toggleKey, onOpenNewTable, onOpenImport,
  onTableSelect, onNameDoubleClick, onOpenTableDirectly, searchQuery, showRowCount = false,
  selectedNodeKey, setSelectedNodeKey,
}: { connId: string; db: string; isSelected: boolean; onSelect: () => void } & CommonProps) {
  const key = `db:${connId}:${db}`
  const expanded = expandedSet.has(key)
  const isSearching = searchQuery.length > 0
  const q = searchQuery.toLowerCase()
  const queryClient = useQueryClient()
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  // 선택될 때 스크롤
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isSelected])

  // 검색 중이면 강제 fetch
  const { data: tables, isLoading } = useQuery({
    queryKey: ['tables', connId, db],
    queryFn: () => ListTables(connId, db),
    enabled: expanded || isSearching,
    staleTime: SCHEMA_STALE,
    gcTime: SCHEMA_GC,
  })

  const allTables = tables ?? []
  // 검색 필터 적용 (검색 중일 때만) + 대소문자 무시 정렬
  const baseTableList = allTables
    .filter((t) => t.type === 'BASE TABLE' && (!isSearching || t.name.toLowerCase().includes(q)))
    .sort((a, b) => byNameCI(a.name, b.name))
  const viewList = allTables
    .filter((t) => t.type === 'VIEW' && (!isSearching || t.name.toLowerCase().includes(q)))
    .sort((a, b) => byNameCI(a.name, b.name))

  // 검색 중인데 DB명도 매칭 안 되고, 하위 테이블도 없으면 숨김
  const dbNameMatches = !isSearching || db.toLowerCase().includes(q)
  const hasChildMatch = isSearching && (baseTableList.length > 0 || viewList.length > 0)
  if (isSearching && !dbNameMatches && !hasChildMatch) return null

  async function handleCreateDatabase() {
    const name = prompt('새 데이터베이스 이름:')
    if (!name) return
    try {
      await CreateDatabase(connId, name)
      toast.success(`데이터베이스 '${name}' 생성 완료`)
      queryClient.invalidateQueries({ queryKey: ['databases', connId] })
    } catch (e) {
      toast.error(`생성 실패: ${e}`)
    }
  }

  async function handleDropDatabase() {
    const input = prompt(`DROP DATABASE를 실행하려면 DB명 '${db}'을 입력하세요:`)
    if (input !== db) { toast.error('취소됨 — DB명이 일치하지 않습니다'); return }
    try {
      await DropDatabase(connId, db)
      toast.success(`데이터베이스 '${db}' 삭제 완료`)
      queryClient.invalidateQueries({ queryKey: ['databases', connId] })
    } catch (e) {
      toast.error(`삭제 실패: ${e}`)
    }
  }

  const dbContextItems: ContextMenuOption[] = [
    {
      label: 'DB명 복사',
      icon: <Copy size={11} />,
      onClick: () => { navigator.clipboard.writeText(`\`${db}\``); toast.success('복사됨') },
    },
    { separator: true },
    {
      label: '새 테이블 디자이너',
      icon: <Plus size={11} className="text-[#68d391]" />,
      onClick: () => onOpenNewTable(connId, db),
    },
    {
      label: '스키마 새로고침',
      icon: <RefreshCw size={11} />,
      onClick: () => {
        queryClient.invalidateQueries({ queryKey: ['tables', connId, db] })
        toast.success(`'${db}' 새로고침 완료`)
      },
    },
    { separator: true },
    {
      label: '새 데이터베이스 생성',
      icon: <Plus size={11} className="text-[#4299e1]" />,
      onClick: handleCreateDatabase,
    },
    {
      label: 'DROP DATABASE',
      icon: <Trash2 size={11} className="text-[#fc8181]" />,
      onClick: handleDropDatabase,
    },
  ]

  return (
    <div ref={rowRef}>
      <TreeRow
        depth={0}
        icon={<Database size={12} className="text-[#f6ad55]" />}
        label={db}
        labelNode={<HighlightText text={db} query={searchQuery} />}
        osqlKey={key}
        isSelected={isSelected && selectedNodeKey === null}
        isExpanded={expanded || isSearching}
        hasChildren
        isLoading={isLoading && (expanded || isSearching)}
        onChevronClick={() => toggleKey(key)}
        onClick={() => { setSelectedNodeKey(null); onSelect() }}
        onDoubleClick={() => onNameDoubleClick?.(`\`${db}\``, connId, db)}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
      />
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={dbContextItems} onClose={() => setCtxMenu(null)} />
      )}
      {(expanded || isSearching) && (
        <>
          {/* Tables 카테고리 — 검색 결과가 없으면 숨김 */}
          {(!isSearching || baseTableList.length > 0) && (
            <CategoryNode
              connId={connId} db={db}
              category="tables"
              label={`테이블 (${baseTableList.length})`}
              icon={<Table2 size={11} className="text-[#4299e1]" />}
              badge2={(() => {
                const total = baseTableList.reduce((s, t) => s + (t.sizeBytes ?? 0), 0)
                return total > 0 ? formatSize(total) : undefined
              })()}
              expandedSet={expandedSet} toggleKey={toggleKey} onOpenNewTable={onOpenNewTable}
              onOpenImport={onOpenImport} selectedDatabase={null} onSelectDatabase={() => {}}
              forceExpanded={isSearching}
            >
              {baseTableList.map((t) => (
                <TableNode
                  key={t.name}
                  connId={connId} db={db} table={t}
                  expandedSet={expandedSet} toggleKey={toggleKey}
                  onOpenNewTable={onOpenNewTable}
                  onOpenImport={onOpenImport}
                  onTableSelect={onTableSelect}
                  onNameDoubleClick={onNameDoubleClick}
                  onOpenTableDirectly={onOpenTableDirectly}
                  searchQuery={searchQuery}
                  showRowCount={showRowCount}
                  selectedNodeKey={selectedNodeKey}
                  setSelectedNodeKey={setSelectedNodeKey}
                />
              ))}
            </CategoryNode>
          )}

          {/* Views 카테고리 — 검색 결과가 없으면 숨김 */}
          {(!isSearching || viewList.length > 0) && (
            <CategoryNode
              connId={connId} db={db}
              category="views"
              label={`뷰 (${viewList.length})`}
              icon={<Eye size={11} className="text-[#68d391]" />}
              expandedSet={expandedSet} toggleKey={toggleKey} onOpenNewTable={onOpenNewTable}
              onOpenImport={onOpenImport} selectedDatabase={null} onSelectDatabase={() => {}}
              forceExpanded={isSearching}
            >
              {viewList.map((t) => (
                <TableNode
                  key={t.name}
                  connId={connId} db={db} table={t}
                  expandedSet={expandedSet} toggleKey={toggleKey}
                  onOpenNewTable={onOpenNewTable}
                  onOpenImport={onOpenImport}
                  onTableSelect={onTableSelect}
                  onNameDoubleClick={onNameDoubleClick}
                  onOpenTableDirectly={onOpenTableDirectly}
                  searchQuery={searchQuery}
                  showRowCount={showRowCount}
                  selectedNodeKey={selectedNodeKey}
                  setSelectedNodeKey={setSelectedNodeKey}
                />
              ))}
            </CategoryNode>
          )}

          {/* 검색 중이 아닐 때만 SP/Func/Event 카테고리 표시 */}
          {!isSearching && (
            <>
              <StoredObjectCategory
                connId={connId} db={db} category="procedures"
                label="프로시저"
                icon={<Wrench size={11} className="text-[#b794f4]" />}
                queryFn={() => ListProcedures(connId, db)}
                expandedSet={expandedSet} toggleKey={toggleKey}
                selectedNodeKey={selectedNodeKey} setSelectedNodeKey={setSelectedNodeKey}
              />
              <StoredObjectCategory
                connId={connId} db={db} category="functions"
                label="함수"
                icon={<FunctionSquare size={11} className="text-[#f6ad55]" />}
                queryFn={() => ListFunctions(connId, db)}
                expandedSet={expandedSet} toggleKey={toggleKey}
                selectedNodeKey={selectedNodeKey} setSelectedNodeKey={setSelectedNodeKey}
              />
              <StoredObjectCategory
                connId={connId} db={db} category="events"
                label="이벤트"
                icon={<Calendar size={11} className="text-[#fc8181]" />}
                queryFn={() => ListEvents(connId, db)}
                expandedSet={expandedSet} toggleKey={toggleKey}
                selectedNodeKey={selectedNodeKey} setSelectedNodeKey={setSelectedNodeKey}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Category 래퍼 노드 ────────────────────────────────────────────────────

function CategoryNode({
  connId, db, category, label, icon, badge2, children,
  expandedSet, toggleKey, onOpenNewTable, forceExpanded = false,
}: {
  connId: string; db: string; category: CategoryType
  label: string; icon: React.ReactNode
  /** 카테고리 합계 등을 표시할 보조 배지(테이블 카테고리의 디비 총 용량 등) */
  badge2?: string
  children: React.ReactNode
  forceExpanded?: boolean
} & Pick<CommonProps, 'expandedSet' | 'toggleKey' | 'onOpenNewTable' | 'onOpenImport' | 'selectedDatabase' | 'onSelectDatabase'>) {
  const key = `cat:${connId}:${db}:${category}`
  const expanded = expandedSet.has(key) || forceExpanded
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const { activeTabId, updateTab, queryTabs, addTab, selectedConnId } = useConnectionStore()

  function appendOrNewTab(sql: string) {
    if (!activeTabId) {
      addTab(selectedConnId, db, sql)
      return
    }
    const currentTab = queryTabs.find((t) => t.id === activeTabId)
    const currentSql = currentTab?.sql?.trim() ?? ''
    updateTab(activeTabId, { sql: currentSql ? `${currentSql}\n\n${sql}` : sql })
  }

  const createMenu: ContextMenuOption[] =
    category === 'tables'
      ? [{
          label: '테이블 생성',
          icon: <Plus size={11} className="text-[#4299e1]" />,
          onClick: () => onOpenNewTable(connId, db),
        }]
      : category === 'views'
      ? [{
          label: '뷰 생성',
          icon: <Plus size={11} className="text-[#68d391]" />,
          onClick: () =>
            appendOrNewTab(
              `CREATE OR REPLACE VIEW \`${db}\`.\`new_view\` AS\nSELECT\n  *\nFROM\n  ;`,
            ),
        }]
      : []

  return (
    <div>
      <TreeRow
        depth={1}
        icon={icon}
        label={label}
        badge2={badge2}
        osqlKey={key}
        isExpanded={expanded}
        hasChildren
        onChevronClick={() => toggleKey(key)}
        onClick={() => toggleKey(key)}
        onContextMenu={
          createMenu.length > 0
            ? (e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) }
            : undefined
        }
      />
      {expanded && children}
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={createMenu} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  )
}

// ─── Stored Object 카테고리 (SP/Func/Event) ───────────────────────────────

function StoredObjectCategory({
  connId, db, category, label, icon, queryFn,
  expandedSet, toggleKey,
  selectedNodeKey, setSelectedNodeKey,
}: {
  connId: string; db: string; category: CategoryType
  label: string; icon: React.ReactNode
  queryFn: () => Promise<ObjectInfo[]>
  expandedSet: Set<string>; toggleKey: (k: string) => void
  selectedNodeKey: string | null
  setSelectedNodeKey: (k: string | null) => void
}) {
  const key = `cat:${connId}:${db}:${category}`
  const expanded = expandedSet.has(key)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const { activeTabId, updateTab, queryTabs, addTab, selectedConnId } = useConnectionStore()

  const { data: objects, isLoading } = useQuery({
    queryKey: [category, connId, db],
    queryFn,
    enabled: expanded,
    staleTime: SCHEMA_STALE,
    gcTime: SCHEMA_GC,
  })

  function appendOrNewTab(sql: string) {
    if (!activeTabId) {
      addTab(selectedConnId, db, sql)
      return
    }
    const currentTab = queryTabs.find((t) => t.id === activeTabId)
    const currentSql = currentTab?.sql?.trim() ?? ''
    updateTab(activeTabId, { sql: currentSql ? `${currentSql}\n\n${sql}` : sql })
  }

  const createMenu: ContextMenuOption[] =
    category === 'procedures'
      ? [{
          label: '프로시저 생성',
          icon: <Plus size={11} className="text-[#b794f4]" />,
          onClick: () =>
            appendOrNewTab(
              `DELIMITER $$\n\n` +
              `CREATE PROCEDURE \`${db}\`.\`new_procedure\`(IN p_param INT)\n` +
              `BEGIN\n  -- TODO\nEND$$\n\n` +
              `DELIMITER ;`,
            ),
        }]
      : category === 'functions'
      ? [{
          label: '함수 생성',
          icon: <Plus size={11} className="text-[#f6ad55]" />,
          onClick: () =>
            appendOrNewTab(
              `DELIMITER $$\n\n` +
              `CREATE FUNCTION \`${db}\`.\`new_function\`(p_param INT) RETURNS INT\n` +
              `DETERMINISTIC\n` +
              `BEGIN\n  RETURN 0;\nEND$$\n\n` +
              `DELIMITER ;`,
            ),
        }]
      : category === 'events'
      ? [{
          label: '이벤트 생성',
          icon: <Plus size={11} className="text-[#fc8181]" />,
          onClick: () =>
            appendOrNewTab(
              `CREATE EVENT \`${db}\`.\`new_event\`\n` +
              `ON SCHEDULE EVERY 1 HOUR\n` +
              `STARTS CURRENT_TIMESTAMP\n` +
              `DO\nBEGIN\n  -- TODO\nEND;`,
            ),
        }]
      : []

  return (
    <div>
      <TreeRow
        depth={1}
        icon={icon}
        label={`${label} (${objects?.length ?? '...'})`}
        osqlKey={key}
        isExpanded={expanded}
        hasChildren
        isLoading={isLoading && expanded}
        onChevronClick={() => toggleKey(key)}
        onClick={() => toggleKey(key)}
        onContextMenu={
          createMenu.length > 0
            ? (e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) }
            : undefined
        }
      />
      {expanded && [...(objects ?? [])]
        .sort((a, b) => byNameCI(a.name, b.name))
        .map((obj) => (
          <StoredObjectNode
            key={obj.name}
            connId={connId} db={db}
            obj={obj}
            category={category}
            icon={icon}
            selectedNodeKey={selectedNodeKey}
            setSelectedNodeKey={setSelectedNodeKey}
          />
        ))}
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={createMenu} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  )
}

// ─── Stored Object 노드 (SP/Func/Event 개별) ─────────────────────────────

function StoredObjectNode({
  connId, db, obj, category, icon,
  selectedNodeKey, setSelectedNodeKey,
}: {
  connId: string; db: string; obj: ObjectInfo; category: CategoryType; icon: React.ReactNode
  selectedNodeKey: string | null
  setSelectedNodeKey: (k: string | null) => void
}) {
  const nodeKey = `obj:${connId}:${db}:${category}:${obj.name}`
  const isSelected = selectedNodeKey === nodeKey
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const { activeTabId, updateTab } = useConnectionStore()

  function injectSQL(sql: string) {
    if (!activeTabId) return
    updateTab(activeTabId, { sql })
  }

  function objTypeStr(): string {
    switch (category) {
      case 'procedures': return 'PROCEDURE'
      case 'functions': return 'FUNCTION'
      case 'events': return 'EVENT'
      default: return category.toUpperCase()
    }
  }

  async function showDDL() {
    try {
      const ddl = await GetObjectDDL(connId, db, objTypeStr(), obj.name)
      injectSQL(ddl)
    } catch {
      toast.error('DDL 조회 실패')
    }
  }

  const contextItems: ContextMenuOption[] = [
    {
      label: 'DDL 보기',
      icon: <Code size={11} />,
      onClick: showDDL,
    },
    {
      label: '이름 복사',
      icon: <Copy size={11} />,
      onClick: () => {
        navigator.clipboard.writeText(obj.name)
        toast.success('이름 복사됨')
      },
    },
    ...(category === 'procedures'
      ? [{ separator: true as const }, {
          label: 'CALL 실행',
          icon: <Play size={11} />,
          onClick: () => injectSQL(`CALL \`${db}\`.\`${obj.name}\`();`),
        }]
      : []),
    ...(category === 'functions'
      ? [{ separator: true as const }, {
          label: 'SELECT 실행',
          icon: <Play size={11} />,
          onClick: () => injectSQL(`SELECT \`${db}\`.\`${obj.name}\`();`),
        }]
      : []),
  ]

  return (
    <div>
      <TreeRow
        depth={2}
        icon={icon}
        label={obj.name}
        badge={obj.definer ? undefined : undefined}
        osqlKey={nodeKey}
        isSelected={isSelected}
        onClick={() => { setSelectedNodeKey(nodeKey); showDDL() }}
        onContextMenu={(e) => { e.preventDefault(); setSelectedNodeKey(nodeKey); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
      />
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          items={contextItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}

// ─── Table 노드 ──────────────────────────────────────────────────────────

interface TableNodeProps {
  connId: string
  db: string
  table: TableInfo
  expandedSet: Set<string>
  toggleKey: (key: string) => void
  /** 신규 테이블 생성 — 카테고리 'tables' 와 동일하게 props 로 받지만 TableNode 내부에서는 직접 사용하지 않음 (자식 트리거 전용) */
  onOpenNewTable: (connId: string, db: string) => void
  onOpenImport: (connId: string, db: string, table: string) => void
  onTableSelect?: (connId: string, db: string, table: TableInfo) => void
  onNameDoubleClick?: (text: string, connId: string, db: string) => void
  onOpenTableDirectly?: (connId: string, db: string, tableName: string) => void
  searchQuery?: string
  showRowCount?: boolean
  selectedNodeKey: string | null
  setSelectedNodeKey: (k: string | null) => void
}

function TableNode({ connId, db, table, expandedSet, toggleKey, onOpenImport, onTableSelect, onNameDoubleClick, onOpenTableDirectly, searchQuery = '', showRowCount = false, selectedNodeKey, setSelectedNodeKey }: TableNodeProps) {
  const language = useLanguageStore((s) => s.language)
  const key = `table:${connId}:${db}:${table.name}`
  const expanded = expandedSet.has(key)
  const isView = table.type === 'VIEW'
  const isSelected = selectedNodeKey === key

  const { data: columns, isLoading } = useQuery({
    queryKey: ['columns', connId, db, table.name],
    queryFn: () => ListColumns(connId, db, table.name),
    enabled: expanded,
    staleTime: COL_STALE,
    gcTime: SCHEMA_GC,
  })
  const { activeTabId, updateTab, queryTabs } = useConnectionStore()
  const selectLimit = useSettingsStore((s) => s.settings.query.selectLimit)
  const queryClient = useQueryClient()
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  // 트리거는 테이블 하위에 lazy
  const [showTriggers, setShowTriggers] = useState(false)
  const { data: triggers, isLoading: triggersLoading } = useQuery({
    queryKey: ['triggers', connId, db, table.name],
    queryFn: () => ListTriggers(connId, db, table.name),
    enabled: showTriggers,
    staleTime: COL_STALE,
    gcTime: SCHEMA_GC,
  })

  const { selectedConnId, addTab } = useConnectionStore()

  /** DDL 등 현재 탭 SQL을 완전히 교체 */
  function injectSQL(sql: string) {
    if (!activeTabId) return
    updateTab(activeTabId, { sql })
  }

  /** SELECT TOP / COUNT 등: 현재 탭에 내용이 있으면 뒤에 추가, 없으면 새 탭 생성 */
  function appendOrNewTab(sql: string) {
    if (!activeTabId) {
      addTab(selectedConnId, db, sql)
      return
    }
    const currentTab = queryTabs.find(t => t.id === activeTabId)
    const currentSql = currentTab?.sql?.trim() ?? ''
    if (currentSql) {
      updateTab(activeTabId, { sql: currentSql + '\n\n' + sql })
    } else {
      updateTab(activeTabId, { sql })
    }
  }

  async function showDDL() {
    try {
      const ddl = await GetTableDDL(connId, db, table.name)
      injectSQL(ddl)
    } catch {
      toast.error('DDL 조회 실패')
    }
  }

  async function openTable() {
    // Open Table: 새 탭 생성 후 즉시 실행
    if (onOpenTableDirectly) {
      onOpenTableDirectly(connId, db, table.name)
    } else {
      // fallback: 탭에 SQL만 삽입
      const sql = `SELECT * FROM \`${db}\`.\`${table.name}\` LIMIT ${selectLimit};`
      addTab(selectedConnId, db, sql)
    }
  }

  async function truncateTable() {
    const ok = await nativeConfirm({
      title: t('truncateTitle', language),
      message: t('truncateBody', language).replace('{name}', table.name),
      language,
    })
    if (!ok) return
    try {
      // BugFix-CW: Messages 영역에 누적
      await runLoggedQuery({
        connId,
        database: db,
        sql: `TRUNCATE TABLE \`${db}\`.\`${table.name}\`;`,
        sourceLabel: t('qlLabelTruncate', language),
      })
      toast.success(`${table.name} TRUNCATE 완료`)
    } catch (e) {
      toast.error(`TRUNCATE 실패: ${e}`)
    }
  }

  async function dropTable() {
    const input = prompt(`DROP TABLE을 실행하려면 테이블명 '${table.name}'을 입력하세요:`)
    if (input !== table.name) { toast.error('취소됨 — 테이블명이 일치하지 않습니다'); return }
    try {
      await runLoggedQuery({
        connId,
        database: db,
        sql: `DROP TABLE \`${db}\`.\`${table.name}\`;`,
        sourceLabel: t('qlLabelDrop', language),
      })
      toast.success(`${table.name} DROP 완료`)
      queryClient.invalidateQueries({ queryKey: ['tables', connId, db] })
    } catch (e) {
      toast.error(`DROP 실패: ${e}`)
    }
  }

  async function renameTable() {
    const newName = prompt('새 테이블명:', table.name)
    if (!newName || newName === table.name) return
    try {
      await RenameTable(connId, db, table.name, newName)
      toast.success(`${table.name} → ${newName} 이름 변경 완료`)
      queryClient.invalidateQueries({ queryKey: ['tables', connId, db] })
    } catch (e) {
      toast.error(`이름 변경 실패: ${e}`)
    }
  }

  async function copyTableStructure() {
    const newName = prompt('복사할 테이블명:', `${table.name}_copy`)
    if (!newName) return
    try {
      await CopyTable(connId, db, table.name, newName, false)
      toast.success(`${table.name} → ${newName} 구조 복사 완료`)
      queryClient.invalidateQueries({ queryKey: ['tables', connId, db] })
    } catch (e) {
      toast.error(`복사 실패: ${e}`)
    }
  }

  async function copyTableWithData() {
    const newName = prompt('복사할 테이블명:', `${table.name}_copy`)
    if (!newName) return
    try {
      await CopyTable(connId, db, table.name, newName, true)
      toast.success(`${table.name} → ${newName} 데이터 포함 복사 완료`)
      queryClient.invalidateQueries({ queryKey: ['tables', connId, db] })
    } catch (e) {
      toast.error(`복사 실패: ${e}`)
    }
  }

  async function exportData(format: 'csv' | 'json' | 'sql') {
    try {
      const data = await ExportTableData(connId, db, table.name, format, 0)
      const mimeMap = { csv: 'text/csv', json: 'application/json', sql: 'text/plain' }
      const blob = new Blob([data], { type: mimeMap[format] })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${table.name}.${format}`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`${table.name}.${format} 내보내기 완료`)
    } catch (e) {
      toast.error(`내보내기 실패: ${e}`)
    }
  }

  const contextItems: ContextMenuOption[] = [
    {
      label: 'Open Table',
      icon: <Play size={11} />,
      onClick: openTable,
    },
    {
      label: `SELECT TOP ${selectLimit.toLocaleString()}`,
      icon: <Play size={11} />,
      onClick: () => appendOrNewTab(`SELECT *\nFROM \`${db}\`.\`${table.name}\`\nLIMIT ${selectLimit};`),
    },
    {
      label: 'SELECT COUNT(*)',
      icon: <Play size={11} />,
      onClick: () => appendOrNewTab(`SELECT COUNT(*) FROM \`${db}\`.\`${table.name}\`;`),
    },
    { separator: true },
    {
      label: 'Show DDL',
      icon: <Code size={11} />,
      onClick: showDDL,
    },
    ...(!isView ? [{
      label: 'Table Designer',
      icon: <Settings size={11} />,
      onClick: () => onTableSelect?.(connId, db, table),
    }] : []),
    { separator: true },
    {
      label: '테이블명 복사',
      icon: <Copy size={11} />,
      onClick: () => {
        navigator.clipboard.writeText(`\`${db}\`.\`${table.name}\``)
        toast.success('테이블명 복사됨')
      },
    },
    { separator: true as const },
    {
      label: '데이터 가져오기 (CSV)',
      icon: <Upload size={11} className="text-[#4299e1]" />,
      onClick: () => onOpenImport(connId, db, table.name),
    },
    { separator: true as const },
    {
      label: '데이터 내보내기 (CSV)',
      icon: <Download size={11} className="text-[#68d391]" />,
      onClick: () => exportData('csv'),
    },
    {
      label: '데이터 내보내기 (JSON)',
      icon: <Download size={11} className="text-[#68d391]" />,
      onClick: () => exportData('json'),
    },
    {
      label: '데이터 내보내기 (SQL INSERT)',
      icon: <Download size={11} className="text-[#68d391]" />,
      onClick: () => exportData('sql'),
    },
    ...(!isView ? [
      { separator: true as const },
      {
        label: '테이블 이름 변경',
        icon: <Pencil size={11} className="text-[#a0aec0]" />,
        onClick: renameTable,
      },
      {
        label: '테이블 복사 (구조만)',
        icon: <CopyPlus size={11} className="text-[#4299e1]" />,
        onClick: copyTableStructure,
      },
      {
        label: '테이블 복사 (데이터 포함)',
        icon: <CopyPlus size={11} className="text-[#68d391]" />,
        onClick: copyTableWithData,
      },
      { separator: true as const },
      {
        label: `트리거 (${triggers?.length ?? '...'})`,
        icon: <Zap size={11} />,
        onClick: () => setShowTriggers((v) => !v),
      },
      { separator: true as const },
      {
        label: 'TRUNCATE TABLE',
        icon: <RefreshCw size={11} className="text-[#f6ad55]" />,
        onClick: truncateTable,
      },
      {
        label: 'DROP TABLE',
        icon: <Trash2 size={11} className="text-[#fc8181]" />,
        onClick: dropTable,
      },
    ] : []),
  ]

  return (
    <div>
      <TreeRow
        depth={2}
        icon={isView
          ? <Eye size={12} className="text-[#68d391]" />
          : <Table2 size={12} className="text-[#4299e1]" />
        }
        label={table.name}
        labelNode={<HighlightText text={table.name} query={searchQuery} />}
        badge={showRowCount && table.rows > 0 ? table.rows.toLocaleString() : undefined}
        badge2={!showRowCount && table.sizeBytes > 0 ? formatSize(table.sizeBytes) : undefined}
        osqlKey={key}
        isSelected={isSelected}
        isExpanded={expanded}
        hasChildren
        isLoading={isLoading && expanded}
        onChevronClick={() => toggleKey(key)}
        onClick={() => { setSelectedNodeKey(key); onTableSelect?.(connId, db, table) }}
        onDoubleClick={() => onNameDoubleClick?.(`\`${db}\`.\`${table.name}\``, connId, db)}
        onContextMenu={(e) => { e.preventDefault(); setSelectedNodeKey(key); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
      />
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          items={contextItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {expanded && columns?.map((col) => (
        <ColumnNode key={col.name} col={col} />
      ))}
      {/* 트리거 서브노드 */}
      {showTriggers && (
        <div>
          <TreeRow
            depth={2}
            icon={<Zap size={11} className="text-[#fc8181]" />}
            label={triggersLoading ? '로딩...' : `트리거 (${triggers?.length ?? 0})`}
            isLoading={triggersLoading}
            hasChildren={false}
          />
          {triggers && [...triggers]
            .sort((a, b) => byNameCI(a.name, b.name))
            .map((trig) => (
              <TriggerNode
                key={trig.name}
                connId={connId} db={db} table={table.name} trig={trig}
                selectedNodeKey={selectedNodeKey}
                setSelectedNodeKey={setSelectedNodeKey}
              />
            ))}
        </div>
      )}
    </div>
  )
}

// ─── Trigger 노드 ────────────────────────────────────────────────────────

function TriggerNode({
  connId, db, table, trig,
  selectedNodeKey, setSelectedNodeKey,
}: {
  connId: string; db: string; table: string; trig: ObjectInfo
  selectedNodeKey: string | null
  setSelectedNodeKey: (k: string | null) => void
}) {
  const nodeKey = `trig:${connId}:${db}:${table}:${trig.name}`
  const isSelected = selectedNodeKey === nodeKey
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const { activeTabId, updateTab } = useConnectionStore()

  async function showDDL() {
    try {
      const ddl = await GetObjectDDL(connId, db, 'TRIGGER', trig.name)
      if (activeTabId) updateTab(activeTabId, { sql: ddl })
    } catch {
      toast.error('DDL 조회 실패')
    }
  }

  const contextItems: ContextMenuOption[] = [
    { label: 'DDL 보기', icon: <Code size={11} />, onClick: showDDL },
    { label: '이름 복사', icon: <Copy size={11} />, onClick: () => {
      navigator.clipboard.writeText(trig.name)
      toast.success('이름 복사됨')
    }},
  ]

  return (
    <div>
      <TreeRow
        depth={3}
        icon={<GitBranch size={11} className="text-[#fc8181]" />}
        label={trig.name}
        osqlKey={nodeKey}
        isSelected={isSelected}
        onClick={() => { setSelectedNodeKey(nodeKey); showDDL() }}
        onContextMenu={(e) => { e.preventDefault(); setSelectedNodeKey(nodeKey); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
      />
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={contextItems} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  )
}

// ─── Column 노드 ─────────────────────────────────────────────────────────

function ColumnNode({ col }: { col: ColumnInfo }) {
  return (
    <TreeRow
      depth={3}
      icon={<Columns size={11} className="text-[#718096]" />}
      label={col.name}
      osqlKey={`col:${col.name}`}
      badge={col.dataType}
      badgeColor={col.key === 'PRI' ? '#f6ad55' : undefined}
    />
  )
}

// ─── 테마 컨텍스트 (SchemaTree 내부 전용) ────────────────────────────────
import React from 'react'
const DarkCtx = React.createContext(true)

// ─── 공통 TreeRow ─────────────────────────────────────────────────────────

interface TreeRowProps {
  depth: number
  icon: React.ReactNode
  label: string
  /** label 대신 렌더링할 ReactNode (하이라이트 텍스트 등) */
  labelNode?: React.ReactNode
  badge?: string
  /** 두 번째 배지 (용량 표시용) */
  badge2?: string
  badgeColor?: string
  isSelected?: boolean
  isExpanded?: boolean
  hasChildren?: boolean
  isLoading?: boolean
  /** 체브론(화살표) 클릭 — 트리 확장/축소 전용 */
  onChevronClick?: () => void
  /** 라벨 클릭 — 선택 동작 */
  onClick?: () => void
  /** 라벨 더블클릭 — 에디터에 텍스트 삽입 */
  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  /** 디버깅용 식별자 — DOM 검사 시 행 종류/대상 식별 (예: 'db:connId:dbName', 'table:...') */
  osqlKey?: string
}

function TreeRow({
  depth, icon, label, labelNode, badge, badge2, badgeColor, isSelected, isExpanded,
  hasChildren, isLoading, onChevronClick, onClick, onDoubleClick, onContextMenu, osqlKey,
}: TreeRowProps) {
  const isDark = React.useContext(DarkCtx)
  const selectedBg  = isDark ? 'bg-[#252b3b]'   : 'bg-[#dce6f5]'
  const hoverBg     = isDark ? 'hover:bg-[#1e2230]' : 'hover:bg-[#edf1f7]'
  const labelColor  = isDark ? 'text-[#e2e8f0]'  : 'text-[#1e293b]'
  const chevronColor = isDark ? 'text-[#718096]'  : 'text-[#94a3b8]'
  return (
    <div
      className={`osql-schema-tree-row flex items-center gap-1 py-[3px] cursor-pointer select-none transition-colors
        ${isSelected ? selectedBg : hoverBg}`}
      style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: '8px' }}
      data-osql-key={osqlKey}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {/* 체브론: 클릭 시 확장/축소만, 라벨 onClick 이벤트 전파 차단 */}
      <span
        className="shrink-0 w-3 h-3 flex items-center justify-center"
        onClick={(e) => {
          if (onChevronClick) {
            e.stopPropagation()
            onChevronClick()
          }
        }}
      >
        {isLoading ? (
          <Loader2 size={10} className={`animate-spin ${chevronColor}`} />
        ) : hasChildren ? (
          isExpanded
            ? <ChevronDown size={10} className={chevronColor} />
            : <ChevronRight size={10} className={chevronColor} />
        ) : null}
      </span>
      <span className="shrink-0">{icon}</span>
      <span className={`flex-1 truncate text-[11px] ${labelColor}`}>{labelNode ?? label}</span>
      {badge2 && (
        <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${isDark ? 'text-[#4a8c6a] bg-[#4a8c6a]/15' : 'text-[#047857] bg-[#d1fae5]'}`}>
          {badge2}
        </span>
      )}
      {badge && (
        <span
          className="text-[9px] px-1 py-0.5 rounded shrink-0"
          style={{ color: badgeColor ?? (isDark ? '#718096' : '#64748b'), background: (badgeColor ?? (isDark ? '#718096' : '#94a3b8')) + '22' }}
        >
          {badge}
        </span>
      )}
    </div>
  )
}

// ─── 검색 하이라이트 ─────────────────────────────────────────────────────

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-[#f6ad55]/25 text-[#f6ad55] rounded-[2px]">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  )
}

