/**
 * BugFix-CD — useQueryExec hook 회귀 가드.
 *
 * TanStack `useMutation` + 다중 store + wails 바인딩 + askContinueExecution dialog 의
 * 조합을 RTL renderHook 으로 검증한다. 단일 SELECT/DML 성공, 연결 오류 재시도, statement
 * 실패 분기(no-remaining vs continue), DDL 스키마 캐시 무효화, 비-연결 오류 onError 분기 등
 * 핵심 경로 7개.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// vi.mock factory 는 hoist 되므로 외부 변수에 접근 불가. vi.hoisted 로 mock 인스턴스를
// factory 와 테스트 본문 양쪽에서 공유한다.
//
// stub 파일(test/stubs/wailsjs-app.ts) 의 vi.fn() 은 bun runtime 에서 mock 표면이 빈
// 일반 function 으로 평가된다 — `mockReset/mockResolvedValue` 가 없음. 그래서 wails
// 바인딩도 stub alias 가 아닌 테스트 파일의 vi.mock() factory 로 직접 교체한다.
const {
  toastMock,
  askContinueMock,
  execMock,
  getExplainMock,
  getExplainJSONMock,
  reconnectMock,
  showNotificationMock,
} = vi.hoisted(() => ({
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    custom: vi.fn(),
  },
  askContinueMock: vi.fn<(failedIndex: number, totalCount: number, errorMsg: string) => Promise<boolean>>(),
  execMock: vi.fn(),
  getExplainMock: vi.fn(),
  getExplainJSONMock: vi.fn(),
  reconnectMock: vi.fn(),
  showNotificationMock: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({ default: toastMock }))
vi.mock('./useMultiStatementConfirm', () => ({ askContinueExecution: askContinueMock }))
vi.mock('@/wailsjs/go/main/App', () => ({
  ExecuteMultiQuery: execMock,
  GetExplain: getExplainMock,
  GetExplainJSON: getExplainJSONMock,
  Reconnect: reconnectMock,
  ShowNotification: showNotificationMock,
  // connectionStore 가 module load 시 import — 안전한 no-op 으로 충분
  SaveSession: vi.fn(),
}))

import { useConnectionStore } from '@/stores/connectionStore'
import { useMessagesLogStore } from '@/stores/useMessagesLogStore'
import { useQueryExec } from './useQueryExec'
import type { QueryResult, QueryTab } from '@/types'

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, invalidateSpy, wrapper }
}

function selectResult(sql: string, rows: unknown[][] = [[1, 'a']]): QueryResult {
  return {
    columns: [
      { name: 'id', type: 'int', nullable: false },
      { name: 'name', type: 'varchar', nullable: true },
    ],
    rows,
    affected: 0,
    lastId: 0,
    duration: 1_000_000,
    sql,
  }
}

function dmlResult(sql: string, affected = 5): QueryResult {
  return {
    columns: [],
    rows: [],
    affected,
    lastId: 0,
    duration: 500_000,
    sql,
  }
}

function seedTab(): QueryTab {
  const tab: QueryTab = {
    id: 'tab-1',
    title: 'Q1',
    sql: '',
    connId: 'conn-1',
    database: 'mydb',
    result: null,
    results: [],
    explainData: [],
    isRunning: false,
  }
  useConnectionStore.setState({ queryTabs: [tab], activeTabId: tab.id })
  return tab
}

const baseExecArgs = {
  tabId: 'tab-1',
  connId: 'conn-1',
  connName: 'c',
  database: 'mydb',
  sql: 'SELECT 1',
}

describe('useQueryExec', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMessagesLogStore.getState().clear()
    execMock.mockReset()
    reconnectMock.mockReset()
    // 부수 호출은 안전한 기본값으로 — 모든 테스트가 매번 reset 안 해도 되도록
    getExplainMock.mockResolvedValue([])
    getExplainJSONMock.mockResolvedValue('{}')
    showNotificationMock.mockResolvedValue(undefined)
    askContinueMock.mockReset()
  })

  it('단일 SELECT 성공 — updateTab 에 result 적재, success toast, logMsg success', async () => {
    seedTab()
    execMock.mockResolvedValue({
      results: [selectResult('SELECT 1')],
      failedIndex: -1,
      failedSQL: '',
      error: '',
      remainingSQL: '',
      totalCount: 1,
    })

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useQueryExec(), { wrapper })
    act(() => {
      result.current.execute(baseExecArgs)
    })

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
    const tab = useConnectionStore.getState().queryTabs[0]
    expect(tab.isRunning).toBe(false)
    expect(tab.results).toHaveLength(1)
    expect(tab.result?.columns).toHaveLength(2)

    const logs = useMessagesLogStore.getState().entries
    expect(logs).toHaveLength(1)
    expect(logs[0].level).toBe('success')
    expect(logs[0].title).toMatch(/row\(s\) returned/)
  })

  it('DML 성공 — toast "행 영향", logMsg "Query OK", affected 누적', async () => {
    seedTab()
    execMock.mockResolvedValue({
      results: [dmlResult('UPDATE t SET a=1', 3)],
      failedIndex: -1,
      failedSQL: '',
      error: '',
      remainingSQL: '',
      totalCount: 1,
    })

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useQueryExec(), { wrapper })
    act(() => {
      result.current.execute({ ...baseExecArgs, sql: 'UPDATE t SET a=1' })
    })

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
    const msg = String(toastMock.success.mock.calls[0]?.[0] ?? '')
    expect(msg).toMatch(/행 영향/)

    const logs = useMessagesLogStore.getState().entries
    expect(logs[0].title).toMatch(/Query OK/)
    expect(logs[0].affected).toBe(3)
  })

  it('연결 오류 → Reconnect 후 1회 재시도 → 성공', async () => {
    seedTab()
    execMock.mockRejectedValueOnce(new Error('invalid connection: server gone'))
    execMock.mockResolvedValueOnce({
      results: [selectResult('SELECT 1')],
      failedIndex: -1,
      failedSQL: '',
      error: '',
      remainingSQL: '',
      totalCount: 1,
    })
    reconnectMock.mockResolvedValue(undefined)

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useQueryExec(), { wrapper })
    act(() => {
      result.current.execute(baseExecArgs)
    })

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
    expect(reconnectMock).toHaveBeenCalledTimes(1)
    expect(execMock).toHaveBeenCalledTimes(2)
  })

  it('Statement 실패 + remainingSQL 비어있음 → toast.error, askContinueExecution 미호출', async () => {
    seedTab()
    execMock.mockResolvedValue({
      results: [],
      failedIndex: 0,
      failedSQL: 'SELECT bad',
      error: 'syntax error',
      remainingSQL: '',
      totalCount: 1,
    })

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useQueryExec(), { wrapper })
    act(() => {
      result.current.execute({ ...baseExecArgs, sql: 'SELECT bad' })
    })

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled())
    expect(askContinueMock).not.toHaveBeenCalled()
    const tab = useConnectionStore.getState().queryTabs[0]
    expect(tab.queryError?.message).toBe('syntax error')
    expect(tab.queryError?.sql).toBe('SELECT bad')

    const logs = useMessagesLogStore.getState().entries
    expect(logs[0].level).toBe('error')
  })

  it('Statement 실패 + 사용자 "계속" 선택 → remainingSQL 로 재귀 실행', async () => {
    seedTab()
    execMock.mockResolvedValueOnce({
      results: [],
      failedIndex: 0,
      failedSQL: 'BAD;',
      error: 'fail',
      remainingSQL: 'SELECT 1',
      totalCount: 2,
    })
    execMock.mockResolvedValueOnce({
      results: [selectResult('SELECT 1')],
      failedIndex: -1,
      failedSQL: '',
      error: '',
      remainingSQL: '',
      totalCount: 1,
    })
    askContinueMock.mockResolvedValue(true)

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useQueryExec(), { wrapper })
    act(() => {
      result.current.execute({ ...baseExecArgs, sql: 'BAD; SELECT 1' })
    })

    await waitFor(() => expect(execMock).toHaveBeenCalledTimes(2))
    expect(askContinueMock).toHaveBeenCalledOnce()
    // 두 번째 호출의 sql 인자(index 4) 가 remainingSQL 이어야 함
    expect(execMock.mock.calls[1][4]).toBe('SELECT 1')
  })

  it('DDL 감지 → queryClient.invalidateQueries 호출', async () => {
    seedTab()
    execMock.mockResolvedValue({
      results: [dmlResult('CREATE TABLE t (id INT)', 0)],
      failedIndex: -1,
      failedSQL: '',
      error: '',
      remainingSQL: '',
      totalCount: 1,
    })

    const { wrapper, invalidateSpy } = makeWrapper()
    const { result } = renderHook(() => useQueryExec(), { wrapper })
    act(() => {
      result.current.execute({ ...baseExecArgs, sql: 'CREATE TABLE t (id INT)' })
    })

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled())
    // SCHEMA_QUERY_KEYS 8개에 대해 각각 호출
    expect(invalidateSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('비-연결 오류 → onError: queryError 적재, isRunning false, Reconnect 미호출, logMsg error', async () => {
    seedTab()
    execMock.mockRejectedValue(new Error('syntax error near "FOO"'))

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useQueryExec(), { wrapper })
    act(() => {
      result.current.execute({ ...baseExecArgs, sql: 'FOO' })
    })

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled())
    const tab = useConnectionStore.getState().queryTabs[0]
    expect(tab.queryError?.message).toMatch(/syntax/)
    expect(tab.isRunning).toBe(false)
    expect(reconnectMock).not.toHaveBeenCalled()

    const logs = useMessagesLogStore.getState().entries
    expect(logs[0].level).toBe('error')
  })
})
