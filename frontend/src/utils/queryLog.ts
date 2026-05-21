/**
 * BugFix-CW — Messages·History 일관성 통합 헬퍼.
 *
 * `useQueryExec` (에디터 F9) 경로 외의 모든 DB 호출 — 테이블 데이터 로드·정렬·
 * 필터·페이지 이동·새로고침·인라인 UPDATE·INSERT·DELETE·TRUNCATE·DROP — 가
 * 동일하게 Messages 영역에 누적되고, History 에도 영구 기록되도록 보장.
 *
 * 두 가지 API:
 *   - `runLoggedQuery` : `ExecuteQuery` 를 wrap. Go 측이 자동으로 history 에 저장하므로
 *                        프런트는 Messages 로그만 추가.
 *   - `recordEditOp`   : `UpdateRowValue`/`InsertRow` 처럼 `ExecuteQuery` 우회 경로용.
 *                        Messages 에 누적 + `RecordHistoryEntry` 로 history 영구 저장.
 *
 * 양쪽 모두 호출자가 사용자 의도를 짧게 설명하는 `sourceLabel` 을 넘기면
 * Messages title 에 prefix 로 표시된다 (예: "테이블 데이터 로드 — 23 row(s) returned").
 */

import { ExecuteQuery, RecordHistoryEntry } from '@/wailsjs/go/main/App'
import { logMsg } from '@/stores/useMessagesLogStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import type { QueryResult } from '@/types'

/** connId → connection name lookup (active connections 스냅샷). */
function connNameOf(connId: string): string {
  return useConnectionStore.getState().activeConnections.find((c) => c.id === connId)?.name ?? ''
}

interface RunLoggedOpts {
  connId: string
  database: string
  sql: string
  /** 사람이 읽을 수 있는 작업 라벨 (이미 i18n 처리된 문자열). 예: "테이블 데이터 로드" */
  sourceLabel?: string
}

/**
 * `ExecuteQuery` wrapper.
 * 성공·실패 모두 Messages 영역에 entry 를 누적. History 는 Go 측이 자동 저장하므로
 * 별도 호출 불필요.
 */
export async function runLoggedQuery({ connId, database, sql, sourceLabel }: RunLoggedOpts): Promise<QueryResult> {
  const language = useLanguageStore.getState().language
  const connName = connNameOf(connId)
  const start = Date.now()
  try {
    const result = await ExecuteQuery(connId, connName, database, sql)
    const durationMs = Date.now() - start
    const isSelect = (result.columns?.length ?? 0) > 0
    const rows = result.rows?.length ?? 0
    const baseTitle = isSelect
      ? `${rows.toLocaleString()} ${t('msgRowsReturned', language)}`
      : `${t('msgQueryOk', language)}, ${result.affected.toLocaleString()} ${t('msgRowsAffected', language)}`
    logMsg({
      kind: 'query',
      level: 'success',
      title: sourceLabel ? `${sourceLabel} — ${baseTitle}` : baseTitle,
      sql,
      rows: isSelect ? rows : undefined,
      affected: isSelect ? undefined : result.affected,
      durationMs,
    })
    return result
  } catch (err) {
    const durationMs = Date.now() - start
    const msg = err instanceof Error ? err.message : String(err)
    logMsg({
      kind: 'query',
      level: 'error',
      title: sourceLabel
        ? `${sourceLabel} ${t('msgQueryFailedSuffix', language)}`
        : t('msgQueryFailed', language),
      detail: msg,
      sql,
      durationMs,
    })
    throw err
  }
}

interface RecordEditOpts {
  connId: string
  database: string
  /** 사용자에게 보여줄 SQL — UPDATE/INSERT 등 실제 실행된 statement 와 동등한 문자열 */
  sql: string
  sourceLabel: string
  /** 성공 시 영향받은 행 수 (없으면 1 가정) */
  affected?: number
  /** 측정된 실행 시간 (ms) */
  durationMs: number
  /** 실패 시 에러 메시지 */
  errorMsg?: string
}

/**
 * `ExecuteQuery` 를 거치지 않는 경로(`UpdateRowValue`/`InsertRow`)의 결과를
 * Messages 와 History 양쪽에 기록.
 *
 * 호출자 책임:
 *   1. 실제 DB 호출은 별도로 수행 (await Update/InsertRow ...)
 *   2. 성공·실패 직후 본 함수 호출
 */
export function recordEditOp(opts: RecordEditOpts): void {
  const language = useLanguageStore.getState().language
  const connName = connNameOf(opts.connId)
  const ok = !opts.errorMsg
  const affected = opts.affected ?? (ok ? 1 : 0)

  // 1) Messages
  logMsg({
    kind: 'query',
    level: ok ? 'success' : 'error',
    title: ok
      ? `${opts.sourceLabel} — ${t('msgQueryOk', language)}, ${affected.toLocaleString()} ${t('msgRowsAffected', language)}`
      : `${opts.sourceLabel} ${t('msgQueryFailedSuffix', language)}`,
    sql: opts.sql,
    detail: ok ? undefined : opts.errorMsg,
    affected: ok ? affected : undefined,
    durationMs: opts.durationMs,
  })

  // 2) History — Go 가 자동 저장하지 않는 경로 (UpdateRowValue/InsertRow) 만 명시 호출
  // duration 필드는 time.Duration(나노초) 호환 정수
  RecordHistoryEntry({
    id: '',
    sql: opts.sql,
    connName,
    database: opts.database,
    executedAt: new Date().toISOString(),
    duration: opts.durationMs * 1_000_000,
    rowCount: 0,
    affected,
    hasError: !ok,
    errorMsg: opts.errorMsg,
    source: 'ui',
  }).catch(() => {
    // history 저장 실패는 사용자 흐름 차단하지 않음 (Messages 에는 이미 기록됨)
  })
}
