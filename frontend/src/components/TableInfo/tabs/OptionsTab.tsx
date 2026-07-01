/**
 * 16-B — 테이블 옵션 탭: 엔진 / 문자셋 / 콜레이션 / AUTO_INCREMENT / ROW_FORMAT.
 */
import { useTableDesignerStore } from '@/stores/useTableDesignerStore'

const ENGINES = ['InnoDB', 'MyISAM', 'MEMORY', 'CSV', 'ARCHIVE', 'BLACKHOLE']
const CHARSETS = ['utf8mb4', 'utf8', 'latin1', 'ascii', 'euckr', 'cp949']
const ROW_FORMATS = ['', 'DEFAULT', 'COMPACT', 'REDUNDANT', 'DYNAMIC', 'COMPRESSED']

export default function OptionsTab() {
  const meta = useTableDesignerStore((s) => s.editedMeta)
  const updateMeta = useTableDesignerStore((s) => s.updateMeta)
  if (!meta) return null

  return (
    <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-3">
      <Field label="스토리지 엔진">
        <select
          value={meta.engine}
          onChange={(e) => updateMeta({ engine: e.target.value })}
          className={inputCls}
        >
          {ENGINES.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
      </Field>
      <Field label="AUTO_INCREMENT">
        <input
          type="number"
          value={meta.autoIncrement || ''}
          onChange={(e) => updateMeta({ autoIncrement: Number(e.target.value) || 0 })}
          className={inputCls}
          placeholder="(auto)"
        />
      </Field>
      <Field label="기본 문자셋">
        <select
          value={meta.charset}
          onChange={(e) => updateMeta({ charset: e.target.value })}
          className={inputCls}
        >
          {CHARSETS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="콜레이션">
        <input
          value={meta.collation}
          onChange={(e) => updateMeta({ collation: e.target.value })}
          className={inputCls}
          placeholder="utf8mb4_general_ci"
        />
      </Field>
      <Field label="ROW_FORMAT">
        <select
          value={meta.rowFormat}
          onChange={(e) => updateMeta({ rowFormat: e.target.value })}
          className={inputCls}
        >
          {ROW_FORMATS.map((r) => (
            <option key={r} value={r}>{r || '(기본)'}</option>
          ))}
        </select>
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-24 shrink-0 text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">
        {label}
      </label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

const inputCls =
  'w-full px-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] transition-colors'
