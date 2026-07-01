import { useRef, useEffect, useCallback } from 'react'
import type { CellEditorProps } from './index'

/**
 * DATE / DATETIME / TIMESTAMP / TIME / YEAR 컬럼용 에디터.
 * 네이티브 HTML5 date/time input을 사용하여 OS 피커를 제공한다.
 */
export function DateTimeEditor({
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
  const colType = columnMeta.type.toUpperCase()

  useEffect(() => {
    // datetime-local / date 등 네이티브 입력은 focus 시 피커가 열린다
    const el = inputRef.current
    if (!el) return
    el.focus()
    // showPicker()는 Chromium에서 프로그래밍 방식으로 피커를 여는 API
    try { el.showPicker?.() } catch { /* 일부 환경에서 지원 안 될 수 있음 */ }
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
    if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onSetNull()
    }
  }, [onConfirm, onCancel, onSetNull])

  // MySQL ↔ HTML5 포맷 변환
  const toHtmlValue = (v: string): string => {
    if (!v) return ''
    if (colType === 'DATETIME' || colType === 'TIMESTAMP') {
      // "2024-01-15 14:30:00" → "2024-01-15T14:30:00"
      return v.replace(' ', 'T')
    }
    return v
  }

  const fromHtmlValue = (v: string): string => {
    if (!v) return ''
    if (colType === 'DATETIME' || colType === 'TIMESTAMP') {
      // "2024-01-15T14:30:00" → "2024-01-15 14:30:00"
      return v.replace('T', ' ')
    }
    return v
  }

  // 타입별 input 속성 결정
  let inputType = 'text'
  let step: string | undefined
  let min: string | undefined
  let max: string | undefined

  switch (colType) {
    case 'DATE':
      inputType = 'date'
      break
    case 'DATETIME':
    case 'TIMESTAMP':
      inputType = 'datetime-local'
      step = '1' // 초 단위
      break
    case 'TIME':
      inputType = 'time'
      step = '1'
      break
    case 'YEAR':
      inputType = 'number'
      min = '1901'
      max = '2155'
      break
  }

  const htmlValue = isNull ? '' : toHtmlValue(value)

  const isInline = mode === 'inline'

  return (
    <input
      ref={inputRef}
      type={inputType}
      value={htmlValue}
      placeholder={isNull ? 'NULL' : undefined}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        const converted = fromHtmlValue(e.target.value)
        onChange(converted)
      }}
      onKeyDown={handleKeyDown}
      onBlur={onConfirm}
      disabled={disabled}
      className={
        isInline
          ? `w-full h-full px-2 bg-[var(--color-bg-selected)] text-xs outline outline-2 outline-[var(--color-accent)] focus:outline-[var(--color-accent-light)] disabled:opacity-50 ${isNull ? 'italic text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'}`
          : `w-full h-8 px-2 text-xs rounded border bg-[var(--color-bg-primary)] outline-none transition-colors disabled:opacity-50 ${
              isNull
                ? 'italic text-[var(--color-null)] border-[var(--color-border)] focus:border-[var(--color-accent)]'
                : 'text-[var(--color-text-primary)] border-[var(--color-accent)]/60 focus:border-[var(--color-accent)]'
            }`
      }
      style={isInline ? { height: 28 } : undefined}
    />
  )
}
