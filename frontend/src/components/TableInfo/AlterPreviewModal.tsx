/**
 * 16-E — 저장 전 ALTER SQL 미리보기 모달.
 */
import { useEffect } from 'react'
import { X, Check } from 'lucide-react'
import type { AlterStatement } from '@/types'

interface Props {
  stmt: AlterStatement
  onConfirm: () => void
  onCancel: () => void
  applying: boolean
}

export default function AlterPreviewModal({ stmt, onConfirm, onCancel, applying }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[640px] max-w-[90vw] max-h-[80vh] flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-2xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">변경 내역 미리보기</span>
          <button
            onClick={onCancel}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
          >
            <X size={14} />
          </button>
        </div>

        {/* 변경 요약 */}
        <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/50">
          <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider mb-1">변경 요약</div>
          <pre className="text-[11px] text-[var(--color-text-subtle)] whitespace-pre-wrap font-mono max-h-[120px] overflow-auto">
            {stmt.preview || '변경 없음'}
          </pre>
        </div>

        {/* SQL */}
        <div className="flex-1 overflow-auto px-4 py-2">
          <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider mb-1">실행될 SQL</div>
          <pre className="text-[11px] text-[var(--color-text-primary)] whitespace-pre-wrap font-mono bg-[var(--color-bg-secondary)] p-3 rounded border border-[var(--color-border)]">
            {stmt.sql || '-- 변경 없음'}
          </pre>
        </div>

        {/* 액션 */}
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <button
            onClick={onCancel}
            disabled={applying}
            className="px-3 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={applying || !stmt.sql}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors disabled:opacity-50"
          >
            <Check size={12} />
            {applying ? '실행 중...' : '실행'}
          </button>
        </div>
      </div>
    </div>
  )
}
