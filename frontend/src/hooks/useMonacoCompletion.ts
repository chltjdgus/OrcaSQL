/**
 * Monaco SQL 스키마 인식 자동완성 훅.
 *
 * 기능:
 *  1. 연결된 DB/테이블/컬럼 목록을 CompletionProvider에 주입.
 *  2. 커서 앞 텍스트 + 에디터 전체 텍스트를 분석해 상황에 맞는 항목 제안:
 *     - `db.table.` → 해당 DB.테이블 컬럼 (타입 포함)
 *     - `alias.` or `table.` → 별칭 자동 해석 후 컬럼 (타입 포함)
 *     - `db.` → 해당 DB의 테이블 목록
 *     - FROM / JOIN 뒤 → 테이블명 + DB명(cross-DB용)
 *     - SELECT / WHERE 등 일반 컨텍스트 → 쿼리 내 참조 테이블 컬럼 우선
 *     - USE / DATABASE( 뒤 → DB명
 *     - SQL 키워드 + 함수
 *  3. 컬럼 제안 시 데이터 타입 표시 (VARCHAR(255), INT 등)
 *  4. 현재 DB의 테이블 컬럼을 백그라운드에서 최대 20개 미리 로드
 */
import { useEffect, useRef } from 'react'
import type * as MonacoEditor from 'monaco-editor'
import type { ColumnInfo } from '@/types'
import { useConnectionStore } from '@/stores/connectionStore'
import { ListTables, ListColumns, ListDatabases } from '@/wailsjs/go/main/App'

// ─── SQL 키워드 (별칭 감지 제외용 포함) ─────────────────────────────────────

const KEYWORD_SET = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'DROP', 'ALTER', 'TABLE', 'DATABASE', 'INDEX',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS',
  'ON', 'AS', 'GROUP', 'BY', 'ORDER', 'ASC', 'DESC',
  'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT',
  'EXISTS', 'BETWEEN', 'LIKE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'IF', 'IFNULL', 'COALESCE', 'NULLIF', 'WITH',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION',
  'SHOW', 'DESCRIBE', 'EXPLAIN', 'USE',
  'TRUNCATE', 'RENAME', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT',
  'CALL', 'RETURNS', 'RETURN', 'DECLARE',
  'AUTO_INCREMENT', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
  'UNIQUE', 'CHECK', 'CONSTRAINT', 'DEFAULT',
  'ENGINE', 'CHARSET', 'COLLATE', 'COMMENT',
  'VARCHAR', 'INT', 'BIGINT', 'TINYINT', 'SMALLINT', 'MEDIUMINT',
  'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC',
  'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYTEXT',
  'BLOB', 'DATETIME', 'TIMESTAMP', 'DATE', 'TIME', 'YEAR',
  'BOOLEAN', 'BIT', 'ENUM', 'JSON',
])

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'DROP', 'ALTER', 'TABLE', 'DATABASE', 'INDEX',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS',
  'ON', 'AS', 'GROUP', 'BY', 'ORDER', 'ASC', 'DESC',
  'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT',
  'EXISTS', 'BETWEEN', 'LIKE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'IF', 'IFNULL', 'COALESCE', 'NULLIF',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION',
  'SHOW', 'DESCRIBE', 'EXPLAIN', 'USE',
  'TRUNCATE', 'RENAME', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT',
  'CALL', 'RETURNS', 'RETURN', 'DECLARE',
  'AUTO_INCREMENT', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
  'UNIQUE', 'CHECK', 'CONSTRAINT', 'DEFAULT',
  'ENGINE', 'CHARSET', 'COLLATE', 'COMMENT',
  'VARCHAR', 'INT', 'BIGINT', 'TINYINT', 'SMALLINT', 'MEDIUMINT',
  'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC',
  'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYTEXT',
  'BLOB', 'DATETIME', 'TIMESTAMP', 'DATE', 'TIME', 'YEAR',
  'BOOLEAN', 'BIT', 'ENUM', 'SET', 'JSON',
]

const SQL_FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'NOW', 'CURDATE', 'CURTIME', 'DATE_FORMAT', 'STR_TO_DATE',
  'CONCAT', 'CONCAT_WS', 'SUBSTRING', 'SUBSTR', 'LEFT', 'RIGHT',
  'LENGTH', 'CHAR_LENGTH', 'UPPER', 'LOWER', 'TRIM', 'LTRIM', 'RTRIM',
  'REPLACE', 'REGEXP_REPLACE', 'INSTR', 'LOCATE',
  'ROUND', 'CEIL', 'FLOOR', 'ABS', 'MOD', 'POWER', 'SQRT',
  'CAST', 'CONVERT', 'FORMAT', 'LPAD', 'RPAD',
  'FIND_IN_SET', 'GROUP_CONCAT', 'JSON_EXTRACT', 'JSON_ARRAYAGG',
  'DATEDIFF', 'DATE_ADD', 'DATE_SUB', 'TIMESTAMPDIFF',
  'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD',
  'IF', 'IFNULL', 'NULLIF', 'COALESCE', 'GREATEST', 'LEAST',
  'UUID', 'MD5', 'SHA1', 'SHA2',
  'SLEEP', 'DATABASE', 'USER', 'VERSION',
]

interface TableRef {
  db: string | null  // FROM절에서 명시된 DB (없으면 null)
  table: string      // 테이블명
}

interface SchemaCache {
  databases: string[]
  tables: Map<string, string[]>        // db → table[]
  columns: Map<string, ColumnInfo[]>   // "db.table" → ColumnInfo[]
}

// 전역 disposable 관리 (중복 등록 방지)
let _disposable: MonacoEditor.IDisposable | null = null

/**
 * 쿼리 텍스트에서 테이블 별칭 맵을 추출한다.
 * `FROM tableName [AS] alias` / `JOIN tableName [AS] alias` 패턴.
 * 반환: alias → 실제 테이블명
 */
function extractAliasMap(sql: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /\b(?:FROM|JOIN)\s+(?:`?\w+`?\.)?`?(\w+)`?\s+(?:AS\s+)?`?([a-zA-Z_]\w*)`?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    const table = m[1]
    const alias = m[2]
    if (
      !KEYWORD_SET.has(alias.toUpperCase()) &&
      alias.toUpperCase() !== table.toUpperCase()
    ) {
      map.set(alias, table)
    }
  }
  return map
}

/**
 * 쿼리 텍스트에서 FROM/JOIN으로 참조된 테이블 목록을 추출한다.
 * `db.table`, `` `db`.`table` ``, `table`, `` `table` `` 형식을 모두 지원한다.
 */
function extractReferencedTableRefs(sql: string): TableRef[] {
  const seen = new Set<string>()
  const refs: TableRef[] = []
  const re = /\b(?:FROM|JOIN)\s+((?:`\w+`|\w+)(?:\.(?:`\w+`|\w+))?)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    const expr = m[1].replace(/`/g, '')
    const parts = expr.split('.')
    const ref: TableRef = parts.length === 2
      ? { db: parts[0], table: parts[1] }
      : { db: null, table: parts[0] }
    const dedupeKey = `${ref.db ?? ''}.${ref.table}`
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey)
      refs.push(ref)
    }
  }
  return refs
}

function buildReverseAliasMap(aliasMap: Map<string, string>): Map<string, string> {
  const rev = new Map<string, string>()
  aliasMap.forEach((tableName, alias) => rev.set(tableName.toLowerCase(), alias))
  return rev
}

function detectInSelectList(textToCursor: string): boolean {
  const stripped = textToCursor.replace(/'[^']*'/g, "''")
  const clauseRe = /\b(FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|FULL|GROUP|ORDER|HAVING|LIMIT|UNION|SET|INTO|UPDATE|ON)\b/gi
  const selectRe = /\b(SELECT|DISTINCT)\b/gi
  let lastSelectIdx = -1, lastClauseIdx = -1
  let m: RegExpExecArray | null
  while ((m = selectRe.exec(stripped)) !== null) lastSelectIdx = m.index
  while ((m = clauseRe.exec(stripped)) !== null) lastClauseIdx = m.index
  return lastSelectIdx > lastClauseIdx && lastSelectIdx !== -1
}

export function useMonacoCompletion(
  monacoRef: React.MutableRefObject<typeof MonacoEditor | null>,
  connId: string | null,
  database: string | null,
) {
  const { activeConnections } = useConnectionStore()
  const cacheRef = useRef<SchemaCache>({ databases: [], tables: new Map(), columns: new Map() })

  useEffect(() => {
    if (!monacoRef.current || !connId) return
    const monaco = monacoRef.current

    // 백그라운드에서 스키마 캐시 구성 + 현재 DB 컬럼 최대 20개 프리로드
    const loadCache = async () => {
      try {
        const dbs = await ListDatabases(connId)
        cacheRef.current.databases = dbs

        const targetDB = database ?? dbs[0]
        if (targetDB) {
          const tables = await ListTables(connId, targetDB)
          const tableNames = tables.map((t) => t.name)
          cacheRef.current.tables.set(targetDB, tableNames)

          // 컬럼 프리로드 (최대 20개 테이블)
          for (const tbl of tableNames.slice(0, 20)) {
            const key = `${targetDB}.${tbl}`
            if (!cacheRef.current.columns.has(key)) {
              try {
                const cols = await ListColumns(connId, targetDB, tbl)
                cacheRef.current.columns.set(key, cols)
              } catch { /* ignore */ }
            }
          }
        }
      } catch {
        // 스키마 로드 실패 시 키워드만 제공
      }
    }
    loadCache()

    // 이전 disposable 정리
    _disposable?.dispose()

    _disposable = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: [' ', '.', '(', '*'],

      async provideCompletionItems(model, position) {
        const lineText = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })
        const fullText = model.getValue()
        const textToCursor = model.getValueInRange({
          startLineNumber: 1, startColumn: 1,
          endLineNumber: position.lineNumber, endColumn: position.column,
        })

        const word = model.getWordUntilPosition(position)
        const range: MonacoEditor.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: position.column,
        }

        const cache = cacheRef.current
        const suggestions: MonacoEditor.languages.CompletionItem[] = []

        // ── 0. `*` 확장: SELECT * 위치 → 컬럼 목록 Snippet ──────────────────────
        {
          const starMatch = lineText.match(/\*\s*$/)
          if (starMatch) {
            const beforeStar = lineText.slice(0, lineText.lastIndexOf('*'))
            const isFunctionStar = /\(\s*$/.test(beforeStar)
            const charBefore = beforeStar.slice(-1)  // trimEnd 제거: "SELECT *"에서 공백이 보존되어야 함
            const isArithmetic = /[\w\d)`'"]/.test(charBefore)

            if (!isFunctionStar && !isArithmetic && detectInSelectList(textToCursor)) {
              const db = database ?? cache.databases[0]
              if (db) {
                const aliasMap = extractAliasMap(fullText)
                const reverseAliasMap = buildReverseAliasMap(aliasMap)
                const referencedRefs = extractReferencedTableRefs(fullText)

                const starCol = lineText.lastIndexOf('*') + 1   // 1-based
                const starRange: MonacoEditor.IRange = {
                  startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
                  startColumn: starCol, endColumn: starCol + 1,
                }

                for (const ref of referencedRefs) {
                  const dbForRef = ref.db ?? db
                  const key = `${dbForRef}.${ref.table}`
                  if (!cache.columns.has(key)) {
                    try { cache.columns.set(key, await ListColumns(connId, dbForRef, ref.table)) } catch { /**/ }
                  }
                }

                if (referencedRefs.length > 1) {
                  const allParts: string[] = []
                  referencedRefs.forEach((ref, idx) => {
                    const alias = reverseAliasMap.get(ref.table.toLowerCase()) ?? ref.table
                    const dbForRef = ref.db ?? db
                    const cols = cache.columns.get(`${dbForRef}.${ref.table}`) ?? []
                    const part = cols.map((c) => `${alias}.${c.name}`).join(', ')
                    if (part) {
                      allParts.push(part)
                      suggestions.push({
                        label: `* → ${alias}.* (${cols.length}개)`,
                        kind: monaco.languages.CompletionItemKind.Snippet,
                        insertText: part, range: starRange,
                        detail: `${ref.table} 컬럼 확장`,
                        sortText: '0' + String(idx + 1).padStart(3, '0'),
                        documentation: { value: part },
                      })
                    }
                  })
                  if (allParts.length > 0) {
                    suggestions.push({
                      label: `* → 전체 컬럼 확장 (모든 테이블)`,
                      kind: monaco.languages.CompletionItemKind.Snippet,
                      insertText: allParts.join(', '), range: starRange,
                      detail: '모든 JOIN 테이블 컬럼',
                      sortText: '0000',
                      documentation: { value: allParts.join(', ') },
                    })
                  }
                } else if (referencedRefs.length === 1) {
                  const ref = referencedRefs[0]
                  const dbForRef = ref.db ?? db
                  const alias = reverseAliasMap.get(ref.table.toLowerCase())
                  const cols = cache.columns.get(`${dbForRef}.${ref.table}`) ?? []
                  const colList = alias
                    ? cols.map((c) => `${alias}.${c.name}`).join(', ')
                    : cols.map((c) => c.name).join(', ')
                  if (colList) {
                    suggestions.push({
                      label: alias ? `* → ${alias}.* 확장` : `* → 컬럼 확장 (${cols.length}개)`,
                      kind: monaco.languages.CompletionItemKind.Snippet,
                      insertText: colList, range: starRange,
                      detail: `${ref.table} 컬럼 확장`,
                      sortText: '0000',
                      documentation: { value: colList },
                    })
                  }
                }

                if (suggestions.length > 0) return { suggestions }
              }
            }
          }
        }

        // ── 1. db.table. 패턴 → 해당 DB.테이블 컬럼 ──────────────────────
        const dbTableDotMatch = lineText.match(/`?(\w+)`?\.`?(\w+)`?\.$/)
        if (dbTableDotMatch) {
          const dbName = dbTableDotMatch[1]
          const tableName = dbTableDotMatch[2]
          const key = `${dbName}.${tableName}`
          if (!cache.columns.has(key)) {
            try {
              const cols = await ListColumns(connId, dbName, tableName)
              cache.columns.set(key, cols)
            } catch { /* ignore */ }
          }
          ;(cache.columns.get(key) ?? []).forEach((col) => {
            suggestions.push({
              label: col.name,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: col.name,
              range,
              detail: col.columnType || col.dataType,
              documentation: col.comment ? { value: col.comment } : undefined,
              sortText: '0' + col.name,
            })
          })
          return { suggestions }
        }

        // ── 2. 단일 점(.) 패턴 ──────────────────────────────────────────────
        const dotMatch = lineText.match(/`?(\w+)`?\.$/)
        if (dotMatch) {
          const name = dotMatch[1]
          const db = database ?? cache.databases[0]

          // 2a. DB 이름이면 → 해당 DB의 테이블 목록
          if (cache.databases.includes(name)) {
            if (!cache.tables.has(name)) {
              try {
                const tables = await ListTables(connId, name)
                cache.tables.set(name, tables.map((t) => t.name))
              } catch { /* ignore */ }
            }
            ;(cache.tables.get(name) ?? []).forEach((t) => {
              suggestions.push({
                label: t,
                kind: monaco.languages.CompletionItemKind.Class,
                insertText: `\`${t}\``,
                range,
                detail: `${name} 테이블`,
                sortText: '0' + t,
              })
            })
            return { suggestions }
          }

          // 2b. 별칭 or 테이블명 → 컬럼 목록 (별칭 자동 해석)
          if (db) {
            const aliasMap = extractAliasMap(fullText)
            const resolvedTable = aliasMap.get(name) ?? name
            const key = `${db}.${resolvedTable}`
            if (!cache.columns.has(key)) {
              try {
                const cols = await ListColumns(connId, db, resolvedTable)
                cache.columns.set(key, cols)
              } catch { /* ignore */ }
            }
            const cols = cache.columns.get(key) ?? []
            if (cols.length > 0) {
              cols.forEach((col) => {
                suggestions.push({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.name,
                  range,
                  detail: col.columnType || col.dataType,
                  documentation: col.comment ? { value: col.comment } : undefined,
                  sortText: '0' + col.name,
                })
              })
              return { suggestions }
            }
          }
          return { suggestions }
        }

        // ── 3. FROM / JOIN / UPDATE / INTO / TABLE 뒤 → 테이블명 + DB명 ──
        const tableContext = /\b(FROM|JOIN|UPDATE|INTO|TABLE)\s+\w*$/i.test(lineText)
        if (tableContext) {
          const db = database ?? cache.databases[0]
          if (db) {
            if (!cache.tables.has(db)) {
              try {
                const tables = await ListTables(connId, db)
                cache.tables.set(db, tables.map((t) => t.name))
              } catch { /* ignore */ }
            }
            ;(cache.tables.get(db) ?? []).forEach((t) => {
              suggestions.push({
                label: t,
                kind: monaco.languages.CompletionItemKind.Class,
                insertText: `\`${t}\``,
                range,
                detail: `${db} 테이블`,
                sortText: '0' + t,
              })
            })
          }
          // Cross-DB 쿼리를 위해 DB 이름도 제안 (선택 시 `db`.으로 삽입)
          cache.databases.forEach((dbName) => {
            suggestions.push({
              label: dbName,
              kind: monaco.languages.CompletionItemKind.Module,
              insertText: `\`${dbName}\`.`,
              range,
              detail: '데이터베이스',
              sortText: '1' + dbName,
            })
          })
        }

        // ── 4. USE / DATABASE( 뒤 → DB명 ─────────────────────────────────
        const dbContext = /\b(USE|DATABASE\s*\()\s*\w*$/i.test(lineText)
        if (dbContext) {
          cache.databases.forEach((db) => {
            suggestions.push({
              label: db,
              kind: monaco.languages.CompletionItemKind.Module,
              insertText: `\`${db}\``,
              range,
              detail: '데이터베이스',
              sortText: '0' + db,
            })
          })
          return { suggestions }
        }

        // ── 5. 일반 컨텍스트 / SELECT 리스트 컨텍스트 ─────────────────────────────
        const db = database ?? cache.databases[0]
        if (db) {
          const aliasMap = extractAliasMap(fullText)
          const reverseAliasMap = buildReverseAliasMap(aliasMap)
          const referencedRefs = extractReferencedTableRefs(fullText)

          const inSelectList = detectInSelectList(textToCursor)

          if (inSelectList && referencedRefs.length > 0) {
            // SELECT 리스트 모드: on-demand fetch + alias prefix
            for (const ref of referencedRefs) {
              const dbForRef = ref.db ?? db
              const key = `${dbForRef}.${ref.table}`
              if (!cache.columns.has(key)) {
                try { cache.columns.set(key, await ListColumns(connId, dbForRef, ref.table)) } catch { /**/ }
              }
              const alias = reverseAliasMap.get(ref.table.toLowerCase())
              const prefix = alias ?? (referencedRefs.length > 1 ? ref.table : '')
              ;(cache.columns.get(key) ?? []).forEach((col) => {
                const label = prefix ? `${prefix}.${col.name}` : col.name
                suggestions.push({
                  label, kind: monaco.languages.CompletionItemKind.Field,
                  insertText: label, range,
                  detail: `${ref.table} · ${col.columnType || col.dataType}`,
                  documentation: col.comment ? { value: col.comment } : undefined,
                  sortText: '1' + label,
                })
              })
            }
            // 2차: prefix 없는 bare 컬럼명 (multi-table or alias 있을 때)
            for (const ref of referencedRefs) {
              const alias = reverseAliasMap.get(ref.table.toLowerCase())
              if (!alias && referencedRefs.length === 1) continue
              const dbForRef = ref.db ?? db
              ;(cache.columns.get(`${dbForRef}.${ref.table}`) ?? []).forEach((col) => {
                suggestions.push({
                  label: col.name, kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.name, range,
                  detail: `${ref.table} · ${col.columnType || col.dataType}`,
                  documentation: col.comment ? { value: col.comment } : undefined,
                  sortText: '2' + col.name,
                })
              })
            }
          } else {
            // 기존 일반 컨텍스트 (SELECT 외 위치)
            const referencedSet = new Set(referencedRefs.map(r => r.table))
            for (const ref of referencedRefs) {
              const dbForRef = ref.db ?? db
              const key = `${dbForRef}.${ref.table}`
              ;(cache.columns.get(key) ?? []).forEach((col) => {
                suggestions.push({
                  label: col.name, kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.name, range,
                  detail: `${ref.table} · ${col.columnType || col.dataType}`,
                  documentation: col.comment ? { value: col.comment } : undefined,
                  sortText: '1' + col.name,
                })
              })
            }
            ;(cache.tables.get(db) ?? []).forEach((tbl) => {
              if (referencedSet.has(tbl)) return
              ;(cache.columns.get(`${db}.${tbl}`) ?? []).forEach((col) => {
                suggestions.push({
                  label: col.name, kind: monaco.languages.CompletionItemKind.Field,
                  insertText: col.name, range,
                  detail: `${tbl} · ${col.columnType || col.dataType}`,
                  sortText: '2' + col.name,
                })
              })
            })
            ;(cache.tables.get(db) ?? []).forEach((t) => {
              suggestions.push({
                label: t, kind: monaco.languages.CompletionItemKind.Class,
                insertText: `\`${t}\``, range,
                detail: `${db} 테이블`, sortText: '3' + t,
              })
            })
          }
        }

        // ── 6. SQL 키워드 ──────────────────────────────────────────────────
        SQL_KEYWORDS.forEach((kw) => {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
            detail: 'SQL 키워드',
            sortText: '8' + kw,
          })
        })

        // ── 7. SQL 함수 ────────────────────────────────────────────────────
        SQL_FUNCTIONS.forEach((fn) => {
          suggestions.push({
            label: fn,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: `${fn}($0)`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: 'SQL 함수',
            sortText: '9' + fn,
          })
        })

        return { suggestions }
      },
    })

    return () => {
      _disposable?.dispose()
      _disposable = null
    }
  }, [connId, database, activeConnections, monacoRef])
}
