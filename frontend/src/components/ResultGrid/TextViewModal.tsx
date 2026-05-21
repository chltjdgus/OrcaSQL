import { Copy, X } from 'lucide-react'
import toast from 'react-hot-toast'

interface TextViewModalProps {
  content: string
  colName: string
  onClose: () => void
}

export default function TextViewModal({ content, colName, onClose }: TextViewModalProps) {
  const byteLen = new TextEncoder().encode(content).length
  const sizeLabel = byteLen >= 1024
    ? `${(byteLen / 1024).toFixed(1)} KB`
    : `${byteLen} B`

  function copyContent() {
    navigator.clipboard.writeText(content).then(() => toast.success('복사됨'))
  }

  return (
    <div
      className="osql-result-grid-text-view-modal fixed inset-0 z-50 flex items-center justify-center"
      style={{ backdropFilter: 'blur(2px)', backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        className="w-[680px] max-h-[70vh] flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{colName}</span>
            <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
              {content.length.toLocaleString()}자 · {sizeLabel}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={copyContent}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <Copy size={10} /> 복사
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 내용 영역 */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-xs text-[var(--color-text-primary)] whitespace-pre-wrap break-all font-mono leading-relaxed">
            {content}
          </pre>
        </div>
      </div>
    </div>
  )
}
