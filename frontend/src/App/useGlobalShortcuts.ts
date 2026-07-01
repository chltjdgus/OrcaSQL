import { useEffect, type RefObject } from 'react'
import type { editor } from 'monaco-editor'
import { useConnectionStore } from '@/stores/connectionStore'
import { useCommandPaletteStore } from '@/stores/useCommandPaletteStore'
import type { ToolTab } from '@/types'
import type { useToolModals } from './useToolModals'

interface UseGlobalShortcutsOpts {
  /** F9/Ctrl+F9 단축키에서 호출하는 쿼리 실행 함수. */
  runQuery: (selectionOnly?: boolean) => void
  /** Ctrl+E 단축키에서 에디터 포커스용. */
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>
  /** 쿼리 탭/연결 탭 전환 시 도구 탭 닫기. */
  setActiveToolTab: (tab: ToolTab | null) => void
  /** Phase 51 useToolModals 반환을 그대로 받아 setter 들만 소비. */
  modals: ReturnType<typeof useToolModals>
}

/**
 * 전역 키보드 단축키 (BugFix-AZ: SQLyog 호환 단축키).
 *
 * Win/Mac 매핑 표는 ShortcutsDialog 참조. 본체 App() 외부로 분리해 가독성 회복.
 *
 * - F9 / Ctrl+F9      : 쿼리 실행 / 선택 영역 실행
 * - F5                 : 스키마 새로고침 (CustomEvent dispatch)
 * - Ctrl+Tab           : 연결 탭 순회
 * - Ctrl+PgUp/PgDn     : 쿼리 탭 순회 (Win) / ⌥⌘← →: 동일 (Mac)
 * - Ctrl+Alt+E/W/S/D   : Backup/DataSync/SchemaSync/ERDiagram 모달
 * - Ctrl+Shift+N/B/P/F/D : NewConn/Favorites/ProcessList/QueryFormat/DataSearch
 * - Ctrl+T/W/B/E/R/H/U/, : NewTab/CloseTab/FocusTree/FocusEditor/FocusResult/History/UserManager/Settings
 */
export function useGlobalShortcuts({
  runQuery,
  editorRef,
  setActiveToolTab,
  modals,
}: UseGlobalShortcutsOpts) {
  const queryTabs = useConnectionStore((s) => s.queryTabs)
  const activeTabId = useConnectionStore((s) => s.activeTabId)
  const selectedConnId = useConnectionStore((s) => s.selectedConnId)
  const selectedDatabase = useConnectionStore((s) => s.selectedDatabase)
  const addTab = useConnectionStore((s) => s.addTab)
  const closeTab = useConnectionStore((s) => s.closeTab)
  const setActiveTab = useConnectionStore((s) => s.setActiveTab)
  const setSelectedConn = useConnectionStore((s) => s.setSelectedConn)

  useEffect(() => {
    const isMac = /Mac/i.test(navigator.platform)

    const cycleConn = (dir: 1 | -1) => {
      const { activeConnections, selectedConnId: cur } = useConnectionStore.getState()
      if (activeConnections.length < 2) return
      const i = activeConnections.findIndex((c) => c.id === cur)
      const next = activeConnections[(i + dir + activeConnections.length) % activeConnections.length]
      setSelectedConn(next.id)
    }
    const cycleQueryTab = (dir: 1 | -1) => {
      const { queryTabs: qt, activeTabId: cur } = useConnectionStore.getState()
      if (qt.length < 2) return
      const i = qt.findIndex((t) => t.id === cur)
      const next = qt[(i + dir + qt.length) % qt.length]
      setActiveTab(next.id)
      setActiveToolTab(null)
    }

    const handler = (e: KeyboardEvent) => {
      // ── F-keys ──────────────────────────────────────────────────────
      // F9 = 전체 실행, Ctrl/Cmd+F9 = 선택 영역 실행 (선택 없으면 전체로 fallback)
      if (e.key === 'F9' && !e.shiftKey && !e.altKey) {
        const sel = e.ctrlKey || e.metaKey
        e.preventDefault()
        runQuery(sel)
        return
      }
      if (e.key === 'F5' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('schema:refresh'))
        return
      }

      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      // ── Ctrl+Tab / Ctrl+Shift+Tab : 연결 탭 전환 (Mac 도 Ctrl 유지 — Cmd+Tab 은 OS 가 가로챔) ──
      if (e.key === 'Tab' && e.ctrlKey) {
        e.preventDefault()
        cycleConn(e.shiftKey ? -1 : 1)
        return
      }

      // ── 쿼리 탭 전환 : Win Ctrl+PgUp/PgDn / Mac ⌥⌘← / ⌥⌘→ ──
      if (!isMac && (e.key === 'PageUp' || e.key === 'PageDown')) {
        e.preventDefault()
        cycleQueryTab(e.key === 'PageUp' ? -1 : 1)
        return
      }
      if (isMac && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        cycleQueryTab(e.key === 'ArrowLeft' ? -1 : 1)
        return
      }

      // ── Ctrl+Alt+ 도구 모달 ─────────────────────────────────────────
      if (e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase()
        if (k === 'e') { e.preventDefault(); modals.setShowBackup(true);    return }
        if (k === 'w') { e.preventDefault(); modals.setShowDataSync(true);  return }
        if (k === 's') { e.preventDefault(); modals.setShowSchemaSync(true); return }
        if (k === 'd') { e.preventDefault(); modals.setShowERDiagram(true); return }
      }

      // ── Ctrl+Shift+ ─────────────────────────────────────────────────
      if (e.shiftKey && !e.altKey) {
        if (e.key === 'N') { e.preventDefault(); window.dispatchEvent(new CustomEvent('session:open')); return }
        if (e.key === 'B') { e.preventDefault(); modals.setShowFavorites((v) => !v); return }
        if (e.key === 'P') { e.preventDefault(); modals.setShowProcessList((v) => !v); return }
        if (e.key === 'F') { e.preventDefault(); window.dispatchEvent(new CustomEvent('query:format')); return }
        if (e.key === 'D') { e.preventDefault(); modals.setShowDataSearch(true); return }
      }

      // ── Ctrl+ (no Shift, no Alt) ────────────────────────────────────
      if (!e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase()
        // Phase 63: 명령 팔레트 토글 (Ctrl/Cmd+K · Ctrl/Cmd+P) — 에디터 외부 포커스 커버.
        if (k === 'k' || k === 'p') { e.preventDefault(); useCommandPaletteStore.getState().toggle(); return }
        if (k === 't') { e.preventDefault(); addTab(selectedConnId, selectedDatabase ?? null); setActiveToolTab(null); return }
        if (k === 'w') { e.preventDefault(); if (activeTabId && queryTabs.length > 1) closeTab(activeTabId); return }
        if (k === 'b') { e.preventDefault(); window.dispatchEvent(new CustomEvent('focus:tree')); return }
        if (k === 'e') { e.preventDefault(); editorRef.current?.focus(); return }
        if (k === 'r') { e.preventDefault(); window.dispatchEvent(new CustomEvent('focus:result')); return }
        if (k === 'h') { e.preventDefault(); modals.setShowHistory((v) => !v); return }
        if (k === 'u') { e.preventDefault(); modals.setShowUserManager((v) => !v); return }
        if (e.key === ',') { e.preventDefault(); modals.setShowSettings(true); return }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, queryTabs.length, selectedConnId, selectedDatabase, addTab, closeTab, setActiveTab, setSelectedConn])
}
