import { useState, useCallback, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  Position,
  Handle,
  type ComponentType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { RefreshCw, X, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { ListTables, ListColumns, GetForeignKeys } from '@/wailsjs/go/main/App'
import type { FKInfo } from '@/wailsjs/go/main/App'
import type { ColumnInfo } from '@/types'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'

interface Props {
  connId: string
  database: string
  onClose: () => void
}

interface TableNodeData {
  tableName: string
  columns: ColumnInfo[]
  fkColumns: string[]  // FK를 가진 컬럼 이름 목록 (엣지 핸들용)
  [key: string]: unknown
}

/**
 * ER Diagram — ReactFlow 기반 시각적 스키마 뷰어.
 * 테이블 노드 + PK/FK 관계 엣지 자동 레이아웃.
 */
export default function ERDiagram({ connId, database, onClose }: Props) {
  const language = useLanguageStore((s) => s.language)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [loading, setLoading] = useState(false)

  const loadSchema = useCallback(async () => {
    setLoading(true)
    try {
      // 테이블 목록 + FK 정보 병렬 로드
      const [tables, fks] = await Promise.all([
        ListTables(connId, database),
        GetForeignKeys(connId, database).catch(() => [] as FKInfo[]), // FK 조회 실패 시 graceful fallback
      ])
      const baseTables = tables.filter((t) => t.type === 'BASE TABLE')

      // 컬럼 병렬 로드
      const tableData = await Promise.all(
        baseTables.map(async (t) => {
          const cols = await ListColumns(connId, database, t.name)
          return { table: t, cols }
        }),
      )

      // FK를 가진 컬럼 맵 구성: tableName → Set<columnName>
      const fkColMap = new Map<string, Set<string>>()
      for (const fk of fks) {
        if (!fkColMap.has(fk.tableName)) fkColMap.set(fk.tableName, new Set())
        fkColMap.get(fk.tableName)!.add(fk.columnName)
      }

      // 자동 그리드 레이아웃 (3열)
      const COLS = 3
      const COL_WIDTH = 280
      const ROW_HEIGHT = 300

      const newNodes: Node<TableNodeData>[] = tableData.map(({ table, cols }, i) => ({
        id: table.name,
        type: 'tableNode',
        position: {
          x: (i % COLS) * (COL_WIDTH + 40) + 40,
          y: Math.floor(i / COLS) * (ROW_HEIGHT + 40) + 40,
        },
        data: {
          tableName: table.name,
          columns: cols,
          fkColumns: [...(fkColMap.get(table.name) ?? [])],
        },
      }))

      // information_schema 기반 실제 FK 엣지 생성
      // 동일한 source/target 사이에 여러 FK가 있으면 하나의 엣지로 묶음
      const edgeMap = new Map<string, { label: string; fks: FKInfo[] }>()
      for (const fk of fks) {
        const edgeKey = `${fk.tableName}→${fk.refTableName}`
        if (!edgeMap.has(edgeKey)) {
          edgeMap.set(edgeKey, { label: fk.columnName, fks: [fk] })
        } else {
          const existing = edgeMap.get(edgeKey)!
          existing.fks.push(fk)
          existing.label = `${existing.label}, ${fk.columnName}`
        }
      }

      const newEdges: Edge[] = [...edgeMap.entries()].map(([key, { label, fks: edgeFKs }]) => {
        const firstFK = edgeFKs[0]
        return {
          id: key,
          source: firstFK.tableName,
          target: firstFK.refTableName,
          sourceHandle: `${firstFK.tableName}-${firstFK.columnName}-source`,
          targetHandle: `${firstFK.refTableName}-pk-target`,
          label,
          style: { stroke: 'var(--color-accent)', strokeWidth: 1.5 },
          labelStyle: { fill: 'var(--color-text-muted)', fontSize: 9 },
          type: 'smoothstep',
          animated: false,
        }
      })

      setNodes(newNodes)
      setEdges(newEdges)
      const fkMsg = language === 'ko'
        ? (fks.length > 0 ? ` · FK ${fks.length}개` : ' · FK 없음')
        : (fks.length > 0 ? ` · ${fks.length} FK` : ' · no FK')
      toast.success(language === 'ko'
        ? `${baseTables.length}개 테이블 로드 완료${fkMsg}`
        : `Loaded ${baseTables.length} table(s)${fkMsg}`)
    } catch (e) {
      toast.error(`${t('erSchemaLoadFailPrefix', language)}${e}`)
    } finally {
      setLoading(false)
    }
  }, [connId, database, setNodes, setEdges, language])

  useEffect(() => { loadSchema() }, [loadSchema])

  function exportSVG() {
    const svg = document.querySelector('.react-flow__renderer svg') as SVGElement | null
    if (!svg) { toast.error(t('erSvgExportFail', language)); return }
    const data = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([data], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${database}_er.svg`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('erSvgSaved', language))
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] shrink-0">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">ER Diagram</span>
        <span className="text-[10px] text-[var(--color-text-muted)]">{database}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={loadSchema}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {t('qlLabelRefresh', language)}
          </button>
          <button
            onClick={exportSVG}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <Download size={11} /> {t('erExportSvg', language)}
          </button>
          <button onClick={onClose} className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Flow Canvas */}
      <div className="flex-1 overflow-hidden">
        {loading && nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> {t('erLoadingSchema', language)}
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={{ tableNode: TableNode as ComponentType<{ data: Record<string, unknown> }> }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            style={{ background: 'var(--color-bg-primary)' }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--color-border)" gap={20} />
            <Controls style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }} />
            <MiniMap
              nodeColor="var(--color-bg-hover)"
              maskColor="rgba(0,0,0,0.5)"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            />
          </ReactFlow>
        )}
      </div>
    </div>
  )
}

// ─── Table 노드 렌더러 ────────────────────────────────────────────────────────

function TableNode({ data }: { data: TableNodeData }) {
  const language = useLanguageStore((s) => s.language)
  const { tableName, columns, fkColumns } = data
  const pkCols = columns.filter((c) => c.key === 'PRI')
  const otherCols = columns.filter((c) => c.key !== 'PRI')
  const fkColSet = new Set(fkColumns ?? [])

  return (
    <div
      className="rounded border border-[var(--color-border)] overflow-hidden"
      style={{ minWidth: 200, background: 'var(--color-bg-secondary)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
    >
      {/* 테이블 헤더 */}
      <div className="px-3 py-2 bg-[var(--color-bg-hover)] border-b border-[var(--color-border)]">
        <span className="text-xs font-semibold text-[var(--color-accent)]">{tableName}</span>
        <Handle
          type="target"
          position={Position.Top}
          id={`${tableName}-pk-target`}
          style={{ background: '#4299e1', width: 8, height: 8, top: -4 }}
        />
      </div>

      {/* PK 컬럼 */}
      {pkCols.map((col) => (
        <div
          key={col.name}
          className="flex items-center justify-between px-3 py-1 border-b border-[var(--color-border)]/50 bg-[var(--color-bg-tertiary)]"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] text-[#f6e05e] bg-[#f6e05e]/10 px-1 rounded">PK</span>
            <span className="text-[11px] text-[var(--color-text-primary)] font-medium">{col.name}</span>
          </div>
          <span className="text-[9px] text-[var(--color-text-muted)]">{col.dataType}</span>
          <Handle
            type="source"
            position={Position.Right}
            id={`${tableName}-${col.name}-source`}
            style={{ background: '#f6e05e', width: 6, height: 6, right: -3 }}
          />
        </div>
      ))}

      {/* 일반 컬럼 (최대 8개) */}
      {otherCols.slice(0, 8).map((col) => {
        const isFK = fkColSet.has(col.name)
        return (
          <div
            key={col.name}
            className="flex items-center justify-between px-3 py-0.5 border-b border-[var(--color-bg-tertiary)]"
          >
            <div className="flex items-center gap-1.5">
              {isFK && (
                <span className="text-[8px] text-[#4299e1] bg-[#4299e1]/10 px-1 rounded">FK</span>
              )}
              <span className="text-[10px] text-[var(--color-text-subtle)]">{col.name}</span>
            </div>
            <span className="text-[9px] text-[var(--color-null)]">{col.dataType}</span>
            {isFK && (
              <Handle
                type="source"
                position={Position.Right}
                id={`${tableName}-${col.name}-source`}
                style={{ background: '#4299e1', width: 5, height: 5, right: -3 }}
              />
            )}
          </div>
        )
      })}
      {otherCols.length > 8 && (
        <div className="px-3 py-1 text-[9px] text-[var(--color-null)]">
          {language === 'ko' ? `+${otherCols.length - 8}개 컬럼 더...` : `+${otherCols.length - 8} more columns...`}
        </div>
      )}
    </div>
  )
}

