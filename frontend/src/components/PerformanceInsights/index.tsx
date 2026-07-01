import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, Copy } from 'lucide-react'
import { GetPerformanceInsights } from '@/wailsjs/go/main/App'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import { formatCount } from '@/lib/formatBytes'
import type { PerformanceInsights as PerfData, SlowQueryRow } from '@/types'

interface Props {
  connId: string
}

type Tab = 'top' | 'fullscan' | 'unused'

/** ms 레이턴시 포맷: s / ms / µs */
function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  if (ms >= 1) return `${ms.toFixed(1)} ms`
  return `${(ms * 1000).toFixed(0)} µs`
}

/**
 * Phase 66: 성능 인사이트.
 *
 * performance_schema(events_statements_summary_by_digest) + sys(schema_unused_indexes) 기반
 * 읽기 전용 진단. 섹션별 미가용 시 안내 배너로 우아하게 저하한다.
 */
export default function PerformanceInsights({ connId }: Props) {
  const language = useLanguageStore((s) => s.language)
  const [tab, setTab] = useState<Tab>('top')

  const { data, isLoading, error } = useQuery<PerfData>({
    queryKey: ['perfInsights', connId],
    queryFn: () => GetPerformanceInsights(connId),
    staleTime: 15_000,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="osql-perf-insights-loading h-full flex items-center justify-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {t('perfLoading', language)}
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="osql-perf-insights-error h-full flex items-center justify-center text-sm px-6 text-center" style={{ color: 'var(--color-danger, #e53e3e)' }}>
        {t('perfLoadFailed', language)}
      </div>
    )
  }

  const copyDigest = (digest: string) => {
    navigator.clipboard.writeText(digest)
    toast.success(t('perfCopied', language))
  }

  const TabBtn = ({ id, label, count }: { id: Tab; label: string; count: number }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className="osql-perf-insights-tab px-3 py-1.5 text-xs font-medium border-b-2"
      style={{
        borderColor: tab === id ? 'var(--color-accent)' : 'transparent',
        color: tab === id ? 'var(--color-accent)' : 'var(--color-text-muted)',
      }}
    >
      {label} <span className="opacity-60">({formatCount(count)})</span>
    </button>
  )

  return (
    <div className="osql-perf-insights h-full flex flex-col text-sm" style={{ color: 'var(--color-text-primary)' }}>
      {/* 탭 */}
      <div className="osql-perf-insights-tabs flex items-center gap-1 px-2 border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
        <TabBtn id="top" label={t('perfTabTop', language)} count={data.topQueries.length} />
        <TabBtn id="fullscan" label={t('perfTabFullScan', language)} count={data.fullScanQueries.length} />
        <TabBtn id="unused" label={t('perfTabUnused', language)} count={data.unusedIndexes.length} />
      </div>

      <div className="osql-perf-insights-body flex-1 overflow-auto p-2">
        {(tab === 'top' || tab === 'fullscan') && (
          !data.perfSchemaAvailable ? (
            <Banner text={t('perfNoPerfSchema', language)} />
          ) : (
            <QueryTable
              rows={tab === 'top' ? data.topQueries : data.fullScanQueries}
              language={language}
              onCopy={copyDigest}
            />
          )
        )}

        {tab === 'unused' && (
          !data.sysAvailable ? (
            <Banner text={t('perfNoSys', language)} />
          ) : data.unusedIndexes.length === 0 ? (
            <div className="py-6 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('perfNoData', language)}</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0" style={{ background: 'var(--color-bg-secondary)' }}>
                <tr className="text-left" style={{ color: 'var(--color-text-muted)' }}>
                  <th className="py-1 pr-2 font-medium">{t('perfColSchema', language)}</th>
                  <th className="py-1 px-2 font-medium">{t('perfColTable', language)}</th>
                  <th className="py-1 pl-2 font-medium">{t('perfColIndex', language)}</th>
                </tr>
              </thead>
              <tbody>
                {data.unusedIndexes.map((r, i) => (
                  <tr key={`${r.schema}.${r.table}.${r.index}.${i}`} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="py-1 pr-2" style={{ color: 'var(--color-text-muted)' }}>{r.schema}</td>
                    <td className="py-1 px-2" style={{ color: 'var(--color-text-primary)' }}>{r.table}</td>
                    <td className="py-1 pl-2 font-mono" style={{ color: 'var(--color-text-primary)' }}>{r.index}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  )
}

function Banner({ text }: { text: string }) {
  return (
    <div className="osql-perf-insights-banner flex items-start gap-2 rounded-md border px-3 py-2 text-xs m-1"
      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)', background: 'var(--color-bg-secondary)' }}>
      <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--color-warning, #d69e2e)' }} />
      <span>{text}</span>
    </div>
  )
}

function QueryTable({ rows, language, onCopy }: { rows: SlowQueryRow[]; language: 'ko' | 'en'; onCopy: (d: string) => void }) {
  if (rows.length === 0) {
    return <div className="py-6 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('perfNoData', language)}</div>
  }
  return (
    <table className="osql-perf-insights-query-table w-full text-xs border-collapse">
      <thead className="sticky top-0" style={{ background: 'var(--color-bg-secondary)' }}>
        <tr className="text-left" style={{ color: 'var(--color-text-muted)' }}>
          <th className="py-1 pr-2 font-medium">{t('perfColQuery', language)}</th>
          <th className="py-1 px-2 font-medium text-right">{t('perfColExec', language)}</th>
          <th className="py-1 px-2 font-medium text-right">{t('perfColTotalLat', language)}</th>
          <th className="py-1 px-2 font-medium text-right">{t('perfColAvgLat', language)}</th>
          <th className="py-1 px-2 font-medium text-right">{t('perfColRowsExam', language)}</th>
          <th className="py-1 pl-2 font-medium text-right">{t('perfColNoIndex', language)}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.digest.slice(0, 40)}.${i}`} className="border-t align-top" style={{ borderColor: 'var(--color-border)' }}>
            <td className="py-1 pr-2 max-w-[420px]">
              <div className="flex items-start gap-1">
                <button type="button" onClick={() => onCopy(r.digest)} title={t('perfCopyDigest', language)}
                  className="shrink-0 mt-0.5 opacity-50 hover:opacity-100">
                  <Copy size={11} />
                </button>
                <span className="font-mono truncate block" style={{ color: 'var(--color-text-primary)' }} title={r.digest}>
                  {r.schema ? <span style={{ color: 'var(--color-text-muted)' }}>{r.schema} · </span> : null}
                  {r.digest}
                </span>
              </div>
            </td>
            <td className="py-1 px-2 text-right tabular-nums">{formatCount(r.execCount)}</td>
            <td className="py-1 px-2 text-right tabular-nums font-medium">{formatMs(r.totalLatencyMs)}</td>
            <td className="py-1 px-2 text-right tabular-nums">{formatMs(r.avgLatencyMs)}</td>
            <td className="py-1 px-2 text-right tabular-nums">{formatCount(r.rowsExamined)}</td>
            <td className="py-1 pl-2 text-right tabular-nums" style={{ color: r.noIndexUsed > 0 ? 'var(--color-warning, #d69e2e)' : 'var(--color-text-muted)' }}>
              {formatCount(r.noIndexUsed)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
