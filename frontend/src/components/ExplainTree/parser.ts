/**
 * parser.ts — MySQL EXPLAIN FORMAT=JSON 파서
 *
 * MySQL EXPLAIN JSON 구조 예시:
 * {
 *   "query_block": {
 *     "select_id": 1,
 *     "cost_info": { "query_cost": "1.00" },
 *     "table": { "table_name": "users", "access_type": "ALL", ... }
 *     // 또는 "nested_loop": [ { "table": {...} }, ... ]
 *     // 또는 "union_result": { "query_specifications": [ ... ] }
 *   }
 * }
 */

export interface ExplainTreeNode {
  id: string
  label: string          // 테이블명 또는 블록명
  accessType?: string    // ALL, index, ref, range 등
  rows?: number          // 예상 행 수
  cost?: string          // prefix_cost
  filtered?: string      // filtered %
  key?: string           // 사용된 인덱스
  extra?: string         // Extra 정보 (JOIN 조건 등)
  children: ExplainTreeNode[]
  // 레이아웃 계산 결과
  x: number
  y: number
  width: number
  height: number
}

// 레이아웃 상수
const NODE_WIDTH = 220
const NODE_HEIGHT = 80
const H_GAP = 40  // 형제 노드 간 수평 간격
const V_GAP = 70  // 레벨 간 수직 간격

let _idCounter = 0
function nextId() { return `etn-${++_idCounter}` }

/**
 * parseExplainJSON EXPLAIN FORMAT=JSON 문자열을 파싱해 트리를 반환한다.
 * 파싱 실패 시 null을 반환한다.
 */
export function parseExplainJSON(jsonStr: string): ExplainTreeNode | null {
  _idCounter = 0
  try {
    const raw = JSON.parse(jsonStr) as Record<string, unknown>
    const queryBlock = raw['query_block']
    if (!queryBlock || typeof queryBlock !== 'object') return null
    const root = parseQueryBlock(queryBlock as Record<string, unknown>, 0)
    if (!root) return null
    layoutTree(root, 0, 0)
    return root
  } catch {
    return null
  }
}

function parseQueryBlock(
  block: Record<string, unknown>,
  depth: number,
): ExplainTreeNode | null {
  const selectId = block['select_id']
  const costInfo = block['cost_info'] as Record<string, string> | undefined

  // 루트 블록 노드
  const node: ExplainTreeNode = {
    id: nextId(),
    label: selectId !== undefined ? `Query Block #${selectId}` : 'Query Block',
    cost: costInfo?.['query_cost'],
    children: [],
    x: 0, y: 0,
    width: NODE_WIDTH, height: NODE_HEIGHT,
  }

  // 단일 테이블
  const tableRaw = block['table']
  if (tableRaw && typeof tableRaw === 'object') {
    const child = parseTableNode(tableRaw as Record<string, unknown>)
    if (child) node.children.push(child)
  }

  // Nested loop (JOIN)
  const nestedLoop = block['nested_loop']
  if (Array.isArray(nestedLoop)) {
    for (const item of nestedLoop) {
      const t = (item as Record<string, unknown>)['table']
      if (t && typeof t === 'object') {
        const child = parseTableNode(t as Record<string, unknown>)
        if (child) node.children.push(child)
      }
    }
  }

  // UNION
  const unionResult = block['union_result']
  if (unionResult && typeof unionResult === 'object') {
    const u = unionResult as Record<string, unknown>
    const specs = u['query_specifications']
    if (Array.isArray(specs)) {
      for (const spec of specs) {
        const s = spec as Record<string, unknown>
        const qb = s['query_block']
        if (qb && typeof qb === 'object') {
          const child = parseQueryBlock(qb as Record<string, unknown>, depth + 1)
          if (child) node.children.push(child)
        }
      }
    }
    // union_result 테이블 자체
    const ut = u['table_name'] as string | undefined
    if (ut) {
      node.label = `UNION RESULT (${ut})`
    }
  }

  // 서브쿼리 / 파생 테이블
  const materializedSubquery = block['materialized_from_subquery']
  if (materializedSubquery && typeof materializedSubquery === 'object') {
    const ms = materializedSubquery as Record<string, unknown>
    const qb = ms['query_block']
    if (qb && typeof qb === 'object') {
      const child = parseQueryBlock(qb as Record<string, unknown>, depth + 1)
      if (child) node.children.push(child)
    }
  }

  return node
}

function parseTableNode(t: Record<string, unknown>): ExplainTreeNode | null {
  const tableName = (t['table_name'] as string) ?? (t['name'] as string) ?? '?'
  const costInfo = t['cost_info'] as Record<string, string> | undefined

  const node: ExplainTreeNode = {
    id: nextId(),
    label: tableName,
    accessType: t['access_type'] as string | undefined,
    rows: t['rows_examined_per_scan'] as number | undefined
      ?? t['rows_produced_per_join'] as number | undefined,
    cost: costInfo?.['prefix_cost'],
    filtered: t['filtered'] as string | undefined,
    key: (t['key'] as string) || (t['used_key_parts'] as string) || undefined,
    extra: extractExtra(t),
    children: [],
    x: 0, y: 0,
    width: NODE_WIDTH, height: NODE_HEIGHT,
  }

  // 파생 테이블 (서브쿼리)
  const attachedSubqueries = t['attached_subqueries']
  if (Array.isArray(attachedSubqueries)) {
    for (const sub of attachedSubqueries) {
      const s = sub as Record<string, unknown>
      const qb = s['query_block']
      if (qb && typeof qb === 'object') {
        const child = parseQueryBlock(qb as Record<string, unknown>, 0)
        if (child) node.children.push(child)
      }
    }
  }

  const materializedSubquery = t['materialized_from_subquery']
  if (materializedSubquery && typeof materializedSubquery === 'object') {
    const ms = materializedSubquery as Record<string, unknown>
    const qb = ms['query_block']
    if (qb && typeof qb === 'object') {
      const child = parseQueryBlock(qb as Record<string, unknown>, 0)
      if (child) node.children.push(child)
    }
  }

  return node
}

function extractExtra(t: Record<string, unknown>): string | undefined {
  const parts: string[] = []
  if (t['using_filesort']) parts.push('Using filesort')
  if (t['using_temporary_table']) parts.push('Using temporary')
  if (t['using_index']) parts.push('Using index')
  if (t['using_index_condition']) parts.push('Using index condition')
  if (t['using_where']) parts.push('Using where')
  const attachedCond = t['attached_condition'] as string | undefined
  if (attachedCond && parts.length === 0) {
    parts.push(attachedCond.slice(0, 40) + (attachedCond.length > 40 ? '…' : ''))
  }
  return parts.length > 0 ? parts.join(', ') : undefined
}

// ─── 레이아웃 (top-down 트리) ────────────────────────────────────────────────

/**
 * layoutTree 각 노드의 x, y 좌표를 계산한다.
 * 반환값: 해당 서브트리가 차지하는 총 너비
 */
function layoutTree(node: ExplainTreeNode, depth: number, offsetX: number): number {
  node.y = depth * (NODE_HEIGHT + V_GAP)

  if (node.children.length === 0) {
    node.x = offsetX
    return NODE_WIDTH
  }

  let totalWidth = 0
  const childWidths: number[] = []
  for (const child of node.children) {
    const w = layoutTree(child, depth + 1, offsetX + totalWidth)
    childWidths.push(w)
    if (totalWidth > 0) totalWidth += H_GAP
    totalWidth += w
  }

  // 부모를 자식들의 가운데 위치에 배치
  const firstChild = node.children[0]
  const lastChild = node.children[node.children.length - 1]
  node.x = (firstChild.x + lastChild.x) / 2

  return Math.max(NODE_WIDTH, totalWidth)
}

/**
 * flattenTree 모든 노드를 flat 배열로 반환 (SVG 렌더링용)
 */
export function flattenTree(node: ExplainTreeNode): ExplainTreeNode[] {
  const result: ExplainTreeNode[] = [node]
  for (const child of node.children) {
    result.push(...flattenTree(child))
  }
  return result
}

/**
 * collectEdges 부모→자식 엣지 목록을 반환 (SVG line 렌더링용)
 */
export interface TreeEdge {
  from: ExplainTreeNode
  to: ExplainTreeNode
}

export function collectEdges(node: ExplainTreeNode): TreeEdge[] {
  const edges: TreeEdge[] = []
  for (const child of node.children) {
    edges.push({ from: node, to: child })
    edges.push(...collectEdges(child))
  }
  return edges
}
