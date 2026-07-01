import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ColStats } from './types'

interface ColumnStatsPopoverProps {
  colName: string
  colType: string
  stats: ColStats
  anchorX: number
  anchorY: number
  onClose: () => void
}

const ColumnStatsPopover = React.forwardRef<HTMLDivElement, ColumnStatsPopoverProps>(
  function ColumnStatsPopover({ colName, colType, stats, anchorX, anchorY, onClose }, ref) {
    const popRef = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState({ x: anchorX, y: anchorY })

    // 뷰포트 넘침 보정
    useLayoutEffect(() => {
      const el = (ref as React.RefObject<HTMLDivElement>)?.current ?? popRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      let x = anchorX
      let y = anchorY
      if (x + rect.width > window.innerWidth - 8) x = window.innerWidth - rect.width - 8
      if (y + rect.height > window.innerHeight - 8) y = anchorY - rect.height - 28
      setPos({ x, y })
    }, [anchorX, anchorY, ref])

    // 외부 클릭 닫기
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        const el = (ref as React.RefObject<HTMLDivElement>)?.current ?? popRef.current
        if (el && !el.contains(e.target as Node)) onClose()
      }
      setTimeout(() => document.addEventListener('mousedown', handler), 0)
      return () => document.removeEventListener('mousedown', handler)
    }, [onClose, ref])

    const fmt = (n: number | null, decimals = 2) =>
      n === null ? '—' : Number.isInteger(n) ? n.toLocaleString() : n.toFixed(decimals)

    const maxFreq = stats.topValues[0]?.[1] ?? 1

    return (
      <div
        ref={(node) => {
          popRef.current = node!
          if (typeof ref === 'function') ref(node)
          else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
        }}
        className="osql-result-grid-col-stats fixed z-50 w-56 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded shadow-xl text-xs text-[var(--color-text-primary)] overflow-hidden"
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-bg-tertiary)] border-b border-[var(--color-border)]">
          <div>
            <span className="font-medium text-[var(--color-accent)]">{colName}</span>
            {colType && <span className="ml-1.5 text-[9px] text-[var(--color-text-muted)]">{colType}</span>}
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
            <X size={11} />
          </button>
        </div>

        {/* 기본 통계 */}
        <div className="px-3 py-2 space-y-1 border-b border-[var(--color-border)]">
          <StatRow label="전체" value={stats.total.toLocaleString()} />
          <StatRow label="NULL" value={stats.nullCount.toLocaleString()} highlight={stats.nullCount > 0} />
          <StatRow label="고유값" value={stats.distinctCount.toLocaleString()} />
          <div className="flex items-center justify-between">
            <span className="text-[var(--color-text-muted)]">채움률</span>
            <div className="flex items-center gap-1.5">
              <div className="w-16 h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--color-accent)]"
                  style={{ width: `${stats.fillRate}%` }}
                />
              </div>
              <span className="text-[var(--color-text-subtle)]">{stats.fillRate.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {/* 숫자형 통계 */}
        {stats.isNumeric && (
          <div className="px-3 py-2 space-y-1 border-b border-[var(--color-border)]">
            <StatRow label="최소" value={fmt(stats.min)} />
            <StatRow label="최대" value={fmt(stats.max)} />
            <StatRow label="평균" value={fmt(stats.avg)} />
            <StatRow label="합계" value={fmt(stats.sum, 0)} />
          </div>
        )}

        {/* 상위 빈도 값 */}
        {stats.topValues.length > 0 && (
          <div className="px-3 py-2 space-y-1">
            <div className="text-[10px] text-[var(--color-text-muted)] mb-1.5">상위 빈도 값</div>
            {stats.topValues.map(([val, cnt]) => (
              <div key={val} className="flex items-center gap-1.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <div
                      className="h-1.5 bg-[var(--color-accent)]/60 rounded-sm shrink-0"
                      style={{ width: `${Math.round((cnt / maxFreq) * 48)}px` }}
                    />
                    <span className="text-[10px] text-[var(--color-text-subtle)] truncate max-w-[80px]"
                      title={val}>{val === '' ? '(빈 문자열)' : val}</span>
                  </div>
                </div>
                <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{cnt}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  },
)

export default ColumnStatsPopover

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className={highlight ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-subtle)]'}>{value}</span>
    </div>
  )
}
