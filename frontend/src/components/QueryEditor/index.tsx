import { useRef, useCallback, useEffect, useState } from 'react'
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { Play, Square, Plus, X } from 'lucide-react'
import { CancelQuery } from '@/wailsjs/go/main/App'
import { useConnectionStore } from '@/stores/connectionStore'
import { useQueryExec } from '@/hooks/useQueryExec'
import { useMonacoCompletion } from '@/hooks/useMonacoCompletion'
import QueryHistory from '@/components/QueryHistory'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useThemeStore } from '@/stores/useThemeStore'
import toast from 'react-hot-toast'
import { runWithPlaceholderCheck } from '@/stores/usePlaceholderStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import ContextMenu, { type ContextMenuOption } from '@/components/ContextMenu'

interface Props {
  editorRef?: React.MutableRefObject<editor.IStandaloneCodeEditor | null>
  showHistory?: boolean
  onHideHistory?: () => void
  /** true이면 탭 바와 Run/Cancel 버튼을 숨김 (UnifiedTabBar가 대신 렌더링) */
  hideTabBar?: boolean
}

/**
 * Monaco 기반 SQL 쿼리 에디터.
 * - 다중 탭
 * - F9: 전체 실행 / Ctrl+Shift+Enter: 선택 영역 실행
 * - SQL 자동완성 (테이블/컬럼 기반 커스텀 CompletionProvider)
 * - editorRef: 부모(App.tsx)에서 Monaco 인스턴스 참조 가능
 */
export default function QueryEditor({ editorRef: externalRef, showHistory = false, onHideHistory, hideTabBar = false }: Props) {
  const { queryTabs, activeTabId, setActiveTab, addTab, closeTab, closeAllTabs, closeTabsToRight, updateTab,
    activeConnections } = useConnectionStore()
  // ─── 탭 이름 인라인 편집 ─────────────────────────────────────────────
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const tabInputRef = useRef<HTMLInputElement | null>(null)
  const [tabCtxMenu, setTabCtxMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const language = useLanguageStore((s) => s.language)
  const { selectedConnId, selectedDatabase } = useConnectionStore()
  const { execute, isPending } = useQueryExec()
  const { settings } = useSettingsStore()
  const editorSettings = settings.editor
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const internalRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const editorRef = externalRef ?? internalRef
  const monacoRef = useRef<Monaco | null>(null)
  // stale closure 방지: 항상 최신 runQuery를 ref로 유지
  const runQueryRef = useRef<(selectionOnly?: boolean) => void>(() => {})

  // 스키마 인식 SQL 자동완성 등록
  useMonacoCompletion(
    monacoRef as React.MutableRefObject<typeof import('monaco-editor') | null>,
    selectedConnId,
    selectedDatabase,
  )

  const activeTab = queryTabs.find((t) => t.id === activeTabId) ?? null

  // ─── Monaco 마운트 ──────────────────────────────────────────────────────
  // command handler는 ref를 통해 호출하므로 의존성 배열 []이 안전.
  // runQuery가 변경되어도 ref가 최신 값을 가리키기 때문에 stale closure 없음.
  const handleEditorMount: OnMount = useCallback((editorInstance, monacoInstance) => {
    editorRef.current = editorInstance
    monacoRef.current = monacoInstance

    // BugFix-AZ: F9 = 전체 실행 (SQLyog 디폴트). Ctrl+Enter 매핑 제거.
    editorInstance.addCommand(
      monacoInstance.KeyCode.F9,
      () => runQueryRef.current(),
    )
    // Ctrl+F9 / Ctrl+Shift+Enter: 선택 영역 실행 (둘 다 등록 — 사용자 익숙한 쪽 선택 가능)
    editorInstance.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.F9,
      () => runQueryRef.current(true),
    )
    editorInstance.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.Enter,
      () => runQueryRef.current(true),
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 탭 변경 시 에디터 내용 동기화 ─────────────────────────────────────
  useEffect(() => {
    if (editorRef.current && activeTab) {
      const current = editorRef.current.getValue()
      if (current !== activeTab.sql) {
        editorRef.current.setValue(activeTab.sql)
      }
    }
  }, [activeTabId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 쿼리 실행 ─────────────────────────────────────────────────────────
  function runQuery(selectionOnly = false) {
    if (!activeTab || !activeTabId) return
    const connId = activeTab.connId ?? selectedConnId
    if (!connId) {
      toast.error('연결을 먼저 선택하세요')
      return
    }

    const editor = editorRef.current
    if (!editor) return

    let sql: string
    if (selectionOnly) {
      const selection = editor.getSelection()
      sql = selection ? editor.getModel()?.getValueInRange(selection) ?? '' : editor.getValue()
    } else {
      sql = editor.getValue()
    }

    if (!sql.trim()) {
      toast.error('실행할 SQL을 입력하세요')
      return
    }

    const connName = activeConnections.find((c) => c.id === connId)?.name ?? connId
    const database = activeTab?.database ?? selectedDatabase ?? ''

    runWithPlaceholderCheck({
      tabId: activeTabId,
      sql,
      execute: (resolvedSql) =>
        execute({ tabId: activeTabId, connId, connName, database, sql: resolvedSql }),
    })
  }
  // Monaco command handler가 ref를 통해 최신 runQuery를 호출하도록 매 렌더마다 동기화
  runQueryRef.current = runQuery

  async function handleCancel() {
    // tabId를 cancelKey로 전달 — 같은 연결을 공유하는 다른 탭에 영향 없음
    if (!activeTabId) return
    try {
      await CancelQuery(activeTabId)
      toast.success('쿼리 취소 요청')
    } catch (e) {
      toast.error('취소 실패')
    }
  }

  function handleEditorChange(value: string | undefined) {
    if (activeTabId) {
      updateTab(activeTabId, { sql: value ?? '' })
    }
  }

  function startTabRename(tabId: string, currentTitle: string) {
    setEditingTabId(tabId)
    setEditingTitle(currentTitle)
    // 다음 렌더 후 인풋에 포커스
    setTimeout(() => tabInputRef.current?.select(), 0)
  }

  function commitTabRename() {
    if (editingTabId && editingTitle.trim()) {
      updateTab(editingTabId, { title: editingTitle.trim() })
    }
    setEditingTabId(null)
  }

  function cancelTabRename() {
    setEditingTabId(null)
  }

  // ── 테마별 색상 ──────────────────────────────────────────────────────────
  const tabBarBg   = isDark ? 'bg-[#161b27] border-[#2d3748]' : 'bg-[#f3f4f6] border-[#e5e7eb]'
  const tabBorderR = isDark ? 'border-[#2d3748]' : 'border-[#e5e7eb]'
  const tabActive  = isDark ? 'bg-[#0f1117] text-[#e2e8f0]' : 'bg-white text-[#111827]'
  const tabInactive = isDark ? 'text-[#718096] hover:text-[#e2e8f0] hover:bg-[#1e2230]' : 'text-[#6b7280] hover:text-[#111827] hover:bg-[#e5e7eb]'
  const tabCloseHover = isDark ? 'hover:bg-[#2d3748]' : 'hover:bg-[#d1d5db]'
  const addTabBtn  = isDark ? 'text-[#718096] hover:text-[#e2e8f0] hover:bg-[#1e2230]' : 'text-[#9ca3af] hover:text-[#374151] hover:bg-[#e5e7eb]'
  const tabInputCls = isDark
    ? 'bg-[#1a2130] text-[#e2e8f0] outline-[#4299e1]'
    : 'bg-white text-[#111827] outline-[#4299e1]'
  const connBarBg  = isDark ? 'bg-[#161b27] border-[#2d3748] text-[#718096]' : 'bg-[#f9fafb] border-[#e5e7eb] text-[#9ca3af]'
  const histBg     = isDark ? 'bg-[#0f1117] border-[#2d3748]' : 'bg-white border-[#e5e7eb]'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 탭 바 — hideTabBar=true일 때 숨김 (UnifiedTabBar가 대신 렌더링) */}
      {!hideTabBar && <div className={`flex items-center border-b shrink-0 overflow-x-auto ${tabBarBg}`}>
        {queryTabs.map((tab, idx) => {
          const isFirstTab = idx === 0
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer border-r shrink-0 select-none transition-colors ${tabBorderR}
                ${activeTabId === tab.id ? tabActive : tabInactive}`}
              onClick={() => { if (editingTabId !== tab.id) setActiveTab(tab.id) }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setActiveTab(tab.id)
                setTabCtxMenu({ x: e.clientX, y: e.clientY, tabId: tab.id })
              }}
            >
              {editingTabId === tab.id ? (
                <input
                  ref={tabInputRef}
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitTabRename() }
                    if (e.key === 'Escape') { e.preventDefault(); cancelTabRename() }
                  }}
                  onBlur={commitTabRename}
                  onClick={(e) => e.stopPropagation()}
                  className={`max-w-[120px] text-xs outline outline-1 rounded px-1 py-0.5 ${tabInputCls}`}
                  style={{ width: `${Math.max(60, editingTitle.length * 7 + 16)}px` }}
                />
              ) : (
                <span
                  className="max-w-[120px] truncate"
                  onDoubleClick={(e) => { e.stopPropagation(); startTabRename(tab.id, tab.title) }}
                  title="더블클릭으로 이름 편집"
                >
                  {tab.title}
                </span>
              )}
              {tab.isRunning && <span className="w-1.5 h-1.5 rounded-full bg-[#68d391] animate-pulse" />}
              {!isFirstTab && (
                <button
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                  className={`opacity-0 group-hover:opacity-100 rounded p-0.5 transition-opacity ${tabCloseHover}`}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )
        })}
        <button
          onClick={() => addTab(selectedConnId ?? undefined, selectedDatabase ?? undefined)}
          className={`p-2 transition-colors shrink-0 ${addTabBtn}`}
          title="새 탭"
        >
          <Plus size={13} />
        </button>

        {/* 히스토리 + 실행 버튼 (우측 고정) */}
        <div className="ml-auto flex items-center gap-1 px-2 shrink-0">
          {activeTab?.isRunning ? (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-[#fc8181]/20 text-[#fc8181] hover:bg-[#fc8181]/30 transition-colors"
            >
              <Square size={11} />
              취소
            </button>
          ) : (
            <button
              onClick={() => runQuery()}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-[#4299e1] hover:bg-[#3182ce] text-white transition-colors disabled:opacity-50"
            >
              <Play size={11} />
              실행 <kbd className="opacity-60 text-[9px]">F9</kbd>
            </button>
          )}
        </div>
      </div>}

      {/* 쿼리 탭 컨텍스트 메뉴 */}
      {!hideTabBar && tabCtxMenu && (() => {
        const ctxTabIdx = queryTabs.findIndex((t) => t.id === tabCtxMenu.tabId)
        const isFirst = ctxTabIdx === 0
        const hasRight = ctxTabIdx >= 0 && ctxTabIdx < queryTabs.length - 1
        const hasMultiple = queryTabs.length > 1
        const items: ContextMenuOption[] = [
          {
            label: t('tabCtxNewTab', language),
            icon: <Plus size={12} />,
            onClick: () => addTab(selectedConnId ?? undefined, selectedDatabase ?? undefined),
          },
          { separator: true },
          {
            label: t('tabCtxCloseTab', language),
            icon: <X size={12} />,
            onClick: () => closeTab(tabCtxMenu.tabId),
            disabled: isFirst,
          },
          {
            label: t('tabCtxCloseRight', language),
            onClick: () => closeTabsToRight(tabCtxMenu.tabId),
            disabled: !hasRight,
          },
          {
            label: t('tabCtxCloseAll', language),
            onClick: () => closeAllTabs(),
            disabled: !hasMultiple,
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

      {/* 연결 상태 표시 바 */}
      {(activeTab?.connId ?? selectedConnId) && (
        <div className={`flex items-center gap-2 px-3 py-1 text-[10px] border-b shrink-0 ${connBarBg}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#68d391]" />
          {activeTab?.database ?? selectedDatabase ?? '(DB 미선택)'}
        </div>
      )}

      {/* Monaco 에디터 / 히스토리 패널 (Toolbar에서 제어) */}
      <div className="flex-1 overflow-hidden relative">
        {showHistory && (
          <div className={`absolute inset-0 z-20 border-r ${histBg}`}>
            <QueryHistory onClose={onHideHistory ?? (() => {})} />
          </div>
        )}
        <Editor
          language="sql"
          value={activeTab?.sql ?? ''}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          theme={isDark ? 'vs-dark' : 'light'}
          options={{
            fontSize: editorSettings.fontSize,
            fontFamily: editorSettings.fontFamily,
            fontLigatures: true,
            minimap: { enabled: editorSettings.minimap },
            lineNumbers: editorSettings.lineNumbers,
            roundedSelection: true,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: editorSettings.tabSize,
            wordWrap: editorSettings.wordWrap,
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, comments: false, strings: false },
            acceptSuggestionOnEnter: 'smart',
            padding: { top: 8, bottom: 8 },
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            renderLineHighlight: 'line',
            overviewRulerLanes: 0,
          }}
        />
      </div>
    </div>
  )
}
