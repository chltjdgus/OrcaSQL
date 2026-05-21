/**
 * 16-B — CHECK 제약 탭: CHECK CRUD (MySQL 8.0+).
 */
import { Plus, Trash2 } from 'lucide-react'
import { useTableDesignerStore } from '@/stores/useTableDesignerStore'
import type { CheckConstraintDef } from '@/types'

export default function ChecksTab() {
  const meta = useTableDesignerStore((s) => s.editedMeta)
  const setCheckConstraints = useTableDesignerStore((s) => s.setCheckConstraints)
  if (!meta) return null

  const checks = meta.checkConstraints ?? []

  const add = () => {
    setCheckConstraints([
      ...checks,
      { name: `chk_${checks.length + 1}`, expression: '', enforced: true },
    ])
  }

  const update = (i: number, patch: Partial<CheckConstraintDef>) => {
    setCheckConstraints(checks.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  }

  const remove = (i: number) => {
    setCheckConstraints(checks.filter((_, j) => j !== i))
  }

  return (
    <div className="p-3 overflow-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">CHECK 제약 ({checks.length})</span>
        <button
          onClick={add}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          <Plus size={10} /> 추가
        </button>
      </div>

      {checks.length === 0 && (
        <div className="text-center text-[var(--color-null)] text-[10px] mt-6">CHECK 제약 없음 (MySQL 8.0+ 필요)</div>
      )}

      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
            <th className="text-left py-1 px-2 font-normal">이름</th>
            <th className="text-left py-1 px-2 font-normal">표현식</th>
            <th className="text-left py-1 px-2 font-normal">강제</th>
            <th className="py-1 px-2"></th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c, i) => (
            <tr key={i} className="border-b border-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)]">
              <td className="py-1 px-2">
                <input
                  value={c.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  className={inputCls}
                />
              </td>
              <td className="py-1 px-2">
                <input
                  value={c.expression}
                  onChange={(e) => update(i, { expression: e.target.value })}
                  className={`${inputCls} font-mono`}
                  placeholder="column > 0"
                />
              </td>
              <td className="py-1 px-2">
                <input
                  type="checkbox"
                  checked={c.enforced}
                  onChange={(e) => update(i, { enforced: e.target.checked })}
                  className="accent-[var(--color-accent)]"
                />
              </td>
              <td className="py-1 px-2">
                <button
                  onClick={() => remove(i)}
                  className="text-[var(--color-error)] hover:text-[var(--color-error)]"
                  title="삭제"
                >
                  <Trash2 size={10} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const inputCls =
  'h-6 px-1.5 text-[11px] rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] transition-colors w-full'
