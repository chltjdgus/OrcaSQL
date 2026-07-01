/**
 * BugFix-CB — BugFix-BN (Messages 영역 세션 로그) 회귀 가드.
 *
 * MAX_ENTRIES(500) 상한 정책 · id/timestamp 자동 채움 · crypto.randomUUID 폴백 · clear/append/logMsg
 * 동작을 단위 테스트로 고정.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMessagesLogStore, logMsg, type MsgEntry } from './useMessagesLogStore'

function getEntries(): MsgEntry[] {
  return useMessagesLogStore.getState().entries
}

describe('useMessagesLogStore', () => {
  beforeEach(() => {
    useMessagesLogStore.getState().clear()
  })

  it('append 시 id · timestamp 가 자동으로 채워지고 호출자 필드는 보존된다', () => {
    const before = Date.now()
    useMessagesLogStore.getState().append({
      kind: 'connection',
      level: 'success',
      title: '연결 성공',
      connName: 'prod',
    })
    const e = getEntries()[0]
    expect(e.id).toBeTruthy()
    expect(e.timestamp).toBeGreaterThanOrEqual(before)
    expect(e.kind).toBe('connection')
    expect(e.level).toBe('success')
    expect(e.title).toBe('연결 성공')
    expect(e.connName).toBe('prod')
  })

  it('append 는 시간순으로 누적되며 가장 최신 항목이 마지막 인덱스에 온다', () => {
    for (let i = 0; i < 5; i++) {
      useMessagesLogStore.getState().append({ kind: 'system', level: 'info', title: `msg-${i}` })
    }
    expect(getEntries().map((e) => e.title)).toEqual(['msg-0', 'msg-1', 'msg-2', 'msg-3', 'msg-4'])
  })

  it('clear 는 entries 를 비운다', () => {
    useMessagesLogStore.getState().append({ kind: 'system', level: 'info', title: 'x' })
    expect(getEntries()).toHaveLength(1)
    useMessagesLogStore.getState().clear()
    expect(getEntries()).toEqual([])
  })

  it('500개 상한 정책 — 초과분은 가장 오래된 항목부터 splice', () => {
    for (let i = 0; i < 510; i++) {
      useMessagesLogStore.getState().append({ kind: 'system', level: 'info', title: `e-${i}` })
    }
    const entries = getEntries()
    expect(entries).toHaveLength(500)
    expect(entries[0].title).toBe('e-10')        // 오래된 10개가 제거됨
    expect(entries[entries.length - 1].title).toBe('e-509')
  })

  it('logMsg 헬퍼는 store.getState().append 와 동등', () => {
    logMsg({ kind: 'query', level: 'error', title: 'failed', sql: 'SELECT 1' })
    expect(getEntries()).toHaveLength(1)
    expect(getEntries()[0].sql).toBe('SELECT 1')
  })

  it('append 가 생성하는 id 는 호출마다 고유하다 (1000회)', () => {
    for (let i = 0; i < 1000; i++) {
      useMessagesLogStore.getState().append({ kind: 'system', level: 'info', title: 't' })
    }
    const ids = new Set(getEntries().map((e) => e.id))
    // 500 상한에 의해 잘리지만, 남은 500개의 id 가 모두 unique 해야 한다.
    expect(ids.size).toBe(500)
  })

  it('crypto.randomUUID 미지원 환경 폴백 — id 는 `${Date.now()}-${suffix}` 형식', () => {
    // happy-dom 의 globalThis.crypto 는 getter-only 라 직접 할당이 불가능하다.
    // vi.stubGlobal 로 일시 교체 → afterEach 의 unstubAllGlobals 또는 finally 에서 복원.
    const original = globalThis.crypto
    vi.stubGlobal('crypto', undefined)
    try {
      useMessagesLogStore.getState().append({ kind: 'system', level: 'info', title: 'fallback' })
      const id = getEntries()[0].id
      expect(id).toMatch(/^\d+-[a-z0-9]+$/)
    } finally {
      vi.stubGlobal('crypto', original)
    }
  })
})
