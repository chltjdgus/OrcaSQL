import { useRef, useEffect, useCallback, useState } from 'react'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import type { CellEditorProps } from './index'

/**
 * TEXT / LONGTEXT / JSON 컬럼용 확장 에디터.
 * 인라인: 고정 위치 팝오버 + 리사이즈 가능 textarea
 * JSON: 포맷 버튼으로 pretty-print
 */
export function TextAreaEditor({
  value,
  isNull,
  onChange,
  onSetNull,
  onConfirm,
  onCancel,
  disabled,
  columnMeta,
  nullable,
  mode,
  anchorRect,
}: CellEditorProps) {
  const language = useLanguageStore((s) => s.language)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const colType = columnMeta.type.toUpperCase()
  const isJson = colType === 'JSON'
  const [jsonError, setJsonError] = useState(false)
  const isInline = mode === 'inline'

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // 외부 클릭 감지 (인라인 팝오버 모드)
  useEffect(() => {
    if (!isInline) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onConfirm()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isInline, onConfirm])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Enter + Shift = 줄바꿈, Enter만 = 커밋
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onConfirm() }
    if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onSetNull()
    }
  }, [onConfirm, onCancel, onSetNull])

  const formatJson = useCallback(() => {
    if (isNull || !value) return
    try {
      const parsed = JSON.parse(value)
      onChange(JSON.stringify(parsed, null, 2))
      setJsonError(false)
    } catch {
      setJsonError(true)
      setTimeout(() => setJsonError(false), 2000)
    }
  }, [value, isNull, onChange])

  // 인라인 모드: 팝오버로 표시
  if (isInline) {
    const posStyle: React.CSSProperties = anchorRect
      ? {
          position: 'fixed',
          left: anchorRect.left,
          top: anchorRect.bottom + 2,
          width: Math.max(anchorRect.width, 300),
          zIndex: 100,
        }
      : {}

    // 아래 공간 부족 시 위로
    if (anchorRect) {
      const spaceBelow = window.innerHeight - anchorRect.bottom
      if (spaceBelow < 200) {
        posStyle.top = undefined
        posStyle.bottom = window.innerHeight - anchorRect.top + 2
      }
    }

    return (
      <div ref={containerRef} style={posStyle}
        className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded shadow-lg p-2"
      >
        <textarea
          ref={textareaRef}
          value={isNull ? '' : value}
          placeholder={isNull ? 'NULL' : undefined}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={6}
          className={`w-full px-2 py-1.5 text-xs rounded border bg-[var(--color-bg-primary)] resize-y outline-none transition-colors disabled:opacity-50 font-mono ${
            isNull
              ? 'italic text-[var(--color-null)] border-[var(--color-border)]'
              : 'text-[var(--color-text-primary)] border-[var(--color-accent)]/60 focus:border-[var(--color-accent)]'
          }`}
        />
        <div className="flex items-center justify-between mt-1.5">
          <div className="flex items-center gap-1">
            {isJson && (
              <button
                onClick={formatJson}
                disabled={disabled || isNull}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors disabled:opacity-50 ${
                  jsonError
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]'
                }`}
              >
                {jsonError ? t('editorJsonInvalid', language) : t('editorJsonFormat', language)}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* BugFix-DC: NULL 버튼 — nullable 컬럼에 한해 노출, 값 NULL 설정 후 즉시 commit (BooleanEditor 패턴 동일) */}
            {nullable && (
              <button
                onClick={() => { onSetNull(); setTimeout(onConfirm, 0) }}
                disabled={disabled}
                title="Ctrl+0"
                className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-bg-hover)] italic text-[var(--color-null)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
              >
                {t('editorSetNull', language)}
              </button>
            )}
            <button
              onClick={onCancel}
              className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              {t('editorCancel', language)}
            </button>
            {/* BugFix-DC: 저장 버튼 복원 — BugFix-CR 에서 제거됐던 명시적 commit 트리거(키보드 단축 외에 마우스 사용자용) */}
            <button
              onClick={onConfirm}
              disabled={disabled}
              className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 transition-colors disabled:opacity-50 font-medium"
            >
              {t('editorSave', language)}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 폼뷰: 직접 textarea
  return (
    <div>
      <textarea
        ref={textareaRef}
        value={isNull ? '' : value}
        placeholder={isNull ? 'NULL' : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={onConfirm}
        disabled={disabled}
        rows={Math.min(8, Math.max(3, Math.ceil((value || '').length / 60)))}
        className={`w-full px-2 py-1.5 text-xs rounded border bg-[var(--color-bg-primary)] resize-y outline-none transition-colors disabled:opacity-50 font-mono ${
          isNull
            ? 'italic text-[var(--color-null)] border-[var(--color-border)] focus:border-[var(--color-accent)]'
            : 'text-[var(--color-text-primary)] border-[var(--color-accent)]/60 focus:border-[var(--color-accent)]'
        }`}
      />
      {isJson && (
        <div className="mt-1 flex items-center gap-1">
          <button
            onClick={formatJson}
            disabled={disabled || isNull}
            className={`text-[10px] px-2 py-0.5 rounded transition-colors disabled:opacity-50 ${
              jsonError
                ? 'bg-red-500/20 text-red-400'
                : 'bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]'
            }`}
          >
            {jsonError ? t('editorJsonInvalid', language) : t('editorJsonFormat', language)}
          </button>
        </div>
      )}
    </div>
  )
}
