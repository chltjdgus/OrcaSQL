import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Copy, Rows3, X } from 'lucide-react'

interface RowDetailModalProps {
  row: unknown[]
  columns: string[]
  rowNum: number
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  nullText: string
}

export default function RowDetailModal({
  row,
  columns,
  rowNum,
  onClose,
  onPrev,
  onNext,
  nullText,
}: RowDetailModalProps) {
  // ESC 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && onPrev) onPrev()
      if (e.key === 'ArrowRight' && onNext) onNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onPrev, onNext])

  return (
    <div
      className="osql-result-grid-row-detail-modal fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-h-[80vh] flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-2">
            <Rows3 size={13} className="text-[var(--color-accent)]" />
            <span className="text-xs font-medium text-[var(--color-text-primary)]">Row {rowNum}</span>
            <span className="text-[10px] text-[var(--color-text-muted)]">/ {columns.length}개 컬럼</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onPrev}
              disabled={!onPrev}
              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] disabled:opacity-30"
              title="이전 행 (←)"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={onNext}
              disabled={!onNext}
              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] disabled:opacity-30"
              title="다음 행 (→)"
            >
              <ChevronRight size={14} />
            </button>
            <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
            <button
              onClick={onClose}
              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)]"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 컬럼별 세로 레이아웃 */}
        <div className="flex-1 overflow-y-auto">
          {columns.map((col, i) => {
            const val = row[i]
            const isNull = val === null || val === undefined
            const displayVal = isNull ? nullText : String(val)
            return (
              <div
                key={col}
                className="flex border-b border-[var(--color-bg-tertiary)] min-h-[36px] group hover:bg-[var(--color-bg-secondary)]"
              >
                {/* 컬럼명 */}
                <div className="w-[160px] shrink-0 flex items-start px-3 py-2 border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                  <span className="text-[11px] font-mono text-[var(--color-accent-light)] break-all leading-snug">{col}</span>
                </div>
                {/* 값 */}
                <div className="flex-1 flex items-start gap-2 px-3 py-2 min-w-0">
                  <span className={`text-xs break-all leading-snug flex-1 min-w-0 ${isNull ? 'text-[var(--color-null)] italic' : 'text-[var(--color-text-primary)]'}`}>
                    {displayVal}
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(isNull ? '' : displayVal)}
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded text-[var(--color-null)] hover:text-[var(--color-text-subtle)] transition-opacity"
                    title="복사"
                  >
                    <Copy size={11} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
