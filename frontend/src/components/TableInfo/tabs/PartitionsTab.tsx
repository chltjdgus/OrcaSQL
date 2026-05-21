/**
 * 16-B — 파티션 탭: information_schema.PARTITIONS 조회 결과 (read-only).
 */
import { useTableDesignerStore } from '@/stores/useTableDesignerStore'

export default function PartitionsTab() {
  const meta = useTableDesignerStore((s) => s.editedMeta)
  if (!meta) return null

  const partitions = meta.partitions ?? []

  if (partitions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-null)] text-xs">
        파티션 정보 없음
      </div>
    )
  }

  return (
    <div className="p-3 overflow-auto h-full">
      <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
        파티션 ({partitions.length}) — 읽기 전용
      </div>
      <table className="w-full text-[11px] border-collapse">
        <thead className="bg-[var(--color-bg-secondary)]">
          <tr className="text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
            <th className="text-left py-1 px-2 font-normal">이름</th>
            <th className="text-left py-1 px-2 font-normal">메서드</th>
            <th className="text-left py-1 px-2 font-normal">표현식</th>
            <th className="text-left py-1 px-2 font-normal">설명</th>
            <th className="text-right py-1 px-2 font-normal">Rows</th>
            <th className="text-right py-1 px-2 font-normal">데이터</th>
            <th className="text-right py-1 px-2 font-normal">인덱스</th>
          </tr>
        </thead>
        <tbody>
          {partitions.map((p, i) => (
            <tr key={i} className="border-b border-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)]">
              <td className="py-1 px-2 font-mono text-[var(--color-text-primary)]">{p.name}</td>
              <td className="py-1 px-2 text-[var(--color-warning)]">{p.method}</td>
              <td className="py-1 px-2 font-mono text-[var(--color-text-subtle)]">{p.expression}</td>
              <td className="py-1 px-2 text-[var(--color-text-subtle)]">{p.description}</td>
              <td className="py-1 px-2 text-right text-[var(--color-success)]">{p.tableRows.toLocaleString()}</td>
              <td className="py-1 px-2 text-right text-[var(--color-accent)]">{formatBytes(p.dataLength)}</td>
              <td className="py-1 px-2 text-right text-[var(--color-accent)]">{formatBytes(p.indexLength)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
