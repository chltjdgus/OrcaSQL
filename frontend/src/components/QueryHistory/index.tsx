import { useState, useDeferredValue } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, Trash2, RotateCcw, AlertCircle, CheckCircle, X, Copy, ChevronDown, ChevronRight, ArrowDownUp, Loader2, Plug } from 'lucide-react'
import toast from 'react-hot-toast'
import { GetHistoryDates, GetHistoryByDate, SearchHistory, DeleteHistoryEntry, ClearHistory } from '@/wailsjs/go/main/App'
import { useConnectionStore } from '@/stores/connectionStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t, type Language } from '@/i18n'
import { nativeConfirm } from '@/utils/nativeConfirm'
import type { HistoryEntry } from '@/types'

type StatusFilter = 'all' | 'success' | 'error'
type SortKey = 'time' | 'duration'

interface Props {
  onClose: () => void
  embedded?: boolean  // ResultPanel 탭에 내장될 때 true (X 버튼 숨김)
}

const todayStr = () => new Date().toISOString().slice(0, 10)

/**
 * 쿼리 히스토리 패널.
 * 실행 이력(성공/실패)을 일단위 날짜 탭으로 표시하며, 클릭 시 에디터에 SQL을 삽입한다.
 */
export default function QueryHistory({ onClose, embedded = false }: Props) {
  const queryClient = useQueryClient()
  const { activeTabId, updateTab, activeConnections, selectedConnId } = useConnectionStore()
  const { language } = useLanguageStore()
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortAsc, setSortAsc] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>(todayStr())
  const [searchScope, setSearchScope] = useState<'today' | 'all'>('today')

  // React 19: 필터 계산을 지연시켜 키 입력 즉각 반응 유지
  const deferredFilter = useDeferredValue(filter)

  const activeConn = activeConnections.find(c => c.id === selectedConnId) ?? null

  // 날짜 목록
  const { data: dates = [] } = useQuery({
    queryKey: ['historyDates'],
    queryFn: GetHistoryDates,
    staleTime: 30_000,
  })

  // 선택 날짜의 항목
  const { data: rawEntries = [], isLoading: loadingEntries } = useQuery({
    queryKey: ['historyByDate', selectedDate],
    queryFn: () => GetHistoryByDate(selectedDate),
    staleTime: 30_000,
    enabled: !!activeConn,
  })

  // 전체 검색
  const { data: searchResults = [], isFetching: isSearching } = useQuery({
    queryKey: ['historySearch', deferredFilter],
    queryFn: () => SearchHistory(deferredFilter, ''),
    enabled: searchScope === 'all' && deferredFilter.length >= 2,
    staleTime: 0,
  })

  const deleteMutation = useMutation({
    mutationFn: DeleteHistoryEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['historyByDate', selectedDate] })
      queryClient.invalidateQueries({ queryKey: ['historyDates'] })
    },
    onError: () => toast.error(t('histDeleteFail', language)),
  })

  const clearMutation = useMutation({
    mutationFn: ClearHistory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['historyDates'] })
      queryClient.invalidateQueries({ queryKey: ['historyByDate'] })
      queryClient.invalidateQueries({ queryKey: ['historySearch'] })
      toast.success(t('histClearOk', language))
    },
    onError: () => toast.error(t('histClearFail', language)),
  })

  function handleReuse(entry: HistoryEntry) {
    if (!activeTabId) return
    updateTab(activeTabId, { sql: entry.sql })
    onClose()
    toast.success(t('histReuseOk', language))
  }

  async function handleClear() {
    const total = rawEntries.length
    const msg = language === 'ko'
      ? `히스토리 전체(${total}건)를 삭제할까요?`
      : `Clear all ${total} history entries?`
    const ok = await nativeConfirm({
      title: t('histDeleteAll', language),
      message: msg,
      language,
    })
    if (!ok) return
    clearMutation.mutate()
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  function handleSelectDate(date: string) {
    setSelectedDate(date)
    if (searchScope === 'all') setSearchScope('today')
  }

  // 파이프라인 — Go nil 슬라이스가 JSON null 로 직렬화될 가능성 대비 방어 처리
  const baseEntries: HistoryEntry[] = ((searchScope === 'all' && deferredFilter.length >= 2)
    ? searchResults
    : rawEntries) ?? []

  // 연결 필터 (client-side)
  const connFiltered = activeConn
    ? baseEntries.filter(e => e.connName === activeConn.name)
    : []

  // 텍스트 필터 (scope=today일 때만 클라이언트 필터)
  const textFiltered = (searchScope === 'today' && deferredFilter.trim())
    ? connFiltered.filter(e =>
        e.sql.toLowerCase().includes(deferredFilter.toLowerCase()) ||
        e.connName.toLowerCase().includes(deferredFilter.toLowerCase()) ||
        e.database.toLowerCase().includes(deferredFilter.toLowerCase())
      )
    : connFiltered

  // 상태 필터
  const statusFiltered = statusFilter === 'all'
    ? textFiltered
    : textFiltered.filter(e => statusFilter === 'error' ? e.hasError : !e.hasError)

  // 정렬
  const sorted = [...statusFiltered].sort((a, b) => {
    let diff = 0
    if (sortKey === 'time') {
      diff = new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime()
    } else {
      diff = a.duration - b.duration
    }
    return sortAsc ? diff : -diff
  })

  const errorCount = connFiltered.filter(e => e.hasError).length
  const successCount = connFiltered.length - errorCount

  const isStale = filter !== deferredFilter

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)]">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-[var(--color-accent)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t('histTitle', language)}</span>
          {activeConn && (
            <span className="text-[10px] text-[var(--color-text-muted)] bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 rounded">
              {connFiltered.length}{t('histUnit', language)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {activeConn && connFiltered.length > 0 && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--color-error)] hover:bg-[var(--color-error)]/10 rounded transition-colors"
              title={t('histDeleteAll', language)}
            >
              <Trash2 size={11} />
              {t('histDeleteAll', language)}
            </button>
          )}
          {!embedded && (
            <button
              onClick={onClose}
              className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] rounded transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 연결 없음 상태 */}
      {!activeConn ? (
        <div className="flex items-center justify-center flex-1 text-xs text-[var(--color-text-muted)]">
          {t('histNoConnection', language)}
        </div>
      ) : (
        <>
          {/* 검색 + 스코프 */}
          <div className="px-3 py-2 border-b border-[var(--color-border)] shrink-0 space-y-2">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('histSearchPh', language)}
                className={`flex-1 h-7 px-2.5 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] transition-all ${isStale ? 'opacity-60' : ''}`}
              />
              <button
                onClick={() => setSearchScope('today')}
                className={`px-2 py-1 text-[10px] rounded whitespace-nowrap transition-colors ${
                  searchScope === 'today'
                    ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
                }`}
              >
                {t('histScopeToday', language)}
              </button>
              <button
                onClick={() => setSearchScope('all')}
                className={`px-2 py-1 text-[10px] rounded whitespace-nowrap transition-colors ${
                  searchScope === 'all'
                    ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
                }`}
              >
                {t('histScopeAll', language)}
              </button>
            </div>

            {/* 상태 필터 + 정렬 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                {(['all', 'success', 'error'] as const).map((s) => {
                  const label = s === 'all'
                    ? (language === 'ko' ? `전체 ${connFiltered.length}` : `All ${connFiltered.length}`)
                    : s === 'success'
                    ? (language === 'ko' ? `성공 ${successCount}` : `OK ${successCount}`)
                    : (language === 'ko' ? `오류 ${errorCount}` : `Err ${errorCount}`)
                  const active = statusFilter === s
                  return (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                        active
                          ? s === 'error'
                            ? 'bg-[var(--color-error)]/20 text-[var(--color-error)]'
                            : s === 'success'
                            ? 'bg-[var(--color-success)]/20 text-[var(--color-success)]'
                            : 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center gap-1">
                <ArrowDownUp size={10} className="text-[var(--color-null)]" />
                {(['time', 'duration'] as const).map((key) => {
                  const label = key === 'time'
                    ? (language === 'ko' ? '최신순' : 'Time')
                    : (language === 'ko' ? '실행시간' : 'Duration')
                  const active = sortKey === key
                  return (
                    <button
                      key={key}
                      onClick={() => toggleSort(key)}
                      className={`flex items-center gap-0.5 px-2 py-0.5 text-[10px] rounded transition-colors ${
                        active
                          ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                      }`}
                    >
                      {label}
                      {active && <span className="text-[8px]">{sortAsc ? '▲' : '▼'}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 날짜 pill 가로 스크롤 */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--color-border)] overflow-x-auto shrink-0">
            {dates.length === 0 ? (
              <span className="text-[10px] text-[var(--color-text-muted)]">{t('histNoDates', language)}</span>
            ) : (
              dates.map(date => {
                const isToday = date === todayStr()
                const isSelected = date === selectedDate
                const label = isToday
                  ? t('histToday', language)
                  : date.slice(5).replace('-', '/')  // MM/DD
                return (
                  <button
                    key={date}
                    onClick={() => handleSelectDate(date)}
                    className={`px-2.5 py-0.5 text-[10px] rounded-full whitespace-nowrap transition-colors ${
                      isSelected
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    {label}
                  </button>
                )
              })
            )}
            {isSearching && (
              <div className="flex items-center gap-1 ml-auto text-[10px] text-[var(--color-text-muted)] shrink-0">
                <Loader2 size={10} className="animate-spin" />
                {t('histSearching', language)}
              </div>
            )}
          </div>

          {/* 목록 */}
          <div className="flex-1 overflow-y-auto">
            {loadingEntries ? (
              <div className="flex items-center justify-center h-20 text-xs text-[var(--color-text-muted)]">
                {t('histLoading', language)}
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-xs text-[var(--color-text-muted)]">
                {filter || statusFilter !== 'all' ? t('histNoMatch', language) : t('histEmpty', language)}
              </div>
            ) : (
              sorted.map((entry) => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  language={language}
                  onReuse={handleReuse}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── 히스토리 행 ─────────────────────────────────────────────────────────

interface RowProps {
  entry: HistoryEntry
  language: Language
  onReuse: (entry: HistoryEntry) => void
  onDelete: (id: string) => void
}

function HistoryRow({ entry, language, onReuse, onDelete }: RowProps) {
  const [expanded, setExpanded] = useState(false)
  const ms = Math.round(entry.duration / 1_000_000)
  const locale = language === 'ko' ? 'ko-KR' : 'en-US'
  const time = new Date(entry.executedAt).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const date = new Date(entry.executedAt).toLocaleDateString(locale, {
    month: '2-digit',
    day: '2-digit',
  })

  const isMultiLine = entry.sql.includes('\n') || entry.sql.length > 120

  // 접힌 상태: 줄바꿈을 공백으로 치환해 한 줄로 표시
  const singleLine = entry.sql.replace(/\s+/g, ' ').trim()
  const truncated = singleLine.length > 120 ? singleLine.slice(0, 120) + '…' : singleLine

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(entry.sql)
      toast.success(language === 'ko' ? 'SQL 복사됨' : 'SQL copied')
    } catch {
      toast.error(language === 'ko' ? '복사 실패' : 'Copy failed')
    }
  }

  function handleExpandToggle(e: React.MouseEvent) {
    e.stopPropagation()
    setExpanded((v) => !v)
  }

  return (
    <div className="group border-b border-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)] transition-colors">
      {/* 메인 행 */}
      <div
        className="flex items-start gap-2 px-3 py-2.5 cursor-pointer"
        onClick={() => onReuse(entry)}
      >
        {/* 확장 토글 (멀티라인인 경우만) */}
        <button
          onClick={isMultiLine ? handleExpandToggle : (e) => e.stopPropagation()}
          className={`shrink-0 mt-0.5 transition-colors ${isMultiLine ? 'text-[var(--color-null)] hover:text-[var(--color-text-subtle)]' : 'text-transparent cursor-default'}`}
        >
          {expanded
            ? <ChevronDown size={12} />
            : <ChevronRight size={12} />
          }
        </button>

        {/* 상태 아이콘 */}
        <div className="shrink-0 mt-0.5">
          {entry.hasError ? (
            <AlertCircle size={13} className="text-[var(--color-error)]" />
          ) : (
            <CheckCircle size={13} className="text-[var(--color-success)]" />
          )}
        </div>

        {/* 본문 */}
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] text-[var(--color-text-primary)] truncate leading-relaxed whitespace-nowrap">
            {truncated}
          </div>
          {entry.hasError && (
            <div className="text-[10px] text-[var(--color-error)] truncate mt-0.5">{entry.errorMsg}</div>
          )}
          <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--color-text-muted)]">
            <span>{date} {time}</span>
            <span>·</span>
            <span>{entry.connName}</span>
            {entry.source === 'mcp' && (
              <span
                title={t('histSourceMcpTooltip', language)}
                className="inline-flex items-center gap-1 px-1.5 py-px rounded border border-[var(--color-accent)] text-[var(--color-accent)] text-[9px] font-semibold tracking-wide leading-none"
              >
                <Plug size={9} />
                {t('histSourceMcp', language)}
              </span>
            )}
            {entry.database && (
              <>
                <span>·</span>
                <span className="text-[var(--color-accent)]">{entry.database}</span>
              </>
            )}
            {!entry.hasError && (
              <>
                <span>·</span>
                <span>
                  {entry.rowCount > 0
                    ? `${entry.rowCount} ${t('histRowsUnit', language)}`
                    : `${entry.affected} ${t('histRowsAffectedUnit', language)}`
                  }
                </span>
                <span>·</span>
                <span className={ms > 1000 ? 'text-[var(--color-pk)]' : ms > 5000 ? 'text-[var(--color-error)]' : ''}>
                  {ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 액션 (hover) */}
        <div className="hidden group-hover:flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-[var(--color-accent)]/20 text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
            title={language === 'ko' ? 'SQL 복사' : 'Copy SQL'}
          >
            <Copy size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onReuse(entry) }}
            className="p-1 rounded hover:bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
            title={t('histLoadToEditor', language)}
          >
            <RotateCcw size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(entry.id) }}
            className="p-1 rounded hover:bg-[var(--color-error)]/20 text-[var(--color-error)]"
            title={t('histDeleteTitle', language)}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* 전문 보기 (확장 시) */}
      {expanded && (
        <div className="px-8 pb-2.5">
          <pre className="text-[11px] font-mono text-[var(--color-text-subtle)] bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto">
            {entry.sql}
          </pre>
        </div>
      )}
    </div>
  )
}
