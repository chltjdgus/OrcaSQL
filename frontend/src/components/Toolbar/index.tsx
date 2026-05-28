import { format } from 'sql-formatter'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Play, SquarePlay, Square, Plus, AlignLeft, Clock, RefreshCw, Star, Sun, Moon, ChevronDown, Database, Search, Server, Link2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useConnectionStore } from '@/stores/connectionStore'
import { useThemeStore } from '@/stores/useThemeStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import { CancelQuery, ListDatabases, GetSavedConnections, ConnectNew, UpdateConnectionLastUsed } from '@/wailsjs/go/main/App'
import { logMsg } from '@/stores/useMessagesLogStore'
import SessionManager from '@/components/SessionManager'
import type { ConnectConfig } from '@/types'

const SCHEMA_STALE = 5 * 60 * 1000
const SCHEMA_GC    = 30 * 60 * 1000

interface Props {
  onExecute: () => void
  /** 선택 영역만 실행 — 선택 없으면 호출 측에서 전체로 fallback. */
  onExecuteSelection?: () => void
  onGetSQL: () => string
  onSetSQL: (sql: string) => void
  onShowHistory: () => void
  onShowFavorites?: () => void
  showFavorites?: boolean
  /** 도구 탭이 활성화된 경우 쿼리 실행 비활성화 */
  activeToolTab?: string | null
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/**
 * SQLyog 스타일 툴바.
 * 연결/DB 선택 드롭다운, 실행/정지, 새탭, SQL포맷, 히스토리, 즐겨찾기, 테마 버튼 포함.
 */
export default function Toolbar({
  onExecute, onExecuteSelection, onGetSQL, onSetSQL, onShowHistory, onShowFavorites, showFavorites, activeToolTab,
}: Props) {
  const {
    activeConnections,
    selectedConnId,
    selectedDatabase,
    setSelectedConn,
    setSelectedDatabase,
    addTab,
  } = useConnectionStore()
  const { theme, toggleTheme } = useThemeStore()
  const formatter = useSettingsStore((s) => s.settings.formatter)
  const { language } = useLanguageStore()

  const activeTabId = useConnectionStore((s) => s.activeTabId)
  const activeTab = useConnectionStore((s) =>
    s.queryTabs.find((t) => t.id === s.activeTabId)
  )
  const isRunning = activeTab?.isRunning ?? false

  // ─── SessionManager + QuickConnect 상태 ──────────────────────────────────
  const [showSessionMgr, setShowSessionMgr] = useState(false)
  const [showQuickDrop, setShowQuickDrop] = useState(false)
  const [savedConns, setSavedConns] = useState<ConnectConfig[]>([])
  const [quickFilter, setQuickFilter] = useState('')
  const quickDropRef = useRef<HTMLDivElement>(null)
  const { addActiveConnection, setSavedConnections } = useConnectionStore()

  // QuickConnect 드롭다운 열릴 때 세션 목록 로드
  async function openQuickDrop() {
    try {
      const cs = await GetSavedConnections()
      setSavedConns(cs ?? [])
      setSavedConnections(cs ?? [])
    } catch (e) {
      toast.error(`${t('toastConnListFail', language)} ${e}`)
    }
    setShowQuickDrop(true)
    setQuickFilter('')
  }

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    if (!showQuickDrop) return
    const handler = (e: MouseEvent) => {
      if (quickDropRef.current && !quickDropRef.current.contains(e.target as Node)) {
        setShowQuickDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showQuickDrop])

  async function handleQuickConnect(cfg: ConnectConfig) {
    setShowQuickDrop(false)
    // BugFix-CX: 같은 창에 host+port+user 가 같은 활성 세션이 있으면 기존 탭으로 전환.
    // (이전 BugFix-BA 의 "매번 새 탭" 정책은 MCP 활성 판별 충돌을 유발 → 같은 창 내 중복 금지로 회귀)
    const dup = useConnectionStore.getState().findActiveDuplicate(cfg.host, cfg.port, cfg.user)
    if (dup) {
      useConnectionStore.getState().setActiveSession(dup.id)
      toast(t('toastDuplicateSwitched', language))
      logMsg({ kind: 'connection', level: 'info', title: `기존 탭으로 전환: ${dup.name}`, connName: dup.name })
      return
    }
    try {
      const connId = await ConnectNew(cfg)
      await UpdateConnectionLastUsed(cfg.id)
      addActiveConnection({ id: connId, cfgId: cfg.id, name: cfg.name, host: cfg.host, port: cfg.port, user: cfg.user, database: cfg.database, connectedAt: new Date().toISOString() })
      setSelectedConn(connId)
      toast.success(`${cfg.name} ${t('toastConnectedSuffix', language)}`)
      logMsg({ kind: 'connection', level: 'success', title: `연결됨: ${cfg.name}`, connName: cfg.name })
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      toast.error(`${t('toastConnFail', language)} ${errMsg}`)
      logMsg({ kind: 'connection', level: 'error', title: `연결 실패: ${cfg.name}`, detail: errMsg, connName: cfg.name })
    }
  }

  const filteredSaved = quickFilter
    ? savedConns.filter((c) => c.name.toLowerCase().includes(quickFilter.toLowerCase()) || c.host.toLowerCase().includes(quickFilter.toLowerCase()))
    : savedConns

  async function handleCancel() {
    if (!activeTabId) return
    try {
      await CancelQuery(activeTabId)
      toast.success(t('toastCancelQuery', language))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`${t('toastCancelFail', language)} ${msg}`)
    }
  }

  const handleFormat = useCallback(() => {
    const sql = onGetSQL()
    if (!sql.trim()) return
    try {
      // 환경설정 → SQL 포매터 탭에서 설정한 옵션을 그대로 사용
      const formatted = format(sql, {
        language: formatter.dialect,
        tabWidth: formatter.tabWidth,
        useTabs: formatter.useTabs,
        keywordCase: formatter.keywordCase,
        identifierCase: formatter.identifierCase,
        dataTypeCase: formatter.dataTypeCase,
        functionCase: formatter.functionCase,
        indentStyle: formatter.indentStyle,
        logicalOperatorNewline: formatter.logicalOperatorNewline,
        expressionWidth: formatter.expressionWidth,
        linesBetweenQueries: formatter.linesBetweenQueries,
        denseOperators: formatter.denseOperators,
        newlineBeforeSemicolon: formatter.newlineBeforeSemicolon,
      })
      onSetSQL(formatted)
      toast.success(t('toastFormatOk', language))
    } catch {
      toast.error(t('toastFormatFail', language))
    }
  }, [onGetSQL, onSetSQL, formatter, language])

  // MenuBar 'Query > Format SQL' 및 Ctrl+Shift+F 단축키 이벤트 수신
  useEffect(() => {
    window.addEventListener('query:format', handleFormat)
    return () => window.removeEventListener('query:format', handleFormat)
  }, [handleFormat])

  // MenuBar 'File > New Connection' 및 Ctrl+Shift+N 이벤트 수신
  useEffect(() => {
    const handler = () => setShowSessionMgr(true)
    window.addEventListener('session:open', handler)
    return () => window.removeEventListener('session:open', handler)
  }, [])

  // ── Toolbar 테마 색상 ─────────────────────────────────────────────────────
  const isDark = theme === 'dark'
  const toolbarBg  = isDark ? 'bg-[#161b27] border-[#2d3748]' : 'bg-[#f3f4f6] border-[#e5e7eb]'
  const dividerCls = isDark ? 'bg-[#2d3748]' : 'bg-[#d1d5db]'
  const iconBtnCls = isDark
    ? 'text-[#718096] hover:bg-[#2d3748] hover:text-[#4299e1]'
    : 'text-[#6b7280] hover:bg-[#e5e7eb] hover:text-[#4299e1]'
  const dropBg    = isDark ? 'bg-[#161b27] border-[#2d3748]' : 'bg-white border-[#d1d5db]'
  const dropInput = isDark ? 'bg-[#0f1117] border-[#2d3748] text-[#e2e8f0]' : 'bg-[#f9fafb] border-[#d1d5db] text-[#111827]'
  const dropItemHover = isDark ? 'hover:bg-[#2d3748]' : 'hover:bg-[#f3f4f6]'
  const dropItemText  = isDark ? 'text-[#e2e8f0]' : 'text-[#111827]'
  const dropSubText   = isDark ? 'text-[#4a5568]' : 'text-[#9ca3af]'
  const quickDropBtn  = isDark
    ? `hover:bg-[#2d3748] text-[#718096] hover:text-[#a0aec0] ${showQuickDrop ? 'bg-[#2d3748] text-[#a0aec0]' : ''}`
    : `hover:bg-[#e5e7eb] text-[#9ca3af] hover:text-[#374151] ${showQuickDrop ? 'bg-[#e5e7eb] text-[#374151]' : ''}`

  return (
    <>
    <div className={`osql-toolbar flex items-center gap-1 px-3 h-10 border-b shrink-0 select-none ${toolbarBg}`}>
      {/* 연결 관리 아이콘 — 세션 매니저 열기 */}
      <button
        onClick={() => setShowSessionMgr(true)}
        title={t('titleSessionMgr', language)}
        className={`p-1.5 rounded transition-colors ${iconBtnCls}`}
      >
        <Link2 size={14} />
      </button>

      {/* 빠른 연결 드롭다운 */}
      <div className="relative" ref={quickDropRef}>
        <button
          onClick={() => (showQuickDrop ? setShowQuickDrop(false) : openQuickDrop())}
          title={t('titleQuickConnect', language)}
          className={`p-1 rounded transition-colors ${quickDropBtn}`}
        >
          <ChevronDown size={13} />
        </button>
        {showQuickDrop && (
          <div className={`absolute top-full left-0 mt-1 z-50 w-64 border rounded-lg shadow-xl overflow-hidden ${dropBg}`}>
            <div className={`p-1.5 border-b ${isDark ? 'border-[#2d3748]' : 'border-[#e5e7eb]'}`}>
              <div className={`flex items-center gap-1 border rounded px-2 py-1 ${dropInput}`}>
                <Search size={11} className={`shrink-0 ${isDark ? 'text-[#4a5568]' : 'text-[#9ca3af]'}`} />
                <input
                  autoFocus
                  value={quickFilter}
                  onChange={(e) => setQuickFilter(e.target.value)}
                  placeholder={t('phSearchSession', language)}
                  className={`flex-1 bg-transparent text-[11px] focus:outline-none placeholder-[#9ca3af] ${isDark ? 'text-[#e2e8f0]' : 'text-[#111827]'}`}
                />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {filteredSaved.length === 0 && (
                <div className={`text-[11px] text-center py-4 ${isDark ? 'text-[#4a5568]' : 'text-[#9ca3af]'}`}>{t('labelNoSession', language)}</div>
              )}
              {filteredSaved.map((cfg) => {
                // BugFix-BA: connId 는 매 연결마다 고유 → 저장 cfg.id 매칭은 cfgId 로
                const isActive = activeConnections.some((c) => c.cfgId === cfg.id)
                return (
                  <button
                    key={cfg.id}
                    onClick={() => handleQuickConnect(cfg)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${dropItemHover}`}
                  >
                    {cfg.color
                      ? <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
                      : <Server size={12} className={`shrink-0 ${isDark ? 'text-[#718096]' : 'text-[#9ca3af]'}`} />
                    }
                    <div className="flex-1 min-w-0">
                      <div className={`text-[11px] truncate ${dropItemText}`}>{cfg.name}</div>
                      <div className={`text-[9px] truncate ${dropSubText}`}>{cfg.user}@{cfg.host}:{cfg.port}</div>
                    </div>
                    {isActive && <span className="text-[9px] text-[#48bb78] shrink-0">{t('labelConnected', language)}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* DB 선택 — 검색 가능한 드롭다운 */}
      <DbSelector
        connId={selectedConnId}
        value={selectedDatabase}
        onChange={setSelectedDatabase}
      />

      <div className={`w-px h-5 mx-1 ${dividerCls}`} />

      {/* 실행 취소 (쿼리 진행 중일 때만 활성) */}
      <ToolBtn onClick={handleCancel} title={t('titleStopQuery', language)} danger disabled={!isRunning}>
        <Square size={14} />
      </ToolBtn>

      {/* 쿼리 실행 (전체) */}
      <ToolBtn onClick={onExecute} title={`${t('titleRunQuery', language)} (F9)`} active disabled={isRunning || !!activeToolTab || !activeTab?.sql?.trim()}>
        <Play size={14} />
      </ToolBtn>

      {/* 쿼리 실행 (선택 영역) */}
      {onExecuteSelection && (
        <ToolBtn
          onClick={onExecuteSelection}
          title={`${t('menuExecuteSelection', language)} (${isMac ? '⌘F9' : 'Ctrl+F9'})`}
          disabled={isRunning || !!activeToolTab || !activeTab?.sql?.trim()}
        >
          <SquarePlay size={14} />
        </ToolBtn>
      )}

      {/* 새 탭 */}
      <ToolBtn
        onClick={() => addTab(selectedConnId ?? undefined, selectedDatabase ?? undefined)}
        title={`${t('titleNewQueryTab', language)} (⌘T)`}
      >
        <Plus size={14} />
      </ToolBtn>

      <div className={`w-px h-5 mx-1 ${dividerCls}`} />

      {/* SQL 포맷 */}
      <ToolBtn onClick={handleFormat} title={`${t('titleFormatSQL', language)} (⌘⇧F)`}>
        <AlignLeft size={14} />
        <span className="text-[11px]">{t('labelFormat', language)}</span>
      </ToolBtn>

      {/* 히스토리 */}
      <ToolBtn onClick={onShowHistory} title={t('titleQueryHistory', language)}>
        <Clock size={14} />
      </ToolBtn>

      {/* 즐겨찾기 */}
      <ToolBtn
        onClick={() => onShowFavorites?.()}
        title={`${t('titleFavorites', language)} (⌘⇧B)`}
        active={showFavorites}
      >
        <Star size={14} className={showFavorites ? 'fill-[#f6e05e] text-[#f6e05e]' : ''} />
      </ToolBtn>

      {/* 스키마 새로고침 */}
      <ToolBtn onClick={() => window.dispatchEvent(new CustomEvent('schema:refresh'))} title={`${t('titleRefreshSchema', language)} (F5)`}>
        <RefreshCw size={13} />
      </ToolBtn>

      {/* 우측: 테마 토글 */}
      <div className="ml-auto flex items-center gap-2">
        <ToolBtn onClick={toggleTheme} title={theme === 'dark' ? t('titleLightMode', language) : t('titleDarkMode', language)}>
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </ToolBtn>
      </div>
    </div>
    {/* 세션 관리 모달 */}
    {showSessionMgr && <SessionManager onClose={() => setShowSessionMgr(false)} />}
    </>
  )
}

// ─── DB 검색 가능 셀렉터 ────────────────────────────────────────────────────

function DbSelector({
  connId,
  value,
  onChange,
}: {
  connId: string | null
  value: string | null
  onChange: (db: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { language } = useLanguageStore()

  const { data: databases = [] } = useQuery({
    queryKey: ['databases', connId],
    queryFn: () => ListDatabases(connId!),
    enabled: !!connId,
    staleTime: SCHEMA_STALE,
    gcTime: SCHEMA_GC,
  })

  // BugFix-T: 세션 cfg.databases 가 설정되어 있으면 그 목록만 노출 (강제 필터)
  // 비어있거나 미정 → 기존대로 전체 노출 (하위 호환)
  // BugFix-BP: 활성 connId 는 ConnectNew 휘발 UUID(BugFix-BA) → cfgId 로 조회해야 saved cfg 매칭됨.
  const allowed = useConnectionStore((s) => {
    if (!connId) return undefined
    const cfgId = s.activeConnections.find((c) => c.id === connId)?.cfgId
    const lookupId = cfgId ?? connId
    return s.savedConnections.find((c) => c.id === lookupId)?.databases
  })
  const visible = allowed && allowed.length > 0
    ? databases.filter((d) => allowed.includes(d))
    : databases

  const filtered = visible.filter((db) =>
    db.toLowerCase().includes(search.toLowerCase())
  )

  const handleOpen = useCallback(() => {
    if (!connId) return
    setSearch('')
    setOpen(true)
    // 드롭다운 열리면 검색창에 포커스
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [connId])

  const handleSelect = useCallback((db: string) => {
    onChange(db)
    setOpen(false)
    setSearch('')
  }, [onChange])

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(null)
    setOpen(false)
    setSearch('')
  }, [onChange])

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ESC 키 닫기
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); setSearch('') }
    else if (e.key === 'Enter' && filtered.length === 1) { handleSelect(filtered[0]) }
  }, [filtered, handleSelect])

  return (
    <div ref={wrapRef} className="relative">
      {/* 트리거 버튼 */}
      <button
        onClick={open ? () => { setOpen(false); setSearch('') } : handleOpen}
        disabled={!connId}
        title={t('titleDbSelect', language)}
        className={[
          'flex items-center gap-1 h-7 px-2 text-xs rounded border transition-colors',
          'bg-[var(--color-bg-primary)] border-[var(--color-border)] focus:outline-none',
          open ? 'border-[var(--color-accent)]' : 'hover:border-[var(--color-text-muted)]',
          !connId ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
          value ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]',
          'w-36',
        ].join(' ')}
      >
        <Database size={11} className="shrink-0 text-[var(--color-text-muted)]" />
        <span className="flex-1 text-left truncate min-w-0">
          {value ?? t('labelDatabase', language)}
        </span>
        <ChevronDown
          size={10}
          className={`shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* 드롭다운 */}
      {open && (
        <div className="absolute left-0 top-full mt-0.5 z-50 w-52 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-xl">
          {/* 검색 인풋 */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--color-border)]">
            <Search size={11} className="shrink-0 text-[var(--color-text-muted)]" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('phSearchDb', language)}
              className="flex-1 bg-transparent text-[11px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none"
            />
          </div>

          {/* DB 목록 */}
          <div className="max-h-48 overflow-y-auto">
            {/* 선택 해제 옵션 */}
            {value && (
              <button
                onClick={handleClear}
                className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] italic"
              >
                {t('labelDeselectDb', language)}
              </button>
            )}

            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
                {databases.length === 0 ? t('labelLoading', language) : t('labelNoResult', language)}
              </div>
            ) : (
              filtered.map((db) => (
                <button
                  key={db}
                  onClick={() => handleSelect(db)}
                  className={[
                    'w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-1.5 transition-colors',
                    db === value
                      ? 'bg-[var(--color-bg-selected)] text-[var(--color-accent-light)]'
                      : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]',
                  ].join(' ')}
                >
                  <Database size={10} className="shrink-0 text-[var(--color-warning)]" />
                  <span className="truncate">{db}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 소형 컴포넌트 ────────────────────────────────────────────────────────

function ToolBtn({
  children,
  onClick,
  title,
  danger,
  disabled,
  active,
}: {
  children: React.ReactNode
  onClick: () => void
  title?: string
  danger?: boolean
  disabled?: boolean
  active?: boolean
}) {
  const base = 'flex items-center gap-1 justify-center rounded px-2 py-1 text-xs transition-colors'
  const cls = `${base} ${
    disabled ? 'opacity-40 cursor-not-allowed text-[#4a5568]' :
    danger   ? 'text-[#fc8181] hover:bg-[#fc8181]/10' :
    active   ? 'bg-[#4299e1]/20 text-[#4299e1]' :
               'text-[#a0aec0] hover:bg-[#2d3748] hover:text-[#e2e8f0]'
  }`
  return (
    <button
      onClick={!disabled ? onClick : undefined}
      title={title}
      disabled={disabled}
      className={cls}
    >
      {children}
    </button>
  )
}
