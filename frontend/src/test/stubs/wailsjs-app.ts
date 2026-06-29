// 테스트 전용 자동생성 바인딩 스텁. 실 모듈은 `wailsjs/go/main/App.js` 인데 Go 빌드 결과물이라
// 테스트 환경에선 부재. 각 테스트가 필요하면 vi.mock() 으로 override.
import { vi } from 'vitest'

export const ExecuteQuery = vi.fn()
export const ExecuteMultiQuery = vi.fn()
export const UpdateRowValue = vi.fn()
export const InsertRow = vi.fn()
export const ListColumns = vi.fn()
export const ListIndexes = vi.fn()
export const GetForeignKeys = vi.fn()
export const GetExplain = vi.fn()
export const GetExplainJSON = vi.fn()
export const Reconnect = vi.fn()
export const ShowNotification = vi.fn()
export const SaveSession = vi.fn()
export const RecordHistoryEntry = vi.fn()
// 추가 스텁은 필요할 때 한 줄씩 추가.
