import { useMemo, useState, useRef, useCallback } from 'react'
import type { ExplainTreeNode, TreeEdge } from './parser'
import { parseExplainJSON, flattenTree, collectEdges } from './parser'

// ─── 노드 색상 (access type 기반) ───────────────────────────────────────────

const ACCESS_TYPE_COLOR: Record<string, { bg: string; border: string; badge: string }> = {
  ALL:    { bg: '#2d1515', border: '#fc8181', badge: '#fc8181' },   // 빨강 — Full Scan
  index:  { bg: '#2d2415', border: '#f6ad55', badge: '#f6ad55' },   // 주황
  range:  { bg: '#1a2d1a', border: '#68d391', badge: '#68d391' },   // 초록
  ref:    { bg: '#1a2d1a', border: '#68d391', badge: '#68d391' },   // 초록
  eq_ref: { bg: '#152d2d', border: '#4299e1', badge: '#4299e1' },   // 파랑
  const:  { bg: '#152d2d', border: '#4299e1', badge: '#4299e1' },   // 파랑
  system: { bg: '#152d2d', border: '#4299e1', badge: '#4299e1' },   // 파랑
}

const DEFAULT_COLOR = { bg: 'var(--color-bg-tertiary)', border: 'var(--color-null)', badge: 'var(--color-text-muted)' }

function getColor(accessType?: string) {
  return accessType ? (ACCESS_TYPE_COLOR[accessType] ?? DEFAULT_COLOR) : DEFAULT_COLOR
}

// ─── SVG 상수 ────────────────────────────────────────────────────────────────
const PADDING = 40    // 캔버스 여백
const NODE_W = 220
const NODE_H = 80
const CORNER_R = 8

// ─── ExplainTreeView 컴포넌트 ────────────────────────────────────────────────

interface Props {
  jsonStr: string
}

export default function ExplainTreeView({ jsonStr }: Props) {
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState<[number, number]>([0, 0])
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null)

  const root = useMemo(() => parseExplainJSON(jsonStr), [jsonStr])

  // 컨테이너 드래그 패닝
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = { startX: e.clientX, startY: e.clientY, tx: translate[0], ty: translate[1] }
  }, [translate])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return
    setTranslate([
      dragging.current.tx + (e.clientX - dragging.current.startX),
      dragging.current.ty + (e.clientY - dragging.current.startY),
    ])
  }, [])

  const onMouseUp = useCallback(() => { dragging.current = null }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setScale(prev => Math.min(2, Math.max(0.3, prev - e.deltaY * 0.001)))
  }, [])

  if (!root) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-xs">
        EXPLAIN JSON 파싱 실패 — MySQL 5.6+ 이상에서 지원됩니다
      </div>
    )
  }

  const nodes = flattenTree(root)
  const edges = collectEdges(root)

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--color-bg-primary)]">
      {/* 툴바 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
        <span className="text-[10px] text-[var(--color-text-muted)]">
          노드 {nodes.length}개 · 드래그로 이동 · 스크롤로 확대/축소
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setScale(s => Math.min(2, s + 0.1))}
            className="px-2 py-0.5 text-[11px] bg-[var(--color-bg-tertiary)] text-[var(--color-text-subtle)] rounded hover:bg-[var(--color-bg-hover)]"
          >+</button>
          <span className="text-[10px] text-[var(--color-text-muted)] w-9 text-center">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale(s => Math.max(0.3, s - 0.1))}
            className="px-2 py-0.5 text-[11px] bg-[var(--color-bg-tertiary)] text-[var(--color-text-subtle)] rounded hover:bg-[var(--color-bg-hover)]"
          >−</button>
          <button
            onClick={() => { setScale(1); setTranslate([0, 0]) }}
            className="ml-1 px-2 py-0.5 text-[10px] bg-[var(--color-bg-tertiary)] text-[var(--color-text-subtle)] rounded hover:bg-[var(--color-bg-hover)]"
          >리셋</button>
        </div>
      </div>

      {/* SVG 캔버스 */}
      <div
        className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ display: 'block' }}
        >
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="var(--color-null)" />
            </marker>
          </defs>
          <g transform={`translate(${translate[0]},${translate[1]}) scale(${scale})`}>
            <g transform={`translate(${PADDING},${PADDING})`}>
              {/* 엣지 (먼저 그려 노드 뒤에 위치) */}
              {edges.map((edge, i) => (
                <EdgeLine key={i} edge={edge} />
              ))}
              {/* 노드 */}
              {nodes.map(node => (
                <TreeNodeSVG key={node.id} node={node} />
              ))}
            </g>
          </g>
        </svg>
      </div>

      {/* 범례 */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
        {[
          { label: 'ALL (Full Scan)', color: 'var(--color-error)' },
          { label: 'index / range', color: 'var(--color-warning)' },
          { label: 'ref / eq_ref', color: 'var(--color-success)' },
          { label: 'const / system', color: 'var(--color-accent)' },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm border" style={{ borderColor: color, background: color + '33' }} />
            <span className="text-[9px] text-[var(--color-text-muted)]">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 엣지 (베지어 곡선) ──────────────────────────────────────────────────────

function EdgeLine({ edge }: { edge: TreeEdge }) {
  const { from, to } = edge
  const x1 = from.x + NODE_W / 2
  const y1 = from.y + NODE_H
  const x2 = to.x + NODE_W / 2
  const y2 = to.y
  const cy = (y1 + y2) / 2

  return (
    <path
      d={`M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`}
      stroke="var(--color-border)"
      strokeWidth={1.5}
      fill="none"
      markerEnd="url(#arrow)"
    />
  )
}

// ─── 트리 노드 ───────────────────────────────────────────────────────────────

function TreeNodeSVG({ node }: { node: ExplainTreeNode }) {
  const color = getColor(node.accessType)
  const isTable = !!node.accessType   // accessType이 있으면 실제 테이블 노드

  // 예상 행 수에 따른 시각적 강조
  const rowsBig = (node.rows ?? 0) > 10000

  return (
    <g transform={`translate(${node.x},${node.y})`}>
      {/* 배경 */}
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={CORNER_R}
        ry={CORNER_R}
        fill={color.bg}
        stroke={color.border}
        strokeWidth={isTable ? 1.5 : 1}
      />

      {/* 헤더: 테이블명 */}
      <foreignObject x={8} y={6} width={NODE_W - 16} height={22}>
        <div
          style={{
            color: 'var(--color-text-primary)',
            fontSize: '12px',
            fontWeight: 600,
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.label}
        </div>
      </foreignObject>

      {/* access_type 배지 */}
      {node.accessType && (
        <foreignObject x={8} y={28} width={NODE_W - 16} height={18}>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span
              style={{
                background: color.badge + '33',
                color: color.badge,
                border: `1px solid ${color.badge}`,
                borderRadius: '3px',
                padding: '0 4px',
                fontSize: '9px',
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}
            >
              {node.accessType.toUpperCase()}
            </span>
            {node.key && (
              <span style={{ color: 'var(--color-success)', fontSize: '9px' }}>
                idx: {node.key}
              </span>
            )}
          </div>
        </foreignObject>
      )}

      {/* 하단: rows / cost */}
      <foreignObject x={8} y={52} width={NODE_W - 16} height={22}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '9px' }}>
          {node.rows !== undefined && (
            <span style={{ color: rowsBig ? 'var(--color-error)' : 'var(--color-text-subtle)' }}>
              rows: {node.rows.toLocaleString()}
            </span>
          )}
          {node.cost && (
            <span style={{ color: 'var(--color-text-muted)' }}>
              cost: {parseFloat(node.cost).toFixed(2)}
            </span>
          )}
          {node.extra && (
            <span
              style={{
                color: 'var(--color-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '100px',
              }}
              title={node.extra}
            >
              {node.extra}
            </span>
          )}
        </div>
      </foreignObject>

      {/* rows 경고 아이콘 (10k 이상) */}
      {rowsBig && (
        <title>많은 행 수 주의 (10,000행 이상)</title>
      )}
      {rowsBig && (
        <text x={NODE_W - 14} y={20} fontSize="12" fill="var(--color-error)">⚠</text>
      )}
    </g>
  )
}
