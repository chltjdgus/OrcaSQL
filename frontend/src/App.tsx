import { useEffect, useRef, useCallback, useState, Suspense, lazy } from 'react'
import { useToolModals } from './App/useToolModals'
import { useSessionRestore } from './App/useSessionRestore'
import { useGlobalShortcuts } from './App/useGlobalShortcuts'
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels'
import type { editor } from 'monaco-editor'
import { SetQueryTimeout } from '@/wailsjs/go/main/App'
import { useConnectionStore } from '@/stores/connectionStore'
import { useTableDesignerStore } from '@/stores/useTableDesignerStore'
import { useThemeStore } from '@/stores/useThemeStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import { useQueryExec } from '@/hooks/useQueryExec'
import { runWithPlaceholderCheck } from '@/stores/usePlaceholderStore'
import SchemaTree from '@/components/SchemaTree'
import QueryEditor from '@/components/QueryEditor'
import PlaceholderModalHost from '@/components/QueryEditor/PlaceholderModalHost'
import ResultPanel from '@/components/ResultPanel'
import MessagesFooter from '@/components/MessagesFooter'
import Toolbar from '@/components/Toolbar'
import StatusBar from '@/components/StatusBar'
import MenuBar from '@/components/MenuBar'
// Bundle 분할 — 무거운/조건부 모달은 lazy import 로 main chunk 에서 제외 (BugFix-BZ).
// 모두 첫 화면에서 보이지 않는 ToolModal 안에 마운트되므로 사용자가 메뉴/단축키로 열 때
// 처음 한 번만 fetch + parse → 메인 부팅 비용에서 빠짐.
const Favorites      = lazy(() => import('@/components/Favorites'))
const ProcessList    = lazy(() => import('@/components/ProcessList'))
const ServerVars     = lazy(() => import('@/components/ServerVars'))
const UserManager    = lazy(() => import('@/components/UserManager'))
const DataSync       = lazy(() => import('@/components/DataSync'))
const BackupPanel    = lazy(() => import('@/components/BackupPanel'))
const SchemaSync     = lazy(() => import('@/components/SchemaSync'))
const DataSearch     = lazy(() => import('@/components/DataSearch'))
const ERDiagram      = lazy(() => import('@/components/ERDiagram'))
const SettingsPanel  = lazy(() => import('@/components/SettingsPanel'))
import ConnectionTabBar from '@/components/ConnectionTabBar'
import UnifiedTabBar from './App/UnifiedTabBar'
import InlineResults from './App/InlineResults'
import ToolModal from './App/ToolModal'
import NoConnMsg from './App/NoConnMsg'
import type { TableInfo, ToolTab } from '@/types'

/**
 * 통합 레이아웃:
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  TitleBar / MenuBar / Toolbar / ConnectionTabBar                 │
 * ├──────────────┬──────────────────────────────────────────────────┤
 * │              │ [Info][Data][History] ┊ [Q1][Q2][+] ▶실행 │
 * │  Object      ├──────────────────────────────────────────────────┤
 * │  Browser     │  activeToolTab === null:                         │
 * │              │    Monaco 에디터                                 │
 * │              │    ──── resize ────                              │
 * │              │    InlineResults 그리드                          │
 * │              │  activeToolTab !== null:                         │
 * │              │    해당 Tool Tab 콘텐츠                          │
 * │              ├──────────────────────────────────────────────────┤
 * │              │  Messages Footer (항상 표시, 높이 조절)          │
 * ├──────────────┴──────────────────────────────────────────────────┤
 * │  StatusBar                                                       │
 * └─────────────────────────────────────────────────────────────────┘
 */
export default function App() {
  const flushSession = useConnectionStore((s) => s.flushSession)
  const queryTabs = useConnectionStore((s) => s.queryTabs)
  const activeTabId = useConnectionStore((s) => s.activeTabId)
  const activeTab = queryTabs.find((t) => t.id === activeTabId) ?? null
  const { selectedConnId, selectedDatabase, activeConnections } = useConnectionStore()
  const { execute } = useQueryExec()
  const { theme } = useThemeStore()
  const language = useLanguageStore((s) => s.language)
  const queryTimeout = useSettingsStore((s) => s.settings.query.queryTimeout)
  // 도구 모달 11개 show-state + Settings initialTab + openSettings 헬퍼는 useToolModals 로 위임.
  // 본 함수 안에서는 destructure 로 개별 변수 사용, useGlobalShortcuts 에는 modals 객체 그대로 전달.
  const modals = useToolModals()
  const {
    showHistory, setShowHistory,
    showFavorites, setShowFavorites,
    showProcessList, setShowProcessList,
    showServerVars, setShowServerVars,
    showUserManager, setShowUserManager,
    showDataSync, setShowDataSync,
    showBackup, setShowBackup,
    showSchemaSync, setShowSchemaSync,
    showDataSearch, setShowDataSearch,
    showERDiagram, setShowERDiagram,
    showSettings, setShowSettings,
    settingsInitialTab,
    openSettings,
  } = modals

  /** 활성 도구 탭 (null = query workspace 표시) */
  const [activeToolTab, setActiveToolTab] = useState<ToolTab | null>(null)

  /** 트리에서 단일 클릭된 테이블 → TableData / Info 탭 표시 */
  const [selectedTableForProps, setSelectedTableForProps] = useState<{
    connId: string; db: string; table: TableInfo
  } | null>(null)

  /**
   * "테이블 생성" 메뉴 → Info 도구 탭을 신규 생성 모드로 진입.
   * 기존 테이블 편집은 onTableSelect 의 단일 클릭 경로(=Info 편집 모드) 와 통합.
   */
  const openNewTable = useCallback((connId: string, database: string) => {
    useTableDesignerStore.getState().initNewTable(connId, database)
    setSelectedTableForProps(null)
    setActiveToolTab('info')
  }, [])

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  /**
   * react-resizable-panels v4 — 영구 레이아웃 (이전 v3 `autoSaveId` 자동 마이그레이션 지원).
   * 각 Group 의 `defaultLayout` / `onLayoutChanged` 에 연결.
   */
  const mainLayout = useDefaultLayout({ id: 'main-layout', storage: localStorage })
  const workspaceFooterLayout = useDefaultLayout({ id: 'workspace-footer-layout', storage: localStorage })
  const editorInlineResultLayout = useDefaultLayout({ id: 'editor-inlineresult-layout', storage: localStorage })

  /** Messages footer 패널 — 접기 버튼이 imperative API 로 collapse/expand 트리거. */
  const messagesFooterRef = usePanelRef()

  /**
   * 테이블 단일 클릭 → Info 탭 전환을 짧게 지연해 더블클릭과 구분.
   * 더블클릭이 도착하면 이 타이머를 취소하여 activeToolTab 이 그대로 유지됨.
   */
  const pendingTableClickRef = useRef<number | null>(null)

  const { addTab } = useConnectionStore()

  // 브라우저 기본 우클릭 컨텍스트 메뉴(검사 등) 전역 차단
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault()
    document.addEventListener('contextmenu', handler)
    return () => document.removeEventListener('contextmenu', handler)
  }, [])

  // 앱 시작: 저장된 쿼리 타임아웃을 Go 백엔드에 복원
  useEffect(() => {
    if (queryTimeout !== 30) {
      SetQueryTimeout(queryTimeout).catch(console.error)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 앱 시작: 저장된 연결 로드 + 이전 세션 복원 + 자동 재연결 (BugFix-BK) — useSessionRestore 에 위임.
  useSessionRestore({ language })

  // Phase 14-B: 앱 종료 직전 최종 저장 (debounce 대기 중인 타이머를 flush)
  useEffect(() => {
    const handleBeforeUnload = () => { flushSession() }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [flushSession])

  // 연결 전환 → query workspace로 복귀
  useEffect(() => {
    setActiveToolTab(null)
  }, [selectedConnId])

  // selectedTable 해제 → tableData 탭에서 query workspace로 복귀.
  // info 탭은 신규 생성 모드(store.mode === 'create')일 수 있으므로 자동으로 닫지 않는다.
  useEffect(() => {
    if (!selectedTableForProps && activeToolTab === 'tableData') {
      setActiveToolTab(null)
    }
    if (!selectedTableForProps && activeToolTab === 'info') {
      const designerMode = useTableDesignerStore.getState().mode
      if (designerMode !== 'create') setActiveToolTab(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTableForProps])

  const getSQL = useCallback(() => editorRef.current?.getValue() ?? '', [])
  const setSQL = useCallback((sql: string) => editorRef.current?.setValue(sql), [])

  // ─── 전역 단축키 (BugFix-AZ: SQLyog 호환) — useGlobalShortcuts 에 위임 ───
  useGlobalShortcuts({ runQuery, editorRef, setActiveToolTab, modals })

  function runQuery(selectionOnly = false) {
    if (!activeTabId) return
    const connId = activeTab?.connId ?? selectedConnId
    if (!connId) return
    let sql: string
    if (selectionOnly) {
      const ed = editorRef.current
      const sel = ed?.getSelection()
      const selText = sel ? ed?.getModel()?.getValueInRange(sel) ?? '' : ''
      // 선택 영역이 비어있으면 전체로 fallback (글로벌 단축키에서 호출 시 자연스러운 동작)
      sql = selText.trim() ? selText : (ed?.getValue() ?? '')
    } else {
      sql = getSQL()
    }
    if (!sql.trim()) return
    const connName = activeConnections.find((c) => c.id === connId)?.name ?? connId
    const database = activeTab?.database ?? selectedDatabase ?? ''
    runWithPlaceholderCheck({
      tabId: activeTabId,
      sql,
      execute: (resolvedSql) =>
        execute({ tabId: activeTabId, connId, connName, database, sql: resolvedSql }),
    })
  }

  function insertAtCursor(text: string) {
    const editor = editorRef.current
    if (!editor) return
    const selection = editor.getSelection()
    if (selection) {
      editor.executeEdits('tree-insert', [{ range: selection, text, forceMoveMarkers: true }])
    } else {
      const pos = editor.getPosition()
      if (pos) {
        const range = { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }
        editor.executeEdits('tree-insert', [{ range, text, forceMoveMarkers: true }])
      }
    }
    editor.focus()
  }

  /**
   * 스키마 트리 DB/테이블 더블클릭:
   *  - 쿼리 탭이 이미 보이는 상태면 현재 탭 에디터의 커서 위치에 이름 삽입
   *  - tool 탭이 떠 있거나 활성 쿼리 탭이 없으면 새 쿼리 탭 생성 + 초기 SQL 로 이름 삽입
   *
   * 테이블 단일 클릭이 Info 탭 전환을 예약해둔 경우 취소해,
   * 더블클릭이 도착한 시점의 activeToolTab 값이 분기에 그대로 반영되게 한다.
   */
  function handleTreeNameDoubleClick(text: string, connId: string, db: string) {
    if (pendingTableClickRef.current !== null) {
      clearTimeout(pendingTableClickRef.current)
      pendingTableClickRef.current = null
    }
    if (activeToolTab === null && activeTabId) {
      insertAtCursor(text)
    } else {
      addTab(connId, db, text)
      setActiveToolTab(null)
    }
  }

  const selectLimit = useSettingsStore((s) => s.settings.query.selectLimit)
  function openTableDirectly(connId: string, db: string, tableName: string) {
    const sql = `SELECT * FROM \`${db}\`.\`${tableName}\` LIMIT ${selectLimit};`
    const connName = activeConnections.find((c) => c.id === connId)?.name ?? connId
    const tabId = addTab(connId, db, sql)
    execute({ tabId, connId, connName, database: db, sql })
    setActiveToolTab(null)
  }

  const bgClass = theme === 'dark' ? 'bg-[#0f1117] text-[#e2e8f0]' : 'bg-white text-[#1a202c]'

  return (
    <div className={`osql-app-root flex flex-col h-full w-full overflow-hidden ${bgClass}`}>
      <MenuBar
        onNewConn={() => window.dispatchEvent(new CustomEvent('session:open'))}
        onExecute={() => runQuery()}
        onExecuteSelection={() => runQuery(true)}
        onGetSQL={getSQL}
        onSetSQL={(sql) => setSQL(sql)}
        onShowHistory={() => setShowHistory((v) => !v)}
        onShowFavorites={() => setShowFavorites((v) => !v)}
        onShowProcessList={() => setShowProcessList((v) => !v)}
        onShowServerVars={() => setShowServerVars((v) => !v)}
        onShowUserManager={() => setShowUserManager((v) => !v)}
        onOpenDataSync={() => setShowDataSync(true)}
        onOpenBackup={() => setShowBackup(true)}
        onOpenSync={() => setShowSchemaSync(true)}
        onOpenSearch={() => setShowDataSearch(true)}
        onOpenER={() => setShowERDiagram(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <Toolbar
        onExecute={() => runQuery()}
        onExecuteSelection={() => runQuery(true)}
        onGetSQL={getSQL}
        onSetSQL={(sql) => setSQL(sql)}
        onShowHistory={() => setShowHistory((v) => !v)}
        onShowFavorites={() => setShowFavorites((v) => !v)}
        showFavorites={showFavorites}
        activeToolTab={activeToolTab}
      />

      <ConnectionTabBar />

      {/* 메인 레이아웃 */}
      <div className="osql-main flex-1 overflow-hidden">
        <Group
          orientation="horizontal"
          defaultLayout={mainLayout.defaultLayout}
          onLayoutChanged={mainLayout.onLayoutChanged}
        >

          {/* 좌측 Object Browser */}
          <Panel
            id="sidebar"
            defaultSize="18%"
            minSize="12%"
            maxSize="32%"
            className="osql-sidebar flex flex-col overflow-hidden border-r border-[#2d3748]"
          >
            {showFavorites ? (
              <div className="flex-1 overflow-hidden">
                <Suspense fallback={null}>
                  <Favorites
                    onClose={() => setShowFavorites(false)}
                    onInsertSQL={(sql) => insertAtCursor(sql)}
                    getSelectedSQL={() => {
                      const editor = editorRef.current
                      if (!editor) return ''
                      const sel = editor.getSelection()
                      if (!sel) return ''
                      return editor.getModel()?.getValueInRange(sel) ?? ''
                    }}
                  />
                </Suspense>
              </div>
            ) : (
              <div className="flex-1 overflow-hidden">
                <SchemaTree
                  onTableSelect={(cId, db, table) => {
                    // 더블클릭과 구분을 위해 짧게 지연 — 더블클릭 핸들러가 타이머 취소
                    if (pendingTableClickRef.current !== null) {
                      clearTimeout(pendingTableClickRef.current)
                    }
                    pendingTableClickRef.current = window.setTimeout(() => {
                      setSelectedTableForProps({ connId: cId, db, table })
                      setActiveToolTab('info')
                      pendingTableClickRef.current = null
                    }, 220)
                  }}
                  onNameDoubleClick={handleTreeNameDoubleClick}
                  onOpenTableDirectly={openTableDirectly}
                  onOpenNewTable={openNewTable}
                />
              </div>
            )}
          </Panel>

          <Separator className="osql-separator-horizontal" />

          {/* 우측: 통합 워크스페이스 */}
          <Panel id="workspace" defaultSize="82%" className="osql-workspace flex flex-col overflow-hidden">
            <Group
              orientation="vertical"
              defaultLayout={workspaceFooterLayout.defaultLayout}
              onLayoutChanged={workspaceFooterLayout.onLayoutChanged}
            >

              {/* Main workspace */}
              <Panel id="workspace-main" defaultSize="85%" minSize="40%" className="osql-workspace-main flex flex-col overflow-hidden">
                <UnifiedTabBar
                  activeToolTab={activeToolTab}
                  onSelectToolTab={setActiveToolTab}
                  selectedTable={selectedTableForProps}
                />
                <div className="flex-1 overflow-hidden relative">

                  {/* Query workspace — 항상 mount, tool탭 활성 시 display:none (Monaco 상태 보존) */}
                  <div
                    className="osql-query-workspace absolute inset-0 flex flex-col"
                    style={{ display: activeToolTab === null ? 'flex' : 'none' }}
                  >
                    <Group
                      orientation="vertical"
                      defaultLayout={editorInlineResultLayout.defaultLayout}
                      onLayoutChanged={editorInlineResultLayout.onLayoutChanged}
                    >
                      <Panel id="editor" minSize="15%">
                        <QueryEditor
                          hideTabBar
                          editorRef={editorRef}
                          showHistory={showHistory}
                          onHideHistory={() => setShowHistory(false)}
                        />
                      </Panel>
                      <Separator className="osql-separator-vertical" />
                      <Panel id="inline-results" minSize="10%">
                        <InlineResults
                          result={activeTab?.result ?? null}
                          results={activeTab?.results ?? []}
                          isRunning={activeTab?.isRunning ?? false}
                          editCtx={activeTab?.editCtx}
                          connId={activeTab?.connId ?? selectedConnId ?? undefined}
                          explainData={activeTab?.explainData}
                        />
                      </Panel>
                    </Group>
                  </div>

                  {/* Tool tab content */}
                  {activeToolTab !== null && (
                    <div className="osql-tool-tab-content absolute inset-0">
                      <ResultPanel
                        currentResult={activeTab?.result ?? null}
                        selectedTable={selectedTableForProps}
                        externalActiveTab={activeToolTab}
                        onCloseToolTab={() => setActiveToolTab(null)}
                      />
                    </div>
                  )}

                </div>
              </Panel>

              <Separator className="osql-separator-vertical" />

              {/* Messages footer — 접기 시 타이틀바(28px)만 남기고 패널 자체가 축소 */}
              <Panel
                id="messages-footer"
                defaultSize="15%"
                minSize="4%"
                maxSize="40%"
                collapsible
                collapsedSize={28}
                panelRef={messagesFooterRef}
                className="osql-messages-footer overflow-hidden"
              >
                <MessagesFooter
                  isRunning={activeTab?.isRunning ?? false}
                  panelRef={messagesFooterRef}
                />
              </Panel>

            </Group>
          </Panel>

        </Group>
      </div>

      <StatusBar onOpenSettings={openSettings} />

      {/* ─── Tools 모달 오버레이 ──────────────────────────────────── */}
      {(showProcessList || showServerVars || showUserManager) && (
        <ToolModal
          onClose={() => {
            setShowProcessList(false)
            setShowServerVars(false)
            setShowUserManager(false)
          }}
          title={
            showProcessList ? 'Process List' :
            showServerVars ? 'Server Variables' :
            'User Manager'
          }
        >
          <Suspense fallback={null}>
            {showProcessList && selectedConnId && (
              <ProcessList connId={selectedConnId} onClose={() => setShowProcessList(false)} />
            )}
            {showProcessList && !selectedConnId && <NoConnMsg />}
            {showServerVars && selectedConnId && (
              <ServerVars connId={selectedConnId} onClose={() => setShowServerVars(false)} />
            )}
            {showServerVars && !selectedConnId && <NoConnMsg />}
            {showUserManager && selectedConnId && (
              <UserManager connId={selectedConnId} onClose={() => setShowUserManager(false)} />
            )}
            {showUserManager && !selectedConnId && <NoConnMsg />}
          </Suspense>
        </ToolModal>
      )}

      {showDataSync && (
        <ToolModal onClose={() => setShowDataSync(false)} title="Data Synchronization">
          <Suspense fallback={null}>
            <DataSync onClose={() => setShowDataSync(false)} />
          </Suspense>
        </ToolModal>
      )}

      {showBackup && (
        <ToolModal onClose={() => setShowBackup(false)} title="Backup / SQL Dump">
          {selectedConnId ? (
            <Suspense fallback={null}>
              <BackupPanel
                connId={selectedConnId}
                database={selectedDatabase ?? ''}
                onClose={() => setShowBackup(false)}
              />
            </Suspense>
          ) : (
            <NoConnMsg />
          )}
        </ToolModal>
      )}

      {showSchemaSync && (
        <ToolModal onClose={() => setShowSchemaSync(false)} title="Schema Synchronization">
          <Suspense fallback={null}>
            <SchemaSync onClose={() => setShowSchemaSync(false)} />
          </Suspense>
        </ToolModal>
      )}

      {showDataSearch && (
        <ToolModal onClose={() => setShowDataSearch(false)} title="Data Search">
          <Suspense fallback={null}>
            <DataSearch onClose={() => setShowDataSearch(false)} />
          </Suspense>
        </ToolModal>
      )}

      {showERDiagram && (
        <ToolModal onClose={() => setShowERDiagram(false)} title="ER Diagram">
          {selectedConnId && selectedDatabase ? (
            <Suspense fallback={null}>
              <ERDiagram
                connId={selectedConnId}
                database={selectedDatabase}
                onClose={() => setShowERDiagram(false)}
              />
            </Suspense>
          ) : (
            <NoConnMsg />
          )}
        </ToolModal>
      )}

      {showSettings && (
        <ToolModal onClose={() => setShowSettings(false)} title={t('settings', language)} size="settings">
          <Suspense fallback={null}>
            <SettingsPanel onClose={() => setShowSettings(false)} initialTab={settingsInitialTab} />
          </Suspense>
        </ToolModal>
      )}

      {/* placeholder 입력 모달 — 어떤 실행 경로(에디터·MenuBar·글로벌 단축키)든 통일된 흐름 */}
      <PlaceholderModalHost />
    </div>
  )
}
