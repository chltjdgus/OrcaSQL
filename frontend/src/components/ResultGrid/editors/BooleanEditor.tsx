import { useCallback, useEffect, useRef } from 'react'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import type { CellEditorProps } from './index'

/**
 * BOOLEAN / BIT(1) / TINYINT(1) 컬럼용 토글 에디터.
 * 인라인: 클릭으로 0↔1 즉시 토글 + 커밋
 * 폼뷰: 체크박스 + TRUE/FALSE/NULL 레이블
 */
export function BooleanEditor({
  value,
  isNull,
  onChange,
  onSetNull,
  onConfirm,
  onCancel,
  disabled,
  nullable,
  mode,
}: CellEditorProps) {
  const language = useLanguageStore((s) => s.language)
  const containerRef = useRef<HTMLDivElement>(null)
  const isInline = mode === 'inline'

  // 현재 boolean 상태 해석: '1', 'true' → true, 그 외 → false
  const boolVal = !isNull && (value === '1' || value.toLowerCase() === 'true')

  const toggle = useCallback(() => {
    if (disabled) return
    const newVal = boolVal ? '0' : '1'
    onChange(newVal)
    // BugFix-CR: 인라인은 staging 만 (blur=onConfirm 으로 commit), 폼뷰는 즉시 커밋 유지
    if (!isInline) setTimeout(onConfirm, 0)
  }, [boolVal, disabled, isInline, onChange, onConfirm])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
    if (e.key === ' ') { e.preventDefault(); toggle() }
    if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onSetNull()
      // BugFix-CR: 인라인은 leave 시 commit, 폼뷰는 즉시 커밋
      if (!isInline) setTimeout(onConfirm, 0)
    }
  }, [toggle, onCancel, onSetNull, onConfirm, isInline])

  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  if (isInline) {
    return (
      <div
        ref={containerRef}
        tabIndex={0}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        onBlur={onConfirm}
        className={`w-full h-full flex items-center justify-center cursor-pointer outline outline-2 outline-[var(--color-accent)] bg-[var(--color-bg-selected)] select-none ${disabled ? 'opacity-50' : ''}`}
        style={{ height: 28 }}
      >
        {isNull ? (
          <span className="text-[10px] italic text-[var(--color-null)]">NULL</span>
        ) : (
          <span className={`text-xs font-medium ${boolVal ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
            {boolVal ? '1' : '0'}
          </span>
        )}
      </div>
    )
  }

  // 폼뷰
  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex items-center gap-2 h-8"
    >
      <input
        type="checkbox"
        checked={!isNull && boolVal}
        onChange={toggle}
        disabled={disabled || isNull}
        className="accent-[var(--color-accent)] w-4 h-4"
      />
      <span className={`text-xs ${isNull ? 'italic text-[var(--color-null)]' : boolVal ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
        {isNull ? 'NULL' : boolVal ? t('editorBoolTrue', language) : t('editorBoolFalse', language)}
      </span>
      {nullable && !isNull && (
        <button
          onClick={() => { onSetNull(); setTimeout(onConfirm, 0) }}
          className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] ml-1"
          title="Ctrl+0"
        >
          NULL
        </button>
      )}
    </div>
  )
}
