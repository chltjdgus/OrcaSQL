import { useQuery } from '@tanstack/react-query'
import { GetDatabaseOverview } from '@/wailsjs/go/main/App'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import { formatBytes, formatCount } from '@/lib/formatBytes'
import type { DatabaseOverview as DBOverview } from '@/types'

interface Props {
  connId: string
  database: string
}

/**
 * Phase 65: DB 개요 대시보드.
 *
 * information_schema.TABLES 를 백엔드에서 집계(GetDatabaseOverview)해 요약 카드·엔진 분포·
 * 크기순 테이블 랭킹을 표시한다. 읽기 전용.
 */
export default function DatabaseOverview({ connId, database }: Props) {
  const language = useLanguageStore((s) => s.language)
  const { data, isLoading, error } = useQuery<DBOverview>({
    queryKey: ['dbOverview', connId, database],
    queryFn: () => GetDatabaseOverview(connId, database),
    staleTime: 30_000,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="osql-database-overview-loading h-full flex items-center justify-center text-sm"
        style={{ color: 'var(--color-text-muted)' }}>
        {t('dbovLoading', language)}
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="osql-database-overview-error h-full flex items-center justify-center text-sm px-6 text-center"
        style={{ color: 'var(--color-danger, #e53e3e)' }}>
        {t('dbovLoadFailed', language)}
      </div>
    )
  }

  const maxEngineSize = data.engines.reduce((m, e) => Math.max(m, e.size), 0) || 1

  return (
    <div className="osql-database-overview h-full overflow-y-auto p-4 text-sm" style={{ color: 'var(--color-text-primary)' }}>
      {/* 요약 카드 */}
      <div className="osql-database-overview-summary grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <Stat label={t('dbovTables', language)} value={formatCount(data.tableCount)} />
        <Stat label={t('dbovViews', language)} value={formatCount(data.viewCount)} />
        <Stat label={t('dbovTotalRows', language)} value={`~${formatCount(data.totalRows)}`} />
        <Stat label={t('dbovTotalSize', language)} value={formatBytes(data.totalSize)} accent />
        <Stat label={t('dbovDataSize', language)} value={formatBytes(data.dataSize)} />
        <Stat label={t('dbovIndexSize', language)} value={formatBytes(data.indexSize)} />
        <Stat label={t('dbovDataFree', language)} value={formatBytes(data.dataFree)} />
        <Stat label={t('dbovDatabase', language)} value={data.database} mono />
      </div>

      {/* 엔진 분포 */}
      {data.engines.length > 0 && (
        <div className="osql-database-overview-engines mb-4">
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>
            {t('dbovEngines', language)}
          </div>
          <div className="flex flex-col gap-1.5">
            {data.engines.map((e) => (
              <div key={e.engine} className="osql-database-overview-engine-row flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-xs" style={{ color: 'var(--color-text-primary)' }}>{e.engine}</span>
                <div className="flex-1 h-3 rounded-sm overflow-hidden" style={{ background: 'var(--color-bg-tertiary, rgba(128,128,128,0.15))' }}>
                  <div className="h-full rounded-sm" style={{ width: `${(e.size / maxEngineSize) * 100}%`, background: 'var(--color-accent)' }} />
                </div>
                <span className="w-40 shrink-0 text-right text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                  {formatBytes(e.size)} · {formatCount(e.tables)} {t('dbovTablesUnit', language)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 테이블 랭킹 */}
      <div className="osql-database-overview-ranking">
        <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>
          {t('dbovTableRanking', language)}
        </div>
        {data.tables.length === 0 ? (
          <div className="py-6 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('dbovNoTables', language)}</div>
        ) : (
          <table className="osql-database-overview-table w-full text-xs border-collapse">
            <thead className="sticky top-0" style={{ background: 'var(--color-bg-secondary)' }}>
              <tr style={{ color: 'var(--color-text-muted)' }} className="text-left">
                <th className="py-1 pr-2 font-medium">{t('dbovColName', language)}</th>
                <th className="py-1 px-2 font-medium">{t('dbovColEngine', language)}</th>
                <th className="py-1 px-2 font-medium text-right">{t('dbovColRows', language)}</th>
                <th className="py-1 px-2 font-medium text-right">{t('dbovColData', language)}</th>
                <th className="py-1 px-2 font-medium text-right">{t('dbovColIndex', language)}</th>
                <th className="py-1 px-2 font-medium text-right">{t('dbovColTotal', language)}</th>
                <th className="py-1 pl-2 font-medium">{t('dbovColCollation', language)}</th>
              </tr>
            </thead>
            <tbody>
              {data.tables.map((tbl) => {
                const isView = tbl.type === 'VIEW'
                return (
                  <tr key={tbl.name} className="osql-database-overview-row border-t" style={{ borderColor: 'var(--color-border)' }}
                    data-osql-key={tbl.name}>
                    <td className="py-1 pr-2 truncate max-w-[220px]" style={{ color: 'var(--color-text-primary)' }} title={tbl.name}>
                      {tbl.name}
                      {isView && <span className="ml-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>({t('dbovView', language)})</span>}
                    </td>
                    <td className="py-1 px-2" style={{ color: 'var(--color-text-muted)' }}>{tbl.engine || '—'}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{isView ? '—' : formatCount(tbl.rows)}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{isView ? '—' : formatBytes(tbl.dataLength)}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{isView ? '—' : formatBytes(tbl.indexLength)}</td>
                    <td className="py-1 px-2 text-right tabular-nums font-medium">{isView ? '—' : formatBytes(tbl.totalLength)}</td>
                    <td className="py-1 pl-2 truncate max-w-[160px]" style={{ color: 'var(--color-text-muted)' }} title={tbl.collation}>{tbl.collation || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div className="mt-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{t('dbovApproxNote', language)}</div>
      </div>
    </div>
  )
}

function Stat({ label, value, accent, mono }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <div className="osql-database-overview-stat rounded-md border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}>
      <div className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
      <div className={`text-sm font-semibold truncate ${mono ? 'font-mono' : ''}`}
        style={{ color: accent ? 'var(--color-accent)' : 'var(--color-text-primary)' }} title={value}>
        {value}
      </div>
    </div>
  )
}
