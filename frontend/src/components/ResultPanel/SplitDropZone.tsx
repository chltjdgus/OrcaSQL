import { useState } from 'react'

interface SplitDropZoneProps {
  isDragActive: boolean
  onDrop: () => void
}

export default function SplitDropZone({ isDragActive, onDrop }: SplitDropZoneProps) {
  const [highlight, setHighlight] = useState(false)

  return (
    <div
      className={`absolute bottom-0 left-0 right-0 h-[30%] flex items-center justify-center
        border-t-2 transition-all duration-150 select-none
        ${isDragActive ? 'pointer-events-auto' : 'pointer-events-none opacity-0'}
        ${highlight ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)]' : 'bg-transparent border-transparent'}`}
      onDragOver={(e) => { e.preventDefault(); setHighlight(true) }}
      onDragLeave={() => setHighlight(false)}
      onDrop={(e) => { e.preventDefault(); setHighlight(false); onDrop() }}
    >
      {isDragActive && (
        <span className="text-[11px] text-[var(--color-accent)] font-medium pointer-events-none">
          여기에 드롭하여 분할 ↓
        </span>
      )}
    </div>
  )
}
