import { useCallback, useEffect, useRef, useState } from 'react'
import { GetForeignKeys, ListColumns, ListIndexes } from '@/wailsjs/go/main/App'
import type { ColumnInfo, TableEditContext } from '@/types'
import type { IndexFlag } from '@/components/common/IndexFlagIcon'
import type { TableSchemaMeta } from '../types'

/**
 * 단일 테이블 SELECT 컨텍스트(editCtx)가 있을 때 information_schema 에서
 * ColumnInfo + 인덱스 + FK 플래그를 합쳐 TableSchemaMeta 로 만들어 보관한다.
 *
 * 캐시는 hook 내부 ref 에 보관 — 같은 (conn, db, table) 재진입 시 fetch 생략.
 * editCtx?.database / table 을 string primitive 로 추출해 deps 안정화
 * (오브젝트 ref 변동으로 인한 in-flight fetch 반복 취소 방지).
 */
export function useSchemaMeta(connId: string | undefined, editCtx: TableEditContext | undefined) {
  const [schemaMeta, setSchemaMeta] = useState<TableSchemaMeta | null>(null)
  const schemaCache = useRef<Map<string, TableSchemaMeta>>(new Map())

  const ctxDb = editCtx?.database
  const ctxTable = editCtx?.table

  useEffect(() => {
    if (!ctxDb || !ctxTable || !connId) { setSchemaMeta(null); return }
    const cacheKey = `${connId}:${ctxDb}:${ctxTable}`
    const cached = schemaCache.current.get(cacheKey)
    if (cached) { setSchemaMeta(cached); return }

    let cancelled = false
    void (async () => {
      try {
        const [cols, idxs, fks] = await Promise.all([
          ListColumns(connId, ctxDb, ctxTable),
          ListIndexes(connId, ctxDb, ctxTable),
          GetForeignKeys(connId, ctxDb),
        ])
        if (cancelled) return
        const colMap = new Map<string, ColumnInfo>()
        for (const c of cols) colMap.set(c.name, c)

        const flagMap = new Map<string, Set<IndexFlag>>()
        const addFlag = (col: string, flag: IndexFlag) => {
          if (!flagMap.has(col)) flagMap.set(col, new Set())
          flagMap.get(col)!.add(flag)
        }
        for (const idx of idxs ?? []) {
          const cols = idx.columns.split(',').map((s) => s.trim()).filter(Boolean)
          const upperIdxType = (idx.indexType || '').toUpperCase()
          for (const col of cols) {
            if (idx.name === 'PRIMARY') addFlag(col, 'PRIMARY')
            else if (upperIdxType === 'FULLTEXT') addFlag(col, 'FULLTEXT')
            else if (idx.unique) addFlag(col, 'UNIQUE')
            else addFlag(col, 'INDEX')
          }
        }
        for (const fk of fks ?? []) {
          if (fk.tableName === ctxTable) addFlag(fk.columnName, 'FK')
        }

        const meta: TableSchemaMeta = { columns: colMap, flags: flagMap }
        schemaCache.current.set(cacheKey, meta)
        setSchemaMeta(meta)
      } catch {
        if (!cancelled) setSchemaMeta(null)
      }
    })()
    return () => { cancelled = true }
  }, [ctxDb, ctxTable, connId])

  /** 실제 DB 컬럼 타입(ENUM/SET 등)이 executor의 ct.DatabaseTypeName() 결과(CHAR 등)와
   *  다를 수 있어, editCtx가 있으면 information_schema 값을 우선 사용한다. */
  const effectiveColType = useCallback((colName: string, fallback: string): string => {
    const info = schemaMeta?.columns.get(colName)
    if (!info?.dataType) return fallback
    return info.dataType.toUpperCase()
  }, [schemaMeta])

  /** ENUM/SET 컬럼의 허용 값 목록 — schemaMeta 에서 동기적으로 파싱 */
  const getEnumValues = useCallback((colName: string): string[] => {
    const info = schemaMeta?.columns.get(colName)
    if (!info?.columnType) return []
    const match = info.columnType.match(/^(?:enum|set)\((.+)\)$/i)
    if (!match) return []
    return match[1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''))
  }, [schemaMeta])

  return { schemaMeta, effectiveColType, getEnumValues }
}
