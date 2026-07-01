/**
 * ResultGrid 의 우클릭 메뉴 / 신규 행 INSERT 등에서 사용하는 순수 SQL·텍스트 직렬화 헬퍼.
 *
 * Phase 48 (Wave 2d) 에서 `index.tsx` 끝의 module-level utility 들을 그대로 분리.
 * 본체와 `buildContextMenuItems` 양쪽이 import 한다.
 *
 * 모든 함수는 state 무관·순수 — 동일 입력에 대해 동일 출력.
 */

/** SQL 값 직렬화: NULL/숫자/문자열 */
export function sqlVal(val: unknown): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'number' || typeof val === 'bigint') return String(val)
  return `'${String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export function buildWhereClause(pkCols: string[], columns: string[], row: unknown[]): string {
  return pkCols.map((pk) => {
    const idx = columns.indexOf(pk)
    return `\`${pk}\` = ${sqlVal(idx >= 0 ? row[idx] : null)}`
  }).join(' AND ')
}

export function generateSelectSQL(db: string, table: string, pkCols: string[], columns: string[], row: unknown[]): string {
  const where = buildWhereClause(pkCols, columns, row)
  return `SELECT *\nFROM \`${db}\`.\`${table}\`\nWHERE ${where};`
}

export function generateInsertSQL(db: string, table: string, columns: string[], row: unknown[]): string {
  const cols = columns.map((c) => `\`${c}\``).join(', ')
  const vals = row.map((v) => sqlVal(v)).join(', ')
  return `INSERT INTO \`${db}\`.\`${table}\`\n  (${cols})\nVALUES\n  (${vals});`
}

export function generateUpdateSQL(db: string, table: string, pkCols: string[], columns: string[], row: unknown[]): string {
  const setClauses = columns
    .filter((c) => !pkCols.includes(c))
    .map((c) => `  \`${c}\` = ${sqlVal(row[columns.indexOf(c)])}`)
    .join(',\n')
  const where = buildWhereClause(pkCols, columns, row)
  const setBlock = setClauses || `  /* no non-PK columns */`
  return `UPDATE \`${db}\`.\`${table}\`\nSET\n${setBlock}\nWHERE ${where};`
}

export function generateDeleteSQL(db: string, table: string, pkCols: string[], columns: string[], row: unknown[]): string {
  const where = buildWhereClause(pkCols, columns, row)
  return `DELETE FROM \`${db}\`.\`${table}\`\nWHERE ${where};`
}

/** 행을 JSON 오브젝트 문자열로 직렬화 */
export function generateRowJSON(columns: string[], row: unknown[]): string {
  const obj: Record<string, unknown> = {}
  columns.forEach((c, i) => { obj[c] = row[i] ?? null })
  return JSON.stringify(obj, null, 2)
}

/** 여러 행을 JSON 배열 문자열로 직렬화 */
export function generateRowsJSON(columns: string[], rows: unknown[][]): string {
  const arr = rows.map((row) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((c, i) => { obj[c] = row[i] ?? null })
    return obj
  })
  return JSON.stringify(arr, null, 2)
}

/** 행을 CSV 한 줄로 직렬화 (RFC 4180) */
export function generateRowCSV(columns: string[], row: unknown[]): string {
  const header = columns.map(csvQuote).join(',')
  const data = row.map((v) => csvQuote(v === null || v === undefined ? '' : String(v))).join(',')
  return `${header}\n${data}`
}

/** 여러 행을 CSV로 직렬화 */
export function generateRowsCSV(columns: string[], rows: unknown[][]): string {
  const header = columns.map(csvQuote).join(',')
  const body = rows.map((row) =>
    row.map((v) => csvQuote(v === null || v === undefined ? '' : String(v))).join(',')
  ).join('\n')
  return `${header}\n${body}`
}

export function csvQuote(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** 여러 행을 단일 multi-row INSERT로 직렬화 */
export function generateMultiInsert(db: string, table: string, columns: string[], rows: unknown[][]): string {
  const cols = columns.map((c) => `\`${c}\``).join(', ')
  const vals = rows.map((row) => `  (${row.map((v) => sqlVal(v)).join(', ')})`).join(',\n')
  return `INSERT INTO \`${db}\`.\`${table}\`\n  (${cols})\nVALUES\n${vals};`
}
