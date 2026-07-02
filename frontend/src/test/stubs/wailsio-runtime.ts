// 테스트 전용 @wailsio/runtime 스텁. 실 모듈은 wails3 dev/build 시 가상 주입되므로
// 테스트 환경에서는 import 가 실패한다. 각 테스트가 필요하면 vi.mock() 으로 override.
import { vi } from 'vitest'

export const Call = {
  ByName: vi.fn(),
  ByID: vi.fn(),
}
export const Create = vi.fn()

export const Dialogs = {
  Question: vi.fn(),
  Info: vi.fn(),
  Warning: vi.fn(),
  Error: vi.fn(),
}
