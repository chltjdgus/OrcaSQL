/**
 * BugFix-CB — BugFix-BR (쿼리 탭 번호 세션별 독립) 회귀 가드.
 *
 * nextQueryTitle 은 "현재 세션의 기존 탭" 만 보고 다음 번호를 정한다.
 * - ko 모드에서 "쿼리 N", en 모드에서 "Query N" prefix 가 적용된다.
 * - 두 prefix(ko·en) 가 섞여 있어도 max+1 계산이 안전해야 한다.
 * - 빈 배열이면 1번부터 시작.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { QueryTab } from '@/types'

// happy-dom localStorage 는 zustand/middleware persist 와 호환되지 않으므로
// useLanguageStore 를 persist 가 빠진 단순 zustand store 로 대체한다.
// nextQueryTitle 이 import 하는 useLanguageStore 도 같은 인스턴스를 보게 됨.
vi.mock('./useLanguageStore', async () => {
  const { create } = await import('zustand')
  type Lang = 'ko' | 'en'
  return {
    useLanguageStore: create<{ language: Lang; setLanguage: (l: Lang) => void }>((set) => ({
      language: 'ko',
      setLanguage: (language) => set({ language }),
    })),
  }
})

import { nextQueryTitle } from './connectionStore'
import { useLanguageStore } from './useLanguageStore'

function makeTab(title: string): QueryTab {
  return {
    id: `id-${title}`,
    title,
    sql: '',
    connId: null,
    database: null,
    result: null,
    results: [],
    explainData: [],
    isRunning: false,
  }
}

describe('nextQueryTitle (BugFix-BR)', () => {
  beforeEach(() => {
    useLanguageStore.getState().setLanguage('ko')
  })

  it('빈 세션은 1번부터 시작 — ko', () => {
    expect(nextQueryTitle([])).toBe('쿼리 1')
  })

  it('빈 세션은 1번부터 시작 — en', () => {
    useLanguageStore.getState().setLanguage('en')
    expect(nextQueryTitle([])).toBe('Query 1')
  })

  it('기존 탭의 최대 번호 + 1', () => {
    const tabs = [makeTab('쿼리 1'), makeTab('쿼리 3'), makeTab('쿼리 2')]
    expect(nextQueryTitle(tabs)).toBe('쿼리 4')
  })

  it('ko · en prefix 가 섞여 있어도 두 prefix 모두 매칭', () => {
    const tabs = [makeTab('쿼리 1'), makeTab('Query 5'), makeTab('쿼리 2')]
    expect(nextQueryTitle(tabs)).toBe('쿼리 6')
  })

  it('현재 언어가 en 이면 결과 prefix 도 en — 다른 prefix 매칭은 그대로', () => {
    useLanguageStore.getState().setLanguage('en')
    const tabs = [makeTab('쿼리 1'), makeTab('Query 2')]
    expect(nextQueryTitle(tabs)).toBe('Query 3')
  })

  it('정규식 외 형식의 타이틀(사용자 이름 변경 등) 은 무시', () => {
    const tabs = [
      makeTab('쿼리 1'),
      makeTab('수동 이름'),       // 매칭 X
      makeTab('Query SomeName'),  // 숫자 자리에 문자 → 매칭 X
      makeTab('쿼리 99x'),        // 뒤에 문자 붙음 → 매칭 X
    ]
    expect(nextQueryTitle(tabs)).toBe('쿼리 2')
  })

  it('전역 카운터(tabCounter) 에 의존하지 않음 — 같은 입력은 같은 출력', () => {
    const tabs = [makeTab('쿼리 7')]
    expect(nextQueryTitle(tabs)).toBe('쿼리 8')
    expect(nextQueryTitle(tabs)).toBe('쿼리 8')
    expect(nextQueryTitle(tabs)).toBe('쿼리 8')
  })
})
