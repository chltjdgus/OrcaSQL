import { useRef, useEffect, useCallback } from 'react'
import type { CellEditorProps } from './index'

/**
 * SET 컬럼용 멀티셀렉트 체크박스 에디터.
 * enumValues prop으로 허용 값 목록을 전달받아 복수 선택 UI 제공.
 */
export function SetEditor({
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
  anchorRect,
}: CellEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isInline = mode === 'inline'

  // 현재 선택된 값들 파싱
  const selectedSet = new Set(
    isNull || !value ? [] : value.split(',').map((s) => s.trim()).filter(Boolean)
  )

  // enum 값이 없으면 일반 텍스트 입력으로 폴백
  if (!enumValues || enumValues.length === 0) {
    return <FallbackInput
      value={value} isNull={isNull} onChange={onChange} onSetNull={onSetNull}
      onConfirm={onConfirm} onCancel={onCancel} disabled={disabled} isInline={isInline}
    />
  }

  const toggleValue = useCallback((v: string) => {
    const newSet = new Set(selectedSet)
    if (newSet.has(v)) {
      newSet.delete(v)
    } else {
      newSet.add(v)
    }
    // enumValues 순서를 유지하여 join
    const ordered = enumValues!.filter((ev) => newSet.has(ev))
    onChange(ordered.join(','))
  }, [selectedSet, enumValues, onChange])

  // 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onConfirm()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onConfirm])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, onConfirm])

  // 위치 계산 (인라인 모드)
  // BugFix-DK — viewport 가장자리 셀 편집 시 dropdown 이 우측 밖으로 잘리던 문제.
  // minWidth 만 정해두므로 실제 폭은 컨텐츠가 결정한다 — clamp 는 minWidth 기준으로
  // 보수적으로 잡고, maxWidth 도 함께 부여해 viewport 보다 커지지 않도록 한다.
  const MARGIN = 8
  const posStyle: React.CSSProperties = isInline && anchorRect
    ? (() => {
        const viewportW = window.innerWidth
        const minWidth = Math.min(Math.max(anchorRect.width, 140), viewportW - MARGIN * 2)
        const maxWidth = viewportW - MARGIN * 2
        const maxLeft = viewportW - minWidth - MARGIN
        const left = Math.max(MARGIN, Math.min(anchorRect.left, maxLeft))
        return {
          position: 'fixed',
          left,
          top: anchorRect.bottom,
          minWidth,
          maxWidth,
          zIndex: 100,
        }
      })()
    : {}

  // 아래 공간 부족 시 위로 표시
  if (isInline && anchorRect) {
    const spaceBelow = window.innerHeight - anchorRect.bottom
    // 확인 버튼 제거(BugFix-CR) 후 row 수 = enum 항목 + (nullable ? 1 : 0)
    const dropdownHeight = Math.min((enumValues.length + (nullable ? 1 : 0)) * 28 + 8, 220)
    if (spaceBelow < dropdownHeight) {
      posStyle.top = anchorRect.top - dropdownHeight
    }
  }

  return (
    <div ref={containerRef} style={{ ...posStyle, maxHeight: 220 }}
      className={`${isInline ? '' : 'relative'} bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded shadow-lg overflow-auto`}
    >
      {nullable && (
        <button
          onClick={() => { onSetNull(); if (!isInline) setTimeout(onConfirm, 0) }}
          disabled={disabled}
          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50 ${isNull ? 'bg-[var(--color-bg-selected)] font-medium' : ''} italic text-[var(--color-null)]`}
        >
          NULL
        </button>
      )}
      {enumValues.map((v) => (
        <label
          key={v}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer ${selectedSet.has(v) ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}
        >
          <input
            type="checkbox"
            checked={selectedSet.has(v)}
            onChange={() => toggleValue(v)}
            disabled={disabled || isNull}
            className="accent-[var(--color-accent)] w-3.5 h-3.5"
          />
          {v}
        </label>
      ))}
      {/* BugFix-CR: 확인 버튼 제거 — 팝오버 바깥 클릭 / Enter 키 / 다음 셀로 이동 시 commit */}
    </div>
  )
}

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
