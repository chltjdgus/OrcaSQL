/**
 * Process List 패널.
 * SHOW FULL PROCESSLIST 결과를 자동 새로고침하고 Kill 기능을 제공.
 */
import { useState, useEffect, useCallback, useDeferredValue } from 'react'
import { RefreshCw, Zap, X, AlertTriangle, Activity } from 'lucide-react'
import toast from 'react-hot-toast'
import type { ProcessRow } from '@/types'
import { GetProcessList, KillProcess } from '@/wailsjs/go/main/App'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import { nativeConfirm } from '@/utils/nativeConfirm'

const REFRESH_OPTIONS = [0, 3, 5, 10, 30] // 0 = 수동

interface Props {
  connId: string
  onClose: () => void
}

export default function ProcessList({ connId, onClose }: Props) {
  const language = useLanguageStore((s) => s.language)
  const [rows, setRows] = useState<ProcessRow[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshSec, setRefreshSec] = useState(5)
  const [search, setSearch] = useState('')
  // React 19: 검색 입력을 지연 처리해 키 입력 반응성 유지
  const deferredSearch = useDeferredValue(search)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [sortKey, setSortKey] = useState<keyof ProcessRow>('time')
  const [sortAsc, setSortAsc] = useState(false)
  const [onlyLong, setOnlyLong] = useState(false)

  const load = useCallback(async () => {
    if (!connId) return
    setLoading(true)
    try {
      const data = await GetProcessList(connId)
      setRows(data)
    } catch (e) {
      toast.error(`${t('procLoadFailPrefix', language)}${e}`)
    } finally {
      setLoading(false)
    }
  }, [connId])

  // 초기 로드 + 자동 새로고침
  useEffect(() => {
    load()
    if (refreshSec === 0) return
    const timer = setInterval(load, refreshSec * 1000)
    return () => clearInterval(timer)
  }, [load, refreshSec])

  // KILL 처리
  async function kill(id: number, killQuery: boolean) {
    const label = killQuery ? 'QUERY' : 'CONNECTION'
    const ok = await nativeConfirm({
      title: t('procKillTitle', language),
      message: t('procKillBody', language).replace('{label}', label).replace('{id}', String(id)),
      language,
    })
    if (!ok) return
    try {
      await KillProcess(connId, id, killQuery)
      toast.success(`Process ${id} ${label} killed`)
      load()
    } catch (e) {
      toast.error(`${t('procKillFailPrefix', language)}${e}`)
    }
  }

  async function killSelected() {
    if (selected.size === 0) return
    const ok = await nativeConfirm({
      title: t('procKillTitle', language),
      message: t('procKillManyBody', language).replace('{n}', String(selected.size)),
      language,
    })
    if (!ok) return
    for (const id of Array.from(selected)) {
      try {
        await KillProcess(connId, id, false)
      } catch { /* noop */ }
    }
    toast.success(`${selected.size}${t('procKillDoneSuffix', language)}`)
    setSelected(new Set())
    load()
  }

  // 정렬 + 검색 필터 — deferredSearch 기준으로 계산해 입력 반응성 보장
  const isStale = search !== deferredSearch
  const q = deferredSearch.toLowerCase()
  const filtered = rows
    .filter((r) => !onlyLong || r.time > 10)
    .filter((r) =>
      !q ||
      r.user.toLowerCase().includes(q) ||
      r.db.toLowerCase().includes(q) ||
      r.command.toLowerCase().includes(q) ||
      r.state.toLowerCase().includes(q) ||
      r.info.toLowerCase().includes(q),
    )
    .sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })

  function toggleSort(key: keyof ProcessRow) {
    if (sortKey === key) setSortAsc((v) => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const cols: { key: keyof ProcessRow; label: string; width?: string }[] = [
    { key: 'id', label: 'ID', width: 'w-16' },
    { key: 'user', label: 'User', width: 'w-24' },
    { key: 'host', label: 'Host', width: 'w-32' },
    { key: 'db', label: 'DB', width: 'w-24' },
    { key: 'command', label: 'Command', width: 'w-20' },
    { key: 'time', label: 'Time', width: 'w-14' },
    { key: 'state', label: 'State', width: 'w-28' },
    { key: 'info', label: 'Info' },
  ]

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={13} className="text-[var(--color-success)]" />
          <span className="text-xs font-medium text-[var(--color-text-subtle)]">Process List</span>
          <span className="text-[10px] text-[var(--color-null)]">{filtered.length}/{rows.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* 자동 새로고침 */}
          <select
            value={refreshSec}
            onChange={(e) => setRefreshSec(Number(e.target.value))}
            className="h-6 px-1 text-[10px] rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-subtle)] focus:outline-none"
          >
            {REFRESH_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === 0 ? t('procManual', language) : `${s}${t('procSecSuffix', language)}`}</option>
            ))}
          </select>

          {/* 새로고침 버튼 */}
          <button
            onClick={load}
            className={`p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] transition-colors ${loading ? 'animate-spin' : ''}`}
          >
            <RefreshCw size={12} />
          </button>

          {/* 10초 초과 쿼리만 표시 */}
          <button
            onClick={() => setOnlyLong((v) => !v)}
            className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded transition-colors ${
              onlyLong
                ? 'bg-[var(--color-error)]/20 text-[var(--color-error)]'
                : 'bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-subtle)]'
            }`}
            title={t('procLongOnlyTitle', language)}
          >
            <AlertTriangle size={9} /> {t('procLongBtn', language)}
          </button>

          {/* 선택 Kill */}
          {selected.size > 0 && (
            <button
              onClick={killSelected}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-[var(--color-error)]/15 text-[var(--color-error)] hover:bg-[var(--color-error)]/25"
            >
              <Zap size={10} /> Kill {selected.size}{t('procKillSelectedSuffix', language)}
            </button>
          )}

          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)]"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* 검색 */}
      <div className="px-3 py-1.5 border-b border-[var(--color-border)] shrink-0">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('procSearchPh', language)}
          className={`w-full px-2 py-1 text-xs bg-[var(--color-bg-secondary)] border rounded text-[var(--color-text-primary)] placeholder-[var(--color-null)] focus:outline-none focus:border-[var(--color-accent)] transition-opacity ${
            isStale ? 'opacity-60 border-[var(--color-border)]' : 'border-[var(--color-border)]'
          }`}
        />
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 bg-[var(--color-bg-secondary)] z-10">
            <tr>
              <th className="w-8 px-2 py-1.5 border-b border-[var(--color-border)]">
                <input
                  type="checkbox"
                  checked={selected.size === filtered.length && filtered.length > 0}
                  onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((r) => r.id)) : new Set())}
                  className="accent-[var(--color-accent)]"
                />
              </th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className={`px-2 py-1.5 text-left font-medium text-[var(--color-text-muted)] cursor-pointer border-b border-[var(--color-border)] hover:text-[var(--color-text-primary)] select-none whitespace-nowrap ${c.width ?? ''}`}
                >
                  {c.label}
                  {sortKey === c.key && <span className="ml-1">{sortAsc ? '↑' : '↓'}</span>}
                </th>
              ))}
              <th className="w-20 px-2 py-1.5 text-left font-medium text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={cols.length + 2} className="px-3 py-6 text-center text-[var(--color-null)]">
                  {loading ? t('labelLoading', language) : t('procNoProcesses', language)}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <ProcessRowComp
                  key={r.id}
                  row={r}
                  selected={selected.has(r.id)}
                  onToggle={() => toggleSelect(r.id)}
                  onKillConn={() => kill(r.id, false)}
                  onKillQuery={() => kill(r.id, true)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── ProcessRowComp ───────────────────────────────────────────────────────────

function ProcessRowComp({
  row, selected, onToggle, onKillConn, onKillQuery,
}: {
  row: ProcessRow
  selected: boolean
  onToggle: () => void
  onKillConn: () => void
  onKillQuery: () => void
}) {
  const isLong = row.time > 10
  return (
    <tr className={`border-b border-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)] transition-colors ${selected ? 'bg-[var(--color-bg-tertiary)]' : ''}`}>
      <td className="px-2 py-1">
        <input type="checkbox" checked={selected} onChange={onToggle} className="accent-[var(--color-accent)]" />
      </td>
      <td className="px-2 py-1 font-mono text-[var(--color-text-subtle)]">{row.id}</td>
      <td className="px-2 py-1 text-[var(--color-success)]">{row.user}</td>
      <td className="px-2 py-1 text-[var(--color-text-subtle)] truncate max-w-[128px]">{row.host}</td>
      <td className="px-2 py-1 text-[var(--color-accent)]">{row.db}</td>
      <td className="px-2 py-1 text-[var(--color-text-primary)]">{row.command}</td>
      <td className={`px-2 py-1 font-mono ${isLong ? 'text-[var(--color-error)]' : 'text-[var(--color-text-subtle)]'}`}>
        {isLong && <AlertTriangle size={9} className="inline mr-0.5 -mt-0.5" />}
        {row.time}s
      </td>
      <td className="px-2 py-1 text-[var(--color-text-subtle)] truncate max-w-[112px]">{row.state}</td>
      <td className="px-2 py-1 text-[var(--color-text-muted)] truncate max-w-[200px] font-mono">{row.info}</td>
      <td className="px-2 py-1">
        <div className="flex gap-1">
          <button
            onClick={onKillConn}
            title="Kill Connection"
            className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-error)]/10 text-[var(--color-error)] hover:bg-[var(--color-error)]/25"
          >
            Kill
          </button>
          {row.command !== 'Sleep' && (
            <button
              onClick={onKillQuery}
              title="Kill Query"
              className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-warning)]/10 text-[var(--color-warning)] hover:bg-[var(--color-warning)]/25"
            >
              Query
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
