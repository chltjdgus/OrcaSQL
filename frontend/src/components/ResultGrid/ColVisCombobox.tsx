import { useEffect, useRef, useState } from 'react'
import type { Table, VisibilityState } from '@tanstack/react-table'
import { ChevronDown, Columns, Search, X } from 'lucide-react'

interface ColVisComboboxProps {
  table: Table<unknown[]>
  columnVisibility: VisibilityState
  open: boolean
  onOpenChange: (v: boolean) => void
}

export default function ColVisCombobox({
  table,
  columnVisibility,
  open,
  onOpenChange,
}: ColVisComboboxProps) {
  const [search, setSearch] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const allCols = table.getAllLeafColumns()
  const hiddenCount = Object.values(columnVisibility).filter((v) => v === false).length

  const filtered = search.trim()
    ? allCols.filter((col) => col.id.toLowerCase().includes(search.toLowerCase()))
    : allCols

  const handleOpen = () => {
    setSearch('')
    onOpenChange(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onOpenChange(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onOpenChange])

  return (
    <div ref={wrapRef} className="osql-result-grid-col-vis relative">
      {/* 트리거 버튼 */}
      <button
        onClick={open ? () => { onOpenChange(false); setSearch('') } : handleOpen}
        className={[
          'flex items-center gap-1 h-6 px-2 rounded border text-[11px] transition-colors',
          open
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
            : hiddenCount > 0
            ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
            : 'border-[var(--color-border)] bg-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-null)]',
        ].join(' ')}
        title="컬럼 표시/숨기기"
      >
        <Columns size={11} />
        <span className="font-mono">
          {hiddenCount > 0
            ? `${allCols.length - hiddenCount}/${allCols.length}`
            : `${allCols.length}열`}
        </span>
        <ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* 드롭다운 */}
      {open && (
        <div className="absolute right-0 top-full mt-0.5 z-30 w-56 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-xl flex flex-col">
          {/* 검색 + 전체 토글 */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--color-border)] shrink-0">
            <Search size={11} className="shrink-0 text-[var(--color-null)]" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { onOpenChange(false); setSearch('') } }}
              placeholder="컬럼 검색..."
              className="flex-1 bg-transparent text-[11px] text-[var(--color-text-primary)] placeholder-[var(--color-null)] outline-none min-w-0"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-[var(--color-null)] hover:text-[var(--color-text-muted)]">
                <X size={9} />
              </button>
            )}
          </div>

          {/* 전체 표시 / 전체 숨김 (검색 중이 아닐 때만) */}
          {!search && (
            <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)] shrink-0">
              <button
                onClick={() => table.toggleAllColumnsVisible(true)}
                className="flex-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded px-1.5 py-0.5 transition-colors"
              >
                전체 표시
              </button>
              <div className="w-px h-3 bg-[var(--color-border)]" />
              <button
                onClick={() => allCols.forEach((col, i) => { if (i > 0) col.toggleVisibility(false) })}
                className="flex-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 rounded px-1.5 py-0.5 transition-colors"
              >
                전체 숨김
              </button>
            </div>
          )}

          {/* 컬럼 목록 */}
          <div className="overflow-y-auto max-h-52">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-[var(--color-null)]">검색 결과 없음</div>
            ) : (
              filtered.map((col) => {
                const orderIdx = allCols.findIndex((c) => c.id === col.id)
                const visible = col.getIsVisible()
                return (
                  <label
                    key={col.id}
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors group
                      ${visible ? 'hover:bg-[var(--color-bg-secondary)]' : 'hover:bg-[var(--color-bg-secondary)] opacity-60'}`}
                  >
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={col.getToggleVisibilityHandler()}
                      className="accent-[var(--color-accent)] w-3 h-3 shrink-0"
                    />
                    <span className="shrink-0 text-[9px] text-[var(--color-null)] font-mono w-5 text-right tabular-nums">
                      {orderIdx + 1}
                    </span>
                    <span className={`flex-1 truncate text-[11px] font-mono min-w-0
                      ${visible ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-null)] line-through'}`}>
                      {col.id}
                    </span>
                  </label>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
