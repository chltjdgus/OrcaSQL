import { useRef, useEffect, useCallback } from 'react'
import type { CellEditorProps } from './index'

/** NULL 선택용 내부 센티넬 — 실제 ENUM 값에는 쓰이지 않는 제어 문자 */
const NULL_OPTION_VALUE = '\x00NULL\x00'

/**
 * ENUM 컬럼용 네이티브 `<select>` 에디터.
 * OS 기본 드롭다운으로 허용 값 목록을 보여준다. 값이 없으면 텍스트 입력으로 폴백.
 */
export function EnumEditor({
  value,
  isNull,
  onChange,
  onSetNull,
  onConfirm,
  onCancel,
  disabled,
  nullable,
  mode,
  enumValues,
}: CellEditorProps) {
  const selectRef = useRef<HTMLSelectElement>(null)
  const isInline = mode === 'inline'

  // 포커스 + 드롭다운 자동 오픈 (Chromium showPicker 지원 시)
  useEffect(() => {
    const el = selectRef.current
    if (!el) return
    el.focus()
    // HTMLSelectElement.showPicker() — Chromium 127+ 에서 네이티브 피커를 띄움
    try {
      (el as HTMLSelectElement & { showPicker?: () => void }).showPicker?.()
    } catch { /* 구버전에서는 무시 */ }
  }, [])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value
    if (v === NULL_OPTION_VALUE) {
      onSetNull()
    } else {
      onChange(v)
    }
    // BugFix-CR: 인라인은 staging 만 (blur=onConfirm 으로 commit), 폼뷰는 즉시 커밋 유지
    if (!isInline) setTimeout(onConfirm, 0)
  }, [onChange, onSetNull, onConfirm, isInline])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
    if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    if (e.key === '0' && (e.ctrlKey || e.metaKey) && nullable) {
      e.preventDefault()
      onSetNull()
      // BugFix-CR: 인라인은 leave 시 commit, 폼뷰는 즉시 커밋
      if (!isInline) setTimeout(onConfirm, 0)
    }
  }, [onConfirm, onCancel, onSetNull, nullable, isInline])

  // enum 값이 없으면 일반 텍스트 입력으로 폴백
  if (!enumValues || enumValues.length === 0) {
    return <FallbackInput
      value={value} isNull={isNull} onChange={onChange} onSetNull={onSetNull}
      onConfirm={onConfirm} onCancel={onCancel} disabled={disabled} isInline={isInline}
    />
  }

  const selectedValue = isNull ? NULL_OPTION_VALUE : value

  return (
    <select
      ref={selectRef}
      value={selectedValue}
      onChange={handleChange}
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
    >
      {/* 현재 값이 enumValues 에 없을 때(과거 데이터) 옵션 추가 → 값 손실 방지 */}
      {!isNull && value && !enumValues.includes(value) && (
        <option value={value}>{value}</option>
      )}
      {nullable && (
        <option value={NULL_OPTION_VALUE}>NULL</option>
      )}
      {enumValues.map((v) => (
        <option key={v} value={v}>{v}</option>
      ))}
    </select>
  )
}

/** enum 값이 없을 때 폴백 텍스트 입력 */
function FallbackInput({
  value, isNull, onChange, onSetNull, onConfirm, onCancel, disabled, isInline,
}: {
  value: string; isNull: boolean; onChange: (v: string) => void; onSetNull: () => void
  onConfirm: () => void; onCancel: () => void; disabled?: boolean; isInline: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  return (
    <input
      ref={inputRef}
      value={isNull ? '' : value}
      placeholder={isNull ? 'NULL' : undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
        if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSetNull() }
      }}
      onBlur={onConfirm}
      disabled={disabled}
      className={
        isInline
          ? `w-full h-full px-2 bg-[var(--color-bg-selected)] text-xs outline outline-2 outline-[var(--color-accent)] disabled:opacity-50 ${isNull ? 'italic text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'}`
          : `w-full h-8 px-2 text-xs rounded border bg-[var(--color-bg-primary)] outline-none transition-colors disabled:opacity-50 ${isNull ? 'italic text-[var(--color-null)] border-[var(--color-border)]' : 'text-[var(--color-text-primary)] border-[var(--color-accent)]/60'}`
      }
      style={isInline ? { height: 28 } : undefined}
    />
  )
}
