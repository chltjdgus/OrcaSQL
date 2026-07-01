import { QueryClient } from '@tanstack/react-query'

/**
 * Phase 61 — 세션 단위 데이터 캐싱.
 *
 * 한 번 가져온 스키마/테이블 메타/테이블 데이터는 **연결 세션이 살아있는 동안** 캐시에
 * 그대로 유지한다. 자동 재조회를 유발하는 모든 축을 끈다:
 *   - `staleTime: Infinity`           → 시간 경과로 stale 되지 않음 (mount 시 자동 refetch 안 함)
 *   - `gcTime: Infinity`              → 컴포넌트 unmount(탭/테이블 전환)로 캐시가 GC 되지 않음
 *   - `refetchOnWindowFocus: false`   → WebView 포커스 변화로 재조회 안 함
 *   - `refetchOnReconnect: false`     → 네트워크 online 이벤트로 재조회 안 함
 *
 * **새 데이터를 가져오는 경로는 오직 셋뿐:**
 *   1) 명시적 새로고침 — SchemaTree F5/메뉴(`schema:refresh`), 테이블 Data 탭 새로고침 버튼,
 *      디자이너 reload → `invalidateQueries` / `refetch` (active observer 즉시 재조회,
 *      inactive 는 다음 mount 시 재조회)
 *   2) 새 연결 — 모든 연결-스코프 키가 `[도메인, connId, ...]` 이고 `ConnectNew` 가 매번 새
 *      connId(UUID)를 발급하므로, 새 연결은 자연히 캐시 미스 → 최초 fetch
 *   3) DDL 감지 — `useQueryExec` 가 CREATE/ALTER/DROP 실행 후 스키마 캐시를 invalidate
 *
 * 연결 해제 시 `clearConnectionCache(connId)` 로 그 연결의 모든 캐시를 제거해 메모리를 회수한다
 * (`gcTime: Infinity` 라 명시적 제거가 없으면 누적되므로 필수).
 *
 * 짧은 주기 갱신이 필요한 쿼리(ServerVars 5~10s, QueryHistory 검색 0, ProcessList 수동 등)는
 * 각 사용처에서 `staleTime` 을 명시적으로 override 하므로 이 기본값의 영향을 받지 않는다.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
})

/**
 * 연결(connId) 단위로 캐시를 제거한다 — 연결 해제 시 호출.
 *
 * 모든 연결-스코프 쿼리 키는 `[도메인, connId, ...]` 형태(예: `['tables', connId, db]`,
 * `['tableMeta', connId, db, table]`, `['server-variables', connId, scope]`)라 키의
 * 2번째 요소(`queryKey[1]`)가 connId 와 일치하는 쿼리를 일괄 제거한다.
 * 도메인-전역 키(`['favorites']`, `['historyDates']` 등)는 `queryKey[1]` 이 connId 가 아니므로
 * 영향받지 않는다.
 */
export function clearConnectionCache(connId: string): void {
  queryClient.removeQueries({
    predicate: (q) => q.queryKey[1] === connId,
  })
}
