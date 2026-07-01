import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Phase 62 — 테이블 Data 탭 WHERE 필터 검색 기록.
 *
 * 적용(Enter/검색)한 WHERE 절을 테이블 단위로 최신순 보관해, 다음에도 같은
 * 조건으로 즉시 재조회할 수 있게 한다. 키는 `${db}.${table}` — connId 가 아닌
 * 안정 식별자라 재접속(휘발 connId 변경) 후에도 기록이 유지된다.
 *
 * localStorage 영속(`orcasql-where-history`). 테이블당 MAX_PER_TABLE 개로 상한.
 */

const MAX_PER_TABLE = 25

export function whereHistoryKey(db: string, table: string): string {
  return `${db}.${table}`
}

interface WhereHistoryStore {
  /** key(`${db}.${table}`) → 최근 적용 WHERE 목록(최신 우선, 중복 제거) */
  histories: Record<string, string[]>
  /** 적용된 WHERE 를 기록에 추가(최신으로 승격, 상한 유지). 빈 문자열은 무시. */
  add: (key: string, where: string) => void
  /** 특정 기록 항목 제거 */
  remove: (key: string, where: string) => void
  /** 해당 테이블의 기록 전체 삭제 */
  clear: (key: string) => void
}

export const useWhereHistoryStore = create<WhereHistoryStore>()(
  persist(
    (set) => ({
      histories: {},
      add: (key, where) =>
        set((s) => {
          const w = where.trim()
          if (!w) return s
          const prev = s.histories[key] ?? []
          const next = [w, ...prev.filter((x) => x !== w)].slice(0, MAX_PER_TABLE)
          return { histories: { ...s.histories, [key]: next } }
        }),
      remove: (key, where) =>
        set((s) => {
          const prev = s.histories[key]
          if (!prev) return s
          return { histories: { ...s.histories, [key]: prev.filter((x) => x !== where) } }
        }),
      clear: (key) =>
        set((s) => {
          if (!(key in s.histories)) return s
          const next = { ...s.histories }
          delete next[key]
          return { histories: next }
        }),
    }),
    { name: 'orcasql-where-history' },
  ),
)
