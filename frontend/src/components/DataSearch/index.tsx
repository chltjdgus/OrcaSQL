import { useState } from 'react'
import { Search, RefreshCw, ChevronDown, ChevronRight, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { SearchInDatabase } from '@/wailsjs/go/main/App'
import { useConnectionStore } from '@/stores/connectionStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import type { DataSearchResult } from '@/types'

interface Props {
  onClose: () => void
}

/**
 * 전체 DB 데이터 검색 패널.
 * LIKE 'keyword%' 기반으로 텍스트 컬럼 전체를 검색한다.
 */
export default function DataSearch({ onClose }: Props) {
  const { activeConnections, selectedConnId, selectedDatabase } = useConnectionStore()
  const language = useLanguageStore((s) => s.language)

  const [connId, setConnId] = useState(selectedConnId ?? activeConnections[0]?.id ?? '')
  const [database, setDatabase] = useState(selectedDatabase ?? '')
  const [keyword, setKeyword] = useState('')
  const [maxPerTable, setMaxPerTable] = useState(100)
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<DataSearchResult[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function runSearch() {
    if (!connId || !database || !keyword.trim()) {
      toast.error(t('dsAllRequired', language))
      return
    }
    setSearching(true)
    setResults([])
    setExpanded(new Set())
    try {
      const res = await SearchInDatabase(connId, database, keyword.trim(), maxPerTable)
      setResults(res)
      if (res.length === 0) {
        toast(t('labelNoResult', language), { icon: '🔍' })
      } else {
        const totalRows = res.reduce((s, r) => s + r.total, 0)
        toast.success(language === 'ko'
          ? `${res.length}개 테이블에서 ${totalRows}행 발견`
          : `Found ${totalRows} row(s) in ${res.length} table(s)`)
        // 자동으로 모두 펼치기 (10개 이하)
        if (res.length <= 10) {
          setExpanded(new Set(res.map((r) => r.table)))
        }
      }
    } catch (e) {
      toast.error(`${t('dsSearchFailPrefix', language)}${e}`)
    } finally {
      setSearching(false)
    }
  }

  function toggleExpand(table: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(table) ? next.delete(table) : next.add(table)
      return next
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') runSearch()
  }

  // 결과에서 컬럼 헤더 추출 (첫 번째 결과의 column 필드는 콤마 구분)
  function getColumns(r: DataSearchResult): string[] {
    return r.column.split(', ')
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0">
        <Search size={14} className="text-[var(--color-accent)]" />
        <span className="text-sm font-semibold">{t('dsTitle', language)}</span>
        <div className="ml-auto">
          <button onClick={onClose} className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 검색 폼 */}
      <div className="flex flex-wrap items-end gap-3 px-4 py-3 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--color-text-muted)]">{t('dsConn', language)}</span>
          <select
            value={connId}
            onChange={(e) => setConnId(e.target.value)}
            className={inputCls + ' w-36'}
          >
            {activeConnections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--color-text-muted)]">{t('dsDatabase', language)}</span>
          <input
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder="database"
            className={inputCls + ' w-28'}
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-40">
          <span className="text-[10px] text-[var(--color-text-muted)]">{t('dsKeywordLabel', language)}</span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('dsKeywordPh', language)}
            className={inputCls + ' flex-1'}
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--color-text-muted)]">{t('dsMaxPerTable', language)}</span>
          <input
            type="number"
            value={maxPerTable}
            onChange={(e) => setMaxPerTable(Number(e.target.value))}
            min={10} max={1000} step={10}
            className={inputCls + ' w-16'}
          />
        </div>
        <button
          onClick={runSearch}
          disabled={searching}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors disabled:opacity-50 self-end"
        >
          {searching ? <RefreshCw size={11} className="animate-spin" /> : <Search size={11} />}
          {searching ? t('histSearching', language) : t('dsSearchBtn', language)}
        </button>
      </div>

      {/* 결과 */}
      <div className="flex-1 overflow-y-auto">
        {results.length === 0 && !searching && (
          <div className="text-center text-[var(--color-text-muted)] text-sm mt-12">
            {t('dsEmptyHint', language)}
          </div>
        )}

        {results.map((r) => {
          const isExpanded = expanded.has(r.table)
          const cols = getColumns(r)

          return (
            <div key={r.table} className="border-b border-[var(--color-border)]">
              {/* 테이블 헤더 */}
              <div
                onClick={() => toggleExpand(r.table)}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--color-bg-tertiary)] transition-colors select-none"
              >
                {isExpanded
                  ? <ChevronDown size={12} className="text-[var(--color-text-muted)] shrink-0" />
                  : <ChevronRight size={12} className="text-[var(--color-text-muted)] shrink-0" />
                }
                <span className="font-medium text-xs text-[var(--color-text-primary)]">{r.table}</span>
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  — {r.total}{t('dsRowsMatchedSuffix', language)}
                </span>
                <span className="ml-auto text-[10px] text-[var(--color-null)]">
                  {t('dsMatchedColsPrefix', language)}{r.column}
                </span>
              </div>

              {/* 결과 테이블 */}
              {isExpanded && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="bg-[var(--color-bg-secondary)]">
                      <tr>
                        {r.rows[0]?.map((_, ci) => (
                          <th
                            key={ci}
                            className="px-3 py-1.5 text-left text-[var(--color-text-muted)] font-normal border-b border-[var(--color-border)] whitespace-nowrap"
                          >
                            {cols[ci] ?? `col${ci}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.rows.map((row, ri) => (
                        <tr key={ri} className="hover:bg-[var(--color-bg-tertiary)] transition-colors">
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className="px-3 py-1.5 border-b border-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] max-w-[300px] truncate"
                              title={cell}
                            >
                              {cell === 'NULL'
                                ? <span className="text-[10px] text-[var(--color-null)] italic">NULL</span>
                                : highlightKeyword(cell, keyword)
                              }
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {r.total >= maxPerTable && (
                    <div className="px-3 py-1 text-[10px] text-[var(--color-text-muted)] bg-[var(--color-bg-secondary)]">
                      {t('dsMaxRowsNote', language).replace('{n}', String(maxPerTable))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 키워드 매칭 부분을 하이라이트한다. */
function highlightKeyword(text: string, keyword: string): React.ReactNode {
  if (!keyword || !text.toLowerCase().startsWith(keyword.toLowerCase())) {
    return text.length > 100 ? text.slice(0, 100) + '…' : text
  }
  const matchLen = keyword.length
  const before = text.slice(0, matchLen)
  const after = text.slice(matchLen, 100)
  const truncated = text.length > 100
  return (
    <>
      <mark className="bg-[var(--color-pk)]/30 text-[var(--color-pk)] rounded-sm">{before}</mark>
      {after}{truncated && '…'}
    </>
  )
}

const inputCls = 'h-7 px-2 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] transition-colors'
