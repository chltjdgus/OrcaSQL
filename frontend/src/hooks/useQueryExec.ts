import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ExecuteMultiQuery, GetExplain, GetExplainJSON, Reconnect, ShowNotification } from '@/wailsjs/go/main/App'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { logMsg } from '@/stores/useMessagesLogStore'
import type { MultiExecResult, QueryResult } from '@/types'
import { isMultiExecResult } from '@/types'
import { askContinueExecution } from './useMultiStatementConfirm'

/** 스키마에 영향을 주는 DDL 패턴 (테이블/DB/뷰/인덱스 등 변경) */
const DDL_PATTERN = /^\s*(CREATE|DROP|ALTER|RENAME|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA|VIEW|INDEX|TRIGGER|PROCEDURE|FUNCTION|EVENT)/i

function hasDDL(results: QueryResult[]): boolean {
  return results.some((r) => DDL_PATTERN.test(r.sql))
}

/** 스키마 관련 TanStack Query 캐시 키 목록 */
const SCHEMA_QUERY_KEYS = ['databases', 'tables', 'columns', 'procedures', 'functions', 'triggers', 'events', 'views'] as const

/** MySQL/네트워크 연결 오류 메시지 패턴 */
const CONNECTION_ERROR_PATTERNS = [
  'invalid connection',
  'connection refused',
  'broken pipe',
  'EOF',
  'packets.go',
  'read: connection reset',
  'write: broken pipe',
  'i/o timeout',
]

function isConnectionError(msg: string): boolean {
  const lower = msg.toLowerCase()
  return CONNECTION_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()))
}

interface ExecOptions {
  tabId: string
  connId: string
  connName: string
  database: string
  sql: string
}

interface RunMultiOptions {
  tabId: string
  connId: string
  connName: string
  database: string
  sql: string
  /** 이미 완료된 이전 결과 (재귀 계속 실행 시 누적) */
  accumulated?: QueryResult[]
}

/**
 * SQL 쿼리 실행 훅.
 * - ExecuteMultiQuery로 세미콜론 구분 다중 statement 실행
 * - 중간 실패 시 askContinueExecution()으로 계속/중단 선택 제공
 * - 계속 선택 시 remainingSQL로 재귀 실행, 결과를 누적
 * - 성공 후 SELECT 쿼리에 대해 GetExplain 자동 실행 (Profile 탭용)
 * - 연결 오류 감지 시 Reconnect 후 1회 자동 재시도
 */
export function useQueryExec() {
  const updateTab = useConnectionStore((s) => s.updateTab)
  const persistSession = useConnectionStore((s) => s.persistSession)
  const queryClient = useQueryClient()
  /** 탭별 쿼리 시작 시각 (ms). 알림 임계값 계산에 사용 */
  const startTimesRef = useRef<Map<string, number>>(new Map())

  const mutation = useMutation<QueryResult[], Error, ExecOptions>({
    mutationFn: async ({ tabId, connId, connName, database, sql }) => {
      /**
       * 재귀 실행 함수.
       * 실패 시 사용자에게 계속/중단을 묻고 계속이면 remainingSQL로 재귀한다.
       */
      const runMulti = async ({
        tabId,
        connId,
        connName,
        database,
        sql,
        accumulated = [],
      }: RunMultiOptions): Promise<QueryResult[]> => {
        const callApi = async (): Promise<MultiExecResult> => {
          // tabId를 cancelKey로 전달 → 탭별 독립 취소 지원
          const raw: unknown = await ExecuteMultiQuery(connId, tabId, connName, database, sql)
          if (!isMultiExecResult(raw)) throw new Error('Unexpected response format from server')
          return raw
        }

        let out: MultiExecResult
        try {
          out = await callApi()
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          // 연결 오류 → 재연결 후 1회 재시도
          if (isConnectionError(msg)) {
            toast.loading('연결이 끊어졌습니다. 재연결 중...', { id: 'reconnect' })
            try {
              await Reconnect(connId)
              toast.success('재연결 성공. 쿼리를 재실행합니다.', { id: 'reconnect' })
              out = await callApi()
            } catch (reconnErr) {
              toast.error(`재연결 실패: ${reconnErr}`, { id: 'reconnect' })
              throw reconnErr
            }
          } else {
            throw err
          }
        }

        const done: QueryResult[] = accumulated.concat(out.results ?? [])

        if (out.failedIndex >= 0) {
          // 탭에 오류 정보 저장 (Messages 영역에 표시)
          updateTab(tabId, {
            queryError: {
              sql: out.failedSQL,
              message: out.error,
              stmtIndex: out.failedIndex,
              totalCount: out.totalCount,
            },
          })

          // BugFix-BN: Messages 영역 세션 로그에도 누적
          logMsg({
            kind: 'query',
            level: 'error',
            title: `Statement ${out.failedIndex + 1}${out.totalCount ? ` / ${out.totalCount}` : ''} 실패`,
            detail: out.error,
            sql: out.failedSQL,
            stmtIndex: out.failedIndex,
            totalCount: out.totalCount,
          })

          // remaining이 없으면 대화 없이 에러 toast만 표시하고 종료
          if (!out.remainingSQL || out.remainingSQL.trim() === '') {
            toast.error(`Statement ${out.failedIndex + 1} 실패: ${out.error}`)
            return done
          }

          // remaining이 있으면 계속/중단 대화 표시
          const shouldContinue = await askContinueExecution(
            out.failedIndex,
            out.totalCount,
            out.error,
          )
          if (!shouldContinue) {
            // 중단 — 지금까지 성공한 결과만 반환
            return done
          }

          // 계속 — remainingSQL로 재귀 실행
          return runMulti({
            tabId,
            connId,
            connName,
            database,
            sql: out.remainingSQL,
            accumulated: done,
          })
        }

        return done
      }

      return runMulti({ tabId, connId, connName, database, sql })
    },

    onMutate: ({ tabId }) => {
      startTimesRef.current.set(tabId, Date.now())
      updateTab(tabId, { isRunning: true, result: null, results: [], explainData: [], queryError: undefined })
    },

    onSuccess: async (data, { tabId, connId }) => {
      // OS 알림: 임계값 초과 시
      const elapsedSec = (Date.now() - (startTimesRef.current.get(tabId) ?? Date.now())) / 1000
      startTimesRef.current.delete(tabId)
      const threshold = useSettingsStore.getState().settings.query.notifyThresholdSec
      if (threshold > 0 && elapsedSec >= threshold) {
        const ms = Math.round(data.reduce((acc, r) => acc + r.duration, 0) / 1_000_000)
        ShowNotification('OrcaSQL — 쿼리 완료', `${data.length}개 쿼리 완료 (${ms}ms)`).catch(() => {})
      }

      // 마지막 SELECT 결과를 result에 (하위 호환)
      // columns/rows 는 백엔드가 빈 슬라이스로 정규화하지만, 외부(MCP)·구버전 응답 대비해 옵셔널 체이닝 사용
      const lastSelect = [...data].reverse().find((r) => (r.columns?.length ?? 0) > 0) ?? null
      const lastResult = data[data.length - 1] ?? null
      updateTab(tabId, {
        result: lastSelect ?? lastResult,
        results: data,
        isRunning: false,
        editCtx: lastSelect?.editCtx,
        explainData: data.map(() => null),
      })

      // BugFix-BN: Messages 영역 세션 로그에 statement 별 entry 누적
      data.forEach((r) => {
        const isSelect = (r.columns?.length ?? 0) > 0
        const stmtMs = Math.round(r.duration / 1_000_000)
        logMsg({
          kind: 'query',
          level: 'success',
          title: isSelect ? `${(r.rows?.length ?? 0).toLocaleString()} row(s) returned` : `Query OK, ${r.affected.toLocaleString()} row(s) affected`,
          sql: r.sql,
          rows: isSelect ? (r.rows?.length ?? 0) : undefined,
          affected: isSelect ? undefined : r.affected,
          durationMs: stmtMs,
        })
      })

      // EXPLAIN 자동 실행 (모든 SELECT에 대해 독립적으로)
      data.forEach((r, idx) => {
        if ((r.columns?.length ?? 0) === 0) return // SELECT가 아니면 스킵

        GetExplain(connId, r.sql)
          .then((rows) => {
            const tab = useConnectionStore.getState().queryTabs.find((t) => t.id === tabId)
            if (!tab) return
            const next = [...tab.explainData]
            next[idx] = { rows, json: next[idx]?.json }
            updateTab(tabId, { explainData: next })
          })
          .catch(() => {})

        GetExplainJSON(connId, r.sql)
          .then((json) => {
            const tab = useConnectionStore.getState().queryTabs.find((t) => t.id === tabId)
            if (!tab) return
            const next = [...tab.explainData]
            next[idx] = { rows: next[idx]?.rows ?? [], json }
            updateTab(tabId, { explainData: next })
          })
          .catch(() => {})
      })

      // DDL 감지 → 스키마 캐시 자동 무효화 (CREATE/DROP/ALTER TABLE·DATABASE 등)
      if (hasDDL(data)) {
        SCHEMA_QUERY_KEYS.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: [key] })
        })
      }

      // 토스트 메시지
      const ms = Math.round(data.reduce((acc, r) => acc + r.duration, 0) / 1_000_000)
      if (data.length === 1) {
        const d = data[0]
        if ((d.columns?.length ?? 0) > 0) {
          toast.success(`${(d.rows?.length ?? 0).toLocaleString()}행 반환 (${ms}ms)`)
        } else {
          toast.success(`${d.affected.toLocaleString()}행 영향 (${ms}ms)`)
        }
      } else if (data.length > 1) {
        const selectCount = data.filter((r) => (r.columns?.length ?? 0) > 0).length
        const dmlCount = data.length - selectCount
        const parts: string[] = []
        if (selectCount > 0) parts.push(`SELECT ×${selectCount}`)
        if (dmlCount > 0) parts.push(`DML ×${dmlCount}`)
        toast.success(`${data.length}개 쿼리 완료 (${parts.join(', ')}) ${ms}ms`)
      }

      // Phase 14-B: 쿼리 실행 완료 시 세션 저장
      persistSession()
    },

    onError: (error, { tabId, sql }) => {
      const elapsedSec = (Date.now() - (startTimesRef.current.get(tabId) ?? Date.now())) / 1000
      startTimesRef.current.delete(tabId)
      const threshold = useSettingsStore.getState().settings.query.notifyThresholdSec
      if (threshold > 0 && elapsedSec >= threshold) {
        ShowNotification('OrcaSQL — 쿼리 실패', error.message ?? '쿼리 실행 실패').catch(() => {})
      }
      updateTab(tabId, {
        isRunning: false,
        queryError: { sql, message: error.message ?? '쿼리 실행 실패' },
      })
      // BugFix-BN: Messages 세션 로그
      logMsg({
        kind: 'query',
        level: 'error',
        title: '쿼리 실행 실패',
        detail: error.message ?? '쿼리 실행 실패',
        sql,
      })
      toast.error(error.message ?? '쿼리 실행 실패')
      // Phase 14-B: 쿼리 실행 실패 시에도 세션 저장 (SQL 내용 보존)
      persistSession()
    },
  })

  return {
    execute: mutation.mutate,
    isPending: mutation.isPending,
    error: mutation.error,
  }
}
