/**
 * 16-B — 테이블 기본 탭: 이름 / 코멘트.
 */
import { useTableDesignerStore } from '@/stores/useTableDesignerStore'

export default function BasicTab() {
  const meta = useTableDesignerStore((s) => s.editedMeta)
  const updateMeta = useTableDesignerStore((s) => s.updateMeta)
  if (!meta) return null

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <Field label="테이블 이름">
        <input
          value={meta.name}
          onChange={(e) => updateMeta({ name: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label="코멘트" grow>
        <textarea
          value={meta.comment}
          onChange={(e) => updateMeta({ comment: e.target.value })}
          className={`${inputCls} flex-1 min-h-[50px] py-1.5 resize-none`}
          placeholder="테이블 설명"
        />
      </Field>
    </div>
  )
}

function Field({
  label,
  children,
  grow,
}: {
  label: string
  children: React.ReactNode
  grow?: boolean
}) {
  return (
    <div className={`flex items-start gap-3 ${grow ? 'flex-1 min-h-0' : ''}`}>
      <label className="w-24 pt-1.5 shrink-0 text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">
        {label}
      </label>
      <div className={`flex-1 min-w-0 ${grow ? 'flex flex-col h-full' : ''}`}>
        {children}
      </div>
    </div>
  )
}

const inputCls =
  'w-full px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] transition-colors'
