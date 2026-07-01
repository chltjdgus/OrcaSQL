import React, { useRef, useState } from 'react'
import { Info, Table2, Clock, Plus, X } from 'lucide-react'
import { useConnectionStore } from '@/stores/connectionStore'
import { useTableDesignerStore } from '@/stores/useTableDesignerStore'
import { useThemeStore } from '@/stores/useThemeStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import ContextMenu, { type ContextMenuOption } from '@/components/ContextMenu'
import type { ToolTab, TableInfo } from '@/types'

export default function UnifiedTabBar({
  activeToolTab, onSelectToolTab, selectedTable,
}: {
  activeToolTab: ToolTab | null
  onSelectToolTab: (t: ToolTab | null) => void
  selectedTable: { connId: string; db: string; table: TableInfo } | null
}) {
  const { queryTabs, activeTabId, setActiveTab, addTab, closeTab, closeAllTabs, closeTabsToRight, updateTab } = useConnectionStore()
  // Info 탭은 (a) 트리에서 테이블이 선택됐거나 (b) Designer store 가 신규 생성/편집 메타를 보유 중이면 표시
  const designerHasMeta = useTableDesignerStore((s) => !!s.editedMeta)
  const { selectedConnId, selectedDatabase } = useConnectionStore()
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const language = useLanguageStore((s) => s.language)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const tabInputRef = useRef<HTMLInputElement | null>(null)
  const [tabCtxMenu, setTabCtxMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)

  const tabBarBg      = isDark ? 'bg-[#161b27] border-[#2d3748]' : 'bg-[#f3f4f6] border-[#e5e7eb]'
  const tabBorderR    = isDark ? 'border-[#2d3748]' : 'border-[#e5e7eb]'
  const tabActive     = isDark ? 'bg-[#0f1117] text-[#e2e8f0]' : 'bg-white text-[#111827]'
  const tabInactive   = isDark ? 'text-[#718096] hover:text-[#e2e8f0] hover:bg-[#1e2230]' : 'text-[#6b7280] hover:text-[#111827] hover:bg-[#e5e7eb]'
  const tabCloseHover = isDark ? 'hover:bg-[#2d3748]' : 'hover:bg-[#d1d5db]'
  const addTabBtn     = isDark ? 'text-[#718096] hover:text-[#e2e8f0] hover:bg-[#1e2230]' : 'text-[#9ca3af] hover:text-[#374151] hover:bg-[#e5e7eb]'
  const tabInputCls   = isDark ? 'bg-[#1a2130] text-[#e2e8f0] outline-[#4299e1]' : 'bg-white text-[#111827] outline-[#4299e1]'
  const toolActive    = isDark ? 'border-[#4299e1] text-[#4299e1] bg-[#0f1117]' : 'border-[#3182ce] text-[#2563eb] bg-[#ffffff]'
  const toolInactive  = isDark ? 'border-transparent text-[#718096] hover:text-[#e2e8f0] hover:bg-[#1e2230]' : 'border-transparent text-[#64748b] hover:text-[#1e293b] hover:bg-[#e2e8f0]'

  function startTabRename(tabId: string, currentTitle: string) {
    setEditingTabId(tabId)
    setEditingTitle(currentTitle)
    setTimeout(() => tabInputRef.current?.select(), 0)
  }
  function commitTabRename() {
    if (editingTabId && editingTitle.trim()) updateTab(editingTabId, { title: editingTitle.trim() })
    setEditingTabId(null)
  }
  function cancelTabRename() { setEditingTabId(null) }

  const toolTabs: { id: ToolTab; label: string; icon: React.ReactNode }[] = [
    ...((selectedTable || designerHasMeta) ? [
      { id: 'info' as ToolTab, label: 'Info', icon: <Info size={12} className="text-[#4299e1]" /> },
    ] : []),
    ...(selectedTable ? [
      { id: 'tableData' as ToolTab, label: 'Data', icon: <Table2 size={12} className="text-[#f6ad55]" /> },
    ] : []),
    { id: 'history', label: 'History', icon: <Clock size={12} /> },
  ]

  return (
    <div className={`osql-unified-tabbar flex items-center border-b shrink-0 overflow-x-auto ${tabBarBg}`}>
      {/* Tool tabs (좌측) */}
      {toolTabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelectToolTab(activeToolTab === tab.id ? null : tab.id)}
          className={`flex items-center gap-1.5 px-3 py-2 text-[11px] border-b-2 transition-colors shrink-0
            ${activeToolTab === tab.id ? toolActive : toolInactive}`}
        >
          {tab.icon}
          {tab.label}
          {tab.id === 'tableData' && selectedTable && (
            <span className="ml-1 text-[9px] text-[#4a5568] font-mono">
              {selectedTable.table.name}
            </span>
          )}
        </button>
      ))}

      {/* 구분선 */}
      <div className={`w-px h-4 mx-1 shrink-0 ${isDark ? 'bg-[#2d3748]' : 'bg-[#e5e7eb]'}`} />

      {/* Query tabs (중앙) */}
      {queryTabs.map((tab, idx) => {
        const isFirstTab = idx === 0
        return (
          <div
            key={tab.id}
            className={`group flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer border-r shrink-0 select-none transition-colors ${tabBorderR}
              ${activeTabId === tab.id && activeToolTab === null ? tabActive : tabInactive}`}
            onClick={() => {
              if (editingTabId !== tab.id) {
                setActiveTab(tab.id)
                onSelectToolTab(null)
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setActiveTab(tab.id)
              onSelectToolTab(null)
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
            {/* 첫 탭은 항상 활성 → 닫기 버튼 비표시 */}
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

      {/* + 새 탭 */}
      <button
        onClick={() => {
          addTab(selectedConnId ?? undefined, selectedDatabase ?? undefined)
          onSelectToolTab(null)
        }}
        className={`p-2 transition-colors shrink-0 ${addTabBtn}`}
        title="새 탭"
      >
        <Plus size={13} />
      </button>

      {/* 쿼리 탭 컨텍스트 메뉴 */}
      {tabCtxMenu && (() => {
        const ctxTabIdx = queryTabs.findIndex((t) => t.id === tabCtxMenu.tabId)
        const isFirst = ctxTabIdx === 0
        const hasRight = ctxTabIdx >= 0 && ctxTabIdx < queryTabs.length - 1
        const hasMultiple = queryTabs.length > 1
        const items: ContextMenuOption[] = [
          {
            label: t('tabCtxNewTab', language),
            icon: <Plus size={12} />,
            onClick: () => {
              addTab(selectedConnId ?? undefined, selectedDatabase ?? undefined)
              onSelectToolTab(null)
            },
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

    </div>
  )
}
