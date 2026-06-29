import { Maximize2 } from 'lucide-react'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { LONG_TEXT_THRESHOLD } from './types'

interface CellValueProps {
  value: unknown
  onExpand?: (content: string) => void
}

export default function CellValue({ value, onExpand }: CellValueProps) {
  const nullText = useSettingsStore((s) => s.settings.display.nullDisplayText)
  if (value === null || value === undefined) {
    return <span className="osql-result-grid-cell-null text-[10px] italic text-[var(--color-null)]">{nullText || <>&nbsp;</>}</span>
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="text-[var(--color-warning)]">{value.toLocaleString()}</span>
  }
  const str = String(value)
  if (str.length > LONG_TEXT_THRESHOLD) {
    return (
      <span className="osql-result-grid-cell-long flex items-center gap-1 min-w-0">
        <span className="truncate text-[var(--color-text-subtle)]">{str.slice(0, LONG_TEXT_THRESHOLD)}…</span>
        <button
          onClick={(e) => { e.stopPropagation(); onExpand?.(str) }}
          className="shrink-0 p-0.5 rounded text-[var(--color-accent)] hover:text-[var(--color-accent-light)] hover:bg-[var(--color-bg-hover)] transition-colors"
          title="전체 내용 보기"
        >
          <Maximize2 size={10} />
        </button>
      </span>
    )
  }
  return <span title={str.length > 80 ? str : undefined}>{str}</span>
}
