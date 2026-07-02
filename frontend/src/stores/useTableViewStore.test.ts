/**
 * Phase 61 — 세션 단위 캐싱 회귀 가드 (테이블 뷰 상태).
 *
 * 핵심 가드: `clearForConn` 이 NUL(\0) 구분 키를 올바르게 prefix 매칭하는지.
 * tableViewKey 는 `${connId}\0${db}\0${table}` 로 NUL 을 구분자로 쓰므로, prefix 가
 * 일반 공백이면 매칭 0건으로 조용히 실패한다 → 이 테스트가 그 회귀를 잡는다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useTableViewStore, tableViewKey, DEFAULT_TABLE_VIEW } from './useTableViewStore'

const NUL = '\0'

function resetStore() {
  useTableViewStore.setState({ views: {}, subTabs: {} })
}

describe('useTableViewStore (Phase 61)', () => {
  beforeEach(resetStore)

  it('tableViewKey 는 NUL 을 구분자로 쓴다 (공백 아님)', () => {
    expect(tableViewKey('conn-1', 'db', 'tbl')).toBe(`conn-1${NUL}db${NUL}tbl`)
    expect(tableViewKey('conn-1', 'db', 'tbl')).not.toBe('conn-1 db tbl')
  })

  it('patch 는 기존 뷰가 없으면 기본값에서 시작해 부분 갱신한다', () => {
    const key = tableViewKey('c1', 'd1', 't1')
    useTableViewStore.getState().patch(key, { page: 3, activeWhere: 'id > 0' })
    const v = useTableViewStore.getState().views[key]
    expect(v.page).toBe(3)
    expect(v.activeWhere).toBe('id > 0')
    expect(v.pageSize).toBe(DEFAULT_TABLE_VIEW.pageSize)
    expect(v.orderByDir).toBe('ASC')
  })

  it('reset 은 필터·정렬·페이지를 비우되 pageSize 는 사용자 선호로 유지한다', () => {
    const key = tableViewKey('c1', 'd1', 't1')
    useTableViewStore.getState().patch(key, { page: 5, pageSize: 1000, activeWhere: 'x=1', orderByCol: 'name' })
    useTableViewStore.getState().reset(key)
    const v = useTableViewStore.getState().views[key]
    expect(v.page).toBe(0)
    expect(v.activeWhere).toBe('')
    expect(v.orderByCol).toBeNull()
    expect(v.pageSize).toBe(1000) // 유지
  })

  it('clearForConn 은 그 connId 의 모든 뷰만 제거하고 다른 연결은 보존한다', () => {
    const { patch, clearForConn } = useTableViewStore.getState()
    const a1 = tableViewKey('conn-A', 'db1', 'users')
    const a2 = tableViewKey('conn-A', 'db2', 'orders')
    const b1 = tableViewKey('conn-B', 'db1', 'users')
    patch(a1, { page: 1 })
    patch(a2, { page: 2 })
    patch(b1, { page: 3 })

    clearForConn('conn-A')

    const views = useTableViewStore.getState().views
    expect(views[a1]).toBeUndefined()
    expect(views[a2]).toBeUndefined()
    expect(views[b1]).toBeDefined() // 다른 연결은 보존
    expect(views[b1].page).toBe(3)
  })

  it('clearForConn 은 connId 가 다른 connId 의 prefix 여도 오삭제하지 않는다 (NUL 경계)', () => {
    const { patch, clearForConn } = useTableViewStore.getState()
    // 구분자가 없었다면 startsWith('conn') 가 'conn-2' 까지 오삭제했을 케이스.
    const shortKey = tableViewKey('conn', 'd', 't')
    const longKey = tableViewKey('conn-2', 'd', 't')
    patch(shortKey, { page: 1 })
    patch(longKey, { page: 2 })

    clearForConn('conn')

    const views = useTableViewStore.getState().views
    expect(views[shortKey]).toBeUndefined()
    expect(views[longKey]).toBeDefined() // NUL 경계 덕에 안전
  })

  it('setSubTab 은 테이블별 서브탭을 기억하고 값이 같으면 상태 참조를 유지한다', () => {
    const { setSubTab } = useTableViewStore.getState()
    const a = tableViewKey('c1', 'd1', 'A')
    const b = tableViewKey('c1', 'd1', 'B')

    // 미기록 테이블은 undefined → 호출 측이 'info' 로 fallback.
    expect(useTableViewStore.getState().subTabs[a]).toBeUndefined()

    setSubTab(a, 'tableData')
    setSubTab(b, 'info')
    expect(useTableViewStore.getState().subTabs[a]).toBe('tableData')
    expect(useTableViewStore.getState().subTabs[b]).toBe('info')

    // 같은 값 재설정은 no-op(참조 유지) — 불필요한 리렌더 방지.
    const before = useTableViewStore.getState().subTabs
    setSubTab(a, 'tableData')
    expect(useTableViewStore.getState().subTabs).toBe(before)
  })

  it('clearForConn 은 그 connId 의 subTabs 도 함께 비운다', () => {
    const { setSubTab, clearForConn } = useTableViewStore.getState()
    const a = tableViewKey('conn-A', 'db1', 'users')
    const b = tableViewKey('conn-B', 'db1', 'users')
    setSubTab(a, 'tableData')
    setSubTab(b, 'tableData')

    clearForConn('conn-A')

    const subTabs = useTableViewStore.getState().subTabs
    expect(subTabs[a]).toBeUndefined()
    expect(subTabs[b]).toBe('tableData') // 다른 연결은 보존
  })
})
