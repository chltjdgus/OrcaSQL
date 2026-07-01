import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, RefreshCw, CheckSquare, Square, X, Play } from 'lucide-react'
import toast from 'react-hot-toast'
import { GetDumpTableList, DumpDatabase } from '@/wailsjs/go/main/App'
import { EventsOn, EventsOff } from '@/wailsjs/runtime/runtime'
import type { DumpOptions, DumpProgress } from '@/types'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'

interface Props {
  connId: string
  database: string
  onClose: () => void
}

/**
 * SQL 덤프 패널.
 * 테이블 체크박스 선택 + 옵션 + 진행률 표시 + 다운로드.
 */
export default function BackupPanel({ connId, database, onClose }: Props) {
  const language = useLanguageStore((s) => s.language)
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set())
  const [noData, setNoData] = useState(false)
  const [noCreate, setNoCreate] = useState(false)
  const [dropTable, setDropTable] = useState(true)
  const [insertIgnore, setInsertIgnore] = useState(false)
  const [batchSize, setBatchSize] = useState(1000)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<DumpProgress | null>(null)
  const [dumpResult, setDumpResult] = useState<string | null>(null)

  const { data: tables = [], isLoading } = useQuery({
    queryKey: ['dump-tables', connId, database],
    queryFn: () => GetDumpTableList(connId, database),
    staleTime: 60_000,
  })

  // 모두 선택 (초기)
  useEffect(() => {
    if (tables.length > 0) {
      setSelectedTables(new Set(tables))
    }
  }, [tables])

  // 진행률 이벤트 구독
  useEffect(() => {
    EventsOn('backup:progress', (p: unknown) => setProgress(p as DumpProgress))
    return () => { EventsOff('backup:progress') }
  }, [])

  function toggleTable(t: string) {
    setSelectedTables((prev) => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  }

  function toggleAll() {
    if (selectedTables.size === tables.length) {
      setSelectedTables(new Set())
    } else {
      setSelectedTables(new Set(tables))
    }
  }

  async function runDump() {
    if (selectedTables.size === 0) {
      toast.error(t('bpSelectTable', language))
      return
    }
    setRunning(true)
    setProgress(null)
    setDumpResult(null)

    const opts: DumpOptions = {
      connId,
      database,
      tables: Array.from(selectedTables),
      noData,
      noCreate,
      dropTable,
      insertIgnore,
      batchSize,
    }

    try {
      const sql = await DumpDatabase(opts)
      setDumpResult(sql)
      toast.success(t('bpDumpDone', language))
    } catch (e) {
      toast.error(`${t('bpDumpFailPrefix', language)}${e}`)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  function downloadDump() {
    if (!dumpResult) return
    const blob = new Blob([dumpResult], { type: 'text/sql;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${database}_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('bpFileSaved', language))
  }

  const allSelected = tables.length > 0 && selectedTables.size === tables.length

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0">
        <Download size={14} className="text-[var(--color-accent)]" />
        <span className="text-sm font-semibold">{t('bpTitle', language)}</span>
        <span className="text-[10px] text-[var(--color-text-muted)] ml-1">{database}</span>
        <div className="ml-auto flex items-center gap-2">
          {dumpResult && (
            <button
              onClick={downloadDump}
              className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-[var(--color-success)] hover:bg-[var(--color-success)] text-white transition-colors"
            >
              <Download size={11} /> {t('bpSaveFile', language)}
            </button>
          )}
          <button
            onClick={runDump}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors disabled:opacity-50"
          >
            {running
              ? <RefreshCw size={11} className="animate-spin" />
              : <Play size={11} />
            }
            {running ? t('bpDumping', language) : t('bpStartDump', language)}
          </button>
          <button onClick={onClose} className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 왼쪽: 테이블 선택 */}
        <div className="w-56 border-r border-[var(--color-border)] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0">
            <span className="text-[10px] text-[var(--color-text-muted)]">{t('bpTableSelect', language)}</span>
            <button
              onClick={toggleAll}
              className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              {allSelected ? <CheckSquare size={11} /> : <Square size={11} />}
              {allSelected ? t('bpDeselectAll', language) : t('bpSelectAll', language)}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw size={14} className="animate-spin text-[var(--color-text-muted)]" />
              </div>
            ) : (
              tables.map((t) => (
                <label
                  key={t}
                  className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--color-bg-tertiary)] transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedTables.has(t)}
                    onChange={() => toggleTable(t)}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="text-xs text-[var(--color-text-primary)] truncate">{t}</span>
                </label>
              ))
            )}
          </div>
          <div className="px-3 py-1.5 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">
            {selectedTables.size} / {tables.length} {t('bpSelectedSuffix', language)}
          </div>
        </div>

        {/* 오른쪽: 옵션 + 진행률 + 미리보기 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 옵션 패널 */}
          <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
            <div className="text-[10px] text-[var(--color-text-muted)] mb-2 uppercase tracking-wider">{t('bpDumpOptions', language)}</div>
            <div className="flex flex-wrap gap-4">
              {[
                [noData, setNoData, 'bpOptNoData'] as const,
                [noCreate, setNoCreate, 'bpOptNoCreate'] as const,
                [dropTable, setDropTable, 'bpOptDropTable'] as const,
                [insertIgnore, setInsertIgnore, 'bpOptInsertIgnore'] as const,
              ].map(([val, setter, labelKey]) => (
                <label key={labelKey} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={val}
                    onChange={(e) => setter(e.target.checked)}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="text-[var(--color-text-subtle)]">{t(labelKey, language)}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-[var(--color-text-muted)]">{t('bpBatchSize', language)}</span>
              <input
                type="number"
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                min={100} max={5000} step={100}
                className="w-20 h-6 px-2 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
              />
            </div>
          </div>

          {/* 진행률 */}
          {(running || progress) && (
            <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
              {progress && (
                <>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[var(--color-text-subtle)]">{progress.table}</span>
                    <span className="text-[var(--color-success)]">{progress.phase === 'done' ? t('bpDone', language) : `${Math.round(progress.percent)}%`}</span>
                  </div>
                  <div className="w-full h-1.5 bg-[var(--color-border)] rounded overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-accent)] transition-all duration-200"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
                    {progress.rowsDone.toLocaleString()} / {progress.totalRows.toLocaleString()} {t('bpRowsSuffix', language)}
                  </div>
                </>
              )}
            </div>
          )}

          {/* SQL 미리보기 */}
          <div className="flex-1 overflow-auto p-4">
            {dumpResult ? (
              <pre className="text-[11px] text-[var(--color-text-subtle)] whitespace-pre-wrap font-mono leading-5">
                {dumpResult.slice(0, 10000)}
                {dumpResult.length > 10000 && (
                  <span className="text-[var(--color-text-muted)]">
                    {'\n'}{t('bpTruncatedNote', language).replace('{n}', String(Math.round(dumpResult.length / 1024)))}
                  </span>
                )}
              </pre>
            ) : (
              <div className="text-center text-[var(--color-text-muted)] text-sm mt-8">
                {t('bpEmptyHint', language)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
