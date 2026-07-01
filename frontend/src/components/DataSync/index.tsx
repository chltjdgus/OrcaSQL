import { useState } from 'react'
import Editor from '@monaco-editor/react'
import {
  RefreshCw, ArrowRightLeft, Check, X, Plus, Minus, Edit3, Database, Table2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { CompareTableData, SyncTableData, ListDatabases, ListTables } from '@/wailsjs/go/main/App'
import { useConnectionStore } from '@/stores/connectionStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { useQuery } from '@tanstack/react-query'
import { t } from '@/i18n'
import { nativeConfirm } from '@/utils/nativeConfirm'
import type { DataSyncResult, DataDiffRow, DataDiffAction } from '@/types'

interface Props {
  onClose: () => void
}

/** 액션별 색상 및 아이콘 */
const ACTION_META: Record<DataDiffAction, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  INSERT: { label: 'INSERT', color: '#48bb78', bg: '#1a2e1a', icon: <Plus size={11} /> },
  UPDATE: { label: 'UPDATE', color: '#4299e1', bg: '#1a2233', icon: <Edit3 size={11} /> },
  DELETE: { label: 'DELETE', color: '#fc8181', bg: '#2e1a1a', icon: <Minus size={11} /> },
}

/**
 * Data Synchronization 패널.
 * 소스/대상 연결+DB+테이블 선택 → 데이터 비교(PK 기준) → diff 목록 → SQL 미리보기 → 적용.
 */
export default function DataSync({ onClose }: Props) {
  const { activeConnections } = useConnectionStore()
  const language = useLanguageStore((s) => s.language)

  const [srcConn, setSrcConn] = useState(activeConnections[0]?.id ?? '')
  const [srcDB, setSrcDB]     = useState('')
  const [srcTable, setSrcTable] = useState('')
  const [dstConn, setDstConn] = useState(activeConnections[0]?.id ?? '')
  const [dstDB, setDstDB]     = useState('')
  const [dstTable, setDstTable] = useState('')
  const [maxRows, setMaxRows]  = useState(5000)

  const [comparing, setComparing]   = useState(false)
  const [applying, setApplying]     = useState(false)
  const [result, setResult]         = useState<DataSyncResult | null>(null)
  const [selectedDiff, setSelectedDiff] = useState<DataDiffRow | null>(null)
  const [activeTab, setActiveTab]   = useState<'diff' | 'sql'>('diff')

  // ─── DB 목록 (소스/대상) ────────────────────────────────────────────────
  const { data: srcDBs = [] } = useQuery({
    queryKey: ['dbs', srcConn],
    queryFn: () => (srcConn ? ListDatabases(srcConn) : Promise.resolve([])),
    enabled: !!srcConn,
  })
  const { data: dstDBs = [] } = useQuery({
    queryKey: ['dbs', dstConn],
    queryFn: () => (dstConn ? ListDatabases(dstConn) : Promise.resolve([])),
    enabled: !!dstConn,
  })

  // ─── 테이블 목록 (소스/대상) ─────────────────────────────────────────────
  const { data: srcTables = [] } = useQuery({
    queryKey: ['tables', srcConn, srcDB],
    queryFn: () =>
      srcConn && srcDB
        ? ListTables(srcConn, srcDB).then((ts) => ts.map((t) => t.name))
        : Promise.resolve([]),
    enabled: !!srcConn && !!srcDB,
  })
  const { data: dstTables = [] } = useQuery({
    queryKey: ['tables', dstConn, dstDB],
    queryFn: () =>
      dstConn && dstDB
        ? ListTables(dstConn, dstDB).then((ts) => ts.map((t) => t.name))
        : Promise.resolve([]),
    enabled: !!dstConn && !!dstDB,
  })

  async function runCompare() {
    if (!srcConn || !srcDB || !srcTable || !dstConn || !dstDB || !dstTable) {
      toast.error(t('dsCompareSelectAll', language))
      return
    }
    setComparing(true)
    setResult(null)
    setSelectedDiff(null)
    try {
      const res = await CompareTableData(
        srcConn, srcDB, srcTable,
        dstConn, dstDB, dstTable,
        maxRows,
      )
      setResult(res)
      if (res.diffs.length === 0) {
        toast.success(t('dsIdentical', language))
      } else {
        toast(language === 'ko' ? `차이 ${res.diffs.length}건 발견` : `Found ${res.diffs.length} difference(s)`, { icon: '🔍' })
      }
    } catch (e) {
      toast.error(`${t('dsCompareFailPrefix', language)}${e}`)
    } finally {
      setComparing(false)
    }
  }

  async function applySync() {
    if (!result?.syncSql) return
    const ok = await nativeConfirm({
      title: t('dsyncApplyTitle', language),
      message: t('dsyncApplyBody', language).replace('{n}', String(result.diffs.length)),
      language,
    })
    if (!ok) return
    setApplying(true)
    try {
      await SyncTableData(dstConn, dstDB, result.syncSql)
      toast.success(t('dsApplyDone', language))
      setResult(null)
    } catch (e) {
      toast.error(`${t('dsApplyFailPrefix', language)}${e}`)
    } finally {
      setApplying(false)
    }
  }

  // INSERT/UPDATE/DELETE 카운트
  const counts = result
    ? result.diffs.reduce(
        (acc, d) => { acc[d.action] = (acc[d.action] ?? 0) + 1; return acc },
        {} as Record<DataDiffAction, number>,
      )
    : null

  const sel = `text-[11px] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded px-2 py-1
               focus:outline-none focus:border-[var(--color-accent)] w-full`
  const btn = `px-3 py-1.5 rounded text-[11px] font-medium transition-colors`

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] overflow-hidden">

      {/* ── 헤더 ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
        <div className="flex items-center gap-2">
          <ArrowRightLeft size={14} className="text-[var(--color-accent)]" />
          <span className="text-xs font-semibold">Data Synchronization</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)]">
          <X size={14} />
        </button>
      </div>

      {/* ── 설정 폼 ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_32px_1fr] gap-2 px-4 py-3 border-b border-[var(--color-border)] shrink-0">

        {/* 소스 */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-[var(--color-accent)] uppercase tracking-wider flex items-center gap-1">
            <Database size={10} /> {t('dsSource', language)}
          </p>
          <select className={sel} value={srcConn} onChange={(e) => { setSrcConn(e.target.value); setSrcDB(''); setSrcTable('') }}>
            <option value="">{t('dsSelectConn', language)}</option>
            {activeConnections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select className={sel} value={srcDB} onChange={(e) => { setSrcDB(e.target.value); setSrcTable('') }} disabled={!srcConn}>
            <option value="">{t('dsSelectDb', language)}</option>
            {srcDBs.map((db) => <option key={db} value={db}>{db}</option>)}
          </select>
          <select className={sel} value={srcTable} onChange={(e) => setSrcTable(e.target.value)} disabled={!srcDB}>
            <option value="">{t('dsSelectTable', language)}</option>
            {srcTables.map((t) => <option key={t} value={t}><Table2 size={10} /> {t}</option>)}
          </select>
        </div>

        {/* 화살표 */}
        <div className="flex items-center justify-center mt-6">
          <ArrowRightLeft size={16} className="text-[var(--color-null)]" />
        </div>

        {/* 대상 */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-[var(--color-success)] uppercase tracking-wider flex items-center gap-1">
            <Database size={10} /> {t('dsTarget', language)}
          </p>
          <select className={sel} value={dstConn} onChange={(e) => { setDstConn(e.target.value); setDstDB(''); setDstTable('') }}>
            <option value="">{t('dsSelectConn', language)}</option>
            {activeConnections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select className={sel} value={dstDB} onChange={(e) => { setDstDB(e.target.value); setDstTable('') }} disabled={!dstConn}>
            <option value="">{t('dsSelectDb', language)}</option>
            {dstDBs.map((db) => <option key={db} value={db}>{db}</option>)}
          </select>
          <select className={sel} value={dstTable} onChange={(e) => setDstTable(e.target.value)} disabled={!dstDB}>
            <option value="">{t('dsSelectTable', language)}</option>
            {dstTables.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* ── 옵션 + 실행 버튼 ────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] shrink-0">
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
          {t('dsMaxRows', language)}
          <input
            type="number"
            min={100}
            max={50000}
            step={500}
            value={maxRows}
            onChange={(e) => setMaxRows(Number(e.target.value))}
            className="w-20 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-0.5 text-[11px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
          />
        </label>

        <button
          onClick={runCompare}
          disabled={comparing || !srcConn || !srcDB || !srcTable || !dstConn || !dstDB || !dstTable}
          className={`${btn} bg-[#2b4a7a] hover:bg-[#3182ce] text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5`}
        >
          {comparing ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {comparing ? t('dsComparing', language) : t('dsCompareStart', language)}
        </button>

        {result && result.diffs.length > 0 && (
          <button
            onClick={applySync}
            disabled={applying}
            className={`${btn} bg-[#276749] hover:bg-[#38a169] text-white disabled:opacity-40 flex items-center gap-1.5`}
          >
            {applying ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
            {applying ? t('dsApplying', language) : t('dsApplySync', language)}
          </button>
        )}

        {/* 요약 배지 */}
        {counts && (
          <div className="flex items-center gap-2 ml-auto">
            {(['INSERT', 'UPDATE', 'DELETE'] as DataDiffAction[]).map((action) =>
              counts[action] ? (
                <span
                  key={action}
                  className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: ACTION_META[action].color, background: ACTION_META[action].bg }}
                >
                  {ACTION_META[action].icon}
                  {counts[action]} {action}
                </span>
              ) : null,
            )}
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {language === 'ko'
                ? `소스 ${result!.srcCount.toLocaleString()}행 / 대상 ${result!.dstCount.toLocaleString()}행`
                : `Source ${result!.srcCount.toLocaleString()} rows / Target ${result!.dstCount.toLocaleString()} rows`}
            </span>
          </div>
        )}
      </div>

      {/* ── 본문: Diff 목록 + SQL 미리보기 ─────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* 탭 */}
        {result && (
          <div className="flex border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
            {(['diff', 'sql'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-[11px] border-b-2 transition-colors
                  ${activeTab === tab
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-bg-primary)]'
                    : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}
              >
                {tab === 'diff' ? `${t('dsDiffList', language)} (${result.diffs.length})` : t('dsSqlPreview', language)}
              </button>
            ))}
          </div>
        )}

        {!result && !comparing && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-[var(--color-null)]">
            <ArrowRightLeft size={36} />
            <p className="text-sm">{t('dsCompareEmptyHint', language)}</p>
          </div>
        )}

        {comparing && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-[var(--color-text-muted)]">
            <RefreshCw size={28} className="animate-spin text-[var(--color-accent)]" />
            <p className="text-sm">{t('dsComparingData', language)}</p>
          </div>
        )}

        {result && activeTab === 'diff' && (
          <div className="flex flex-1 overflow-hidden">

            {/* Diff 목록 */}
            <div className="w-1/2 overflow-y-auto border-r border-[var(--color-border)]">
              {result.diffs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--color-text-muted)]">
                  <Check size={28} className="text-[#48bb78]" />
                  <p className="text-sm">{t('dsDataIdentical', language)}</p>
                </div>
              ) : (
                <table className="w-full text-[11px] border-collapse">
                  <thead className="sticky top-0 bg-[var(--color-bg-secondary)] z-10">
                    <tr>
                      <th className="text-left px-3 py-1.5 text-[10px] text-[var(--color-text-muted)] font-semibold uppercase border-b border-[var(--color-border)] w-20">{t('dsColAction', language)}</th>
                      <th className="text-left px-3 py-1.5 text-[10px] text-[var(--color-text-muted)] font-semibold uppercase border-b border-[var(--color-border)]">PK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.diffs.map((diff, idx) => {
                      const meta = ACTION_META[diff.action]
                      return (
                        <tr
                          key={idx}
                          onClick={() => setSelectedDiff(diff)}
                          className={`border-b border-[var(--color-bg-secondary)] cursor-pointer transition-colors
                            ${selectedDiff === diff ? 'bg-[var(--color-bg-tertiary)]' : 'hover:bg-[var(--color-bg-secondary)]'}`}
                        >
                          <td className="px-3 py-1.5">
                            <span
                              className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded w-fit"
                              style={{ color: meta.color, background: meta.bg }}
                            >
                              {meta.icon} {meta.label}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[var(--color-text-subtle)] truncate max-w-[200px]">
                            {diff.pk}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* 행 상세 (우측) */}
            <div className="w-1/2 overflow-y-auto">
              {!selectedDiff ? (
                <div className="flex items-center justify-center h-full text-[var(--color-null)] text-xs">
                  {t('dsClickRowDetail', language)}
                </div>
              ) : (
                <DiffDetail diff={selectedDiff} />
              )}
            </div>
          </div>
        )}

        {result && activeTab === 'sql' && (
          <div className="flex-1 overflow-hidden">
            <Editor
              height="100%"
              defaultLanguage="sql"
              value={result.syncSql || t('dsNoDiffComment', language)}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'off',
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── DiffDetail ─────────────────────────────────────────────────────────────

function DiffDetail({ diff }: { diff: DataDiffRow }) {
  const language = useLanguageStore((s) => s.language)
  const meta = ACTION_META[diff.action]

  // 비교할 컬럼 목록
  const cols = Object.keys(diff.srcRow ?? diff.dstRow ?? {})

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded"
          style={{ color: meta.color, background: meta.bg }}
        >
          {meta.icon} {meta.label}
        </span>
        <span className="text-[11px] font-mono text-[var(--color-text-muted)]">PK: {diff.pk}</span>
      </div>

      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="text-left px-2 py-1 text-[10px] text-[var(--color-text-muted)] font-semibold uppercase">{t('dsColColumn', language)}</th>
            <th className="text-left px-2 py-1 text-[10px] text-[var(--color-accent)] font-semibold uppercase">{t('dsSource', language)}</th>
            {diff.action === 'UPDATE' && (
              <th className="text-left px-2 py-1 text-[10px] text-[var(--color-error)] font-semibold uppercase">{t('dsColTargetBefore', language)}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {cols.map((col) => {
            const srcVal = diff.srcRow?.[col] ?? '—'
            const dstVal = diff.dstRow?.[col] ?? '—'
            const changed = diff.action === 'UPDATE' && srcVal !== dstVal
            return (
              <tr
                key={col}
                className={`border-b border-[var(--color-bg-secondary)] ${changed ? 'bg-[var(--color-error)]/10' : ''}`}
              >
                <td className="px-2 py-1 text-[var(--color-text-muted)] font-mono">{col}</td>
                <td className={`px-2 py-1 font-mono ${changed ? 'text-[#48bb78]' : 'text-[var(--color-text-primary)]'}`}>
                  {srcVal === 'NULL' ? <span className="text-[var(--color-null)] italic">NULL</span> : srcVal}
                </td>
                {diff.action === 'UPDATE' && (
                  <td className={`px-2 py-1 font-mono ${changed ? 'text-[var(--color-error)] line-through' : 'text-[var(--color-text-muted)]'}`}>
                    {dstVal === 'NULL' ? <span className="text-[var(--color-null)] italic">NULL</span> : dstVal}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* SQL 미리보기 */}
      <div>
        <p className="text-[10px] text-[var(--color-null)] mb-1 uppercase">{t('dsGenSql', language)}</p>
        <pre className="bg-[var(--color-bg-secondary)] rounded p-2 text-[10px] font-mono text-[var(--color-text-subtle)] overflow-x-auto whitespace-pre-wrap">
          {diff.sql}
        </pre>
      </div>
    </div>
  )
}
