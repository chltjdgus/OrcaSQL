import { create } from 'zustand'

/**
 * BugFix-BK: 앱 시작 시 세션 복원 진행 상태를 추적한다.
 *
 * App.tsx `init()` 가 자동 재접속을 시작 → 결과를 이 store 에 기록 → StatusBar 가 구독해 표시.
 * 1차 시도가 끝난 뒤 실패가 남으면 5초 카운트다운 후 자동 재시도(`retryNow`) 1회.
 * 그 후에도 실패가 남으면 `phase = 'partial'` 로 두고 사용자가 StatusBar 의 수동 "재시도"
 * 버튼을 누르기 전까지 대기 — 자동 재시도는 무한 반복하지 않는다.
 */

export type RestorePhase = 'idle' | 'restoring' | 'retrying' | 'partial' | 'done'

export interface RestoreFailure {
  cfgId: string
  name: string
  lastError?: string
}

interface RestoreStore {
  phase: RestorePhase
  total: number
  succeeded: number
  failed: RestoreFailure[]
  /** 다음 자동 재시도까지 남은 초. null 이면 카운트다운 없음. */
  retryIn: number | null
  /** App.tsx 가 등록한 재시도 실행 함수. failed[] 만 다시 시도해 store 를 갱신. */
  retryFn: (() => Promise<void>) | null

  start: (total: number) => void
  markSuccess: () => void
  markFail: (item: RestoreFailure) => void
  /** 1차 시도 종료 — failed.length 에 따라 자동 재시도 카운트다운 또는 finish. */
  finishFirstPass: () => void
  /** 자동 재시도 카운트다운(5 → 0) 시작. 0 도달 시 retryNow 호출. */
  scheduleAutoRetry: (delaySec?: number) => void
  /** 카운트다운 취소(사용자가 수동 재시도 또는 dismiss 시). */
  cancelAutoRetry: () => void
  retryNow: () => Promise<void>
  setRetryFn: (fn: (() => Promise<void>) | null) => void
  /** 진행 상태 종료(모든 작업 완료 또는 실패가 0). idle 로 되돌림. */
  finish: () => void
  /** 사용자가 수동으로 닫음 (partial 상태에서 dismiss). */
  dismiss: () => void
}

let _retryTimer: ReturnType<typeof setInterval> | null = null

function _clearTimer() {
  if (_retryTimer !== null) {
    clearInterval(_retryTimer)
    _retryTimer = null
  }
}

export const useRestoreStore = create<RestoreStore>((set, get) => ({
  phase: 'idle',
  total: 0,
  succeeded: 0,
  failed: [],
  retryIn: null,
  retryFn: null,

  start: (total) => {
    _clearTimer()
    set({ phase: 'restoring', total, succeeded: 0, failed: [], retryIn: null })
  },

  markSuccess: () => set((s) => ({ succeeded: s.succeeded + 1 })),

  markFail: (item) =>
    set((s) => {
      // 같은 cfgId 가 이미 있으면 lastError 만 갱신 (재시도 시 덮어쓰기)
      const idx = s.failed.findIndex((f) => f.cfgId === item.cfgId)
      if (idx >= 0) {
        const next = [...s.failed]
        next[idx] = item
        return { failed: next }
      }
      return { failed: [...s.failed, item] }
    }),

  finishFirstPass: () => {
    const { failed } = get()
    if (failed.length === 0) {
      set({ phase: 'done' })
      // 잠깐 표시했다가 자동으로 idle 로 돌리지 않음 — App.tsx 가 finish() 호출
      return
    }
    // 실패가 남아있음 — 5초 자동 재시도 예약
    get().scheduleAutoRetry(5)
  },

  scheduleAutoRetry: (delaySec = 5) => {
    _clearTimer()
    set({ phase: 'partial', retryIn: delaySec })
    _retryTimer = setInterval(() => {
      const { retryIn } = get()
      if (retryIn === null) {
        _clearTimer()
        return
      }
      if (retryIn <= 1) {
        _clearTimer()
        set({ retryIn: null })
        // 비동기 fire-and-forget
        void get().retryNow()
        return
      }
      set({ retryIn: retryIn - 1 })
    }, 1000)
  },

  cancelAutoRetry: () => {
    _clearTimer()
    set({ retryIn: null })
  },

  retryNow: async () => {
    _clearTimer()
    const fn = get().retryFn
    if (!fn) return
    set({ phase: 'retrying', retryIn: null })
    try {
      await fn()
    } finally {
      // 호출자가 markSuccess / markFail 을 적절히 갱신했다고 가정
      const { failed } = get()
      if (failed.length === 0) {
        set({ phase: 'done' })
      } else {
        // 자동 재시도는 1회만 — 추가 시도는 사용자 수동 클릭으로 한정
        set({ phase: 'partial' })
      }
    }
  },

  setRetryFn: (fn) => set({ retryFn: fn }),

  finish: () => {
    _clearTimer()
    set({ phase: 'idle', total: 0, succeeded: 0, failed: [], retryIn: null })
  },

  dismiss: () => {
    _clearTimer()
    set({ phase: 'idle', retryIn: null })
  },
}))
