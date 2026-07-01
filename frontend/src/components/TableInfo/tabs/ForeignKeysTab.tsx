/**
 * 16-B — 외래 키 탭: FK CRUD.
 */
import { Plus, Trash2 } from 'lucide-react'
import { useTableDesignerStore } from '@/stores/useTableDesignerStore'
import type { ForeignKeyDef } from '@/types'

const FK_RULES = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION']

export default function ForeignKeysTab() {
  const meta = useTableDesignerStore((s) => s.editedMeta)
  const rows = useTableDesignerStore((s) => s.editedRows)
  const setForeignKeys = useTableDesignerStore((s) => s.setForeignKeys)
  if (!meta) return null

  const fks = meta.foreignKeys ?? []
  const columns = rows.map((r) => r.name).filter(Boolean)

  const add = () => {
    setForeignKeys([
      ...fks,
      {
        name: `fk_${fks.length + 1}`,
        column: columns[0] ?? '',
        refTable: '',
        refColumn: '',
        onDelete: 'RESTRICT',
        onUpdate: 'RESTRICT',
      },
    ])
  }

  const update = (i: number, patch: Partial<ForeignKeyDef>) => {
    setForeignKeys(fks.map((fk, j) => (j === i ? { ...fk, ...patch } : fk)))
  }

  const remove = (i: number) => {
    setForeignKeys(fks.filter((_, j) => j !== i))
  }

  return (
    <div className="p-3 overflow-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">외래 키 ({fks.length})</span>
        <button
          onClick={add}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          <Plus size={10} /> 추가
        </button>
      </div>

      {fks.length === 0 && (
        <div className="text-center text-[var(--color-null)] text-[10px] mt-6">외래 키 없음</div>
      )}

      {fks.map((fk, i) => (
        <div key={i} className="border border-[var(--color-border)] rounded p-2 mb-2 bg-[var(--color-bg-secondary)]">
          <div className="grid grid-cols-3 gap-2">
            <Field label="이름">
              <input
                value={fk.name}
                onChange={(e) => update(i, { name: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="컬럼">
              <select
                value={fk.column}
                onChange={(e) => update(i, { column: e.target.value })}
                className={inputCls}
              >
                {columns.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <div />
            <Field label="참조 테이블">
              <input
                value={fk.refTable}
                onChange={(e) => update(i, { refTable: e.target.value })}
                className={inputCls}
                placeholder="table_name"
              />
            </Field>
            <Field label="참조 컬럼">
              <input
                value={fk.refColumn}
                onChange={(e) => update(i, { refColumn: e.target.value })}
                className={inputCls}
                placeholder="column_name"
              />
            </Field>
            <button
              onClick={() => remove(i)}
              className="self-end justify-self-end text-[10px] text-[var(--color-error)] hover:text-[var(--color-error)] flex items-center gap-1"
            >
              <Trash2 size={10} /> 삭제
            </button>
            <Field label="ON DELETE">
              <select
                value={fk.onDelete}
                onChange={(e) => update(i, { onDelete: e.target.value })}
                className={inputCls}
              >
                {FK_RULES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="ON UPDATE">
              <select
                value={fk.onUpdate}
                onChange={(e) => update(i, { onUpdate: e.target.value })}
                className={inputCls}
              >
                {FK_RULES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      ))}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[9px] text-[var(--color-text-muted)] uppercase">{label}</label>
      {children}
    </div>
  )
}

const inputCls =
  'h-6 px-1.5 text-[11px] rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] transition-colors w-full'
