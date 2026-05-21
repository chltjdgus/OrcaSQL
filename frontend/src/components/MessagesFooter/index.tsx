import { useEffect, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ChevronUp, AlertCircle, Trash2, Loader2 } from 'lucide-react'
import type { PanelImperativeHandle } from 'react-resizable-panels'
import { useThemeStore } from '@/stores/useThemeStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { useMessagesLogStore, type MsgEntry, type MsgLevel } from '@/stores/useMessagesLogStore'
import { t } from '@/i18n'

/**
 * BugFix-BN — Messages 영역.
 *
 * `useMessagesLogStore` 의 세션 단위 누적 로그를 시간순(오래된→최신)으로 표시.
 * 연결 성공/실패, 쿼리 성공/실패, 시스템 알림이 모두 한곳에 쌓이고 창 닫기 전까지 유지.
 *
 * 이전 v3 동작(active 탭의 result/queryError 만 매번 교체)과 다르게, 사용자가 과거
 * 이벤트를 추적할 수 있도록 누적 보존. 새 항목이 들어오면 자동으로 맨 아래로 스크롤.
 *
 * 접기 토글: `panelRef` 가 주어지면 react-resizable-panels v4 의 imperative API
 * (`collapse()`/`expand()`)로 패널 자체를 축소·복원. 부모에서 Panel 에 `collapsible
 * collapsedSize={28}` 을 설정해 두면 헤더(28px)만 남고 본문이 사라진다.
 */
interface Props {
  isRunning?: boolean
  panelRef?: RefObject<PanelImperativeHandle | null>
}

export default function MessagesFooter({ isRunning, panelRef }: Props) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const language = useLanguageStore((s) => s.language)
  const entries = useMessagesLogStore((s) => s.entries)
  const clear = useMessagesLogStore((s) => s.clear)
  const [collapsed, setCollapsed] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 외부 패널 상태(드래그로 collapsedSize 까지 줄였을 때)와 로컬 collapsed 동기화.
  // mount 시 한 번 + entries 변동 시(=interaction 직후) 다시 확인 — 폴링 없이 가벼움.
  useEffect(() => {
    const isColl = panelRef?.current?.isCollapsed?.() ?? false
    setCollapsed(isColl)
  }, [panelRef, entries.length])

  // 새 entry 도착 시 자동으로 맨 아래로 스크롤 (사용자가 위로 스크롤 중이어도 적용 — 단순화).
  useEffect(() => {
    if (collapsed) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [entries.length, collapsed])

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    if (panelRef?.current) {
      if (next) panelRef.current.collapse()
      else panelRef.current.expand()
    }
  }

  const errorCount = entries.filter((e) => e.level === 'error').length
  const borderCls  = isDark ? 'border-[#2d3748]' : 'border-[#e2e8f0]'
  const headerBg   = isDark ? 'bg-[#161b27]' : 'bg-[#f1f5f9]'
  const headerText = isDark ? 'text-[#718096]' : 'text-[#64748b]'
  const contentBg  = isDark ? 'bg-[#0f1117]' : 'bg-white'

  return (
    <div className={`osql-messages-footer-inner flex flex-col h-full overflow-hidden border-t ${borderCls}`}>
      {/* 헤더 (항상 표시) */}
      <div
        className={`flex items-center gap-2 px-3 py-1 border-b shrink-0 select-none ${headerBg} ${borderCls}`}
      >
        <button
          onClick={toggleCollapsed}
          className={`flex items-center gap-2 cursor-pointer ${headerText} hover:text-[var(--color-text-primary)] transition-colors`}
        >
          <span className="text-[10px] font-medium">Messages</span>
        </button>
        {entries.length > 0 && (
          <span className="text-[9px] bg-[#4299e1]/20 text-[#4299e1] px-1 py-0.5 rounded">
            {entries.length}
          </span>
        )}
        {errorCount > 0 && (
          <span className="flex items-center gap-0.5 text-[9px] bg-[#fc8181]/15 text-[#fc8181] px-1 py-0.5 rounded">
            <AlertCircle size={8} />
            {errorCount}
          </span>
        )}
        {isRunning && (
          <span className={`flex items-center gap-1 text-[9px] ${headerText}`}>
            <Loader2 size={9} className="animate-spin" />
            {t('msgRunning', language)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {entries.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); clear() }}
              className={`p-1 rounded ${headerText} hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors`}
              title={t('msgClearLog', language)}
            >
              <Trash2 size={10} />
            </button>
          )}
          <button
            onClick={toggleCollapsed}
            className={`p-1 ${headerText} hover:text-[var(--color-text-primary)] transition-colors`}
            title={collapsed ? t('msgExpand', language) : t('msgCollapse', language)}
          >
            {collapsed ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      </div>

      {/* 콘텐츠 */}
      {!collapsed && (
        <div
          ref={scrollRef}
          className={`osql-messages-log flex-1 overflow-auto p-3 font-mono text-xs space-y-2 ${contentBg}`}
        >
          {entries.length === 0 && (
            <div className={`text-xs ${headerText}`}>{t('msgNoEntries', language)}</div>
          )}

          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} isDark={isDark} />
          ))}
        </div>
      )}
    </div>
  )
}

function EntryRow({ entry, isDark }: { entry: MsgEntry; isDark: boolean }) {
  const tsLabel = formatTime(entry.timestamp)
  const dim = isDark ? 'text-[#718096]' : 'text-[#94a3b8]'

  return (
    <div className="space-y-0.5">
      <div className="flex gap-2">
        <span className={`shrink-0 w-[60px] tabular-nums ${dim}`}>{tsLabel}</span>
        <MessageLine level={entry.level} text={entry.title} isDark={isDark} />
      </div>
      {entry.sql && (
        <div className="flex gap-2 pl-[68px]">
          <MessageLine
            level="info"
            text={`SQL: ${entry.sql.replace(/\s+/g, ' ').trim()}`}
            isDark={isDark}
            nowrap
          />
        </div>
      )}
      {entry.detail && (
        <div className="flex gap-2 pl-[68px]">
          <MessageLine level={entry.level === 'success' ? 'info' : entry.level} text={entry.detail} isDark={isDark} />
        </div>
      )}
      {entry.durationMs !== undefined && (
        <div className="flex gap-2 pl-[68px]">
          <MessageLine
            level="info"
            text={
              entry.rows !== undefined
                ? `${entry.rows.toLocaleString()} row(s) returned · ${entry.durationMs}ms`
                : entry.affected !== undefined
                ? `${entry.affected.toLocaleString()} row(s) affected · ${entry.durationMs}ms`
                : `${entry.durationMs}ms`
            }
            isDark={isDark}
          />
        </div>
      )}
    </div>
  )
}

function MessageLine({ level, text, isDark, nowrap }: { level: MsgLevel; text: string; isDark: boolean; nowrap?: boolean }) {
  const color =
    level === 'success' ? 'text-[#68d391]' :
    level === 'error'   ? 'text-[#fc8181]' :
    level === 'warn'    ? 'text-[#f6ad55]' :
    isDark ? 'text-[#a0aec0]' : 'text-[#64748b]'
  const prefix =
    level === 'success' ? '✓' :
    level === 'error'   ? '✗' :
    level === 'warn'    ? '!' : '»'
  return (
    <div className={`flex gap-2 min-w-0 ${color}`}>
      <span className="shrink-0 w-3">{prefix}</span>
      <span className={nowrap ? 'whitespace-nowrap' : 'break-all'} title={nowrap ? text : undefined}>{text}</span>
    </div>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}
