import { describe, it, expect } from 'vitest'
import { t } from './index'

describe('i18n.t', () => {
  it('한국어 키 반환', () => {
    expect(t('settings', 'ko')).toBe('환경설정')
    expect(t('confirmDefaultOk', 'ko')).toBe('확인')
    expect(t('confirmDefaultCancel', 'ko')).toBe('취소')
  })

  it('영어 키 반환', () => {
    expect(t('settings', 'en')).toBe('Settings')
    expect(t('confirmDefaultOk', 'en')).toBe('OK')
    expect(t('confirmDefaultCancel', 'en')).toBe('Cancel')
  })

  it('lang 인자 미지정 시 ko 폴백', () => {
    expect(t('settings')).toBe('환경설정')
  })

  it('BugFix-BX 신규 키들이 ko/en 양쪽에 모두 등록됨', () => {
    const keys = [
      'procKillTitle', 'procKillBody', 'procKillManyBody',
      'dsyncApplyTitle', 'dsyncApplyBody',
      'connDeleteTitle', 'connDeleteBody',
      'truncateTitle', 'truncateBody',
      'userDeleteTitle', 'userDeleteBody',
      'favDeleteTitle',
      'groupDeleteTitle', 'groupDeleteBodyWithConns', 'groupDeleteBodyEmpty',
    ] as const
    for (const k of keys) {
      const ko = t(k, 'ko')
      const en = t(k, 'en')
      expect(ko, `${k} ko`).toBeTruthy()
      expect(en, `${k} en`).toBeTruthy()
      expect(ko, `${k} ko/en should differ`).not.toBe(en)
    }
  })

  it('BugFix-BT 의 plural body 키가 {n} placeholder 를 포함', () => {
    expect(t('gridDeleteRowsBodyPluralKo', 'ko')).toContain('{n}')
    expect(t('gridDeleteRowsBodyPluralKo', 'en')).toContain('{n}')
    expect(t('gridDeleteRowsBodySingular', 'ko')).not.toContain('{n}')
  })
})
