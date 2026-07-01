import { useEffect, useState } from 'react'
import { X, Database, Plus, WifiOff, Unplug, ChevronLeft, ChevronRight } from 'lucide-react'
import { useConnectionStore } from '@/stores/connectionStore'
import { useThemeStore } from '@/stores/useThemeStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { Disconnect } from '@/wailsjs/go/main/App'
import ContextMenu, { type ContextMenuOption } from '@/components/ContextMenu'
import toast from 'react-hot-toast'
import { t } from '@/i18n'

/**
 * SQLyog 스타일 최상위 연결 탭 바.
 *
 * 각 연결(세션)을 독립된 탭으로 표시한다.
 * 탭 클릭 → 해당 연결 세션으로 전환 (에디터/결과 패널 독립)
 * × 클릭 → 연결 해제 + 세션 제거
 */
export default function ConnectionTabBar() {
  const { sessions, activeSessionId, setActiveSession, removeActiveConnection } = useConnectionStore()
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const language = useLanguageStore((s) => s.language)

  // 닫기 확인 다이얼로그 — 대상 세션 ID 보관 (null = 닫혀있음)
  // WKWebView/WebView2 의 native window.confirm 은 표시 차단되고 silently false 반환,
  // Wails Dialogs.Question 은 OS 네이티브라 커스텀 아이콘 불가 → 자체 React 모달 사용.
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null)
  // BugFix-BS: 탭 우클릭 컨텍스트 메뉴 (닫기 군)
  // BugFix-CX: "세션 복사" 옵션 제거 — 같은 창 내 동일 세션 중복 금지.
  const [tabCtxMenu, setTabCtxMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)

  /** + 버튼 — SessionManager 모달을 직접 오픈. (BugFix-CX 이전엔 "복제 / 새 연결" 드롭다운이 있었으나 복제는 폐지되었으므로 단일 동작) */
  function handleOpenSessionMgr() {
    window.dispatchEvent(new CustomEvent('session:open'))
  }

  // BugFix-BS: 일괄 세션 닫기 — Disconnect 후 removeActiveConnection. 확인 다이얼로그 없이 즉시 처리.
  async function closeSessionsByIds(ids: string[]) {
    for (const sid of ids) {
      try { await Disconnect(sid) } catch { /* 이미 끊어진 경우 무시 */ }
      removeActiveConnection(sid)
    }
    if (ids.length > 0) toast.success(t('toastDisconnected', language))
  }

  if (sessions.length === 0) return null

  function handleClose(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation()
    setClosingSessionId(sessionId)
  }

  async function confirmClose() {
    const sid = closingSessionId
    if (!sid) return
    setClosingSessionId(null)
    try {
      await Disconnect(sid)
    } catch {
      // 이미 끊어진 경우 무시
    }
    removeActiveConnection(sid)
    toast.success(t('toastDisconnected', language))
  }

  // ── 테마별 색상 ──────────────────────────────────────────────────────────
  const barBg  = isDark ? 'bg-[#0a0d14] border-[#2d3748]' : 'bg-[#e8ecf2] border-[#d1d5db]'
  const tabBorderR = isDark ? 'border-[#2d3748]' : 'border-[#d1d5db]'

  function activeTabCls() {
    return isDark
      ? 'bg-[#0f1117] text-[#e2e8f0] border-t-2 border-t-[#4299e1]'
      : 'bg-white text-[#111827] border-t-2 border-t-[#4299e1]'
  }
  function inactiveTabCls() {
    return isDark
      ? 'bg-[#0a0d14] text-[#718096] hover:bg-[#131720] hover:text-[#a0aec0]'
      : 'bg-[#e8ecf2] text-[#6b7280] hover:bg-[#d5dae4] hover:text-[#374151]'
  }
  function badgeCls() {
    return isDark
      ? 'bg-[#2d3748] text-[#718096]'
      : 'bg-[#d1d5db] text-[#6b7280]'
  }
  function closeActiveCls() {
    return isDark
      ? 'text-[#4a5568] hover:text-[#fc8181] hover:bg-[#2d3748]'
      : 'text-[#9ca3af] hover:text-[#ef4444] hover:bg-[#e5e7eb]'
  }
  function closeInactiveCls() {
    return isDark
      ? 'text-transparent group-hover:text-[#4a5568] hover:!text-[#fc8181] hover:bg-[#1a1f2e]'
      : 'text-transparent group-hover:text-[#9ca3af] hover:!text-[#ef4444] hover:bg-[#e5e7eb]'
  }
  // 닫기 대상 세션 정보 (다이얼로그 본문 표기용)
  const closingSession = closingSessionId ? sessions.find((s) => s.id === closingSessionId) ?? null : null

  return (
    <>
    <div className={`osql-conn-tabbar flex items-end shrink-0 border-b ${barBg}`}>
    {/* 탭 목록 — 가로 스크롤 가능 (드롭다운을 클립하지 않도록 + 버튼은 별도 컨테이너로 분리) */}
    <div
      className="flex items-end overflow-x-auto min-w-0"
      style={{ scrollbarWidth: 'none' }}
    >
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId
        // 세션 색상 (저장된 색상이 있으면 상단 테두리에 적용)
        const savedConn = useConnectionStore.getState().savedConnections.find((c) => c.id === session.id)
        const sessionColor = savedConn?.color

        return (
          // 외부 컨테이너는 `<div role="tab">` — 닫기 버튼(`<button>`) 을 중첩하기 위해 `<button>` 으로 둘 수 없다
          // (HTML 사양상 button 내부에 interactive content 금지 → WebView 가 inner onClick 을 무시하거나
          //  outer click 만 발화시켜 닫기 동작이 사라지는 회귀 발생)
          <div
            key={session.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            onClick={() => setActiveSession(session.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setActiveSession(session.id)
              setTabCtxMenu({ x: e.clientX, y: e.clientY, sessionId: session.id })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setActiveSession(session.id)
              }
            }}
            className={`
              group relative flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium
              border-r ${tabBorderR} shrink-0 select-none transition-colors min-w-0 max-w-[180px]
              cursor-pointer
              ${isActive ? activeTabCls() : inactiveTabCls()}
            `}
            style={isActive && sessionColor ? { borderTopColor: sessionColor } : undefined}
          >
            {/* 연결 상태 표시 */}
            <ConnStatus isActive={isActive} sessionColor={sessionColor} />

            {/* DB 아이콘 */}
            <Database size={11} className={isActive
              ? (isDark ? 'text-[#4299e1]' : 'text-[#3182ce]')
              : (isDark ? 'text-[#4a5568]' : 'text-[#9ca3af]')
            } />

            {/* 연결 이름 */}
            <span className="truncate flex-1 min-w-0">
              {session.name}
            </span>

            {/* 탭 수 뱃지 */}
            {session.tabs.length > 1 && (
              <span className={`text-[9px] px-1 rounded shrink-0 ${badgeCls()}`}>
                {session.tabs.length}
              </span>
            )}

            {/* 닫기 버튼 */}
            <button
              type="button"
              onClick={(e) => handleClose(e, session.id)}
              className={`shrink-0 rounded p-0.5 transition-colors ${isActive ? closeActiveCls() : closeInactiveCls()}`}
              aria-label={t('confirmDisconnectTab', language)}
            >
              <X size={10} />
            </button>
          </div>
        )
      })}

    </div>{/* /탭 목록 스크롤 컨테이너 */}

      {/* + 버튼 — SessionManager 모달 직접 오픈 (BugFix-CX: 이전 드롭다운 폐지, 복제 항목 제거). */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={handleOpenSessionMgr}
          title={t('connTabAddMenu', language)}
          className={`flex items-center justify-center px-2.5 py-1.5 transition-colors
            ${isDark ? 'text-[#718096] hover:text-[#e2e8f0] hover:bg-[#131720]' : 'text-[#9ca3af] hover:text-[#374151] hover:bg-[#d5dae4]'}`}
        >
          <Plus size={12} />
        </button>
      </div>

      {/* 오른쪽 여백 (드래그 영역) */}
      <div className="flex-1 min-w-0" />
    </div>

    <DisconnectConfirmDialog
      open={!!closingSession}
      sessionName={closingSession?.name ?? ''}
      isDark={isDark}
      language={language}
      onConfirm={confirmClose}
      onCancel={() => setClosingSessionId(null)}
    />

    {/* BugFix-BS: 탭 우클릭 메뉴 */}
    {tabCtxMenu && (() => {
      const idx = sessions.findIndex((s) => s.id === tabCtxMenu.sessionId)
      const hasLeft = idx > 0
      const hasRight = idx >= 0 && idx < sessions.length - 1
      const hasMultiple = sessions.length > 1
      const items: ContextMenuOption[] = [
        // BugFix-CX: "세션 복사" 항목 제거 — 같은 창 내 동일 세션 중복 금지.
        {
          label: t('connTabCtxClose', language),
          icon: <X size={12} />,
          onClick: () => setClosingSessionId(tabCtxMenu.sessionId),
        },
        {
          label: t('connTabCtxCloseLeft', language),
          icon: <ChevronLeft size={12} />,
          onClick: () => closeSessionsByIds(sessions.slice(0, idx).map((s) => s.id)),
          disabled: !hasLeft,
        },
        {
          label: t('connTabCtxCloseRight', language),
          icon: <ChevronRight size={12} />,
          onClick: () => closeSessionsByIds(sessions.slice(idx + 1).map((s) => s.id)),
          disabled: !hasRight,
        },
        {
          label: t('connTabCtxCloseAll', language),
          onClick: () => closeSessionsByIds(sessions.map((s) => s.id)),
          disabled: !hasMultiple && idx === -1,
          danger: true,
        },
      ]
      return (
        <ContextMenu
          x={tabCtxMenu.x}
          y={tabCtxMenu.y}
          items={items}
          onClose={() => setTabCtxMenu(null)}
        />
      )
    })()}
    </>
  )
}

// ── 연결 해제 확인 모달 ─────────────────────────────────────────────────────
// Wails Dialogs.Question 은 OS 네이티브라 아이콘 커스터마이즈 불가하고,
// window.confirm 은 WKWebView/WebView2 가 차단한다. 따라서 React 자체 모달.
interface DisconnectConfirmDialogProps {
  open: boolean
  sessionName: string
  isDark: boolean
  language: 'ko' | 'en'
  onConfirm: () => void
  onCancel: () => void
}
function DisconnectConfirmDialog({
  open, sessionName, isDark, language, onConfirm, onCancel,
}: DisconnectConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onConfirm, onCancel])

  if (!open) return null

  const overlay = 'fixed inset-0 z-50 flex items-center justify-center'
  const dialogCls = isDark
    ? 'relative z-10 w-[400px] flex flex-col rounded-xl border border-[#2d3748] bg-[#161b27] shadow-2xl'
    : 'relative z-10 w-[400px] flex flex-col rounded-xl border border-[#d1d5db] bg-white shadow-2xl'
  const iconWrapCls = isDark
    ? 'mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#7f1d1d]/30 text-[#fc8181]'
    : 'mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600'
  const titleCls = isDark ? 'text-sm font-semibold text-[#e2e8f0]' : 'text-sm font-semibold text-[#111827]'
  const bodyCls = isDark ? 'text-xs text-[#a0aec0] leading-relaxed' : 'text-xs text-[#6b7280] leading-relaxed'
  const cancelBtn = isDark
    ? 'rounded px-3 py-1.5 text-xs text-[#a0aec0] hover:bg-[#2d3748]'
    : 'rounded px-3 py-1.5 text-xs text-[#374151] hover:bg-[#f3f4f6]'
  const confirmBtn = 'rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors'
  const footerCls = isDark
    ? 'flex justify-end gap-2 border-t border-[#2d3748] px-5 py-3'
    : 'flex justify-end gap-2 border-t border-[#e5e7eb] px-5 py-3'

  return (
    <div className={overlay} onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60" />
      <div className={dialogCls} onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center gap-3 px-5 pt-6 pb-4">
          <div className={iconWrapCls}>
            <Unplug size={22} />
          </div>
          <div className={titleCls}>{t('disconnectConfirmTitle', language)}</div>
          <p className={`${bodyCls} text-center`}>
            {t('confirmDisconnectTab', language)}
            {sessionName && (
              <>
                <br />
                <span className={isDark ? 'text-[#cbd5e0]' : 'text-[#374151]'}>"{sessionName}"</span>
              </>
            )}
          </p>
        </div>
        <div className={footerCls}>
          <button onClick={onCancel} className={cancelBtn} type="button">
            {t('disconnectConfirmCancel', language)}
          </button>
          <button onClick={onConfirm} className={confirmBtn} type="button" autoFocus>
            {t('disconnectConfirmAction', language)}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 연결 상태 표시 점 */
function ConnStatus({ isActive, sessionColor }: { isActive: boolean; sessionColor?: string }) {
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0`}
      style={{
        backgroundColor: sessionColor ?? (isActive ? '#48bb78' : '#718096'),
      }}
    />
  )
}

/** 연결 없음 안내 배너 */
export function NoConnectionBanner({ onConnectClick }: { onConnectClick?: () => void }) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const language = useLanguageStore((s) => s.language)
  const bannerCls = isDark
    ? 'bg-[#0a0d14] border-[#2d3748] text-[#4a5568]'
    : 'bg-[#f3f4f6] border-[#e5e7eb] text-[#9ca3af]'

  return (
    <div className={`flex items-center justify-center gap-3 py-2 border-b text-[11px] ${bannerCls}`}>
      <WifiOff size={12} />
      <span>{t('noServerConnection', language)}</span>
      {onConnectClick && (
        <button onClick={onConnectClick} className="flex items-center gap-1 text-[#4299e1] hover:underline">
          <Plus size={10} /> {t('connAdd', language)}
        </button>
      )}
    </div>
  )
}
