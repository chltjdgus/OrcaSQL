import React, { useEffect } from 'react'
import { useThemeStore } from '@/stores/useThemeStore'

export default function ToolModal({
  children, title, onClose, size = 'lg',
}: {
  children: React.ReactNode
  title: string
  onClose: () => void
  size?: 'sm' | 'lg' | 'settings'
}) {
  const { theme } = useThemeStore()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const sizeClass =
    size === 'sm'       ? 'w-[480px] h-auto max-h-[70vh]' :
    size === 'settings' ? 'w-[720px] h-[600px]' :
                          'w-[85vw] h-[80vh] max-w-[1200px]'
  const modalBg   = theme === 'dark' ? 'bg-[#0f1117] border-[#2d3748]' : 'bg-white border-[#d1d5db]'
  const headerBg  = theme === 'dark' ? 'bg-[#161b27] border-[#2d3748]' : 'bg-[#f8f9fa] border-[#e5e7eb]'
  const titleColor = theme === 'dark' ? 'text-[#a0aec0]' : 'text-[#374151]'
  const closeBtnHover = theme === 'dark' ? 'hover:bg-[#2d3748] text-[#718096]' : 'hover:bg-[#e5e7eb] text-[#6b7280]'

  return (
    <div
      className="osql-modal-backdrop fixed inset-0 z-50 flex items-center justify-center"
      style={{ backdropFilter: 'blur(2px)', backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className={`osql-modal ${sizeClass} rounded-lg overflow-hidden shadow-2xl border ${modalBg} flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-4 py-2 ${headerBg} border-b shrink-0`}>
          <span className={`text-xs font-medium ${titleColor}`}>{title}</span>
          <button onClick={onClose} className={`p-1 rounded ${closeBtnHover}`}>
            <span className="text-xs">✕</span>
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  )
}
