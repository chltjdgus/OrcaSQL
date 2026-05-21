/**
 * 16-G9 — 선택된 ColumnDef 를 기반으로 `ALTER TABLE ... ADD COLUMN ...` SQL 을 생성한다.
 * 다중 선택 시 단일 ALTER 문 안에 여러 ADD COLUMN 절로 묶는다.
 * AFTER 절은 편집 중인 컬럼 배열의 현재 위치에 기반한다 (이전 컬럼 이름 사용).
 */
import type { ColumnDef } from '@/types'

interface BuildOpts {
  database: string
  table: string
  /** 편집 중인 전체 컬럼 목록 (AFTER 절 계산용) */
  allColumns: ColumnDef[]
  /** 선택된 rowIds → 컬럼 index 매핑에 쓸 필터 함수 */
  selectedIndices: number[]
}

function isDefaultLiteral(s: string): boolean {
  const u = s.trim().toUpperCase()
  if (u === 'NULL' || u === 'CURRENT_TIMESTAMP' || u === 'CURRENT_TIMESTAMP()') return true
  if (u.startsWith('CURRENT_TIMESTAMP(') && u.endsWith(')')) return true
  if (s.startsWith('(') && s.endsWith(')')) return true
  return false
}

function columnClause(c: ColumnDef): string {
  const parts: string[] = [`\`${c.name}\` ${c.dataType}`]
  if (c.length) parts[0] += `(${c.length})`
  if (c.unsigned) parts.push('UNSIGNED')
  if (c.zeroFill) parts.push('ZEROFILL')
  parts.push(c.notNull ? 'NOT NULL' : 'NULL')
  // NOT NULL + DEFAULT NULL 은 무효 DDL → DEFAULT 절 생략
  const effectiveDefault = (c.notNull && c.default.trim().toUpperCase() === 'NULL') ? '' : c.default
  if (effectiveDefault !== '') {
    if (isDefaultLiteral(effectiveDefault)) {
      parts.push(`DEFAULT ${effectiveDefault}`)
    } else {
      parts.push(`DEFAULT '${effectiveDefault.replace(/'/g, "''")}'`)
    }
  }
  if (c.autoInc) parts.push('AUTO_INCREMENT')
  if (c.onUpdate) parts.push(`ON UPDATE ${c.onUpdate}`)
  if (c.comment) parts.push(`COMMENT '${c.comment.replace(/'/g, "''")}'`)
  return parts.join(' ')
}

/** 선택된 컬럼들에 대한 ALTER TABLE ... ADD COLUMN SQL 을 반환한다. */
export function buildAlterAddColumn(opts: BuildOpts): string {
  const { database, table, allColumns, selectedIndices } = opts
  if (selectedIndices.length === 0) return ''

  const addClauses: string[] = []
  const sorted = [...selectedIndices].sort((a, b) => a - b)
  for (const idx of sorted) {
    const col = allColumns[idx]
    if (!col) continue
    const clause = columnClause(col)
    // AFTER 절: 이전 컬럼 기준 (0 번이면 FIRST)
    if (idx === 0) {
      addClauses.push(`ADD COLUMN ${clause} FIRST`)
    } else {
      const prev = allColumns[idx - 1]
      addClauses.push(`ADD COLUMN ${clause} AFTER \`${prev.name}\``)
    }
  }

  if (addClauses.length === 0) return ''
  return `ALTER TABLE \`${database}\`.\`${table}\`\n  ${addClauses.join(',\n  ')};`
}
