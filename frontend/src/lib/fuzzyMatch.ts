/**
 * Phase 63: 명령 팔레트용 순수 퍼지 매칭.
 *
 * 의존성 없는 서브시퀀스 스코어러. query 의 모든 글자가 target 에 **순서대로**
 * 등장하면 매치(중간 글자 건너뛰기 허용). 대소문자 무시. 매치 실패 시 null.
 *
 * 스코어(높을수록 우수):
 *  - 연속 매치(CONSEC): 가장 강한 신호 — 붙여 친 글자가 붙어서 매치될수록 우수
 *  - 단어 경계(BOUNDARY): 시작 위치 / 구분자 직후 / camelCase 전이에서 매치
 *  - 갭 페널티: 매치 사이 건너뛴 글자 수(상한 있음)
 *  - 길이 tiebreak: 동점 시 짧은 target 우선
 *
 * 빈 query 는 { score: 0, indices: [] } 로 전체 통과(필터 미적용).
 */
export interface FuzzyMatchResult {
  /** 정렬용 점수(높을수록 우수). */
  score: number
  /** 매치된 target 글자 인덱스(오름차순) — UI 하이라이트용. */
  indices: number[]
}

const BASE = 1
const BOUNDARY = 8
const CONSEC = 12
const GAP_CAP = 3

const SEPARATORS = new Set([' ', '_', '-', '.', '/', ':', '\\', '(', ')', '[', ']'])

function isSeparator(ch: string | undefined): boolean {
  return ch !== undefined && SEPARATORS.has(ch)
}

/** camelCase 전이 등 단어 경계 판정. */
function isBoundary(target: string, i: number): boolean {
  if (i === 0) return true
  const prev = target[i - 1]
  if (isSeparator(prev)) return true
  // 소문자/숫자 → 대문자 전이 (camelCase)
  const cur = target[i]
  const prevLower = prev === prev.toLowerCase() && prev !== prev.toUpperCase()
  const curUpper = cur === cur.toUpperCase() && cur !== cur.toLowerCase()
  return prevLower && curUpper
}

export function fuzzyMatch(query: string, target: string): FuzzyMatchResult | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q.length === 0) return { score: 0, indices: [] }
  if (q.length > t.length) return null

  const indices: number[] = []
  let ti = 0
  let score = 0
  let prevMatch = -2 // -2 → 첫 매치는 연속/갭 판정에서 제외

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti
        break
      }
      ti++
    }
    if (found === -1) return null
    indices.push(found)

    let s = BASE
    if (isBoundary(target, found)) s += BOUNDARY
    if (found === prevMatch + 1) {
      s += CONSEC
    } else if (prevMatch >= 0) {
      const gap = found - (prevMatch + 1)
      s -= Math.min(gap, GAP_CAP)
    }
    score += s
    prevMatch = found
    ti = found + 1
  }

  // 동점 시 짧은 대상 우선 (아주 작은 tiebreak)
  score -= target.length * 0.01
  return { score, indices }
}
