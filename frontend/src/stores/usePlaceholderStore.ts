/**
 * 쿼리 placeholder 모달 상태 — 어떤 실행 경로(에디터 단축키, 글로벌 단축키, MenuBar, Toolbar)를 거치든
 * 단일 모달이 동일한 흐름으로 동작하도록 중앙화한다.
 */
import { create } from 'zustand'
import {
  parsePlaceholders,
  groupPlaceholders,
  type PlaceholderGroup,
  type Resolution,
} from '@/utils/placeholderParser'

export interface PendingPlaceholderRequest {
  sql: string
  groups: PlaceholderGroup[]
  tabId: string
  /** 모달 제출 시 호출 — 치환된 SQL을 받아 실제 execute 트리거 */
  onResolve: (substitutedSql: string) => void
}

interface PlaceholderStore {
  pending: PendingPlaceholderRequest | null
  /** tabId → placeholderName → 직전 입력값. 같은 탭 재실행 시 자동 채움. */
  memory: Map<string, Map<string, Resolution>>
  open: (req: PendingPlaceholderRequest) => void
  close: () => void
  rememberValues: (tabId: string, values: Map<string, Resolution>) => void
}

export const usePlaceholderStore = create<PlaceholderStore>((set) => ({
  pending: null,
  memory: new Map(),
  open: (req) => set({ pending: req }),
  close: () => set({ pending: null }),
  rememberValues: (tabId, values) =>
    set((s) => {
      const next = new Map(s.memory)
      next.set(tabId, values)
      return { memory: next }
    }),
}))

/**
 * SQL에 placeholder가 있으면 모달을 열고, 없으면 바로 실행 콜백을 호출한다.
 * 모든 쿼리 실행 진입점(App.tsx runQuery, QueryEditor runQuery, 향후 추가될 경로)에서 사용.
 */
export function runWithPlaceholderCheck(opts: {
  tabId: string
  sql: string
  /** placeholder 없거나 모달 제출 후 실행할 함수. 치환된 SQL이 인자로 전달됨. */
  execute: (sql: string) => void
}): void {
  const found = parsePlaceholders(opts.sql)
  if (found.length === 0) {
    opts.execute(opts.sql)
    return
  }
  const groups = groupPlaceholders(found)
  usePlaceholderStore.getState().open({
    sql: opts.sql,
    groups,
    tabId: opts.tabId,
    onResolve: (subSql) => opts.execute(subSql),
  })
}
