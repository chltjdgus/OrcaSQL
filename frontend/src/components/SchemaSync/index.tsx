import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { RefreshCw, GitCompare, Check, X, Plus, Minus, Edit3 } from 'lucide-react'
import toast from 'react-hot-toast'
import { CompareSchemas, ApplySyncSQL } from '@/wailsjs/go/main/App'
import { useConnectionStore } from '@/stores/connectionStore'
import { useThemeStore } from '@/stores/useThemeStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import type { SchemaSyncResult, SchemaDiffItem } from '@/types'

interface Props {
  onClose: () => void
}

/**
 * Schema Synchronization 패널.
 * 소스/대상 연결+DB 선택 → 비교 → diff 목록 → SQL 미리보기 → 적용.
 */
export default function SchemaSync({ onClose }: Props) {
  const { activeConnections } = useConnectionStore()
  const theme = useThemeStore((s) => s.theme)
  const language = useLanguageStore((s) => s.language)

  const [srcConn, setSrcConn] = useState(activeConnections[0]?.id ?? '')
  const [srcDB, setSrcDB] = useState('')
  const [dstConn, setDstConn] = useState(activeConnections[0]?.id ?? '')
  const [dstDB, setDstDB] = useState('')

  const [comparing, setComparing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<SchemaSyncResult | null>(null)
  const [selectedSQL, setSelectedSQL] = useState<string | null>(null)

  async function runCompare() {
    if (!srcConn || !srcDB || !dstConn || !dstDB) {
      toast.error(t('ssyncSelectAll', language))
      return
    }
    setComparing(true)
    setResult(null)
    try {
      const res = await CompareSchemas(srcConn, srcDB, dstConn, dstDB)
      setResult(res)
      if (res.diffs.length === 0) {
        toast.success(t('ssyncIdentical', language))
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
    setApplying(true)
    try {
      await ApplySyncSQL(dstConn, dstDB, result.syncSql)
      toast.success(t('ssyncApplyDone', language))
      setResult(null)
    } catch (e) {
      toast.error(`${t('dsApplyFailPrefix', language)}${e}`)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0">
        <GitCompare size={14} className="text-[#b794f4]" />
        <span className="text-sm font-semibold">Schema Synchronization</span>
        <div className="ml-auto flex items-center gap-2">
          {result && result.diffs.length > 0 && (
            <button
              onClick={applySync}
              disabled={applying}
              className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-[var(--color-error)] hover:bg-[var(--color-error)] text-white transition-colors disabled:opacity-50"
            >
              {applying ? <RefreshCw size={11} className="animate-spin" /> : <Check size={11} />}
              {t('ssyncApplyToTarget', language)}
            </button>
          )}
          <button onClick={onClose} className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 소스/대상 설정 */}
      <div className="flex items-end gap-4 px-4 py-3 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0">
        <ConnSelector
          label={t('ssyncSrcLabel', language)}
          connections={activeConnections}
          connId={srcConn}
          database={srcDB}
          onConnChange={setSrcConn}
          onDBChange={setSrcDB}
          color="text-[var(--color-success)]"
        />
        <span className="text-[var(--color-text-muted)] text-xl pb-1">→</span>
        <ConnSelector
          label={t('ssyncDstLabel', language)}
          connections={activeConnections}
          connId={dstConn}
          database={dstDB}
          onConnChange={setDstConn}
          onDBChange={setDstDB}
          color="text-[var(--color-error)]"
        />
        <button
          onClick={runCompare}
          disabled={comparing}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors disabled:opacity-50 mb-0.5 shrink-0"
        >
          {comparing ? <RefreshCw size={11} className="animate-spin" /> : <GitCompare size={11} />}
          {comparing ? t('dsComparing', language) : t('ssyncCompareBtn', language)}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Diff 목록 */}
        <div className="w-64 border-r border-[var(--color-border)] flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0">
            <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">
              {t('ssyncChangeList', language)} ({result?.diffs.length ?? 0})
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!result ? (
              <div className="text-center text-[var(--color-text-muted)] text-xs mt-6">{t('ssyncRunCompare', language)}</div>
            ) : result.diffs.length === 0 ? (
              <div className="flex items-center justify-center gap-1 mt-6 text-[var(--color-success)] text-xs">
                <Check size={12} /> {t('ssyncNoDiff', language)}
              </div>
            ) : (
              result.diffs.map((diff, i) => (
                <DiffRow
                  key={i}
                  diff={diff}
                  selected={selectedSQL === diff.sql}
                  onClick={() => setSelectedSQL(diff.sql)}
                />
              ))
            )}
          </div>
        </div>

        {/* SQL 미리보기 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0 flex items-center justify-between">
            <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">
              {selectedSQL ? t('ssyncSelectedSql', language) : t('ssyncAllSyncSql', language)}
            </span>
            {selectedSQL && (
              <button
                onClick={() => setSelectedSQL(null)}
                className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                {t('ssyncViewAll', language)}
              </button>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            <Editor
              language="sql"
              value={selectedSQL ?? result?.syncSql ?? t('ssyncResultPlaceholder', language)}
              theme={theme === 'dark' ? 'vs-dark' : 'vs'}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                padding: { top: 8 },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 헬퍼 컴포넌트 ──────────────────────────────────────────────────────────

function ConnSelector({
  label, connections, connId, database, onConnChange, onDBChange, color,
}: {
  label: string
  connections: { id: string; name: string }[]
  connId: string
  database: string
  onConnChange: (v: string) => void
  onDBChange: (v: string) => void
  color: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-[10px] font-medium ${color}`}>{label}</span>
      <div className="flex items-center gap-2">
        <select
          value={connId}
          onChange={(e) => onConnChange(e.target.value)}
          className="h-7 px-2 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] w-36"
        >
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          value={database}
          onChange={(e) => onDBChange(e.target.value)}
          placeholder="database"
          className="h-7 px-2 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] w-28"
        />
      </div>
    </div>
  )
}

function DiffRow({
  diff,
  selected,
  onClick,
}: {
  diff: SchemaDiffItem
  selected: boolean
  onClick: () => void
}) {
  const icons = {
    ADD: <Plus size={11} className="text-[var(--color-success)] shrink-0" />,
    DROP: <Minus size={11} className="text-[var(--color-error)] shrink-0" />,
    MODIFY: <Edit3 size={11} className="text-[var(--color-warning)] shrink-0" />,
  }
  const colors = {
    ADD: 'text-[var(--color-success)]',
    DROP: 'text-[var(--color-error)]',
    MODIFY: 'text-[var(--color-warning)]',
  }

  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors text-xs ${
        selected ? 'bg-[var(--color-bg-hover)]' : 'hover:bg-[var(--color-bg-tertiary)]'
      }`}
    >
      {icons[diff.action as keyof typeof icons]}
      <div className="min-w-0">
        <div className={`font-medium ${colors[diff.action as keyof typeof colors]}`}>
          {diff.action}
        </div>
        <div className="text-[var(--color-text-primary)] truncate">{diff.objectName}</div>
        {diff.subName && (
          <div className="text-[var(--color-text-muted)] text-[10px] truncate">.{diff.subName}</div>
        )}
        <div className="text-[var(--color-null)] text-[10px]">{diff.objectType}</div>
      </div>
    </div>
  )
}
