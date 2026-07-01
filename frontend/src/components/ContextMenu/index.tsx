import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  separator?: never
}

export interface ContextMenuSeparator {
  separator: true
  label?: never
  icon?: never
  onClick?: never
  disabled?: never
}

export type ContextMenuOption = ContextMenuItem | ContextMenuSeparator

interface Props {
  x: number
  y: number
  items: ContextMenuOption[]
  onClose: () => void
}

/**
 * 범용 컨텍스트 메뉴 컴포넌트.
 * 뷰포트 경계를 자동으로 감지해 넘치지 않도록 위치를 조정한다.
 */
export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y, visible: false })

  // 실제 DOM 크기를 측정해 뷰포트 경계 안으로 위치 조정
  useLayoutEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const gap = 4
    const adjX = Math.max(gap, Math.min(x, window.innerWidth - rect.width - gap))
    const adjY = Math.max(gap, Math.min(y, window.innerHeight - rect.height - gap))
    setPos({ x: adjX, y: adjY, visible: true })
  }, [x, y])

  // 바깥 클릭 / ESC 시 닫기
  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-50 w-48 py-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-2xl"
      style={{ left: pos.x, top: pos.y, visibility: pos.visible ? 'visible' : 'hidden' }}
    >
      {items.map((item, i) => {
        if ('separator' in item && item.separator) {
          return <div key={i} className="my-1 border-t border-[var(--color-border)]" />
        }
        const menuItem = item as ContextMenuItem
        return (
          <button
            key={i}
            disabled={menuItem.disabled}
            onClick={() => { menuItem.onClick(); onClose() }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors
              ${menuItem.disabled
                ? 'text-[var(--color-null)] cursor-not-allowed'
                : menuItem.danger
                ? 'text-[var(--color-error)] hover:bg-[var(--color-error)]/15 cursor-pointer'
                : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] cursor-pointer'
              }`}
          >
            {menuItem.icon && <span className="shrink-0">{menuItem.icon}</span>}
            {menuItem.label}
          </button>
        )
      })}
    </div>
  )
}
