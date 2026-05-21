/**
 * 16-B (revised) — 인덱스 탭: 트리 구조 + DnD 컬럼 순서 편집.
 */
import { useState } from 'react'
import { Plus, Trash2, GripVertical, X, ChevronDown, ChevronRight } from 'lucide-react'
import { useTableDesignerStore } from '@/stores/useTableDesignerStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { IndexFlagIcon, type IndexFlag } from '@/components/common/IndexFlagIcon'
import type { IndexDef } from '@/types'

function idxType(idx: IndexDef): IndexFlag {
  if (idx.isPrimary) return 'PRIMARY'
  if (idx.fullText)  return 'FULLTEXT'
  if (idx.unique)    return 'UNIQUE'
  return 'INDEX'
}

export default function IndexesTab() {
  const language = useLanguageStore((s) => s.language)
  const meta = useTableDesignerStore((s) => s.editedMeta)
  const rows = useTableDesignerStore((s) => s.editedRows)
  const setIndexes = useTableDesignerStore((s) => s.setIndexes)

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([0]))
  const [dragFrom, setDragFrom] = useState<{ i: number; j: number } | null>(null)
  const [dragOver, setDragOver] = useState<{ i: number; j: number } | null>(null)

  if (!meta) return null

  const indexes = meta.indexes ?? []
  const columns = rows.map((r) => r.name).filter(Boolean)

  const add = () => {
    const newIdx = indexes.length
    setIndexes([
      ...indexes,
      {
        name: `idx_${indexes.length + 1}`,
        columns: [],
        columnDirections: [],
        unique: false,
        fullText: false,
        indexType: 'BTREE',
        isPrimary: false,
      },
    ])
    setExpanded((prev) => new Set([...prev, newIdx]))
  }

  const update = (i: number, patch: Partial<IndexDef>) => {
    setIndexes(indexes.map((idx, j) => (j === i ? { ...idx, ...patch } : idx)))
  }

  const remove = (i: number) => {
    setIndexes(indexes.filter((_, j) => j !== i))
    setExpanded((prev) => {
      const next = new Set<number>()
      for (const v of prev) {
        if (v < i) next.add(v)
        else if (v > i) next.add(v - 1)
      }
      return next
    })
  }

  const toggleExpand = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const addColumn = (i: number) => {
    const used = new Set(indexes[i].columns)
    const next = columns.find((c) => !used.has(c))
    if (!next) return
    update(i, {
      columns: [...indexes[i].columns, next],
      columnDirections: [...(indexes[i].columnDirections ?? []), 'ASC'],
    })
  }

  const removeColumn = (i: number, j: number) => {
    const cols = indexes[i].columns.filter((_, k) => k !== j)
    const dirs = (indexes[i].columnDirections ?? []).filter((_, k) => k !== j)
    update(i, { columns: cols, columnDirections: dirs })
  }

  const reorderIndex = (idxI: number, from: number, to: number) => {
    const idx = indexes[idxI]
    const cols = [...idx.columns]
    const dirs = [...(idx.columnDirections ?? [])]
    const [c] = cols.splice(from, 1)
    const [d] = dirs.splice(from, 1)
    cols.splice(to, 0, c)
    dirs.splice(to, 0, d)
    update(idxI, { columns: cols, columnDirections: dirs })
  }

  return (
    <div className="p-3 overflow-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">
          인덱스 ({indexes.length})
        </span>
        <button
          onClick={add}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          <Plus size={10} /> 추가
        </button>
      </div>

      {indexes.length === 0 && (
        <div className="text-center text-[var(--color-null)] text-[10px] mt-6">인덱스 없음</div>
      )}

      <div className="flex flex-col gap-1">
        {indexes.map((idx, i) => {
          const type = idxType(idx)
          const isExpanded = expanded.has(i)
          const allUsed = columns.length > 0 && columns.every((c) => idx.columns.includes(c))

          return (
            <div key={i} className="border border-[var(--color-border)] rounded bg-[var(--color-bg-primary)]">
              {/* 인덱스 헤더 */}
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <button
                  onClick={() => toggleExpand(i)}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text-subtle)] shrink-0"
                >
                  {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>

                {/* 인덱스 종류 아이콘 — Data 그리드와 동일 세트 */}
                <span className="shrink-0 inline-flex items-center">
                  <IndexFlagIcon flag={type} language={language} />
                </span>

                {/* 이름 */}
                {idx.isPrimary ? (
                  <span className="text-[11px] text-[var(--color-pk)] font-medium flex-1">PRIMARY</span>
                ) : (
                  <input
                    value={idx.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    className={`${inputCls} flex-1`}
                  />
                )}

                {/* 타입 셀렉트 */}
                {!idx.isPrimary && (
                  <select
                    value={idx.fullText ? 'FULLTEXT' : idx.unique ? 'UNIQUE' : idx.indexType}
                    onChange={(e) => {
                      const v = e.target.value
                      update(i, {
                        indexType: v === 'FULLTEXT' ? 'FULLTEXT' : v === 'UNIQUE' ? 'BTREE' : v,
                        fullText: v === 'FULLTEXT',
                        unique: v === 'UNIQUE',
                      })
                    }}
                    className={`${inputCls} w-24 shrink-0`}
                  >
                    <option value="INDEX">INDEX</option>
                    <option value="UNIQUE">UNIQUE</option>
                    <option value="FULLTEXT">FULLTEXT</option>
                    <option value="BTREE">BTREE</option>
                    <option value="HASH">HASH</option>
                  </select>
                )}

                {/* +컬럼 */}
                <button
                  onClick={() => addColumn(i)}
                  disabled={allUsed || columns.length === 0}
                  className="text-[var(--color-accent)] hover:text-[var(--color-accent-light)] disabled:opacity-30 shrink-0"
                  title="컬럼 추가"
                >
                  <Plus size={11} />
                </button>

                {/* 삭제 */}
                <button
                  onClick={() => remove(i)}
                  disabled={idx.isPrimary}
                  className="text-[var(--color-error)] hover:text-[var(--color-error)] disabled:opacity-20 shrink-0"
                  title="인덱스 삭제"
                >
                  <Trash2 size={10} />
                </button>
              </div>

              {/* 컬럼 목록 */}
              {isExpanded && idx.columns.length > 0 && (
                <div className="border-t border-[var(--color-border)]">
                  {idx.columns.map((col, j) => {
                    const isOver =
                      dragOver?.i === i && dragOver.j === j && dragFrom?.i === i
                    return (
                      <div
                        key={j}
                        draggable
                        onDragStart={() => setDragFrom({ i, j })}
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOver({ i, j })
                        }}
                        onDrop={() => {
                          if (dragFrom && dragFrom.i === i && dragFrom.j !== j) {
                            reorderIndex(i, dragFrom.j, j)
                          }
                          setDragFrom(null)
                          setDragOver(null)
                        }}
                        onDragEnd={() => {
                          setDragFrom(null)
                          setDragOver(null)
                        }}
                        className={`flex items-center gap-2 px-2 py-1 text-[10px] ${
                          isOver ? 'bg-[var(--color-bg-tertiary)]' : 'hover:bg-[var(--color-bg-tertiary)]'
                        }`}
                      >
                        <GripVertical size={10} className="text-[var(--color-null)] cursor-grab shrink-0" />

                        {/* 컬럼 셀렉트 */}
                        <select
                          value={col}
                          onChange={(e) => {
                            const cols = [...idx.columns]
                            cols[j] = e.target.value
                            update(i, { columns: cols })
                          }}
                          className={`${inputCls} flex-1`}
                        >
                          {columns.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>

                        {/* ASC/DESC */}
                        <select
                          value={(idx.columnDirections ?? [])[j] ?? 'ASC'}
                          onChange={(e) => {
                            const dirs = [...(idx.columnDirections ?? [])]
                            dirs[j] = e.target.value
                            update(i, { columnDirections: dirs })
                          }}
                          className={`${inputCls} w-14 shrink-0`}
                        >
                          <option value="ASC">ASC</option>
                          <option value="DESC">DESC</option>
                        </select>

                        {/* × 제거 */}
                        <button
                          onClick={() => removeColumn(i, j)}
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-error)] shrink-0"
                          title="컬럼 제거"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {isExpanded && idx.columns.length === 0 && (
                <div className="border-t border-[var(--color-border)] px-4 py-2 text-[9px] text-[var(--color-null)]">
                  컬럼 없음 — + 버튼으로 추가
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const inputCls =
  'h-6 px-1.5 text-[11px] rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] transition-colors'
