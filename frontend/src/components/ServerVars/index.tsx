/**
 * Server Variables / Status 패널.
 * SHOW [GLOBAL|SESSION] VARIABLES 와 SHOW [GLOBAL|SESSION] STATUS를 탭으로 표시.
 * 실시간 검색 필터 제공.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, RefreshCw, X, Settings, BarChart2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { VariableRow } from '@/types'
import { GetServerVariables, GetServerStatus } from '@/wailsjs/go/main/App'
import { t, type Language } from '@/i18n'
import { useLanguageStore } from '@/stores/useLanguageStore'

type TabType = 'variables' | 'status'
type ScopeType = 'GLOBAL' | 'SESSION'

interface Props {
  connId: string
  onClose: () => void
}

export default function ServerVars({ connId, onClose }: Props) {
  const language = useLanguageStore((s) => s.language)
  const [tab, setTab] = useState<TabType>('variables')
  const [scope, setScope] = useState<ScopeType>('GLOBAL')
  const [search, setSearch] = useState('')

  const varsQuery = useQuery<VariableRow[]>({
    queryKey: ['server-variables', connId, scope],
    queryFn: () => GetServerVariables(connId, scope),
    enabled: tab === 'variables',
    staleTime: 10_000,
  })

  const statusQuery = useQuery<VariableRow[]>({
    queryKey: ['server-status', connId, scope],
    queryFn: () => GetServerStatus(connId, scope),
    enabled: tab === 'status',
    staleTime: 5_000,
  })

  const activeQuery = tab === 'variables' ? varsQuery : statusQuery
  const rows = activeQuery.data ?? []

  const q = search.toLowerCase()
  const filtered = rows.filter((r) =>
    !q || r.name.toLowerCase().includes(q) || r.value.toLowerCase().includes(q),
  )

  function refresh() {
    activeQuery.refetch().catch(() => toast.error(t('svRefreshFail', language)))
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <Settings size={13} className="text-[var(--color-text-subtle)]" />
          <span className="text-xs font-medium text-[var(--color-text-subtle)]">Server Variables</span>
          <span className="text-[10px] text-[var(--color-null)]">{filtered.length}/{rows.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* 스코프 토글 */}
          <div className="flex rounded overflow-hidden border border-[var(--color-border)]">
            {(['GLOBAL', 'SESSION'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-2 py-0.5 text-[10px] transition-colors ${
                  scope === s ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] bg-[var(--color-bg-secondary)]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <button
            onClick={refresh}
            className={`p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] ${activeQuery.isFetching ? 'animate-spin' : ''}`}
          >
            <RefreshCw size={12} />
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)]">
            <X size={12} />
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex border-b border-[var(--color-border)] shrink-0">
        <TabBtn label="Variables" icon={<Settings size={10} />} active={tab === 'variables'} onClick={() => setTab('variables')} />
        <TabBtn label="Status" icon={<BarChart2 size={10} />} active={tab === 'status'} onClick={() => setTab('status')} />
      </div>

      {/* 검색 */}
      <div className="px-3 py-1.5 border-b border-[var(--color-border)] shrink-0">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('svSearchPh', language)}
            className="w-full pl-6 pr-3 py-1 text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] placeholder-[var(--color-null)] focus:outline-none focus:border-[var(--color-accent)]"
          />
        </div>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto">
        {activeQuery.isLoading ? (
          <div className="flex items-center justify-center h-32 text-[var(--color-null)] text-xs">{t('labelLoading', language)}</div>
        ) : activeQuery.isError ? (
          <div className="flex items-center justify-center h-32 text-[var(--color-error)] text-xs">{t('svLoadFail', language)}</div>
        ) : (
          <table className="w-full text-[11px] border-collapse">
            <thead className="sticky top-0 bg-[var(--color-bg-secondary)] z-10">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium text-[var(--color-text-muted)] border-b border-[var(--color-border)] w-1/2">Variable Name</th>
                <th className="px-3 py-1.5 text-left font-medium text-[var(--color-text-muted)] border-b border-[var(--color-border)]">Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <VarRow key={r.name} row={r} language={language} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-6 text-center text-[var(--color-null)]">
                    {t('svNoResult', language)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── 소형 컴포넌트 ────────────────────────────────────────────────────────────

function TabBtn({
  label, icon, active, onClick,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-[11px] border-b-2 transition-colors ${
        active
          ? 'border-[var(--color-accent)] text-[var(--color-text-primary)]'
          : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-subtle)]'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function VarRow({ row, language }: { row: VariableRow; language: Language }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(row.value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  // 숫자형 값 강조
  const isNumeric = /^\d+$/.test(row.value)
  const isOnOff = /^(ON|OFF|YES|NO)$/i.test(row.value)

  return (
    <tr
      className="border-b border-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)] cursor-pointer group"
      onClick={copy}
      title={`${t('svClickCopyPrefix', language)}${row.value}`}
    >
      <td className="px-3 py-1.5 font-mono text-[var(--color-accent)] select-text">{row.name}</td>
      <td className={`px-3 py-1.5 font-mono select-text ${
        isOnOff
          ? /^(ON|YES)$/i.test(row.value) ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'
          : isNumeric
          ? 'text-[var(--color-pk)]'
          : 'text-[var(--color-text-primary)]'
      }`}>
        {row.value || <span className="text-[var(--color-null)] italic">empty</span>}
        {copied && <span className="ml-2 text-[var(--color-success)] text-[9px]">{t('tvCopied', language)}</span>}
      </td>
    </tr>
  )
}
