import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Plug, Settings as SettingsIcon, Activity, AlertTriangle, X } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  PingWithLatency, Reconnect,
  GetMCPStatus, GetMCPConfig, StartMCPServer, StopMCPServer, TestMCPConnection,
  type MCPStatus,
} from '@/wailsjs/go/main/App'
import { useConnectionStore } from '@/stores/connectionStore'
import { useRestoreStore } from '@/stores/useRestoreStore'
import { useThemeStore } from '@/stores/useThemeStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'

type PingStatus = 'ok' | 'slow' | 'dead' | 'idle'

const PING_INTERVAL_MS = 30_000  // 30초마다 자동 ping
const SLOW_THRESHOLD_MS = 300    // 300ms 이상이면 "느림"
const MCP_POLL_INTERVAL_MS = 5_000

interface Props {
  /** Settings 다이얼로그를 (선택적으로 특정 탭으로) 연다. MCP 인디케이터 팝업의 "환경설정" 액션에서 호출. */
  onOpenSettings?: (tab?: string) => void
}

/**
 * 하단 상태바: 활성 연결·DB·핑 상태·쿼리 결과 요약·MCP 서버 상태를 표시한다.
 *
 * 핑 주기: 활성 연결이 있을 때 30초마다 자동으로 PingWithLatency를 호출한다.
 * 재연결 버튼: 핑 실패(dead) 상태이거나 statusDot 옆 버튼을 누르면 Reconnect를 시도한다.
 * MCP 인디케이터: 활성화된 경우만 노출, 클릭 시 위쪽으로 팝업 메뉴 (재시작·테스트·환경설정).
 */
export default function StatusBar({ onOpenSettings }: Props) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { language } = useLanguageStore()

  const { activeConnections, selectedConnId, selectedDatabase, queryTabs, activeTabId, savedConnections } =
    useConnectionStore()

  const activeConn = activeConnections.find((c) => c.id === selectedConnId)
  const connColor = selectedConnId
    ? savedConnections.find((c) => c.id === selectedConnId)?.color
    : undefined
  const activeTab = queryTabs.find((t) => t.id === activeTabId)

  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [pingStatus, setPingStatus] = useState<PingStatus>('idle')
  const [isReconnecting, setIsReconnecting] = useState(false)
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // MCP 상태 — Config.enabled 가 true 일 때만 인디케이터 노출.
  const [mcpEnabled, setMcpEnabled] = useState(false)
  const [mcpStatus, setMcpStatus] = useState<MCPStatus>({ running: false, port: 0, endpoint: '' })
  const [mcpMenuOpen, setMcpMenuOpen] = useState(false)
  const [mcpBusy, setMcpBusy] = useState(false)
  const mcpAnchorRef = useRef<HTMLButtonElement | null>(null)
  const mcpMenuRef = useRef<HTMLDivElement | null>(null)

  const doPing = useCallback(async (connId: string) => {
    try {
      const ms = await PingWithLatency(connId)
      setLatencyMs(ms)
      setPingStatus(ms >= SLOW_THRESHOLD_MS ? 'slow' : 'ok')
    } catch {
      setLatencyMs(null)
      setPingStatus('dead')
    }
  }, [])

  // 연결이 바뀌거나 생길 때 즉시 ping + 주기 설정
  useEffect(() => {
    if (pingTimerRef.current) clearInterval(pingTimerRef.current)
    setLatencyMs(null)
    setPingStatus('idle')

    if (!selectedConnId) return

    void doPing(selectedConnId)
    pingTimerRef.current = setInterval(() => {
      void doPing(selectedConnId)
    }, PING_INTERVAL_MS)

    return () => {
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
    }
  }, [selectedConnId, doPing])

  // MCP enabled / status 폴링
  const refreshMcp = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([GetMCPConfig(), GetMCPStatus()])
      setMcpEnabled(c.enabled)
      setMcpStatus(s)
    } catch {
      /* 무시 — 백엔드가 아직 준비 안 됐을 수 있음 */
    }
  }, [])

  useEffect(() => {
    void refreshMcp()
    const id = window.setInterval(refreshMcp, MCP_POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [refreshMcp])

  // 메뉴 외부 클릭 / Esc 시 닫기
  useEffect(() => {
    if (!mcpMenuOpen) return
    const handlePointer = (e: MouseEvent) => {
      const tgt = e.target as Node
      if (mcpMenuRef.current?.contains(tgt) || mcpAnchorRef.current?.contains(tgt)) return
      setMcpMenuOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMcpMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [mcpMenuOpen])

  async function handleReconnect() {
    if (!selectedConnId || isReconnecting) return
    setIsReconnecting(true)
    setPingStatus('idle')
    try {
      await Reconnect(selectedConnId)
      toast.success(t('toastReconnectOk', language))
      await doPing(selectedConnId)
    } catch (e) {
      toast.error(`${t('toastReconnectFail', language)} ${e}`)
      setPingStatus('dead')
    } finally {
      setIsReconnecting(false)
    }
  }

  async function handleMcpRestart() {
    setMcpBusy(true)
    const restartingToast = toast.loading(t('mcpToastRestarting', language))
    try {
      // Stop → Start (서버가 이미 멈춰있으면 Stop 은 no-op)
      try { await StopMCPServer() } catch { /* 무시 */ }
      await StartMCPServer()
      await refreshMcp()
      toast.success(t('mcpToastRestarted', language), { id: restartingToast })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('mcpToastRestartFail', language).replace('{message}', msg), { id: restartingToast })
    } finally {
      setMcpBusy(false)
    }
  }

  async function handleMcpTest() {
    if (!mcpStatus.running) {
      toast.error(t('mcpTestNotRunning', language))
      return
    }
    setMcpBusy(true)
    try {
      const res = await TestMCPConnection()
      if (res.success) {
        toast.success(t('mcpTestSuccess', language).replace('{ms}', String(res.durationMs)))
      } else {
        toast.error(t('mcpTestFail', language).replace('{message}', res.message ?? ''))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('mcpTestFail', language).replace('{message}', msg))
    } finally {
      setMcpBusy(false)
    }
  }

  function handleOpenMcpSettings() {
    setMcpMenuOpen(false)
    onOpenSettings?.('mcp')
  }

  // 핑 상태 → 색상 + 레이블
  const dotColor = {
    ok:   'bg-[#68d391]',
    slow: 'bg-[#f6ad55]',
    dead: 'bg-[#fc8181] animate-pulse',
    idle: 'bg-[#4a5568]',
  }[pingStatus]

  const latencyLabel = latencyMs !== null
    ? latencyMs >= 1000
      ? `${(latencyMs / 1000).toFixed(1)}s`
      : `${latencyMs}ms`
    : null

  const containerCls = isDark
    ? 'border-[#2d3748] bg-[#161b27] text-[#718096]'
    : 'border-[#e2e8f0] bg-[#f8f9fa] text-[#64748b]'
  const connNameCls  = isDark ? 'text-[#e2e8f0]' : 'text-[#1e293b]'
  const connMetaCls  = isDark ? 'text-[#4a5568]' : 'text-[#94a3b8]'
  const dbCls        = isDark ? 'text-[#4299e1]' : 'text-[#2563eb]'

  // MCP 인디케이터 색상 — running=녹색 / 활성화됐는데 멈춤=황색 / 에러=적색
  let mcpDotCls = 'bg-[#4a5568]'
  let mcpStateLabel = t('mcpBarStoppedShort', language)
  if (mcpStatus.lastError) {
    mcpDotCls = 'bg-[#fc8181] animate-pulse'
    mcpStateLabel = t('mcpBarErrorShort', language)
  } else if (mcpStatus.running) {
    mcpDotCls = 'bg-[#68d391]'
    mcpStateLabel = t('mcpBarRunningOn', language).replace('{port}', String(mcpStatus.port))
  } else if (mcpEnabled) {
    mcpDotCls = 'bg-[#f6ad55]'
  }

  return (
    <div className={`osql-statusbar relative flex items-center h-6 px-3 gap-3 border-t text-[10px] shrink-0 select-none overflow-visible ${containerCls}`}>

      {/* BugFix-BK: 세션 복원 진행 인디케이터 */}
      <RestoreIndicator />

      {/* 연결 상태 */}
      {activeConn ? (
        <span className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
          {connColor && (
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: connColor }}
              title={activeConn.name}
            />
          )}
          <span className={connNameCls}>{activeConn.name}</span>
          <span className={connMetaCls}>
            {activeConn.user}@{activeConn.host}:{activeConn.port}
          </span>

          {/* 핑 지연 */}
          {latencyLabel && (
            <span className={
              pingStatus === 'slow' ? 'text-[#f6ad55]' :
              pingStatus === 'dead' ? 'text-[#fc8181]' :
              'text-[#4a5568]'
            }>
              {pingStatus === 'dead' ? t('statusConnLost', language) : latencyLabel}
            </span>
          )}

          {/* 재연결 버튼 (dead 또는 hover 시) */}
          {(pingStatus === 'dead' || isReconnecting) && (
            <button
              onClick={handleReconnect}
              disabled={isReconnecting}
              className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[#fc8181] hover:text-[#fff] hover:bg-[#fc8181]/20 transition-colors disabled:opacity-50"
              title={t('statusReconnect', language)}
            >
              <RefreshCw size={9} className={isReconnecting ? 'animate-spin' : ''} />
              {isReconnecting ? t('statusReconnecting', language) : t('statusReconnect', language)}
            </button>
          )}
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4a5568]" />
          {t('statusNoConn', language)}
        </span>
      )}

      {/* 선택된 데이터베이스 */}
      {selectedDatabase && (
        <>
          <span>·</span>
          <span className={dbCls}>{selectedDatabase}</span>
        </>
      )}

      {/* 쿼리 실행 중 */}
      {activeTab?.isRunning && (
        <span className="ml-auto flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#68d391] animate-pulse" />
          {t('statusRunning', language)}
        </span>
      )}

      {/* 마지막 쿼리 결과 요약 */}
      {activeTab?.result && !activeTab.isRunning && (
        <span className={`${activeTab?.isRunning ? '' : 'ml-auto'}`}>
          {activeTab.result.columns.length > 0
            ? `${activeTab.result.rows.length.toLocaleString()} ${t('statusRowsUnit', language)}`
            : `${activeTab.result.affected.toLocaleString()} ${t('statusRowsAffectedUnit', language)}`}
        </span>
      )}

      {/* MCP 인디케이터 — 활성화된 경우만 노출 */}
      {mcpEnabled && (
        <button
          ref={mcpAnchorRef}
          onClick={() => setMcpMenuOpen(o => !o)}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
            !activeTab?.result && !activeTab?.isRunning ? 'ml-auto' : ''
          } ${
            mcpMenuOpen
              ? (isDark ? 'bg-[#2d3748]' : 'bg-[#e2e8f0]')
              : 'hover:bg-[var(--color-border)]'
          }`}
          title={mcpStatus.running ? t('mcpBarTooltipRunning', language) : t('mcpBarTooltipStopped', language)}
        >
          <Plug size={9} className={isDark ? 'text-[#94a3b8]' : 'text-[#64748b]'} />
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${mcpDotCls}`} />
          <span>MCP</span>
          <span className={connMetaCls}>{mcpStateLabel}</span>
        </button>
      )}

      {/* MCP 팝업 메뉴 — 위쪽으로 띄움 (StatusBar 가 화면 하단이므로) */}
      {mcpMenuOpen && (
        <div
          ref={mcpMenuRef}
          className={`absolute right-3 bottom-7 z-50 min-w-[200px] rounded-md shadow-lg border text-[11px] ${
            isDark
              ? 'bg-[#1a202c] border-[#2d3748] text-[#e2e8f0]'
              : 'bg-white border-[#e2e8f0] text-[#1e293b]'
          }`}
          role="menu"
        >
          {/* 헤더 — 상태 요약 */}
          <div className={`px-3 py-2 border-b ${isDark ? 'border-[#2d3748]' : 'border-[#e2e8f0]'}`}>
            <div className="flex items-center gap-1.5 font-semibold">
              <Plug size={11} />
              {t('mcpBarTitle', language)}
            </div>
            <div className={`mt-1 text-[10px] flex items-center gap-1.5 ${connMetaCls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${mcpDotCls}`} />
              {mcpStateLabel}
            </div>
            {mcpStatus.endpoint && mcpStatus.running && (
              <code className={`mt-1 block text-[10px] font-mono px-1.5 py-0.5 rounded ${
                isDark ? 'bg-[#0f1419] text-[#94a3b8]' : 'bg-[#f1f5f9] text-[#64748b]'
              }`}>
                {mcpStatus.endpoint}
              </code>
            )}
            {mcpStatus.lastError && (
              <div className="mt-1 text-[10px] text-[#fc8181] break-all">{mcpStatus.lastError}</div>
            )}
          </div>

          {/* 액션들 */}
          <div className="py-1">
            <MenuItem
              isDark={isDark}
              icon={<RefreshCw size={11} className={mcpBusy ? 'animate-spin' : ''} />}
              label={t('mcpBarRestart', language)}
              onClick={handleMcpRestart}
              disabled={mcpBusy}
            />
            <MenuItem
              isDark={isDark}
              icon={<Activity size={11} />}
              label={t('mcpTestConnection', language)}
              onClick={handleMcpTest}
              disabled={mcpBusy || !mcpStatus.running}
            />
            <MenuItem
              isDark={isDark}
              icon={<SettingsIcon size={11} />}
              label={t('mcpBarOpenSettings', language)}
              onClick={handleOpenMcpSettings}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * BugFix-BK: 세션 복원 진행 상태를 좌측에 prepend.
 * - phase=restoring: 스피너 + "세션 복원 중 N/M"
 * - phase=retrying:  스피너 + "재시도 중 N/M (실패 K)"
 * - phase=partial:   ⚠ 아이콘 + "복원 일부 실패 K개" + 카운트다운("Ks 후 자동") + 수동 "재시도" 버튼 + 닫기
 * - phase=done/idle: 표시 없음
 */
function RestoreIndicator() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const language = useLanguageStore((s) => s.language)
  const phase = useRestoreStore((s) => s.phase)
  const total = useRestoreStore((s) => s.total)
  const succeeded = useRestoreStore((s) => s.succeeded)
  const failed = useRestoreStore((s) => s.failed)
  const retryIn = useRestoreStore((s) => s.retryIn)
  const retryNow = useRestoreStore((s) => s.retryNow)
  const dismiss = useRestoreStore((s) => s.dismiss)

  if (phase === 'idle' || phase === 'done') return null

  const failedCount = failed.length
  const failedNames = failed.map((f) => f.name).join(', ')
  const muted = isDark ? 'text-[#a0aec0]' : 'text-[#475569]'
  const warn  = 'text-[#f6ad55]'

  // restoring / retrying — 스피너 + 진행
  if (phase === 'restoring' || phase === 'retrying') {
    const label = phase === 'restoring'
      ? t('statusRestoring', language)
      : t('statusRestoreRetrying', language)
    return (
      <span className={`flex items-center gap-1 ${muted}`}>
        <RefreshCw size={9} className="animate-spin" />
        <span>{label}</span>
        <span className="font-mono">{succeeded}/{total}</span>
        {failedCount > 0 && (
          <span className={warn}>
            ({t('statusRestoreFailedCount', language).replace('{n}', String(failedCount))})
          </span>
        )}
        <span className={isDark ? 'text-[#2d3748]' : 'text-[#cbd5e1]'}>·</span>
      </span>
    )
  }

  // partial — 자동 재시도 카운트다운 + 수동 재시도 버튼 + 닫기
  return (
    <span
      className={`flex items-center gap-1 ${warn}`}
      title={failedNames || undefined}
    >
      <AlertTriangle size={10} />
      <span>{t('statusRestorePartial', language)}</span>
      <span className="font-mono">
        ({t('statusRestoreFailedCount', language).replace('{n}', String(failedCount))})
      </span>
      {retryIn !== null && retryIn > 0 && (
        <span className={muted}>
          · {t('statusRestoreRetryIn', language).replace('{s}', String(retryIn))}
        </span>
      )}
      <button
        onClick={() => void retryNow()}
        className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[#4299e1] hover:text-[#fff] hover:bg-[#4299e1]/20 transition-colors"
        title={t('statusRestoreRetryNow', language)}
      >
        <RefreshCw size={9} />
        {t('statusRestoreRetryNow', language)}
      </button>
      <button
        onClick={dismiss}
        className="flex items-center px-0.5 py-0.5 rounded hover:bg-[var(--color-border)] transition-colors"
        title={t('statusRestoreDismiss', language)}
      >
        <X size={9} />
      </button>
      <span className={isDark ? 'text-[#2d3748]' : 'text-[#cbd5e1]'}>·</span>
    </span>
  )
}

function MenuItem({
  icon, label, onClick, disabled, isDark,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  isDark: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      role="menuitem"
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        isDark ? 'hover:bg-[#2d3748]' : 'hover:bg-[#f1f5f9]'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
