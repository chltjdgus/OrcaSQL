import { create } from 'zustand'

/**
 * BugFix-BN — Messages 영역 세션 로그.
 *
 * 앱이 살아 있는 동안 누적되는 in-memory 로그 (창 닫기 전까지 유지, 디스크 영속 X).
 * 연결 성공/실패, 쿼리 성공/실패, 시스템 알림이 모두 시간순으로 쌓여 사용자가
 * 과거 이벤트를 추적할 수 있도록 함. MessagesFooter 가 이 store 를 구독해 표시.
 *
 * 메모리 보호: 최대 MAX_ENTRIES 개 유지 → 초과 시 가장 오래된 항목부터 제거.
 */

export type MsgLevel = 'info' | 'success' | 'warn' | 'error'
export type MsgKind = 'connection' | 'query' | 'system'

export interface MsgEntry {
  id: string
  /** epoch ms */
  timestamp: number
  kind: MsgKind
  level: MsgLevel
  /** 한 줄 요약 (예: "연결 실패: prod-db") */
  title: string
  /** 상세 메시지 (에러 본문, 부가 설명 등) */
  detail?: string
  /** Connection 이름 (kind === 'connection' 일 때) */
  connName?: string
  /** SQL 미리보기 (kind === 'query' 일 때, 첫 줄만) */
  sql?: string
  /** 다중 statement 에서의 인덱스 (1-based 표시용은 호출자가 +1 처리) */
  stmtIndex?: number
  totalCount?: number
  /** SELECT 의 행 수 */
  rows?: number
  /** DML 의 영향 행 수 */
  affected?: number
  /** 실행 시간 (ms) */
  durationMs?: number
}

interface MessagesLogState {
  entries: MsgEntry[]
  append: (entry: Omit<MsgEntry, 'id' | 'timestamp'>) => void
  clear: () => void
}

const MAX_ENTRIES = 500

export const useMessagesLogStore = create<MessagesLogState>((set) => ({
  entries: [],
  append: (entry) =>
    set((s) => {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const next = s.entries.concat({ ...entry, id, timestamp: Date.now() })
      if (next.length > MAX_ENTRIES) {
        next.splice(0, next.length - MAX_ENTRIES)
      }
      return { entries: next }
    }),
  clear: () => set({ entries: [] }),
}))

/** 헬퍼 — 호출부에서 zustand getState 보일러플레이트 줄이기. */
export function logMsg(entry: Omit<MsgEntry, 'id' | 'timestamp'>): void {
  useMessagesLogStore.getState().append(entry)
}
