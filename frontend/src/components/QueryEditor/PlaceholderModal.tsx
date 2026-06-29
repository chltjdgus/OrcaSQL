import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Play } from 'lucide-react'
import { t } from '@/i18n'
import { useLanguageStore } from '@/stores/useLanguageStore'
import {
  detectValueType,
  formatIdentifier,
  formatValue,
  substitute,
  type PlaceholderGroup,
  type PlaceholderMode,
  type Resolution,
} from '@/utils/placeholderParser'

interface Props {
  sql: string
  groups: PlaceholderGroup[]
  /** 직전 입력값 — { mode, value } 맵. 없으면 빈 값으로 시작. */
  initialValues?: Map<string, Resolution>
  onClose: () => void
  onSubmit: (substitutedSql: string, values: Map<string, Resolution>) => void
}

export default function PlaceholderModal({ sql, groups, initialValues, onClose, onSubmit }: Props) {
  const language = useLanguageStore((s) => s.language)

  // 입력 상태 — name 별로 mode, value 보관
  const [state, setState] = useState<Map<string, Resolution>>(() => {
    const m = new Map<string, Resolution>()
    for (const g of groups) {
      const prev = initialValues?.get(g.name)
      m.set(g.name, {
        mode: prev?.mode ?? g.defaultMode,
        rawInput: prev?.rawInput ?? '',
      })
    }
    return m
  })

  const firstInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setTimeout(() => firstInputRef.current?.focus(), 0)
  }, [])

  function update(name: string, patch: Partial<Resolution>) {
    setState((prev) => {
      const next = new Map(prev)
      const cur = next.get(name) ?? { mode: 'value' as PlaceholderMode, rawInput: '' }
      next.set(name, { ...cur, ...patch })
      return next
    })
  }

  const preview = useMemo(() => substitute(sql, groups, state), [sql, groups, state])

  function handleSubmit() {
    onSubmit(preview, state)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      // Ctrl/Cmd+Enter — 모달에서도 빠르게 실행
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg shadow-2xl w-[640px] max-h-[85vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {t('phModalTitle', language)}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* 설명 */}
        <div className="px-5 pt-3 pb-2 text-[11px] text-[var(--color-text-muted)] leading-relaxed">
          {t('phModalDesc', language)}
        </div>

        {/* 입력 리스트 */}
        <div className="flex-1 overflow-y-auto px-5 py-2 space-y-3">
          {groups.map((g, idx) => {
            const cur = state.get(g.name)!
            return (
              <PlaceholderRow
                key={g.name}
                group={g}
                resolution={cur}
                onChange={(patch) => update(g.name, patch)}
                inputRef={idx === 0 ? firstInputRef : undefined}
                language={language}
              />
            )
          })}
        </div>

        {/* 미리보기 */}
        <div className="px-5 py-2 border-t border-[var(--color-border)]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
            {t('phPreviewLabel', language)}
          </div>
          <pre className="text-[11px] font-mono text-[var(--color-text-primary)] bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1.5 max-h-[120px] overflow-auto whitespace-pre-wrap break-all">
            {preview}
          </pre>
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded font-medium bg-[var(--color-bg-hover)] hover:bg-[var(--color-border)] text-[var(--color-text-primary)] transition-colors"
          >
            {t('phCancel', language)}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded font-medium bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors"
          >
            <Play size={11} />
            {t('phRunSubstituted', language)}
            <kbd className="opacity-60 text-[9px] ml-1">⌘↵</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Row 컴포넌트 ──────────────────────────────────────────────────────────

interface RowProps {
  group: PlaceholderGroup
  resolution: Resolution
  onChange: (patch: Partial<Resolution>) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
  language: 'ko' | 'en'
}

function PlaceholderRow({ group, resolution, onChange, inputRef, language }: RowProps) {
  const formattedPreview = resolution.mode === 'identifier'
    ? formatIdentifier(resolution.rawInput)
    : formatValue(resolution.rawInput)

  const typeLabel = resolution.mode === 'identifier'
    ? t('phTypeIdentifier', language)
    : labelForType(detectValueType(resolution.rawInput), language)

  return (
    <div className="border border-[var(--color-border)] rounded-md px-3 py-2 bg-[var(--color-bg-primary)]">
      {/* 상단: 이름 + 모드 토글 */}
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <code className="text-[11px] font-mono text-[var(--color-accent)] bg-[var(--color-accent)]/10 px-1.5 py-0.5 rounded">
            {group.raw}
          </code>
          <span className="text-xs text-[var(--color-text-primary)] font-medium truncate">
            {group.name}
          </span>
          {group.occurrences.length > 1 && (
            <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
              ×{group.occurrences.length}
            </span>
          )}
        </div>

        {/* 모드 토글 */}
        <div className="flex shrink-0 rounded border border-[var(--color-border)] overflow-hidden text-[10px]">
          <button
            type="button"
            onClick={() => onChange({ mode: 'value' })}
            title={t('phModeValueHint', language)}
            className={`px-2 py-0.5 transition-colors ${
              resolution.mode === 'value'
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]'
            }`}
          >
            {t('phModeValue', language)}
          </button>
          <button
            type="button"
            onClick={() => onChange({ mode: 'identifier' })}
            title={t('phModeIdentifierHint', language)}
            className={`px-2 py-0.5 transition-colors ${
              resolution.mode === 'identifier'
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]'
            }`}
          >
            {t('phModeIdentifier', language)}
          </button>
        </div>
      </div>

      {/* 컨텍스트 */}
      <div className="text-[10px] text-[var(--color-text-muted)] font-mono mb-1.5 truncate" title={group.contexts.join('\n')}>
        {group.contexts[0]}
      </div>

      {/* 입력 + 타입 배지 */}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={resolution.rawInput}
          onChange={(e) => onChange({ rawInput: e.target.value })}
          placeholder={t('phInputPlaceholder', language)}
          className="flex-1 h-7 px-2 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] transition-colors font-mono"
        />
        <span className="shrink-0 text-[10px] text-[var(--color-text-muted)] font-mono px-1.5 py-0.5 rounded bg-[var(--color-bg-hover)]">
          → <span className="text-[var(--color-accent)]">{typeLabel}</span>
        </span>
      </div>

      {/* 변환 결과 미리보기 */}
      <div className="mt-1 text-[10px] font-mono text-[var(--color-text-muted)] truncate" title={formattedPreview}>
        {formattedPreview}
      </div>
    </div>
  )
}

function labelForType(type: ReturnType<typeof detectValueType>, language: 'ko' | 'en'): string {
  switch (type) {
    case 'null': return t('phTypeNull', language)
    case 'number': return t('phTypeNumber', language)
    case 'boolean': return t('phTypeBoolean', language)
    case 'string': return t('phTypeString', language)
  }
}
