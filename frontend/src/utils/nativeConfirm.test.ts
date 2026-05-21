import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Dialogs } from '@wailsio/runtime'
import { nativeConfirm } from './nativeConfirm'

describe('nativeConfirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('OK 버튼 클릭 시 true', async () => {
    vi.mocked(Dialogs.Question).mockResolvedValue('확인')
    const ok = await nativeConfirm({ title: '테스트', message: '진행?', language: 'ko' })
    expect(ok).toBe(true)
  })

  it('Cancel 버튼 클릭 시 false', async () => {
    vi.mocked(Dialogs.Question).mockResolvedValue('취소')
    const ok = await nativeConfirm({ title: '테스트', message: '진행?', language: 'ko' })
    expect(ok).toBe(false)
  })

  it('Wails 가 빈 문자열 반환(다이얼로그 닫힘) 시 false', async () => {
    vi.mocked(Dialogs.Question).mockResolvedValue('')
    const ok = await nativeConfirm({ title: '테스트', message: '진행?', language: 'ko' })
    expect(ok).toBe(false)
  })

  it('영어 모드 — OK Label 매칭', async () => {
    vi.mocked(Dialogs.Question).mockResolvedValue('OK')
    const ok = await nativeConfirm({ title: 'Test', message: 'Proceed?', language: 'en' })
    expect(ok).toBe(true)
  })

  it('Dialogs.Question 호출 시 IsDefault/IsCancel 플래그 부여', async () => {
    vi.mocked(Dialogs.Question).mockResolvedValue('확인')
    await nativeConfirm({ title: 'T', message: 'M', language: 'ko' })

    const callArg = vi.mocked(Dialogs.Question).mock.calls[0][0]
    expect(callArg.Title).toBe('T')
    expect(callArg.Message).toBe('M')
    expect(callArg.Buttons).toHaveLength(2)
    expect(callArg.Buttons?.[0]).toMatchObject({ Label: '확인', IsDefault: true })
    expect(callArg.Buttons?.[1]).toMatchObject({ Label: '취소', IsCancel: true })
  })

  it('커스텀 okLabel/cancelLabel override', async () => {
    vi.mocked(Dialogs.Question).mockResolvedValue('Delete')
    const ok = await nativeConfirm({
      title: 'T',
      message: 'M',
      language: 'en',
      okLabel: 'Delete',
      cancelLabel: 'Keep',
    })
    expect(ok).toBe(true)
    const callArg = vi.mocked(Dialogs.Question).mock.calls[0][0]
    expect(callArg.Buttons?.[0]).toMatchObject({ Label: 'Delete' })
    expect(callArg.Buttons?.[1]).toMatchObject({ Label: 'Keep' })
  })
})
