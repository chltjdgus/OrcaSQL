import { useRef, useEffect, useCallback, useState } from 'react'
import type { CellEditorProps } from './index'

const INTEGER_TYPES = new Set(['INT', 'BIGINT', 'SMALLINT', 'MEDIUMINT', 'TINYINT'])

/**
 * 숫자 타입 컬럼용 에디터.
 * 정수/소수 구분 regex 검증 + 잘못된 입력 시 빨간 테두리 피드백.
 */
export function NumericEditor({
  value,
  isNull,
  onChange,
  onSetNull,
  onConfirm,
  onCancel,
  disabled,
  columnMeta,
  mode,
}: CellEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [invalid, setInvalid] = useState(false)
  const colType = columnMeta.type.toUpperCase()
  const isInteger = INTEGER_TYPES.has(colType)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const validate = useCallback((v: string): boolean => {
    if (v === '' || v === '-') return true // 입력 중
    if (isInteger) return /^-?\d*$/.test(v)
    return /^-?\d*\.?\d*$/.test(v)
  }, [isInteger])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (validate(v)) {
      onChange(v)
      setInvalid(false)
    } else {
      setInvalid(true)
      setTimeout(() => setInvalid(false), 600)
    }
  }, [validate, onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
    if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onSetNull()
    }
  }, [onConfirm, onCancel, onSetNull])

  const isInline = mode === 'inline'
  const outlineColor = invalid ? 'outline-red-500' : 'outline-[var(--color-accent)]'
  const borderColor = invalid
    ? 'border-red-500'
    : isNull
    ? 'border-[var(--color-border)] focus:border-[var(--color-accent)]'
    : 'border-[var(--color-accent)]/60 focus:border-[var(--color-accent)]'

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode={isInteger ? 'numeric' : 'decimal'}
      value={isNull ? '' : value}
      placeholder={isNull ? 'NULL' : undefined}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={onConfirm}
      disabled={disabled}
      className={
        isInline
          ? `w-full h-full px-2 bg-[var(--color-bg-selected)] text-xs outline outline-2 ${outlineColor} focus:outline-[var(--color-accent-light)] disabled:opacity-50 transition-colors ${isNull ? 'italic text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'}`
          : `w-full h-8 px-2 text-xs rounded border bg-[var(--color-bg-primary)] outline-none transition-colors disabled:opacity-50 ${borderColor} ${isNull ? 'italic text-[var(--color-null)]' : 'text-[var(--color-text-primary)]'}`
      }
      style={{
        ...(isInline ? { height: 28 } : {}),
        // 스피너 화살표 제거
        MozAppearance: 'textfield',
      }}
    />
  )
}
