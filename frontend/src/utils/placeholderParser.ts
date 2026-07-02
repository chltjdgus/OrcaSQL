/**
 * SQL 쿼리 내 플레이스홀더(`?`, `#{name}`, `:name`, `${name}`)를 감지·치환한다.
 * 문자열 리터럴('...', "..."), 백틱 식별자(`...`), 주석(--, #, /\* \*\/) 내부는 건너뛴다.
 */

export type PlaceholderMode = 'value' | 'identifier'

export interface Placeholder {
  /** 모달에서 사용자에게 보여줄 이름 (예: "param1", "mediaId") */
  name: string
  /** SQL 안에 실제로 등장한 토큰 (예: "?", "#{mediaId}", ":id", "${tableName}") */
  raw: string
  /** 원본 SQL에서의 시작 오프셋 */
  start: number
  /** 종료 오프셋 (exclusive) */
  end: number
  /** 주변 컨텍스트로 추정한 기본 모드 */
  defaultMode: PlaceholderMode
  /** 모달에 표시할 주변 SQL 발췌 */
  context: string
}

/** 동일 이름 placeholder는 하나의 입력으로 묶고, 모든 등장 위치를 기록한다. */
export interface PlaceholderGroup {
  name: string
  /** 첫 등장 raw — 표시용 */
  raw: string
  defaultMode: PlaceholderMode
  /** 등장한 모든 컨텍스트(중복 등장 시 여러 줄) */
  contexts: string[]
  /** 치환 대상 위치 — 모두 같은 값으로 치환 */
  occurrences: Array<{ start: number; end: number }>
}

const IDENTIFIER_KEYWORDS = [
  'FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE', 'DATABASE',
  'USE', 'DESC', 'DESCRIBE', 'REFERENCES', 'TRUNCATE',
]

export function parsePlaceholders(sql: string): Placeholder[] {
  const result: Placeholder[] = []
  let i = 0
  let positionalIdx = 0
  const n = sql.length

  while (i < n) {
    const ch = sql[i]
    const next = sql[i + 1] ?? ''

    // -- line comment
    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    // # line comment (MySQL) — `#{` 와 충돌 방지
    if (ch === '#' && next !== '{') {
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    // /* block comment */
    if (ch === '/' && next === '*') {
      i += 2
      while (i < n - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      continue
    }
    // 'single-quoted string' — '' 와 \' 이스케이프
    if (ch === "'") {
      i++
      while (i < n) {
        if (sql[i] === '\\' && i + 1 < n) { i += 2; continue }
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue }
        if (sql[i] === "'") { i++; break }
        i++
      }
      continue
    }
    // "double-quoted string"
    if (ch === '"') {
      i++
      while (i < n) {
        if (sql[i] === '\\' && i + 1 < n) { i += 2; continue }
        if (sql[i] === '"' && sql[i + 1] === '"') { i += 2; continue }
        if (sql[i] === '"') { i++; break }
        i++
      }
      continue
    }
    // `backtick identifier` — 내부의 ? 등을 placeholder로 오인하지 않도록 건너뜀
    if (ch === '`') {
      i++
      while (i < n && sql[i] !== '`') i++
      i++
      continue
    }

    let matched: { raw: string; name: string; len: number } | null = null

    if (ch === '?') {
      positionalIdx++
      matched = { raw: '?', name: `param${positionalIdx}`, len: 1 }
    } else if (ch === '#' && next === '{') {
      const close = sql.indexOf('}', i + 2)
      if (close > i + 2) {
        const name = sql.slice(i + 2, close).trim()
        if (/^[A-Za-z_][\w.]*$/.test(name)) {
          matched = { raw: sql.slice(i, close + 1), name, len: close + 1 - i }
        }
      }
    } else if (ch === '$' && next === '{') {
      const close = sql.indexOf('}', i + 2)
      if (close > i + 2) {
        const name = sql.slice(i + 2, close).trim()
        if (/^[A-Za-z_][\w.]*$/.test(name)) {
          matched = { raw: sql.slice(i, close + 1), name, len: close + 1 - i }
        }
      }
    } else if (ch === ':' && next !== ':' && sql[i - 1] !== ':') {
      // :name — Postgres cast(::)와 충돌 방지
      const tail = sql.slice(i)
      const m = /^:([A-Za-z_]\w*)/.exec(tail)
      if (m) {
        matched = { raw: m[0], name: m[1]!, len: m[0].length }
      }
    }

    if (matched) {
      const start = i
      const end = i + matched.len
      const before = sql.slice(Math.max(0, start - 40), start)
      const after = sql.slice(end, Math.min(n, end + 20))
      const context = `${before}${matched.raw}${after}`.replace(/\s+/g, ' ').trim()
      result.push({
        name: matched.name,
        raw: matched.raw,
        start,
        end,
        defaultMode: inferMode(sql, start, matched.raw),
        context,
      })
      i = end
      continue
    }

    i++
  }

  return result
}

function inferMode(sql: string, pos: number, raw: string): PlaceholderMode {
  // ${name} — MyBatis 관례상 identifier 치환에 주로 쓰임
  if (raw.startsWith('${')) return 'identifier'

  const before = sql.slice(Math.max(0, pos - 60), pos).toUpperCase()
  const trimmed = before.replace(/[\s(]+$/, '')
  for (const kw of IDENTIFIER_KEYWORDS) {
    if (trimmed.endsWith(kw)) {
      const charBefore = trimmed[trimmed.length - kw.length - 1]
      if (charBefore === undefined || /[\s;,]/.test(charBefore)) {
        return 'identifier'
      }
    }
  }
  return 'value'
}

export function groupPlaceholders(placeholders: Placeholder[]): PlaceholderGroup[] {
  const map = new Map<string, PlaceholderGroup>()
  for (const p of placeholders) {
    const existing = map.get(p.name)
    if (existing) {
      existing.contexts.push(p.context)
      existing.occurrences.push({ start: p.start, end: p.end })
    } else {
      map.set(p.name, {
        name: p.name,
        raw: p.raw,
        defaultMode: p.defaultMode,
        contexts: [p.context],
        occurrences: [{ start: p.start, end: p.end }],
      })
    }
  }
  return Array.from(map.values())
}

/** 사용자가 입력한 값을 타입 추론해 SQL 리터럴로 변환. */
export function formatValue(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '' || trimmed.toUpperCase() === 'NULL') return 'NULL'
  if (trimmed.toUpperCase() === 'TRUE') return 'TRUE'
  if (trimmed.toUpperCase() === 'FALSE') return 'FALSE'
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  // 문자열 — 작은따옴표/백슬래시 이스케이프
  return `'${input.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

/** 식별자(컬럼/테이블/DB명)를 백틱으로 감싼다. db.table 형태도 지원. */
export function formatIdentifier(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') return ''
  // 이미 백틱으로 감싼 경우 그대로
  if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length >= 2) {
    return trimmed
  }
  return trimmed.split('.').map((p) => `\`${p.replace(/`/g, '``')}\``).join('.')
}

export type DetectedType = 'null' | 'number' | 'boolean' | 'string'

export function detectValueType(input: string): DetectedType {
  const trimmed = input.trim()
  if (trimmed === '' || trimmed.toUpperCase() === 'NULL') return 'null'
  if (trimmed.toUpperCase() === 'TRUE' || trimmed.toUpperCase() === 'FALSE') return 'boolean'
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return 'number'
  return 'string'
}

export interface Resolution {
  mode: PlaceholderMode
  rawInput: string
}

/** placeholder 그룹을 입력값으로 치환. 오프셋 안정성을 위해 뒤에서 앞으로 처리. */
export function substitute(
  sql: string,
  groups: PlaceholderGroup[],
  resolutions: Map<string, Resolution>,
): string {
  const all: Array<{ start: number; end: number; replacement: string }> = []
  for (const g of groups) {
    const r = resolutions.get(g.name)
    if (!r) continue
    const replacement = r.mode === 'identifier'
      ? formatIdentifier(r.rawInput)
      : formatValue(r.rawInput)
    for (const occ of g.occurrences) {
      all.push({ start: occ.start, end: occ.end, replacement })
    }
  }
  all.sort((a, b) => b.start - a.start)
  let out = sql
  for (const r of all) {
    out = out.slice(0, r.start) + r.replacement + out.slice(r.end)
  }
  return out
}
