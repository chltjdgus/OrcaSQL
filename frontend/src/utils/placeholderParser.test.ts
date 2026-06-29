/**
 * BugFix-CB — Phase 41 (쿼리 placeholder 자동 치환 모달) 회귀 가드.
 *
 * parsePlaceholders / groupPlaceholders / formatValue / formatIdentifier / detectValueType /
 * substitute 의 모드 추론·정규식·치환 오프셋 로직을 단위 테스트로 고정.
 */
import { describe, it, expect } from 'vitest'
import {
  parsePlaceholders,
  groupPlaceholders,
  formatValue,
  formatIdentifier,
  detectValueType,
  substitute,
  type PlaceholderGroup,
  type Resolution,
} from './placeholderParser'

describe('parsePlaceholders — 토큰 감지', () => {
  it('? positional 은 param1·param2 로 자동 명명되고 라벨이 1부터 증가', () => {
    const out = parsePlaceholders('SELECT ? , ? FROM t WHERE id = ?')
    expect(out.map((p) => p.name)).toEqual(['param1', 'param2', 'param3'])
    expect(out.every((p) => p.raw === '?')).toBe(true)
  })

  it('#{name} · ${name} · :name 세 가지 표기 모두 감지', () => {
    const out = parsePlaceholders('SELECT * FROM t WHERE a = #{a} AND b = ${b} AND c = :c')
    expect(out.map((p) => p.name)).toEqual(['a', 'b', 'c'])
    expect(out.map((p) => p.raw)).toEqual(['#{a}', '${b}', ':c'])
  })

  it('문자열 리터럴 · 백틱 식별자 · 라인/블록 주석 내부의 토큰은 무시', () => {
    const sql = [
      "SELECT '?' as q,",                  // single-quote
      `       "?" as qq,`,                 // double-quote
      '       `?col` as col,',             // backtick
      '       -- :ignored',                // line comment
      '       # :ignored_mysql',           // mysql # line comment
      '       /* :ignored_block ${x} */',  // block comment
      '       ? as real_one',              // 유일한 진짜 placeholder
      'FROM t',
    ].join('\n')
    const out = parsePlaceholders(sql)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('param1')
  })

  it(':: postgres cast 와 :name 을 구분', () => {
    const out = parsePlaceholders("SELECT id::text, :uid FROM users")
    expect(out.map((p) => p.name)).toEqual(['uid'])
  })

  it('#{...} 식별자 규칙(`[A-Za-z_][\\w.]*`) 위반 시 placeholder 로 인정 안 함', () => {
    const out = parsePlaceholders('SELECT #{1bad} , #{ok} FROM t')
    expect(out.map((p) => p.name)).toEqual(['ok'])
  })

  it('inferMode: FROM · JOIN · INTO · UPDATE 직후의 ? · :name 은 identifier 모드', () => {
    const cases = [
      ['SELECT * FROM ?',            'identifier'],
      ['SELECT * FROM users JOIN ?', 'identifier'],
      ['INSERT INTO :tbl VALUES(1)', 'identifier'],
      ['UPDATE :tbl SET a = 1',      'identifier'],
      ['SELECT * FROM t WHERE a = ?', 'value'],
      ['SELECT * FROM t WHERE a = :x','value'],
    ] as const
    for (const [sql, expected] of cases) {
      const out = parsePlaceholders(sql)
      expect(out[0]?.defaultMode, sql).toBe(expected)
    }
  })

  it('${name} 은 위치와 상관없이 항상 identifier 모드 (MyBatis 관례)', () => {
    const out = parsePlaceholders("SELECT * FROM t WHERE a = ${col}")
    expect(out[0].defaultMode).toBe('identifier')
  })
})

describe('groupPlaceholders — 동일 이름 묶기', () => {
  it('같은 이름 3회 등장 → 1개 그룹, occurrences 3개', () => {
    const ps = parsePlaceholders('SELECT :id FROM t WHERE a = :id OR b = :id')
    const groups = groupPlaceholders(ps)
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('id')
    expect(groups[0].occurrences).toHaveLength(3)
    expect(groups[0].contexts).toHaveLength(3)
  })

  it('?·?·? positional 은 param1·param2·param3 각각 별도 그룹', () => {
    const ps = parsePlaceholders('SELECT ?, ?, ?')
    const groups = groupPlaceholders(ps)
    expect(groups.map((g) => g.name)).toEqual(['param1', 'param2', 'param3'])
  })
})

describe('formatValue · formatIdentifier · detectValueType — 타입 추론·이스케이프', () => {
  it('NULL · TRUE · FALSE · 숫자 · 문자열', () => {
    expect(formatValue('')).toBe('NULL')
    expect(formatValue('NULL')).toBe('NULL')
    expect(formatValue('null')).toBe('NULL')
    expect(formatValue('TRUE')).toBe('TRUE')
    expect(formatValue('false')).toBe('FALSE')
    expect(formatValue('123')).toBe('123')
    expect(formatValue('-3.14')).toBe('-3.14')
    expect(formatValue('hello')).toBe("'hello'")
  })

  it('문자열 안 작은따옴표 → 두 번(MySQL 표준) 이스케이프', () => {
    expect(formatValue("O'Brien")).toBe("'O''Brien'")
  })

  it('백슬래시는 이중 백슬래시로 이스케이프', () => {
    expect(formatValue('a\\b')).toBe("'a\\\\b'")
  })

  it('formatIdentifier: 기본 백틱 + db.table 분리 + 내부 백틱 이중화', () => {
    expect(formatIdentifier('users')).toBe('`users`')
    expect(formatIdentifier('mydb.users')).toBe('`mydb`.`users`')
    expect(formatIdentifier('weird`name')).toBe('`weird``name`')
  })

  it('formatIdentifier: 이미 백틱으로 감싼 입력은 그대로', () => {
    expect(formatIdentifier('`x`')).toBe('`x`')
  })

  it('detectValueType', () => {
    expect(detectValueType('')).toBe('null')
    expect(detectValueType('null')).toBe('null')
    expect(detectValueType('TRUE')).toBe('boolean')
    expect(detectValueType('0')).toBe('number')
    expect(detectValueType('hello')).toBe('string')
  })
})

describe('substitute — 뒤에서 앞으로 치환 (오프셋 안정성)', () => {
  it('value 모드 · identifier 모드 · 다중 등장 모두 치환', () => {
    const sql = "SELECT * FROM ${tbl} WHERE a = :id AND b = :id"
    const ps = parsePlaceholders(sql)
    const groups: PlaceholderGroup[] = groupPlaceholders(ps)
    const resolutions = new Map<string, Resolution>([
      ['tbl', { mode: 'identifier', rawInput: 'users' }],
      ['id',  { mode: 'value',      rawInput: '42' }],
    ])
    expect(substitute(sql, groups, resolutions)).toBe(
      'SELECT * FROM `users` WHERE a = 42 AND b = 42',
    )
  })

  it('resolutions 누락 그룹은 원본 토큰 그대로 둔다', () => {
    const sql = 'SELECT :a , :b'
    const groups = groupPlaceholders(parsePlaceholders(sql))
    const resolutions = new Map<string, Resolution>([
      ['a', { mode: 'value', rawInput: '1' }],
    ])
    expect(substitute(sql, groups, resolutions)).toBe('SELECT 1 , :b')
  })

  it('? positional 도 substitute 됨 (param1·param2 키로 등록)', () => {
    const sql = 'SELECT ?, ?'
    const groups = groupPlaceholders(parsePlaceholders(sql))
    const resolutions = new Map<string, Resolution>([
      ['param1', { mode: 'value', rawInput: 'hi' }],
      ['param2', { mode: 'value', rawInput: '7' }],
    ])
    expect(substitute(sql, groups, resolutions)).toBe("SELECT 'hi', 7")
  })
})
