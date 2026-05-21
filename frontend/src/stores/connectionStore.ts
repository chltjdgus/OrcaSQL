import { create } from 'zustand'
import type {
  ConnectConfig,
  ConnectionInfo,
  QueryTab,
  ConnectionSession,
  SessionGroup,
  ConnectionSessionState,
  SessionState,
  TabState,
} from '@/types'
import { SaveSession } from '@/wailsjs/go/main/App'
import { t } from '@/i18n'
import { useLanguageStore } from '@/stores/useLanguageStore'

/** persistSession 디바운스 타이머 — 연속 호출을 300ms 단위로 묶어 IPC 횟수 최소화 */
let _persistTimer: ReturnType<typeof setTimeout> | null = null

interface ConnectionStore {
  // ─── 저장된 연결 설정 (로컬 파일에서 로드) ───────────────────────────
  savedConnections: ConnectConfig[]
  setSavedConnections: (configs: ConnectConfig[]) => void
  addOrUpdateSavedConnection: (cfg: ConnectConfig) => void
  removeSavedConnection: (id: string) => void

  // ─── 연결 그룹 ────────────────────────────────────────────────────────
  groups: SessionGroup[]
  setGroups: (groups: SessionGroup[]) => void
  addOrUpdateGroup: (grp: SessionGroup) => void
  removeGroup: (id: string) => void

  // ─── 활성 연결 (실제 DB 연결된 상태) ────────────────────────────────
  activeConnections: ConnectionInfo[]
  setActiveConnections: (conns: ConnectionInfo[]) => void
  addActiveConnection: (conn: ConnectionInfo) => void
  removeActiveConnection: (id: string) => void

  /**
   * BugFix-CX: 같은 창 내 중복 세션 방지.
   * host + port + user 가 모두 일치하는 기존 활성 연결을 반환 (없으면 null).
   * 같은 MySQL 엔드포인트·동일 사용자 = 같은 서버 세션으로 간주 → 한 창에서 한 번만 열림.
   * 호출자는 ConnectNew 호출 전에 검사해 백엔드 자원 낭비를 피해야 한다.
   */
  findActiveDuplicate: (host: string, port: number, user: string) => ConnectionInfo | null

  // ─── 현재 선택된 연결/DB ─────────────────────────────────────────────
  selectedConnId: string | null
  selectedDatabase: string | null
  setSelectedConn: (id: string | null) => void
  setSelectedDatabase: (db: string | null) => void

  // ─── 연결 세션 (Phase 7-B: 연결별 독립 워크스페이스) ────────────────
  sessions: ConnectionSession[]
  activeSessionId: string | null
  /** 세션을 전환한다. 현재 세션 상태를 저장하고 새 세션 상태를 로드한다. */
  setActiveSession: (sessionId: string | null) => void
  /** 내부 전용: addActiveConnection에서 자동 호출 */
  _addSession: (conn: ConnectionInfo) => void
  /** 내부 전용: removeActiveConnection에서 자동 호출 */
  _removeSession: (connId: string) => void

  // ─── 쿼리 탭 관리 (활성 세션에 반영됨) ─────────────────────────────
  queryTabs: QueryTab[]
  activeTabId: string | null
  addTab: (connId?: string | null, database?: string | null, sql?: string) => string
  closeTab: (tabId: string) => void
  /** 첫 탭을 제외한 모든 탭을 닫는다 — 첫 탭은 항상 유지. */
  closeAllTabs: () => void
  /** 지정한 탭의 오른쪽에 있는 모든 탭을 닫는다. */
  closeTabsToRight: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateTab: (tabId: string, updates: Partial<QueryTab>) => void

  // ─── Phase 14 세션 복원/저장 ──────────────────────────────────────────
  /**
   * 14-D: 재접속 후 _addSession 에서 1회 적용되는 연결별 세션 (key = newConnId).
   * App.tsx 가 cfgId → newConnId 매핑 후 setState 로 직접 등록 → addActiveConnection
   * 직후 _addSession 이 즉시 소비/제거하므로 사실상 휘발성.
   */
  pendingSessions: Record<string, ConnectionSessionState>
  setPendingSessions: (map: Record<string, ConnectionSessionState>) => void

  /**
   * BugFix-BK: 첫 시도에서 재접속 실패 → 활성 연결에 들어가지 않은 cfgId 의 세션 데이터.
   * 다음 persistSession 호출 시 perConnection 에 함께 직렬화되어야 데이터 손실이 없다.
   * 키 = cfgId (영구). 사용자가 재시도해 성공하면 _consumePendingByCfg 가 제거.
   */
  pendingByCfgId: Record<string, ConnectionSessionState>
  setPendingByCfgId: (map: Record<string, ConnectionSessionState>) => void
  /** cfgId 의 항목을 제거 (재시도 성공 시 호출). */
  _consumePendingByCfg: (cfgId: string) => void

  /** 14-B: 현재 store 상태를 SessionState 로 직렬화해 Go SaveSession 호출. (300ms debounce) */
  persistSession: () => void
  /** beforeunload 등 즉시 저장이 필요한 경우 — 대기 중인 debounce 타이머를 취소하고 즉시 실행. */
  flushSession: () => void
}

let tabCounter = 1

/**
 * BugFix-BR: 다음 "쿼리 N" 번호는 **현재 세션의 기존 탭** 만 보고 정한다.
 * - 종전엔 module-level tabCounter 가 모든 세션을 가로질러 단조증가 → DB 탭(=세션) 마다
 *   1·2·3 으로 시작하지 않고 "쿼리 5", "쿼리 7" 같이 전역 일련번호가 노출되었음.
 * - ko("쿼리")·en("Query") 두 prefix 모두 매칭해서 언어 전환 후에도 안전.
 */
export function nextQueryTitle(existing: QueryTab[]): string {
  const lang = useLanguageStore.getState().language
  const prefixCurrent = t('defaultQueryTab', lang)
  const prefixes = ['쿼리', 'Query']
  const re = new RegExp(`^(?:${prefixes.join('|')})\\s+(\\d+)$`)
  let max = 0
  for (const tab of existing) {
    const m = re.exec(tab.title)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefixCurrent} ${max + 1}`
}

function newTab(
  connId?: string | null,
  database?: string | null,
  sql?: string,
  existing: QueryTab[] = [],
): QueryTab {
  const id = `tab-${Date.now()}-${tabCounter++}`
  return {
    id,
    title: nextQueryTitle(existing),
    sql: sql ?? '',
    connId: connId ?? null,
    database: database ?? null,
    result: null,
    results: [],
    explainData: [],
    isRunning: false,
  }
}

/** 활성 세션 상태를 root 레벨로 로드한다. */
function loadSessionToRoot(sessions: ConnectionSession[], sessionId: string | null): {
  queryTabs: QueryTab[]
  activeTabId: string | null
  selectedDatabase: string | null
} {
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) {
    const fallback = newTab()
    return { queryTabs: [fallback], activeTabId: fallback.id, selectedDatabase: null }
  }
  return {
    queryTabs: session.tabs,
    activeTabId: session.activeTabId,
    selectedDatabase: session.selectedDatabase,
  }
}

/** 현재 root 상태를 activeSessionId 세션에 저장한다. */
function saveRootToSession(
  sessions: ConnectionSession[],
  activeSessionId: string | null,
  queryTabs: QueryTab[],
  activeTabId: string | null,
  selectedDatabase: string | null,
): ConnectionSession[] {
  if (!activeSessionId) return sessions
  return sessions.map((s) =>
    s.id === activeSessionId ? { ...s, tabs: queryTabs, activeTabId, selectedDatabase } : s,
  )
}

/**
 * Phase 14-A: 저장된 ConnectionSessionState (Go) 를 frontend QueryTab[] 로 변환.
 * tabs 가 없거나 비어있으면 빈 기본 탭 1개를 만든다.
 */
function tabsFromPersisted(
  persisted: ConnectionSessionState | undefined,
  connId: string,
): { tabs: QueryTab[]; activeTabId: string } {
  const persistedTabs = persisted?.tabs ?? []
  if (persistedTabs.length === 0) {
    const fallback = newTab(connId, persisted?.selectedDatabase ?? null)
    return { tabs: [fallback], activeTabId: fallback.id }
  }
  // BugFix-BR: 복원 중 title 누락 시에도 같은 세션 내 누적 탭 기준으로 번호 산정.
  const tabs: QueryTab[] = []
  for (const tab of persistedTabs) {
    tabs.push({
      id: tab.id || `tab-${Date.now()}-${tabCounter++}`,
      title: tab.title || nextQueryTitle(tabs),
      sql: tab.sql ?? '',
      connId: tab.connId || connId,
      database: tab.database || persisted?.selectedDatabase || null,
      result: null,
      results: [],
      explainData: [],
      isRunning: false,
    })
  }
  const activeTabId =
    persisted?.activeTabId && tabs.some((tab) => tab.id === persisted.activeTabId)
      ? persisted.activeTabId
      : tabs[0].id
  return { tabs, activeTabId }
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  // ─── 저장된 연결 설정 ────────────────────────────────────────────────
  savedConnections: [],
  setSavedConnections: (configs) => set({ savedConnections: configs }),
  addOrUpdateSavedConnection: (cfg) =>
    set((state) => {
      const exists = state.savedConnections.some((c) => c.id === cfg.id)
      return {
        savedConnections: exists
          ? state.savedConnections.map((c) => (c.id === cfg.id ? cfg : c))
          : [...state.savedConnections, cfg],
      }
    }),
  removeSavedConnection: (id) =>
    set((state) => ({
      savedConnections: state.savedConnections.filter((c) => c.id !== id),
    })),

  // ─── 연결 그룹 ───────────────────────────────────────────────────────
  groups: [],
  setGroups: (groups) => set({ groups }),
  addOrUpdateGroup: (grp) =>
    set((state) => {
      const exists = state.groups.some((g) => g.id === grp.id)
      return {
        groups: exists
          ? state.groups.map((g) => (g.id === grp.id ? grp : g))
          : [...state.groups, grp],
      }
    }),
  removeGroup: (id) =>
    set((state) => ({ groups: state.groups.filter((g) => g.id !== id) })),

  // ─── 활성 연결 ───────────────────────────────────────────────────────
  activeConnections: [],
  setActiveConnections: (conns) => set({ activeConnections: conns }),
  addActiveConnection: (conn) => {
    set((state) => ({
      activeConnections: [...state.activeConnections.filter((c) => c.id !== conn.id), conn],
    }))
    get()._addSession(conn)
    // Phase 14-B: 연결 추가 시 즉시 저장
    get().persistSession()
  },
  removeActiveConnection: (id) => {
    set((state) => ({
      activeConnections: state.activeConnections.filter((c) => c.id !== id),
    }))
    get()._removeSession(id)
    // Phase 14-B: 연결 해제 시 즉시 저장
    get().persistSession()
  },

  // BugFix-CX: host+port+user 키로 활성 연결 중복 탐지.
  findActiveDuplicate: (host, port, user) => {
    return get().activeConnections.find(
      (c) => c.host === host && c.port === port && c.user === user,
    ) ?? null
  },

  // ─── 현재 선택된 연결/DB ─────────────────────────────────────────────
  selectedConnId: null,
  selectedDatabase: null,
  setSelectedConn: (id) => {
    set({ selectedConnId: id })
    if (id) {
      const { sessions } = get()
      const session = sessions.find((s) => s.connId === id)
      if (session) get().setActiveSession(session.id)
    }
    // Phase 14-B: 연결 탭 전환 시 즉시 저장
    get().persistSession()
  },
  setSelectedDatabase: (db) => {
    set({ selectedDatabase: db })
    // 세션에도 현재 DB 저장
    const { sessions, activeSessionId, queryTabs, activeTabId } = get()
    set({
      sessions: saveRootToSession(sessions, activeSessionId, queryTabs, activeTabId, db),
    })
    // Phase 14-B: 스키마 트리에서 DB 선택 시 즉시 저장
    get().persistSession()
  },

  // ─── 연결 세션 ───────────────────────────────────────────────────────
  sessions: [],
  activeSessionId: null,

  setActiveSession: (sessionId) => {
    set((state) => {
      // 현재 세션에 root 상태 저장
      const savedSessions = saveRootToSession(
        state.sessions,
        state.activeSessionId,
        state.queryTabs,
        state.activeTabId,
        state.selectedDatabase,
      )
      // 새 세션 상태 로드
      const { queryTabs, activeTabId, selectedDatabase } = loadSessionToRoot(savedSessions, sessionId)
      const newSession = savedSessions.find((s) => s.id === sessionId)
      return {
        sessions: savedSessions,
        activeSessionId: sessionId,
        queryTabs,
        activeTabId,
        selectedConnId: newSession?.connId ?? state.selectedConnId,
        selectedDatabase,
      }
    })
    // Phase 14-B: 연결 탭 전환 시 즉시 저장
    get().persistSession()
  },

  _addSession: (conn) =>
    set((state) => {
      // 이미 존재하면 활성화만
      if (state.sessions.find((s) => s.id === conn.id)) {
        const savedSessions = saveRootToSession(
          state.sessions,
          state.activeSessionId,
          state.queryTabs,
          state.activeTabId,
          state.selectedDatabase,
        )
        const { queryTabs, activeTabId, selectedDatabase } = loadSessionToRoot(savedSessions, conn.id)
        return {
          sessions: savedSessions,
          activeSessionId: conn.id,
          queryTabs,
          activeTabId,
          selectedConnId: conn.id,
          selectedDatabase,
        }
      }

      // Phase 14-D: 보류 중인 세션 상태가 있으면 그것으로 복원, 없으면 빈 기본 탭
      const pending = state.pendingSessions[conn.id]
      const { tabs: initialTabs, activeTabId: initialActiveTabId } = tabsFromPersisted(pending, conn.id)
      const initialSelectedDb = pending?.selectedDatabase ?? null

      const newSession: ConnectionSession = {
        id: conn.id,
        connId: conn.id,
        name: conn.name,
        host: conn.host,
        tabs: initialTabs,
        activeTabId: initialActiveTabId,
        selectedDatabase: initialSelectedDb,
      }

      // 현재 세션 저장 후 새 세션 추가
      const savedSessions = saveRootToSession(
        [...state.sessions, newSession],
        state.activeSessionId,
        state.queryTabs,
        state.activeTabId,
        state.selectedDatabase,
      )

      // pending 소비 (1회 적용 후 제거)
      const nextPending = { ...state.pendingSessions }
      if (pending) delete nextPending[conn.id]

      return {
        sessions: savedSessions,
        activeSessionId: conn.id,
        queryTabs: newSession.tabs,
        activeTabId: newSession.activeTabId,
        selectedConnId: conn.id,
        selectedDatabase: initialSelectedDb,
        pendingSessions: nextPending,
      }
    }),

  _removeSession: (connId) =>
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== connId)
      const wasActive = state.activeSessionId === connId

      if (!wasActive) {
        return { sessions: remaining }
      }

      // 삭제된 세션이 활성이었으면 마지막 세션으로 이동
      const next = remaining[remaining.length - 1] ?? null
      const { queryTabs, activeTabId, selectedDatabase } = loadSessionToRoot(remaining, next?.id ?? null)
      return {
        sessions: remaining,
        activeSessionId: next?.id ?? null,
        queryTabs,
        activeTabId,
        selectedConnId: next?.connId ?? null,
        selectedDatabase,
      }
    }),

  // ─── 쿼리 탭 관리 ────────────────────────────────────────────────────
  queryTabs: (() => { const t = newTab(); return [t] })(),
  activeTabId: null,

  addTab: (connId, database, sql) => {
    const state = get()
    const effectiveConnId = connId ?? state.selectedConnId
    // BugFix-BR: 같은 세션 내 기존 탭만 보고 다음 번호 산정 (탭 간 중복 방지, 세션 간 독립).
    const tab = newTab(effectiveConnId, database, sql, state.queryTabs)
    const newTabs = [...state.queryTabs, tab]
    const updatedSessions = saveRootToSession(
      state.sessions, state.activeSessionId, newTabs, tab.id, state.selectedDatabase,
    )
    set({ queryTabs: newTabs, activeTabId: tab.id, sessions: updatedSessions })
    return tab.id
  },

  closeTab: (tabId) =>
    set((state) => {
      const remaining = state.queryTabs.filter((t) => t.id !== tabId)
      const newActive =
        state.activeTabId === tabId
          ? (remaining[remaining.length - 1]?.id ?? null)
          : state.activeTabId
      const finalTabs = remaining.length > 0 ? remaining : [newTab(state.selectedConnId)]
      const finalActive = newActive ?? finalTabs[0].id
      const updatedSessions = saveRootToSession(
        state.sessions, state.activeSessionId, finalTabs, finalActive, state.selectedDatabase,
      )
      return { queryTabs: finalTabs, activeTabId: finalActive, sessions: updatedSessions }
    }),

  closeAllTabs: () =>
    set((state) => {
      // 첫 탭은 항상 유지 (첫 탭은 닫을 수 없음)
      if (state.queryTabs.length <= 1) return state
      const finalTabs = [state.queryTabs[0]]
      const finalActive = finalTabs[0].id
      const updatedSessions = saveRootToSession(
        state.sessions, state.activeSessionId, finalTabs, finalActive, state.selectedDatabase,
      )
      return { queryTabs: finalTabs, activeTabId: finalActive, sessions: updatedSessions }
    }),

  closeTabsToRight: (tabId) =>
    set((state) => {
      const idx = state.queryTabs.findIndex((t) => t.id === tabId)
      if (idx === -1 || idx === state.queryTabs.length - 1) return state
      const finalTabs = state.queryTabs.slice(0, idx + 1)
      const stillExists = finalTabs.some((t) => t.id === state.activeTabId)
      const finalActive = stillExists ? state.activeTabId : tabId
      const updatedSessions = saveRootToSession(
        state.sessions, state.activeSessionId, finalTabs, finalActive, state.selectedDatabase,
      )
      return { queryTabs: finalTabs, activeTabId: finalActive, sessions: updatedSessions }
    }),

  setActiveTab: (tabId) =>
    set((state) => {
      const updatedSessions = saveRootToSession(
        state.sessions, state.activeSessionId, state.queryTabs, tabId, state.selectedDatabase,
      )
      return { activeTabId: tabId, sessions: updatedSessions }
    }),

  updateTab: (tabId, updates) =>
    set((state) => {
      const newTabs = state.queryTabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t))
      const updatedSessions = saveRootToSession(
        state.sessions, state.activeSessionId, newTabs, state.activeTabId, state.selectedDatabase,
      )
      return { queryTabs: newTabs, sessions: updatedSessions }
    }),

  // ─── Phase 14 세션 복원/저장 ──────────────────────────────────────────
  pendingSessions: {},
  setPendingSessions: (map) => set({ pendingSessions: map }),

  // BugFix-BK
  pendingByCfgId: {},
  setPendingByCfgId: (map) => set({ pendingByCfgId: map }),
  _consumePendingByCfg: (cfgId) =>
    set((state) => {
      if (!(cfgId in state.pendingByCfgId)) return state
      const next = { ...state.pendingByCfgId }
      delete next[cfgId]
      return { pendingByCfgId: next }
    }),

  persistSession: () => {
    // 300ms 디바운스: 연속 클릭/상태 변경을 묶어 IPC 호출 최소화
    if (_persistTimer !== null) clearTimeout(_persistTimer)
    _persistTimer = setTimeout(() => {
      _persistTimer = null
      _doSave(get)
    }, 300)
  },
  flushSession: () => {
    // 대기 중인 타이머를 취소하고 즉시 저장 (beforeunload 등 긴급 저장용)
    if (_persistTimer !== null) {
      clearTimeout(_persistTimer)
      _persistTimer = null
    }
    _doSave(get)
  },
}))

function _doSave(get: () => ConnectionStore) {
    const state = get()
    // 현재 active session 의 root 상태를 sessions[] 에 동기화
    const syncedSessions = saveRootToSession(
      state.sessions,
      state.activeSessionId,
      state.queryTabs,
      state.activeTabId,
      state.selectedDatabase,
    )

    // BugFix-BK: 활성 connId → cfgId 매핑
    // ConnectNew 가 매번 새 UUID 를 발급하므로 connId 는 휘발성. cfgId 만 영구.
    const connIdToCfgId = new Map<string, string>()
    for (const conn of state.activeConnections) {
      if (conn.cfgId) connIdToCfgId.set(conn.id, conn.cfgId)
    }

    // 각 ConnectionSession → ConnectionSessionState 직렬화 (key = cfgId).
    // 같은 cfgId 가 여러 활성 connId 에 매핑된 경우(=BugFix-BA 의 복제 탭) 마지막 항목이 우선
    // (간단화 — 복제 탭의 별도 보존은 후속 과제로 분리).
    const perConnection: Record<string, ConnectionSessionState> = {}
    for (const sess of syncedSessions) {
      const cfgId = connIdToCfgId.get(sess.connId)
      if (!cfgId) continue   // 휘발 connId 만 갖는 세션은 직렬화 불가 (정상 흐름에서는 발생하지 않음)
      const tabs: TabState[] = sess.tabs.map((t) => ({
        id: t.id,
        title: t.title,
        sql: t.sql,
        connId: t.connId ?? '',
        connName: state.activeConnections.find((c) => c.id === t.connId)?.name ?? '',
        database: t.database ?? '',
        isActive: t.id === sess.activeTabId,
      }))
      perConnection[cfgId] = {
        tabs,
        activeTabId: sess.activeTabId ?? '',
        selectedDatabase: sess.selectedDatabase ?? '',
      }
    }

    // BugFix-BK: 첫 시도/재시도에서 재접속 실패한 cfgId 의 세션 데이터는 pendingByCfgId 에 보관됨.
    // 활성 연결에 들어가지 않아 perConnection 에 누락되므로, 여기서 머지해 직렬화에 포함.
    // 같은 cfgId 가 활성 연결에도 있고 pendingByCfgId 에도 있으면 활성 연결의 최신 상태가 우선.
    for (const [cfgId, ps] of Object.entries(state.pendingByCfgId)) {
      if (!perConnection[cfgId]) {
        perConnection[cfgId] = ps
      }
    }

    // BugFix-BK: 다음 종료 시 자동 재접속 대상 = 활성 cfgId + 미해결 pending cfgId 합집합.
    // 사용자가 partial 상태에서 그냥 앱을 닫아도 다음 실행 시 모든 연결을 다시 시도한다.
    const activeCfgIds = state.activeConnections
      .map((c) => c.cfgId)
      .filter((id): id is string => !!id)
    const allCfgIds = [...activeCfgIds]
    for (const cfgId of Object.keys(state.pendingByCfgId)) {
      if (!allCfgIds.includes(cfgId)) allCfgIds.push(cfgId)
    }
    const selectedCfgId = state.selectedConnId
      ? state.activeConnections.find((c) => c.id === state.selectedConnId)?.cfgId ?? ''
      : ''

    const session: SessionState = {
      savedAt: new Date().toISOString(),
      perConnection,
      activeCfgIds: allCfgIds,
      selectedCfgId,
    }

    // fire-and-forget — 저장 실패해도 UI 는 진행
    SaveSession(session).catch((e) => console.error('persistSession failed', e))
}

// 초기 activeTabId 설정
useConnectionStore.setState((state) => ({
  activeTabId: state.queryTabs[0]?.id ?? null,
}))
