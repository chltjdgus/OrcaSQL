/**
 * 환경설정 패널 (SQLyog Preferences 스타일).
 *
 * 탭 구조:
 *  ┌──────────────────────────────────────────────────────────┐
 *  │  [에디터]  [쿼리]  [표시]  [SQL 포매터]  [SSH]           │
 *  ├──────────────────────────────────────────────────────────┤
 *  │  설정 항목들...                                          │
 *  ├──────────────────────────────────────────────────────────┤
 *  │  [기본값 복원] [불러오기] [내보내기]   [한/EN]  [닫기]  │
 *  └──────────────────────────────────────────────────────────┘
 */
import React, { useState, useCallback, useEffect, useMemo, useRef, type ChangeEvent } from 'react'
import {
  Code2, Play, Eye, RotateCcw, Key, Trash2, RefreshCw, ShieldCheck,
  AlignLeft, ChevronRight, ChevronDown, Settings2, Type, WrapText,
  Download, Upload, FileCode2, Plug, Copy as CopyIcon, Power,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format as sqlFormat } from 'sql-formatter'
import {
  SetQueryTimeout, ListKnownHosts, DeleteKnownHost, type KnownHostEntry,
  GetMCPConfig, UpdateMCPConfig, GetMCPStatus, RegenerateMCPToken,
  RevealMCPToken, GetMCPClientConfigSnippet, GetMCPAIPromptSnippet,
  CheckMCPPortAvailable, TestMCPConnection, GetSavedConnections, ListConnections,
  type MCPConfig, type MCPStatus,
} from '@/wailsjs/go/main/App'
import type { ConnectConfig } from '@/types'
import {
  useSettingsStore,
  type EditorSettings,
  type QuerySettings,
  type DisplaySettings,
  type SchemaTreeSettings,
  type FormatterSettings,
  type FormatterCase,
  type FormatterIndentStyle,
  type FormatterLogicalNewline,
  type FormatterDialect,
} from '@/stores/useSettingsStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t, type Language } from '@/i18n'
import { nativeConfirm } from '@/utils/nativeConfirm'

interface Props {
  onClose: () => void
  /** 초기에 활성화할 탭 (예: 'mcp'). 미지정 시 'editor'. */
  initialTab?: string
}

type SettingsTab = 'editor' | 'query' | 'display' | 'formatter' | 'ssh' | 'mcp'

const VALID_TABS: SettingsTab[] = ['editor', 'query', 'display', 'formatter', 'ssh', 'mcp']

function isValidTab(t: string | undefined): t is SettingsTab {
  return !!t && (VALID_TABS as string[]).includes(t)
}

const FONT_FAMILIES = [
  { label: 'JetBrains Mono', value: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace" },
  { label: 'Fira Code', value: "'Fira Code', 'Cascadia Code', Menlo, monospace" },
  { label: 'Cascadia Code', value: "'Cascadia Code', Consolas, monospace" },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Menlo', value: 'Menlo, Monaco, monospace' },
  { label: 'Monaco', value: 'Monaco, Menlo, monospace' },
]

const DIALECT_OPTIONS: { value: FormatterDialect; label: string }[] = [
  { value: 'mysql',      label: 'MySQL' },
  { value: 'mariadb',    label: 'MariaDB' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'sqlite',     label: 'SQLite' },
  { value: 'tsql',       label: 'T-SQL (SQL Server)' },
  { value: 'plsql',      label: 'PL/SQL (Oracle)' },
  { value: 'bigquery',   label: 'BigQuery' },
  { value: 'redshift',   label: 'Redshift' },
  { value: 'snowflake',  label: 'Snowflake' },
  { value: 'db2',        label: 'DB2' },
  { value: 'sql',        label: 'Standard SQL' },
]

export default function SettingsPanel({ onClose, initialTab }: Props) {
  const {
    settings,
    updateEditor,
    updateQuery,
    updateDisplay,
    updateSchemaTree,
    updateFormatter,
    resetToDefaults,
    exportToJSON,
    importFromJSON,
  } = useSettingsStore()
  const { language, setLanguage } = useLanguageStore()
  const [activeTab, setActiveTab] = useState<SettingsTab>(isValidTab(initialTab) ? initialTab : 'editor')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 로컬 draft — 확인 버튼 없이 즉시 반영 (SQLyog 방식)
  const ed = settings.editor
  const qr = settings.query
  const dp = settings.display
  const st = settings.schemaTree
  const fm = settings.formatter

  // 쿼리 타임아웃 변경 시 Go 백엔드에도 즉시 반영
  const handleQueryChange = useCallback(async (patch: Partial<typeof qr>) => {
    updateQuery(patch)
    if (patch.queryTimeout !== undefined) {
      try {
        await SetQueryTimeout(patch.queryTimeout)
      } catch {
        toast.error(t('toastTimeoutFail', language))
      }
    }
  }, [updateQuery, qr, language])

  async function handleReset() {
    const ok = await nativeConfirm({
      title: t('restoreDefaults', language),
      message: t('confirmResetSettings', language),
      language,
    })
    if (!ok) return
    resetToDefaults()
  }

  // 설정 내보내기 — JSON 파일로 저장
  function handleExport() {
    try {
      const json = exportToJSON()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      a.href = url
      a.download = `websql-settings-${ts}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(t('toastExportSuccess', language))
    } catch {
      toast.error(t('toastExportFail', language))
    }
  }

  // 설정 불러오기 — JSON 파일에서 import
  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 파일 재선택 가능하도록 초기화
    if (!file) return
    const confirmMsg = language === 'ko'
      ? `'${file.name}' ${t('confirmImportSettings', language)}`
      : `${t('confirmImportSettings', language)} ('${file.name}')`
    const ok = await nativeConfirm({
      title: t('importSettings', language),
      message: confirmMsg,
      language,
    })
    if (!ok) return
    try {
      const text = await file.text()
      importFromJSON(text)
      // 쿼리 타임아웃이 바뀌었을 수 있으므로 백엔드에도 동기화
      const newTimeout = useSettingsStore.getState().settings.query.queryTimeout
      try { await SetQueryTimeout(newTimeout) } catch { /* 무시 */ }
      toast.success(t('toastImportSuccess', language))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`${t('toastExportFail', language)}: ${msg}`)
    }
  }

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'editor',    label: t('tabEditor', language),    icon: <Code2 size={13} /> },
    { id: 'query',     label: t('tabQuery', language),     icon: <Play size={13} /> },
    { id: 'display',   label: t('tabDisplay', language),   icon: <Eye size={13} /> },
    { id: 'formatter', label: t('tabFormatter', language), icon: <AlignLeft size={13} /> },
    { id: 'ssh',       label: t('tabSsh', language),       icon: <Key size={13} /> },
    { id: 'mcp',       label: t('tabMcp', language),       icon: <Plug size={13} /> },
  ]

  return (
    <div className="flex flex-col h-full text-[var(--color-text-primary)]">
      {/* 탭 바 */}
      <div className="flex border-b border-[var(--color-border)] bg-[var(--color-bg-primary)] shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'border-[var(--color-accent)] text-[var(--color-text-primary)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-subtle)]'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* 설정 내용 — 포매터 탭은 자체 레이아웃을 쓰므로 패딩 제외 */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === 'editor' && (
          <div className="flex-1 overflow-y-auto p-6">
            <EditorTab settings={ed} onChange={updateEditor} language={language} />
          </div>
        )}
        {activeTab === 'query' && (
          <div className="flex-1 overflow-y-auto p-6">
            <QueryTab settings={qr} onChange={handleQueryChange} language={language} />
          </div>
        )}
        {activeTab === 'display' && (
          <div className="flex-1 overflow-y-auto p-6">
            <DisplayTab settings={dp} onChange={updateDisplay} schemaTree={st} onSchemaTreeChange={updateSchemaTree} language={language} />
          </div>
        )}
        {activeTab === 'formatter' && (
          <div className="flex-1 min-h-0">
            <FormatterTab settings={fm} onChange={updateFormatter} language={language} />
          </div>
        )}
        {activeTab === 'ssh' && (
          <div className="flex-1 overflow-y-auto p-6">
            <SSHTab language={language} />
          </div>
        )}
        {activeTab === 'mcp' && (
          <div className="flex-1 overflow-y-auto p-6">
            <MCPTab language={language} />
          </div>
        )}
      </div>

      {/* 숨겨진 파일 input — 설정 가져오기용 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleImportFile}
        className="hidden"
      />

      {/* 하단 버튼 바 */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg-primary)] shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] rounded transition-colors"
          >
            <RotateCcw size={12} />
            {t('restoreDefaults', language)}
          </button>
          <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
          <button
            onClick={handleImportClick}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] rounded transition-colors"
            title="JSON 파일에서 설정 불러오기"
          >
            <Upload size={12} />
            {t('importSettings', language)}
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] rounded transition-colors"
            title="현재 설정을 JSON 파일로 내보내기"
          >
            <Download size={12} />
            {t('exportSettings', language)}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* 언어 토글 */}
          <div className="flex items-center border border-[var(--color-border)] rounded overflow-hidden">
            {(['ko', 'en'] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                className={`px-2 py-1 text-[11px] transition-colors ${
                  language === lang
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)]'
                }`}
              >
                {lang === 'ko' ? '한' : 'EN'}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white rounded transition-colors"
          >
            {t('close', language)}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 에디터 탭 ──────────────────────────────────────────────────────────────

function EditorTab({
  settings,
  onChange,
  language,
}: {
  settings: EditorSettings
  onChange: (patch: Partial<EditorSettings>) => void
  language: Language
}) {
  return (
    <div className="space-y-6 max-w-lg">
      <Section title={t('sectionFont', language)}>
        <Field label={t('fieldFontFamily', language)}>
          <select
            value={settings.fontFamily}
            onChange={(e) => onChange({ fontFamily: e.target.value })}
            className="w-full bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.label} value={f.value}>{f.label}</option>
            ))}
          </select>
        </Field>

        <Field label={t('fieldFontSize', language)} hint={`${settings.fontSize}px`}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={10}
              max={24}
              step={1}
              value={settings.fontSize}
              onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
              className="flex-1 accent-[#4299e1]"
            />
            <span
              className="font-mono text-xs"
              style={{ fontFamily: settings.fontFamily, fontSize: settings.fontSize }}
            >
              SELECT * FROM table;
            </span>
          </div>
        </Field>
      </Section>

      <Section title={t('sectionEditor', language)}>
        <Field label={t('fieldTabSize', language)}>
          <div className="flex gap-2">
            {[2, 4].map((n) => (
              <button
                key={n}
                onClick={() => onChange({ tabSize: n })}
                className={`px-4 py-1 text-xs rounded border transition-colors ${
                  settings.tabSize === n
                    ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {n} {t('spaces', language)}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t('fieldWordWrap', language)}>
          <Toggle
            checked={settings.wordWrap === 'on'}
            onChange={(v) => onChange({ wordWrap: v ? 'on' : 'off' })}
          />
        </Field>

        <Field label={t('fieldMinimap', language)}>
          <Toggle
            checked={settings.minimap}
            onChange={(v) => onChange({ minimap: v })}
          />
        </Field>

        <Field label={t('fieldLineNumbers', language)}>
          <Toggle
            checked={settings.lineNumbers === 'on'}
            onChange={(v) => onChange({ lineNumbers: v ? 'on' : 'off' })}
          />
        </Field>
      </Section>

      {/* 미리보기 */}
      <Section title={t('sectionPreview', language)}>
        <div
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg-deep)] p-3 text-[var(--color-text-primary)] leading-relaxed"
          style={{ fontFamily: settings.fontFamily, fontSize: settings.fontSize }}
        >
          <span className="text-[#4299e1]">SELECT</span>{' '}
          <span className="text-[#f6e05e]">id</span>,{' '}
          <span className="text-[#f6e05e]">name</span>,{' '}
          <span className="text-[#f6e05e]">created_at</span>
          <br />
          <span className="text-[#4299e1]">FROM</span>{' '}
          <span className="text-[#68d391]">users</span>
          <br />
          <span className="text-[#4299e1]">WHERE</span>{' '}
          <span className="text-[#f6e05e]">status</span>{' '}
          <span className="text-[#fc8181]">=</span>{' '}
          <span className="text-[#fbd38d]">&apos;active&apos;</span>
          <br />
          <span className="text-[#4299e1]">LIMIT</span>{' '}
          <span className="text-[#fbd38d]">100</span>;
        </div>
      </Section>
    </div>
  )
}

// ─── 쿼리 탭 ────────────────────────────────────────────────────────────────

function QueryTab({
  settings,
  onChange,
  language,
}: {
  settings: QuerySettings
  onChange: (patch: Partial<QuerySettings>) => void | Promise<void>
  language: Language
}) {
  const limitPresets = [100, 500, 1000, 5000, 10000]
  const timeoutPresets = [15, 30, 60, 120, 300]

  function formatDuration(n: number): string {
    if (n >= 60) return `${n / 60}${language === 'ko' ? t('fieldMinutes', language) : 'min'}`
    return `${n}${language === 'ko' ? t('fieldSeconds', language) : 'sec'}`
  }

  return (
    <div className="space-y-6 max-w-lg">
      <Section title={t('sectionResultLimit', language)}>
        <Field
          label={t('fieldSelectLimit', language)}
          hint={t('fieldSelectLimitHint', language)}
        >
          <div className="flex flex-wrap gap-2 mb-2">
            {limitPresets.map((n) => (
              <button
                key={n}
                onClick={() => onChange({ selectLimit: n })}
                className={`px-3 py-1 text-xs rounded border transition-colors ${
                  settings.selectLimit === n
                    ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {n.toLocaleString()}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--color-text-muted)] shrink-0">{t('fieldCustomInput', language)}</span>
            <input
              type="number"
              min={1}
              max={100000}
              value={settings.selectLimit}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v > 0) onChange({ selectLimit: v })
              }}
              className="w-28 bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            <span className="text-[11px] text-[var(--color-null)]">{t('fieldRows', language)}</span>
          </div>
        </Field>
      </Section>

      <Section title={t('sectionExecLimit', language)}>
        <Field
          label={t('tabQuery', language) + ' ' + (language === 'ko' ? '타임아웃' : 'Timeout')}
          hint={`${t('queryTimeoutCurrent', language)} ${settings.queryTimeout}${language === 'ko' ? '초' : 'sec'} — ${language === 'ko' ? '초과 시 자동 취소' : 'auto-cancelled on timeout'}`}
        >
          <div className="flex flex-wrap gap-2 mb-2">
            {timeoutPresets.map((n) => (
              <button
                key={n}
                onClick={() => onChange({ queryTimeout: n })}
                className={`px-3 py-1 text-xs rounded border transition-colors ${
                  settings.queryTimeout === n
                    ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {formatDuration(n)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={5}
              max={300}
              step={5}
              value={settings.queryTimeout}
              onChange={(e) => onChange({ queryTimeout: Number(e.target.value) })}
              className="flex-1 accent-[#4299e1]"
            />
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="number"
                min={5}
                max={300}
                value={settings.queryTimeout}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (v >= 5 && v <= 300) onChange({ queryTimeout: v })
                }}
                className="w-16 bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
              />
              <span className="text-[11px] text-[var(--color-null)]">{t('fieldSeconds', language)}</span>
            </div>
          </div>
        </Field>
      </Section>

      <Section title={t('sectionNotification', language)}>
        <Field
          label={t('fieldNotifyThreshold', language)}
          hint={settings.notifyThresholdSec === 0
            ? t('notifyDisabledHint', language)
            : `${settings.notifyThresholdSec}${language === 'ko' ? t('fieldSeconds', language) : 'sec'}+ ${t('notifyActiveHint', language)}`}
        >
          <div className="flex flex-wrap gap-2 mb-2">
            {[0, 3, 5, 10, 30].map((n) => (
              <button
                key={n}
                onClick={() => onChange({ notifyThresholdSec: n })}
                className={`px-3 py-1 text-xs rounded border transition-colors ${
                  settings.notifyThresholdSec === n
                    ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {n === 0 ? t('notifyDisabled', language) : `${n}${language === 'ko' ? t('fieldSeconds', language) : 'sec'}`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--color-text-muted)] shrink-0">{t('fieldCustomInput', language)}</span>
            <input
              type="number"
              min={0}
              max={300}
              value={settings.notifyThresholdSec}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v >= 0) onChange({ notifyThresholdSec: v })
              }}
              className="w-20 bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            <span className="text-[11px] text-[var(--color-null)]">
              {language === 'ko' ? '초 (0 = 비활성)' : 'sec (0 = off)'}
            </span>
          </div>
        </Field>
      </Section>

      <InfoBox>
        {t('infoQueryTab', language).split('\n').map((line, i) => (
          <span key={i}>{line}{i < 2 ? <br /> : null}</span>
        ))}
      </InfoBox>
    </div>
  )
}

// ─── 표시 탭 ────────────────────────────────────────────────────────────────

function DisplayTab({
  settings,
  onChange,
  schemaTree,
  onSchemaTreeChange,
  language,
}: {
  settings: DisplaySettings
  onChange: (patch: Partial<DisplaySettings>) => void
  schemaTree: SchemaTreeSettings
  onSchemaTreeChange: (patch: Partial<SchemaTreeSettings>) => void
  language: Language
}) {
  const nullPresets = ['NULL', '(null)', '∅', '-', '']

  return (
    <div className="space-y-6 max-w-lg">
      <Section title={t('sectionResultGrid', language)}>
        <Field
          label={t('fieldNullDisplay', language)}
          hint={t('fieldNullDisplayHint', language)}
        >
          <div className="flex flex-wrap gap-2 mb-2">
            {nullPresets.map((p) => (
              <button
                key={p === '' ? 'empty' : p}
                onClick={() => onChange({ nullDisplayText: p })}
                className={`px-3 py-1 text-xs rounded border font-mono transition-colors ${
                  settings.nullDisplayText === p
                    ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {p === '' ? t('emptyString', language) : p}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--color-text-muted)] shrink-0">{t('fieldCustomText', language)}</span>
            <input
              type="text"
              maxLength={20}
              value={settings.nullDisplayText}
              onChange={(e) => onChange({ nullDisplayText: e.target.value })}
              placeholder="NULL"
              className="w-36 font-mono bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            />
          </div>
        </Field>

        {/* 미리보기 */}
        <div className="mt-3">
          <p className="text-[11px] text-[var(--color-null)] mb-2">{t('sectionPreview', language)}</p>
          <table className="text-[11px] border-collapse w-full">
            <thead>
              <tr className="bg-[var(--color-bg-secondary)]">
                {['id', 'name', 'email'].map((col) => (
                  <th key={col} className="px-3 py-1.5 text-left border border-[var(--color-border)] text-[var(--color-text-muted)] font-medium">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-text-primary)]">1</td>
                <td className="px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-text-primary)]">Alice</td>
                <td className="px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-null)] italic font-mono">
                  {settings.nullDisplayText === '' ? '\u00a0' : settings.nullDisplayText}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-text-primary)]">2</td>
                <td className="px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-null)] italic font-mono">
                  {settings.nullDisplayText === '' ? '\u00a0' : settings.nullDisplayText}
                </td>
                <td className="px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-text-primary)]">bob@example.com</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t('sectionSchemaTree', language)}>
        <Field
          label={t('fieldTableBadge', language)}
          hint={t('fieldTableBadgeHint', language)}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => onSchemaTreeChange({ showRowCount: false })}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors ${
                !schemaTree.showRowCount
                  ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#276749]/30 text-[#68d391] font-mono">1.2 MB</span>
              {t('fieldSchemaTreeSize', language)}
            </button>
            <button
              onClick={() => onSchemaTreeChange({ showRowCount: true })}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors ${
                schemaTree.showRowCount
                  ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-text-subtle)] font-mono">1,234</span>
              {t('fieldSchemaTreeRowCount', language)}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-[var(--color-null)]">
            {t('fieldCurrentSelection', language)}{' '}
            <span className="text-[var(--color-accent)]">
              {schemaTree.showRowCount ? t('displayRowCount', language) : t('displaySize', language)}
            </span>
          </p>
        </Field>
      </Section>
    </div>
  )
}

// ─── SQL 포매터 탭 ─────────────────────────────────────────────────────────
//
// IntelliJ Code Style → SQL 트리 UI 모티브.
// 좌측: 카테고리 트리(접기/펼치기 + 카테고리별 설정 컨트롤)
// 우측: 라이브 미리보기(쿼리 종류 프리셋 + 사용자 입력 SQL)

type FormatterCategory = 'general' | 'case' | 'indent' | 'wrap'

interface PresetQuery {
  id: string
  label: string
  sql: string
}

const FORMATTER_PRESETS: PresetQuery[] = [
  {
    id: 'select',
    label: 'SELECT',
    sql: `select id, name, email, created_at from users where status = 'active' and created_at > '2024-01-01' order by created_at desc limit 100;`,
  },
  {
    id: 'join',
    label: 'JOIN',
    sql: `select u.id, u.name, count(o.id) as order_count, sum(o.total) as total_spent from users u left join orders o on o.user_id = u.id where u.status = 'active' group by u.id, u.name having count(o.id) > 5 order by total_spent desc;`,
  },
  {
    id: 'insert',
    label: 'INSERT',
    sql: `insert into users (name, email, status, created_at) values ('Alice', 'alice@example.com', 'active', now()), ('Bob', 'bob@example.com', 'pending', now());`,
  },
  {
    id: 'update',
    label: 'UPDATE',
    sql: `update users set status = 'archived', updated_at = now() where last_login_at < date_sub(now(), interval 1 year) and status != 'admin';`,
  },
  {
    id: 'cte',
    label: 'CTE',
    sql: `with active_users as (select id, name from users where status = 'active'), recent_orders as (select user_id, total from orders where created_at > '2024-01-01') select au.name, sum(ro.total) as total from active_users au join recent_orders ro on ro.user_id = au.id group by au.id, au.name;`,
  },
]

/** FormatterSettings → sql-formatter 옵션 객체로 변환 */
function buildFormatOptions(s: FormatterSettings) {
  return {
    language: s.dialect,
    tabWidth: s.tabWidth,
    useTabs: s.useTabs,
    keywordCase: s.keywordCase,
    identifierCase: s.identifierCase,
    dataTypeCase: s.dataTypeCase,
    functionCase: s.functionCase,
    indentStyle: s.indentStyle,
    logicalOperatorNewline: s.logicalOperatorNewline,
    expressionWidth: s.expressionWidth,
    linesBetweenQueries: s.linesBetweenQueries,
    denseOperators: s.denseOperators,
    newlineBeforeSemicolon: s.newlineBeforeSemicolon,
  } as const
}

function FormatterTab({
  settings,
  onChange,
  language,
}: {
  settings: FormatterSettings
  onChange: (patch: Partial<FormatterSettings>) => void
  language: Language
}) {
  // 모든 카테고리를 기본 펼침 상태로
  const [expanded, setExpanded] = useState<Record<FormatterCategory, boolean>>({
    general: true,
    case: true,
    indent: true,
    wrap: true,
  })
  const [previewMode, setPreviewMode] = useState<'preset' | 'custom'>('preset')
  const [presetId, setPresetId] = useState<string>('select')
  const [customSQL, setCustomSQL] = useState<string>(
    "select id, name from users where id in (1,2,3) and active = true order by name;"
  )

  function toggle(cat: FormatterCategory) {
    setExpanded((e) => ({ ...e, [cat]: !e[cat] }))
  }

  // 언어별 옵션 라벨
  const caseOptions: { value: FormatterCase; label: string }[] = [
    { value: 'preserve', label: t('preserveCase', language) },
    { value: 'upper',    label: t('caseUpper', language) },
    { value: 'lower',    label: t('caseLower', language) },
  ]

  const indentOptions: { value: FormatterIndentStyle; label: string; hint: string }[] = [
    { value: 'standard',     label: t('indentStandard', language),     hint: t('indentStandardHint', language) },
    { value: 'tabularLeft',  label: t('indentTabularLeft', language),   hint: t('indentTabularLeftHint', language) },
    { value: 'tabularRight', label: t('indentTabularRight', language),  hint: t('indentTabularRightHint', language) },
  ]

  const logicalNlOptions: { value: FormatterLogicalNewline; label: string }[] = [
    { value: 'before', label: t('logicalBefore', language) },
    { value: 'after',  label: t('logicalAfter', language) },
  ]

  // 미리보기 소스 SQL
  const sourceSQL = previewMode === 'custom'
    ? customSQL
    : (FORMATTER_PRESETS.find((p) => p.id === presetId)?.sql ?? '')

  // 라이브 포맷팅 (settings 또는 SQL 변경 시 재계산)
  const formatted = useMemo(() => {
    if (!sourceSQL.trim()) return ''
    try {
      return sqlFormat(sourceSQL, buildFormatOptions(settings))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return `-- ⚠ 포맷 오류: ${msg}\n${sourceSQL}`
    }
  }, [sourceSQL, settings])

  return (
    <div className="flex h-full min-h-0">
      {/* ─── 좌측: 카테고리 트리 ─────────────────────────────────────── */}
      <div className="w-[300px] shrink-0 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-bg-deep)]">
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-null)] border-b border-[var(--color-border)]">
          {t('sectionFormatterSettings', language)}
        </div>

        {/* 일반 */}
        <TreeCategory
          icon={<Settings2 size={11} />}
          label={t('categoryGeneral', language)}
          expanded={expanded.general}
          onToggle={() => toggle('general')}
        >
          <TreeField label={t('fieldDialect', language)}>
            <select
              value={settings.dialect}
              onChange={(e) => onChange({ dialect: e.target.value as FormatterDialect })}
              className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1 text-[11px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            >
              {DIALECT_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </TreeField>
          <TreeField label={t('fieldTabWidth', language)} hint={`${settings.tabWidth} ${t('spaces', language)}`}>
            <input
              type="number"
              min={1}
              max={8}
              value={settings.tabWidth}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v >= 1 && v <= 8) onChange({ tabWidth: v })
              }}
              className="w-16 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1 text-[11px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            />
          </TreeField>
          <TreeField label={t('fieldUseTabs', language)}>
            <Toggle
              checked={settings.useTabs}
              onChange={(v) => onChange({ useTabs: v })}
            />
          </TreeField>
          <TreeField label={t('fieldLinesBetweenQueries', language)} hint={`${settings.linesBetweenQueries} ${t('lines', language)}`}>
            <input
              type="number"
              min={0}
              max={5}
              value={settings.linesBetweenQueries}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v >= 0 && v <= 5) onChange({ linesBetweenQueries: v })
              }}
              className="w-16 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1 text-[11px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            />
          </TreeField>
        </TreeCategory>

        {/* 케이스 */}
        <TreeCategory
          icon={<Type size={11} />}
          label={t('categoryCase', language)}
          expanded={expanded.case}
          onToggle={() => toggle('case')}
        >
          <CaseSelector
            label={t('fieldKeywordCase', language)}
            value={settings.keywordCase}
            onChange={(v) => onChange({ keywordCase: v })}
            options={caseOptions}
          />
          <CaseSelector
            label={t('fieldIdentifierCase', language)}
            value={settings.identifierCase}
            onChange={(v) => onChange({ identifierCase: v })}
            options={caseOptions}
          />
          <CaseSelector
            label={t('fieldDataTypeCase', language)}
            value={settings.dataTypeCase}
            onChange={(v) => onChange({ dataTypeCase: v })}
            options={caseOptions}
          />
          <CaseSelector
            label={t('fieldFunctionCase', language)}
            value={settings.functionCase}
            onChange={(v) => onChange({ functionCase: v })}
            options={caseOptions}
          />
        </TreeCategory>

        {/* 들여쓰기 / 정렬 */}
        <TreeCategory
          icon={<AlignLeft size={11} />}
          label={t('categoryIndent', language)}
          expanded={expanded.indent}
          onToggle={() => toggle('indent')}
        >
          <TreeField label={t('fieldIndentStyle', language)}>
            <select
              value={settings.indentStyle}
              onChange={(e) => onChange({ indentStyle: e.target.value as FormatterIndentStyle })}
              className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1 text-[11px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            >
              {indentOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-[var(--color-null)]">
              {indentOptions.find((o) => o.value === settings.indentStyle)?.hint}
            </p>
          </TreeField>
          <TreeField label={t('fieldLogicalNewline', language)}>
            <select
              value={settings.logicalOperatorNewline}
              onChange={(e) => onChange({ logicalOperatorNewline: e.target.value as FormatterLogicalNewline })}
              className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1 text-[11px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            >
              {logicalNlOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </TreeField>
          <TreeField label={t('fieldNewlineBeforeSemicolon', language)}>
            <Toggle
              checked={settings.newlineBeforeSemicolon}
              onChange={(v) => onChange({ newlineBeforeSemicolon: v })}
            />
          </TreeField>
        </TreeCategory>

        {/* 줄바꿈 / 공백 */}
        <TreeCategory
          icon={<WrapText size={11} />}
          label={t('categoryWrap', language)}
          expanded={expanded.wrap}
          onToggle={() => toggle('wrap')}
        >
          <TreeField label={t('fieldExpressionWidth', language)} hint={`${settings.expressionWidth} ${t('characters', language)}`}>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={20}
                max={250}
                step={5}
                value={settings.expressionWidth}
                onChange={(e) => onChange({ expressionWidth: Number(e.target.value) })}
                className="flex-1 accent-[#4299e1]"
              />
              <input
                type="number"
                min={20}
                max={250}
                value={settings.expressionWidth}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (v >= 20 && v <= 250) onChange({ expressionWidth: v })
                }}
                className="w-14 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-[11px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
              />
            </div>
          </TreeField>
          <TreeField label={t('fieldDenseOperators', language)} hint={t('fieldDenseOperatorsHint', language)}>
            <Toggle
              checked={settings.denseOperators}
              onChange={(v) => onChange({ denseOperators: v })}
            />
          </TreeField>
        </TreeCategory>
      </div>

      {/* ─── 우측: 미리보기 ──────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col bg-[var(--color-bg-primary)]">
        {/* 미리보기 모드 토글 */}
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPreviewMode('preset')}
              className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded transition-colors ${
                previewMode === 'preset'
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)]'
              }`}
            >
              <FileCode2 size={11} />
              {t('previewSampleQuery', language)}
            </button>
            <button
              onClick={() => setPreviewMode('custom')}
              className={`flex items-center gap-1 px-2.5 py-1 text-[11px] rounded transition-colors ${
                previewMode === 'custom'
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)]'
              }`}
            >
              <Code2 size={11} />
              {t('previewMyQuery', language)}
            </button>
          </div>
          {previewMode === 'preset' && (
            <div className="flex items-center gap-1">
              {FORMATTER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPresetId(p.id)}
                  className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                    presetId === p.id
                      ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-subtle)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 사용자 SQL 입력 (custom 모드) */}
        {previewMode === 'custom' && (
          <div className="border-b border-[var(--color-border)] shrink-0">
            <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-widest text-[var(--color-null)]">
              {t('previewInputLabel', language)}
            </div>
            <textarea
              value={customSQL}
              onChange={(e) => setCustomSQL(e.target.value)}
              spellCheck={false}
              placeholder="select * from users where id = 1;"
              className="w-full h-28 bg-[var(--color-bg-deep)] border-t border-[var(--color-border)] px-4 py-2 text-[11px] font-mono text-[var(--color-text-primary)] focus:outline-none resize-none"
            />
          </div>
        )}

        {/* 포맷 결과 출력 */}
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-widest text-[var(--color-null)]">
            {t('previewOutputLabel', language)}
          </div>
          <pre className="px-4 pb-4 text-[12px] leading-relaxed font-mono text-[var(--color-text-primary)] whitespace-pre">
{formatted || <span className="text-[var(--color-null)] italic">{t('previewEmpty', language)}</span>}
          </pre>
        </div>
      </div>
    </div>
  )
}

// ─── 포매터 트리 UI 헬퍼 ───────────────────────────────────────────────────

function TreeCategory({
  icon, label, expanded, onToggle, children,
}: {
  icon: React.ReactNode
  label: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-[var(--color-bg-secondary)]">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-secondary)] transition-colors"
      >
        {expanded
          ? <ChevronDown size={11} className="text-[var(--color-null)] shrink-0" />
          : <ChevronRight size={11} className="text-[var(--color-null)] shrink-0" />
        }
        <span className="text-[var(--color-accent)] shrink-0">{icon}</span>
        <span className="font-medium">{label}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2.5">
          {children}
        </div>
      )}
    </div>
  )
}

function TreeField({
  label, hint, children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="pl-5">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[11px] text-[var(--color-text-muted)]">{label}</span>
        {hint && <span className="text-[10px] text-[var(--color-null)]">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function CaseSelector({
  label, value, onChange, options,
}: {
  label: string
  value: FormatterCase
  onChange: (v: FormatterCase) => void
  options: { value: FormatterCase; label: string }[]
}) {
  return (
    <TreeField label={label}>
      <div className="flex gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`flex-1 px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
              value === o.value
                ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </TreeField>
  )
}

// ─── 공통 UI 헬퍼 ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-null)] mb-3">
        {title}
      </h3>
      <div className="space-y-4 pl-0">{children}</div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-xs text-[var(--color-text-subtle)]">{label}</span>
        {hint && <span className="text-[11px] text-[var(--color-null)]">— {hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-deep)] px-3 py-2.5 text-[11px] text-[var(--color-text-muted)]">
      {children}
    </div>
  )
}

// ─── SSH 탭 ─────────────────────────────────────────────────────────────────

function SSHTab({ language }: { language: Language }) {
  const [entries, setEntries] = useState<KnownHostEntry[]>([])
  const [loading, setLoading] = useState(false)

  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      const list = await ListKnownHosts()
      setEntries(list ?? [])
    } catch {
      toast.error(t('sshLoadFail', language))
    } finally {
      setLoading(false)
    }
  }, [language])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  async function handleDelete(entry: KnownHostEntry) {
    const msg = language === 'ko'
      ? `'${entry.host}' 호스트 키를 삭제할까요?\n\n다음 연결 시 새 키가 다시 저장됩니다.`
      : `Delete host key for '${entry.host}'?\n\nA new key will be saved on next connection.`
    const ok = await nativeConfirm({
      title: t('sshDeleteTitle', language),
      message: msg,
      language,
    })
    if (!ok) return
    try {
      await DeleteKnownHost(entry.line)
      toast.success(`${entry.host} ${t('sshDeletedSuccess', language)}`)
      setEntries((prev) => prev.filter((e) => e.line !== entry.line))
    } catch {
      toast.error(t('sshDeleteFail', language))
    }
  }

  return (
    <div className="space-y-5 max-w-lg">
      <Section title={t('sectionKnownHosts', language)}>
        {/* 안내 박스 */}
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-deep)] px-3 py-2.5 text-[11px] text-[var(--color-text-muted)] space-y-1 mb-3">
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={11} className="text-[#68d391] shrink-0" />
            <span>
              {language === 'ko' ? (
                <>
                  SSH 연결 시 <strong className="text-[var(--color-text-subtle)]">TOFU</strong> 방식으로 호스트 공개키를{' '}
                  <code className="text-[var(--color-text-subtle)]">~/.websql/known_hosts</code>에 저장합니다.
                </>
              ) : (
                <>
                  SSH connections use <strong className="text-[var(--color-text-subtle)]">TOFU</strong> to store host public keys in{' '}
                  <code className="text-[var(--color-text-subtle)]">~/.websql/known_hosts</code>.
                </>
              )}
            </span>
          </div>
          <div>
            {language === 'ko'
              ? '서버 재발급 등으로 키가 변경됐을 경우 해당 항목을 삭제 후 재연결하세요.'
              : 'If the server key changes (e.g. re-provisioned), delete the entry and reconnect.'}
          </div>
        </div>

        {/* 새로고침 버튼 */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-[var(--color-null)]">
            {entries.length > 0
              ? `${entries.length}${t('sshEntryCount', language)}`
              : t('sshNoSaved', language)}
          </span>
          <button
            onClick={loadEntries}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] rounded transition-colors disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {t('sshRefresh', language)}
          </button>
        </div>

        {/* 항목 목록 */}
        {loading ? (
          <div className="flex items-center justify-center py-8 text-[var(--color-null)] text-xs gap-2">
            <RefreshCw size={12} className="animate-spin" />
            {t('sshLoading', language)}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-[var(--color-null)] text-xs">
            {t('sshNoEntries', language)}
          </div>
        ) : (
          <div className="space-y-1.5">
            {entries.map((entry) => (
              <div
                key={entry.line}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg-deep)] group"
              >
                <div className="flex-1 min-w-0">
                  {/* 호스트 */}
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Key size={10} className="text-[var(--color-accent)] shrink-0" />
                    <span className="text-[11px] text-[var(--color-text-primary)] font-medium truncate">{entry.host}</span>
                  </div>
                  {/* 키 타입 + 핑거프린트 */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--color-accent)] font-mono bg-[var(--color-bg-secondary)] px-1.5 py-0.5 rounded shrink-0">
                      {entry.keyType}
                    </span>
                    <span className="text-[10px] text-[var(--color-null)] font-mono truncate" title={entry.fingerprint}>
                      {entry.fingerprint}
                    </span>
                  </div>
                </div>
                {/* 삭제 버튼 */}
                <button
                  onClick={() => handleDelete(entry)}
                  className="p-1.5 rounded text-[var(--color-null)] hover:text-[var(--color-error)] hover:bg-[var(--color-border)] transition-colors opacity-0 group-hover:opacity-100"
                  title={t('sshDeleteTitle', language)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

// ─── MCP 서버 탭 (Phase 43) ─────────────────────────────────────────────────
//
// 환경설정 → MCP 탭. backend 는 .claude/plans/phase-43-mcp-server.md 참조.
//
// UX 정책:
//  - "활성화" 토글 변경 즉시 UpdateMCPConfig 호출 → backend Restart/Stop
//  - 포트·권한·allowlist 도 변경 즉시 UpdateMCPConfig (디바운싱 X — backend 가 idempotent 하게 Restart)
//  - 토큰은 RevealMCPToken 으로 한 번 받아 메모리 보관, "복사" 클릭 시 navigator.clipboard 로 출력
//  - 클라이언트 설정 JSON Snippet 은 backend 에서 받아 그대로 클립보드에

const ALL_CONNS_WILDCARD = '*'

function MCPTab({ language }: { language: Language }) {
  const [cfg, setCfg] = useState<MCPConfig | null>(null)
  const [status, setStatus] = useState<MCPStatus>({ running: false, port: 0, endpoint: '' })
  const [savedConns, setSavedConns] = useState<ConnectConfig[]>([])
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set())
  const [token, setToken] = useState<string>('')        // 메모리만 — 키체인 평문 1회 노출
  const [showToken, setShowToken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const s = await GetMCPStatus()
      setStatus(s)
    } catch {
      /* 무시 */
    }
  }, [])

  // 활성 connID 집합 새로고침 — allowlist UI 의 ● 활성 / ○ 미연결 배지에 사용
  const refreshActiveIds = useCallback(async () => {
    try {
      const list = await ListConnections()
      setActiveIds(new Set((list ?? []).map(c => c.id)))
    } catch {
      /* 무시 */
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [c, conns, active, s] = await Promise.all([
          GetMCPConfig(),
          GetSavedConnections(),
          ListConnections(),
          GetMCPStatus(),
        ])
        if (cancelled) return
        setCfg(c)
        setSavedConns(conns ?? [])
        setActiveIds(new Set((active ?? []).map(x => x.id)))
        setStatus(s)
      } catch {
        toast.error(t('mcpToastSaveFail', language))
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 실행 중일 때 status + 활성 연결 5 초마다 폴링
  useEffect(() => {
    if (!status.running) return
    const id = window.setInterval(() => {
      void refreshStatus()
      void refreshActiveIds()
    }, 5000)
    return () => window.clearInterval(id)
  }, [status.running, refreshStatus, refreshActiveIds])

  const persist = useCallback(async (next: MCPConfig) => {
    setBusy(true)
    try {
      await UpdateMCPConfig(next)
      setCfg(next)
      await refreshStatus()
      toast.success(t('mcpToastSaved', language))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 포트 충돌은 별도 메시지로 안내
      if (/address already in use|EADDRINUSE/i.test(msg)) {
        toast.error(t('mcpToastPortInUse', language).replace('{port}', String(next.port)))
      } else {
        toast.error(`${t('mcpToastSaveFail', language)}: ${msg}`)
      }
      // 실패 시 backend 상태로 되돌림
      try { setCfg(await GetMCPConfig()) } catch { /* 무시 */ }
    } finally {
      setBusy(false)
    }
  }, [language, refreshStatus])

  // 포트 사전 체크 — 활성화/포트 변경 직전에 호출.
  // 우리 서버가 이미 그 포트에서 돌고 있으면 통과 (Restart 시 자기 자신 우회).
  const ensurePortAvailable = useCallback(async (port: number): Promise<boolean> => {
    if (status.running && status.port === port) return true
    try {
      const free = await CheckMCPPortAvailable(port)
      if (free) return true
    } catch {
      // 검사 실패 — confirm 없이 진행 (네트워크 권한 등 환경 이슈)
      return true
    }
    return await nativeConfirm({
      title: t('confirmDefaultTitle', language),
      message: t('mcpPortInUseConfirm', language).replace('{port}', String(port)),
      language,
    })
  }, [status.running, status.port, language])

  if (!cfg) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--color-null)] text-xs gap-2">
        <RefreshCw size={12} className="animate-spin" />
        {t('sshLoading', language)}
      </div>
    )
  }

  function setField<K extends keyof MCPConfig>(key: K, value: MCPConfig[K]) {
    if (!cfg) return
    void persist({ ...cfg, [key]: value })
  }

  const allConnsExposed = cfg.allowedConnIDs.includes(ALL_CONNS_WILDCARD)

  function toggleConnInAllowlist(connID: string) {
    if (!cfg) return
    const cur = new Set(cfg.allowedConnIDs.filter(id => id !== ALL_CONNS_WILDCARD))
    if (cur.has(connID)) cur.delete(connID)
    else cur.add(connID)
    void persist({ ...cfg, allowedConnIDs: Array.from(cur) })
  }

  function toggleAllowAll() {
    if (!cfg) return
    if (allConnsExposed) {
      void persist({ ...cfg, allowedConnIDs: [] })
    } else {
      void persist({ ...cfg, allowedConnIDs: [ALL_CONNS_WILDCARD] })
    }
  }

  async function handleRevealToken() {
    try {
      const tok = await RevealMCPToken()
      setToken(tok)
      setShowToken(true)
    } catch {
      toast.error(t('mcpToastTokenCopyFail', language))
    }
  }

  async function handleCopyToken() {
    try {
      const tok = token || await RevealMCPToken()
      if (!token) setToken(tok)
      await navigator.clipboard.writeText(tok)
      toast.success(t('mcpToastTokenCopied', language))
    } catch {
      toast.error(t('mcpToastTokenCopyFail', language))
    }
  }

  async function handleRegenToken() {
    const ok = await nativeConfirm({
      title: t('confirmDefaultTitle', language),
      message: t('mcpTokenRegenConfirm', language),
      language,
    })
    if (!ok) return
    try {
      const tok = await RegenerateMCPToken()
      setToken(tok)
      setShowToken(true)
      await refreshStatus()
      toast.success(t('mcpToastTokenRegenerated', language))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`${t('mcpToastSaveFail', language)}: ${msg}`)
    }
  }

  async function handleCopySnippet(client: 'claude-code' | 'cursor') {
    if (!status.running) {
      toast.error(t('mcpClientCopyNeedsRunning', language))
      return
    }
    try {
      const snippet = await GetMCPClientConfigSnippet(client)
      await navigator.clipboard.writeText(snippet)
      toast.success(t('mcpToastSnippetCopied', language))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`${t('mcpToastSnippetFail', language)}: ${msg}`)
    }
  }

  async function handleTestConnection() {
    if (!status.running) {
      toast.error(t('mcpTestNotRunning', language))
      return
    }
    setTesting(true)
    try {
      const res = await TestMCPConnection()
      if (res.success) {
        toast.success(t('mcpTestSuccess', language).replace('{ms}', String(res.durationMs)))
      } else {
        toast.error(t('mcpTestFail', language).replace('{message}', res.message ?? ''))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('mcpTestFail', language).replace('{message}', msg))
    } finally {
      setTesting(false)
    }
  }

  async function handleCopyAIPrompt() {
    try {
      const snippet = await GetMCPAIPromptSnippet()
      await navigator.clipboard.writeText(snippet)
      toast.success(t('mcpToastSnippetCopied', language))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`${t('mcpToastSnippetFail', language)}: ${msg}`)
    }
  }

  const noneSelected = !allConnsExposed && cfg.allowedConnIDs.length === 0
  const ddlWithoutWrite = cfg.allowDDL && !cfg.allowWrite

  return (
    <div className="space-y-5 max-w-2xl">
      {/* 안내 */}
      <InfoBox>
        <div className="flex items-start gap-1.5">
          <ShieldCheck size={11} className="text-[#68d391] shrink-0 mt-0.5" />
          <span>{t('mcpIntro', language)}</span>
        </div>
      </InfoBox>

      {/* 서버 */}
      <Section title={t('mcpSectionServer', language)}>
        <Field label={t('mcpEnable', language)} hint={t('mcpEnableHint', language)}>
          <div className="flex items-center gap-3">
            <Toggle
              checked={cfg.enabled}
              onChange={async v => {
                if (!cfg) return
                // 활성화하려는 시점에만 포트 사전 체크 — 비활성화는 항상 OK
                if (v && !cfg.enabled) {
                  if (!(await ensurePortAvailable(cfg.port))) return
                }
                setField('enabled', v)
              }}
            />
            <span className={`flex items-center gap-1 text-[11px] ${
              status.running ? 'text-[#68d391]' : 'text-[var(--color-null)]'
            }`}>
              <Power size={10} className={status.running ? '' : 'opacity-50'} />
              {status.running ? t('mcpStatusRunning', language) : t('mcpStatusStopped', language)}
            </span>
            {status.running && status.endpoint && (
              <code className="text-[10px] text-[var(--color-text-muted)] font-mono px-1.5 py-0.5 rounded bg-[var(--color-bg-deep)] border border-[var(--color-border)]">
                {status.endpoint}
              </code>
            )}
            {status.running && (
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="ml-auto flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] rounded transition-colors disabled:opacity-50"
                title={t('mcpTestConnection', language)}
              >
                <RefreshCw size={11} className={testing ? 'animate-spin' : ''} />
                {t('mcpTestConnection', language)}
              </button>
            )}
          </div>
          {status.lastError && (
            <div className="mt-1.5 text-[11px] text-[var(--color-error)]">
              {status.lastError}
            </div>
          )}
        </Field>

        <Field label={t('mcpFieldPort', language)} hint={t('mcpPortHint', language)}>
          <input
            type="number"
            min={1024}
            max={65535}
            value={cfg.port}
            onChange={e => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              if (cfg) setCfg({ ...cfg, port: n })
            }}
            onBlur={async e => {
              const n = Number(e.target.value)
              if (!(n >= 1024 && n <= 65535) || n === status.port) return
              // 활성 상태에서 포트 변경 시 사전 체크 — 비활성 시엔 어차피 listen 안 함
              if (cfg.enabled && !(await ensurePortAvailable(n))) {
                // 사용자가 취소하면 입력값을 디스크 값으로 되돌림
                setCfg({ ...cfg })
                return
              }
              setField('port', n)
            }}
            disabled={busy}
            className="w-28 bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] disabled:opacity-50"
          />
        </Field>
      </Section>

      {/* 활성화된 경우에만 상세 설정 노출 — 토큰·권한·allowlist·클라이언트 설정 */}
      {cfg.enabled && <>
      {/* 토큰 */}
      <Section title={t('mcpSectionToken', language)}>
        <Field label={t('mcpTokenHint', language)}>
          <div className="flex items-center gap-2">
            <input
              type={showToken ? 'text' : 'password'}
              readOnly
              value={token || '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
              onFocus={() => { if (!token) void handleRevealToken() }}
              className="flex-1 bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded px-2 py-1 text-[11px] text-[var(--color-text-primary)] font-mono"
            />
            <button
              onClick={handleCopyToken}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] rounded transition-colors"
              title={t('mcpTokenCopy', language)}
            >
              <CopyIcon size={11} />
              {t('mcpTokenCopy', language)}
            </button>
            <button
              onClick={handleRegenToken}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-border)] rounded transition-colors"
              title={t('mcpTokenRegen', language)}
            >
              <RefreshCw size={11} />
              {t('mcpTokenRegen', language)}
            </button>
          </div>
        </Field>
      </Section>

      {/* 권한 */}
      <Section title={t('mcpSectionPolicy', language)}>
        <Field label={t('mcpAllowWrite', language)} hint={t('mcpAllowWriteHint', language)}>
          <Toggle checked={cfg.allowWrite} onChange={v => setField('allowWrite', v)} />
        </Field>
        <Field label={t('mcpAllowDDL', language)} hint={t('mcpAllowDDLHint', language)}>
          <Toggle checked={cfg.allowDDL} onChange={v => setField('allowDDL', v)} />
        </Field>
        {ddlWithoutWrite && (
          <div className="text-[11px] text-[var(--color-warn,#d69e2e)]">
            ⚠ {t('mcpWarnDdlWithoutWrite', language)}
          </div>
        )}
      </Section>

      {/* allowlist */}
      <Section title={t('mcpSectionAllowlist', language)}>
        <InfoBox>{t('mcpAllowlistHint', language)}</InfoBox>

        <div className="flex items-center gap-2 pt-2">
          <input
            type="checkbox"
            id="mcp-allow-all"
            checked={allConnsExposed}
            onChange={toggleAllowAll}
            className="cursor-pointer"
          />
          <label htmlFor="mcp-allow-all" className="text-xs text-[var(--color-text-subtle)] cursor-pointer">
            {t('mcpAllowAll', language)}
          </label>
        </div>

        {savedConns.length === 0 ? (
          <div className="text-[11px] text-[var(--color-null)] py-2">
            {t('mcpAllowlistEmpty', language)}
          </div>
        ) : (
          <div className="space-y-1">
            {savedConns.map(c => {
              const checked = allConnsExposed || cfg.allowedConnIDs.includes(c.id)
              const isActive = activeIds.has(c.id)
              const id = `mcp-conn-${c.id}`
              return (
                <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-bg-deep)] transition-colors">
                  <input
                    type="checkbox"
                    id={id}
                    checked={checked}
                    disabled={allConnsExposed}
                    onChange={() => toggleConnInAllowlist(c.id)}
                    className="cursor-pointer disabled:cursor-not-allowed"
                  />
                  <label htmlFor={id} className="flex-1 text-xs text-[var(--color-text-subtle)] cursor-pointer flex items-center gap-2 min-w-0">
                    <span className="font-medium text-[var(--color-text-primary)] truncate">{c.name || c.id}</span>
                    <span className="text-[10px] text-[var(--color-null)] truncate">
                      {c.user}@{c.host}:{c.port}
                      {c.database && ` / ${c.database}`}
                    </span>
                    <span className={`shrink-0 inline-flex items-center gap-1 text-[9px] tracking-wide ${
                      isActive ? 'text-[#68d391]' : 'text-[var(--color-null)]'
                    }`}>
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                        isActive ? 'bg-[#68d391]' : 'border border-[var(--color-null)]'
                      }`} />
                      {isActive ? t('mcpConnStateActive', language) : t('mcpConnStateInactive', language)}
                    </span>
                  </label>
                </div>
              )
            })}
          </div>
        )}

        {cfg.enabled && noneSelected && (
          <div className="text-[11px] text-[var(--color-warn,#d69e2e)] mt-2">
            {t('mcpAllowlistNoneSelected', language)}
          </div>
        )}
      </Section>

      {/* 클라이언트 설정 복사 */}
      <Section title={t('mcpSectionClients', language)}>
        <InfoBox>{t('mcpClientHint', language)}</InfoBox>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={() => handleCopySnippet('claude-code')}
            disabled={!status.running}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-[var(--color-text-primary)] bg-[var(--color-bg-deep)] hover:bg-[var(--color-border)] border border-[var(--color-border)] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CopyIcon size={11} />
            {t('mcpCopyClaudeCode', language)}
          </button>
          <button
            onClick={() => handleCopySnippet('cursor')}
            disabled={!status.running}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-[var(--color-text-primary)] bg-[var(--color-bg-deep)] hover:bg-[var(--color-border)] border border-[var(--color-border)] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CopyIcon size={11} />
            {t('mcpCopyCursor', language)}
          </button>
        </div>

        {/* AI 부트스트랩 프롬프트 — BugFix-CY: 서버 URL+토큰을 포함하므로 서버 실행 중일 때만 의미가 있다. 미실행 시 Go 측 가드가 에러 반환. */}
        <div className="pt-3">
          <div className="text-[11px] text-[var(--color-text-muted)] mb-1.5">
            {t('mcpCopyAIPromptHint', language)}
          </div>
          <button
            onClick={handleCopyAIPrompt}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-[var(--color-text-primary)] bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/20 border border-[var(--color-accent)]/40 rounded transition-colors"
          >
            <CopyIcon size={11} />
            {t('mcpCopyAIPrompt', language)}
          </button>
        </div>
      </Section>
      </>}
    </div>
  )
}
