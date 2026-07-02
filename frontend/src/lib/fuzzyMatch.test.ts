/**
 * Phase 63 — 명령 팔레트 퍼지 매칭 순수 함수 가드.
 */
import { describe, it, expect } from 'vitest'
import { fuzzyMatch } from './fuzzyMatch'

describe('fuzzyMatch (Phase 63)', () => {
  it('빈 query 는 전체 통과 (score 0, indices 빈 배열)', () => {
    const r = fuzzyMatch('', 'anything')
    expect(r).not.toBeNull()
    expect(r!.score).toBe(0)
    expect(r!.indices).toEqual([])
  })

  it('서브시퀀스가 아니면 null', () => {
    expect(fuzzyMatch('xyz', 'abc')).toBeNull()
    expect(fuzzyMatch('back', 'abc')).toBeNull() // 순서 불충족
  })

  it('query 가 target 보다 길면 null', () => {
    expect(fuzzyMatch('abcd', 'abc')).toBeNull()
  })

  it('대소문자 무시', () => {
    expect(fuzzyMatch('USR', 'user')).not.toBeNull()
    expect(fuzzyMatch('user', 'USER')).not.toBeNull()
  })

  it('매치 글자 인덱스를 오름차순으로 반환 (하이라이트용)', () => {
    const r = fuzzyMatch('st', 'schema_tree')
    expect(r).not.toBeNull()
    // s(0), 그다음 t 는 단어경계인 index 7('_tree')
    expect(r!.indices).toEqual([0, 7])
  })

  it('연속 매치가 흩어진 매치보다 높은 점수', () => {
    const consec = fuzzyMatch('ab', 'ab')!
    const gapped = fuzzyMatch('ab', 'a_b')!
    expect(consec.score).toBeGreaterThan(gapped.score)
  })

  it('접두 연속 매치가 뒷부분 흩어진 매치보다 높은 점수', () => {
    const prefix = fuzzyMatch('user', 'user_manager')!
    const scattered = fuzzyMatch('user', 'superuser')!
    expect(prefix.score).toBeGreaterThan(scattered.score)
  })

  it('단어 경계(구분자 직후) 매치에 보너스', () => {
    const boundary = fuzzyMatch('t', 'a_table')! // t at index 2 (구분자 직후)
    const mid = fuzzyMatch('t', 'atable')!        // t at index 1 (경계 아님)
    expect(boundary.score).toBeGreaterThan(mid.score)
  })

  it('camelCase 전이를 경계로 인식', () => {
    const r = fuzzyMatch('cp', 'CommandPalette')!
    expect(r.indices).toEqual([0, 7]) // C(0), P(7)
  })

  it('동점 시 더 짧은 대상이 우선 (length tiebreak)', () => {
    const short = fuzzyMatch('abc', 'abc')!
    const long = fuzzyMatch('abc', 'abcdefghij')!
    expect(short.score).toBeGreaterThan(long.score)
  })
})
