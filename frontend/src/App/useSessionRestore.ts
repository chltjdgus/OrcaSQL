import { useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  GetSavedConnections,
  LoadSession,
  ResetSession,
  GetConnectionWithCredential,
  ConnectNew,
  UpdateConnectionLastUsed,
} from '@/wailsjs/go/main/App'
import { useConnectionStore } from '@/stores/connectionStore'
import { useRestoreStore, type RestoreFailure } from '@/stores/useRestoreStore'
import { logMsg } from '@/stores/useMessagesLogStore'
import { t, type Language } from '@/i18n'
import type { SessionState, ConnectionSessionState } from '@/types'

interface UseSessionRestoreOpts {
  /** toast 메시지 i18n 용 — 마운트 시점 값 캡처(useEffect deps 가 비어있어 초기값만 사용). */
  language: Language
}

/**
 * BugFix-CX: React StrictMode 가 dev 모드에서 useEffect 를 두 번 마운트하므로 init() 이 병렬 2회 실행될 수 있다.
 * 첫 번째 init 의 addActiveConnection 이 store 에 반영되기 전에 두 번째 init 이 findActiveDuplicate 를 통과
 * → 같은 연결로 ConnectNew 가 2회 발사되어 세션 탭이 2개 생기는 회귀가 있었다.
 * 모듈 레벨 플래그(프로세스 1회) 로 init() 의 중복 실행을 차단한다.
 * 프로덕션 빌드에서는 StrictMode 가 effect 를 1회만 발사하지만, 이 가드는 dev 와 production 모두 안전(idempotent).
 */
let _restoreStarted = false

/**
 * 앱 시작 시 1회 실행: 저장된 연결 목록 로드 + 직전 세션 복원 + 자동 재접속 (BugFix-BK).
 *
 * 복원 키 매핑:
 *   - SessionState.activeCfgIds[]  → 자동 재접속 대상 (cfgId 기반, 영구)
 *   - SessionState.perConnection[cfgId] → 그 연결의 탭/SQL/선택 DB
 *   - 매 ConnectNew 호출 시 새 connId 발급 → pendingSessions[newConnId] 로 매핑
 *   - 구버전(activeConnIds, selectedConnId) 은 폴백으로만 사용
 *
 * 본 hook 은 App() 본체에서 분리되어 store/Wails 바인딩/toast/logMsg/RestoreFailure 타입을 모두 캡슐화.
 * 외부에서 받는 의존은 `language` 단 하나 → 호출부 App.tsx 는 useSessionRestore({ language }) 한 줄로 끝.
 */
export function useSessionRestore({ language }: UseSessionRestoreOpts) {
  const setSavedConnections = useConnectionStore((s) => s.setSavedConnections)
  const addActiveConnection = useConnectionStore((s) => s.addActiveConnection)
  const setSelectedConnStore = useConnectionStore((s) => s.setSelectedConn)

  useEffect(() => {
    // BugFix-CX: StrictMode dev 더블 마운트 시 init() 이 2회 병렬 실행되는 것을 차단.
    if (_restoreStarted) return
    _restoreStarted = true

    let savedConfigs: Awaited<ReturnType<typeof GetSavedConnections>> = []

    async function attemptCfgIds(
      cfgIds: string[],
      preferredCfgId: string | null,
    ): Promise<string | null> {
      // 같은 cfgId 가 여러 번 등장할 수 있으므로(=BugFix-BA 복제 탭) 시도 인덱스로 구분.
      let firstSelectedNewConnId: string | null = null
      for (const cfgId of cfgIds) {
        const cfgName = savedConfigs?.find((c) => c.id === cfgId)?.name ?? cfgId
        try {
          const cfg = await GetConnectionWithCredential(cfgId)
          // BugFix-CX: stale state (이전 버전에서 같은 cfgId 가 activeCfgIds 에 두 번 적재됐거나,
          // 서로 다른 cfgId 가 같은 host+port+user 를 가리키는 경우) 의 두 번째 시도부터 건너뛴다.
          // ConnectNew 호출 자체를 생략해 백엔드 연결 풀에 중복 항목이 안 쌓이게 한다.
          const existing = useConnectionStore.getState().findActiveDuplicate(cfg.host, cfg.port, cfg.user)
          if (existing) {
            useConnectionStore.getState()._consumePendingByCfg(cfgId)
            useRestoreStore.setState((state) => ({
              failed: state.failed.filter((f) => f.cfgId !== cfgId),
              succeeded: state.succeeded + 1,
            }))
            logMsg({ kind: 'connection', level: 'info', title: `중복 세션 건너뜀: ${cfg.name}`, detail: `기존 탭(${existing.name}) 으로 통합`, connName: cfg.name })
            if (preferredCfgId && cfg.id === preferredCfgId) {
              firstSelectedNewConnId = existing.id
            } else if (!firstSelectedNewConnId) {
              firstSelectedNewConnId = existing.id
            }
            continue
          }
          const newConnId = await ConnectNew(cfg)
          await UpdateConnectionLastUsed(cfg.id)
          // BugFix-BK: pendingByCfgId 의 데이터를 newConnId 키로 옮김 → _addSession 이 즉시 소비.
          const ps = useConnectionStore.getState().pendingByCfgId[cfgId]
          if (ps) {
            useConnectionStore.setState((state) => ({
              pendingSessions: { ...state.pendingSessions, [newConnId]: ps },
            }))
          }
          addActiveConnection({
            id: newConnId,
            cfgId: cfg.id,
            name: cfg.name,
            host: cfg.host,
            port: cfg.port,
            user: cfg.user,
            database: cfg.database,
            connectedAt: new Date().toISOString(),
          })
          // 성공 → pendingByCfgId 에서 제거 + 진행 store 갱신
          useConnectionStore.getState()._consumePendingByCfg(cfgId)
          useRestoreStore.setState((state) => ({
            failed: state.failed.filter((f) => f.cfgId !== cfgId),
            succeeded: state.succeeded + 1,
          }))
          // BugFix-BN: Messages 세션 로그
          logMsg({ kind: 'connection', level: 'success', title: `연결됨: ${cfg.name}`, connName: cfg.name })
          // 같은 cfgId 가 selectedCfgId 와 일치하면 그 newConnId 를 무조건 선택 (덮어쓰기).
          // 아직 결정된 게 없으면 첫 성공 항목을 임시 선택.
          if (preferredCfgId && cfg.id === preferredCfgId) {
            firstSelectedNewConnId = newConnId
          } else if (!firstSelectedNewConnId) {
            firstSelectedNewConnId = newConnId
          }
        } catch (e) {
          console.warn('auto-reconnect failed', cfgId, e)
          const errMsg = e instanceof Error ? e.message : String(e)
          const item: RestoreFailure = {
            cfgId,
            name: cfgName,
            lastError: errMsg,
          }
          useRestoreStore.getState().markFail(item)
          // BugFix-BN: Messages 세션 로그
          logMsg({ kind: 'connection', level: 'error', title: `연결 실패: ${cfgName}`, detail: errMsg, connName: cfgName })
        }
      }
      return firstSelectedNewConnId
    }

    async function init() {
      try {
        const configs = await GetSavedConnections()
        savedConfigs = configs ?? []
        setSavedConnections(savedConfigs)
      } catch { /* ignore */ }

      let s: SessionState | null = null
      try {
        s = await LoadSession()
      } catch (e) {
        console.error('LoadSession failed', e)
        try {
          await ResetSession()
        } catch { /* best-effort */ }
        toast.error(t('toastSessionRestoreFailed', language))
        return
      }
      if (!s) return

      const perConn = (s.perConnection ?? {}) as Record<string, ConnectionSessionState>

      // BugFix-BK: 신규 포맷(activeCfgIds) 우선, 없으면 deprecated activeConnIds 폴백.
      // 폴백 경우엔 connId == cfgId 로 가정(BugFix-BK 이전 세션 데이터). 키체인 매핑이 없으면 실패.
      const rawCfgIds: string[] = (s.activeCfgIds && s.activeCfgIds.length > 0)
        ? s.activeCfgIds
        : (s.activeConnIds ?? [])
      // BugFix-CX: 이전 버전에서 같은 cfgId 가 activeCfgIds 에 두 번 적재된 stale state 대응 — 배열 자체를 dedup.
      // attemptCfgIds 의 런타임 findActiveDuplicate 와 이중 가드(서로 다른 cfgId → 같은 host+port+user 는 런타임 가드가 처리).
      const cfgIds: string[] = Array.from(new Set(rawCfgIds))
      const preferredCfgId: string | null = s.selectedCfgId || s.selectedConnId || null

      if (cfgIds.length === 0) return

      // BugFix-BK: 모든 perConn 데이터를 pendingByCfgId 에 미리 적재.
      // attemptCfgIds 가 성공한 cfgId 만 _consumePendingByCfg 로 제거 → 실패한 cfgId 의 탭/SQL 데이터는
      // 다음 persistSession 시 perConnection 에 그대로 직렬화되어 보존된다.
      useConnectionStore.getState().setPendingByCfgId({ ...perConn })

      // 진행 store 초기화 + 재시도 함수 등록
      useRestoreStore.getState().start(cfgIds.length)
      useRestoreStore.getState().setRetryFn(async () => {
        // 현재 failed[] 만 다시 시도. attemptCfgIds 가 성공/실패에 따라 store 를 직접 갱신.
        const targets = useRestoreStore.getState().failed.map((f) => f.cfgId)
        const newSelected = await attemptCfgIds(targets, preferredCfgId)
        // 첫 성공 항목으로 selectedConn 업데이트(없으면 그대로 유지)
        if (newSelected && !useConnectionStore.getState().selectedConnId) {
          setSelectedConnStore(newSelected)
        }
      })

      const selectedNewConnId = await attemptCfgIds(cfgIds, preferredCfgId)

      if (selectedNewConnId) {
        setSelectedConnStore(selectedNewConnId)
      }

      // 1차 시도 종료 — 실패가 있으면 5초 후 자동 재시도, 없으면 done
      useRestoreStore.getState().finishFirstPass()

      // 모두 성공한 경우 잠시 표시한 후 idle 로
      if (useRestoreStore.getState().phase === 'done') {
        setTimeout(() => useRestoreStore.getState().finish(), 1500)
      }
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
