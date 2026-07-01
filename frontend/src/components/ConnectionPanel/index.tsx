import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Plus, RefreshCw, Plug, PlugZap, Trash2, Edit2, Upload, Download,
  ChevronRight, ChevronDown, FolderPlus, Folder, FolderOpen,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Connect,
  Disconnect,
  SaveConnection,
  DeleteConnection,
  ExportConnections,
  ImportConnections,
  GetSavedConnections,
  GetSessionGroups,
  SaveSessionGroup,
  DeleteSessionGroup,
} from '@/wailsjs/go/main/App'
import { useConnectionStore } from '@/stores/connectionStore'
import { logMsg } from '@/stores/useMessagesLogStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import { nativeConfirm } from '@/utils/nativeConfirm'
import type { ConnectConfig, SessionGroup } from '@/types'
import ConnectionModal from './ConnectionModal'

// 색상 팔레트
const GROUP_COLORS = [
  '#4299e1', '#68d391', '#fc8181', '#f6ad55',
  '#9f7aea', '#76e4f7', '#fbd38d', '#b794f4',
]

/**
 * 좌측 사이드바 상단: 저장된 연결 목록 및 연결/해제 버튼.
 * 그룹(폴더)별로 연결을 분류하여 표시한다.
 */
export default function ConnectionPanel() {
  const language = useLanguageStore((s) => s.language)
  const {
    savedConnections, activeConnections,
    addActiveConnection, removeActiveConnection,
    removeSavedConnection, setSavedConnections, setSelectedConn, selectedConnId,
    groups, setGroups, addOrUpdateGroup, removeGroup,
  } = useConnectionStore()

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ConnectConfig | null>(null)
  const [newGroupTarget, setNewGroupTarget] = useState<string | null>(null) // groupId preselect for modal
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 그룹 접기/펼치기 상태 (groupId → boolean)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  // 인라인 그룹 추가 입력
  const [addingGroup, setAddingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0])
  // 그룹 이름 인라인 편집
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const newGroupInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // 초기 로드
  useEffect(() => {
    GetSessionGroups().then(setGroups).catch(() => { toast.error(t('cpGroupLoadFail', language)) })
  }, [setGroups])

  useEffect(() => {
    if (addingGroup) newGroupInputRef.current?.focus()
  }, [addingGroup])

  useEffect(() => {
    if (renamingGroupId) renameInputRef.current?.focus()
  }, [renamingGroupId])

  // ─── Import / Export ──────────────────────────────────────────────────
  async function handleExport() {
    try {
      const json = await ExportConnections()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'orcasql_connections.json'
      a.click()
      URL.revokeObjectURL(url)
      toast.success(t('cpExportDone', language))
    } catch (e) {
      toast.error(`${t('cpExportFailPrefix', language)}${e}`)
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      const added = await ImportConnections(text)
      const [configs, grps] = await Promise.all([GetSavedConnections(), GetSessionGroups()])
      setSavedConnections(configs ?? [])
      setGroups(grps ?? [])
      toast.success(`${added}${t('cpImportDoneSuffix', language)}`)
    } catch (e) {
      toast.error(`${t('cpImportFailPrefix', language)}${e}`)
    }
    e.target.value = ''
  }

  // ─── 연결 CRUD ───────────────────────────────────────────────────────
  const activeIds = new Set(activeConnections.map((c) => c.id))

  async function handleConnect(cfg: ConnectConfig) {
    // BugFix-CX: 같은 창에 host+port+user 가 같은 활성 세션이 있으면 기존 탭으로 전환.
    const dup = useConnectionStore.getState().findActiveDuplicate(cfg.host, cfg.port, cfg.user)
    if (dup) {
      useConnectionStore.getState().setActiveSession(dup.id)
      toast(t('toastDuplicateSwitched', language))
      logMsg({ kind: 'connection', level: 'info', title: `${t('cpSwitchedTabPrefix', language)}${dup.name}`, connName: dup.name })
      return
    }
    try {
      const connId = await Connect(cfg)
      addActiveConnection({
        id: connId, name: cfg.name, host: cfg.host, port: cfg.port,
        user: cfg.user, database: cfg.database, connectedAt: new Date().toISOString(),
      })
      setSelectedConn(connId)
      toast.success(`${cfg.name} ${t('cpConnectedSuffix', language)}`)
      logMsg({ kind: 'connection', level: 'success', title: `${t('cpLogConnectedPrefix', language)}${cfg.name}`, connName: cfg.name })
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      toast.error(`${t('cpConnFailPrefix', language)}${errMsg}`)
      logMsg({ kind: 'connection', level: 'error', title: `${t('cpConnFailPrefix', language)}${cfg.name}`, detail: errMsg, connName: cfg.name })
    }
  }

  async function handleDisconnect(connId: string) {
    try {
      await Disconnect(connId)
      removeActiveConnection(connId)
      if (selectedConnId === connId) setSelectedConn(null)
      toast.success(t('toastDisconnected', language))
    } catch (e) {
      toast.error(`${t('cpDisconnectFailPrefix', language)}${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function handleDelete(cfg: ConnectConfig) {
    const ok = await nativeConfirm({
      title: t('connDeleteTitle', language),
      message: t('connDeleteBody', language).replace('{name}', cfg.name),
      language,
    })
    if (!ok) return
    try {
      await DeleteConnection(cfg.id)
      removeSavedConnection(cfg.id)
      toast.success(t('cpDeleteDone', language))
    } catch (e) {
      toast.error(`${t('cpDeleteFailPrefix', language)}${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function handleSave(cfg: ConnectConfig) {
    try {
      await SaveConnection(cfg)
      useConnectionStore.getState().addOrUpdateSavedConnection(cfg)
      setModalOpen(false)
      setEditTarget(null)
      setNewGroupTarget(null)
      toast.success(t('cpSaveDone', language))
    } catch (e) {
      toast.error(`${t('cpSaveFailPrefix', language)}${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ─── 그룹 CRUD ────────────────────────────────────────────────────────
  async function handleAddGroup() {
    const name = newGroupName.trim()
    if (!name) { setAddingGroup(false); return }
    const grp: SessionGroup = {
      id: '', name, color: newGroupColor,
      parentId: '', order: groups.length,
    }
    try {
      await SaveSessionGroup(grp)
      const updated = await GetSessionGroups()
      setGroups(updated)
      toast.success(language === 'ko' ? `그룹 '${name}' 생성` : `Group '${name}' created`)
    } catch (e) {
      toast.error(`${t('cpGroupCreateFailPrefix', language)}${e}`)
    }
    setAddingGroup(false)
    setNewGroupName('')
    setNewGroupColor(GROUP_COLORS[0])
  }

  async function handleRenameGroup(grp: SessionGroup) {
    const name = renameValue.trim()
    if (!name || name === grp.name) { setRenamingGroupId(null); return }
    try {
      await SaveSessionGroup({ ...grp, name })
      addOrUpdateGroup({ ...grp, name })
    } catch (e) {
      toast.error(`${t('cpGroupRenameFailPrefix', language)}${e}`)
    }
    setRenamingGroupId(null)
  }

  async function handleDeleteGroup(grp: SessionGroup) {
    const hasConns = savedConnections.some((c) => c.groupId === grp.id)
    const msg = (hasConns ? t('groupDeleteBodyWithConns', language) : t('groupDeleteBodyEmpty', language))
      .replace('{name}', grp.name)
    const ok = await nativeConfirm({
      title: t('groupDeleteTitle', language),
      message: msg,
      language,
    })
    if (!ok) return
    try {
      await DeleteSessionGroup(grp.id, false) // cascade=false: 연결은 그룹 해제만
      removeGroup(grp.id)
      // 그룹 해제된 연결의 groupId 초기화
      if (hasConns) {
        const updated = await GetSavedConnections()
        setSavedConnections(updated ?? [])
      }
      toast.success(language === 'ko' ? `그룹 '${grp.name}' 삭제` : `Group '${grp.name}' deleted`)
    } catch (e) {
      toast.error(`${t('cpGroupDeleteFailPrefix', language)}${e}`)
    }
  }

  async function handleMoveToGroup(cfg: ConnectConfig, groupId: string) {
    const updated = { ...cfg, groupId }
    try {
      await SaveConnection(updated)
      useConnectionStore.getState().addOrUpdateSavedConnection(updated)
    } catch (e) {
      toast.error(`${t('cpMoveFailPrefix', language)}${e}`)
    }
  }

  // ─── 렌더 헬퍼 ────────────────────────────────────────────────────────
  const toggleGroup = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  // 그룹별 연결 분류
  const sortedGroups = [...groups].sort((a, b) => a.order - b.order)
  const connsByGroup: Record<string, ConnectConfig[]> = {}
  const ungrouped: ConnectConfig[] = []
  for (const cfg of savedConnections) {
    const gid = cfg.groupId ?? ''
    if (gid && groups.some((g) => g.id === gid)) {
      ;(connsByGroup[gid] ??= []).push(cfg)
    } else {
      ungrouped.push(cfg)
    }
  }

  return (
    <div className="flex flex-col h-48 shrink-0">
      {/* 숨김 파일 입력 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
        <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t('cpHeader', language)}</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            title={t('cpImportTitle', language)}
          >
            <Upload size={12} />
          </button>
          <button
            onClick={handleExport}
            className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            title={t('cpExportTitle', language)}
          >
            <Download size={12} />
          </button>
          <button
            onClick={() => { setAddingGroup(true); setNewGroupName('') }}
            className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            title={t('cpAddGroupTitle', language)}
          >
            <FolderPlus size={12} />
          </button>
          <button
            onClick={() => { setEditTarget(null); setNewGroupTarget(null); setModalOpen(true) }}
            className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            title={t('cpAddConn', language)}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* 연결 목록 */}
      <div className="flex-1 overflow-y-auto">
        {savedConnections.length === 0 && groups.length === 0 ? (
          <div className="px-3 py-4 text-xs text-[var(--color-text-muted)] text-center select-none">
            {t('cpNoConns', language)}<br />
            <button
              onClick={() => { setEditTarget(null); setModalOpen(true) }}
              className="text-[var(--color-accent)] hover:underline mt-1"
            >
              {t('cpAddConn', language)}
            </button>
          </div>
        ) : (
          <>
            {/* 그룹별 연결 */}
            {sortedGroups.map((grp) => {
              const isOpen = !collapsed[grp.id]
              const conns = connsByGroup[grp.id] ?? []
              const isRenaming = renamingGroupId === grp.id

              return (
                <div key={grp.id}>
                  {/* 그룹 헤더 */}
                  <div
                    className="group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-[var(--color-bg-tertiary)] transition-colors select-none"
                    onClick={() => !isRenaming && toggleGroup(grp.id)}
                  >
                    {isOpen
                      ? <ChevronDown size={11} className="text-[var(--color-text-muted)] shrink-0" />
                      : <ChevronRight size={11} className="text-[var(--color-text-muted)] shrink-0" />
                    }
                    {/* 폴더 아이콘 (그룹 색상) */}
                    {isOpen
                      ? <FolderOpen size={12} style={{ color: grp.color ?? 'var(--color-text-muted)' }} className="shrink-0" />
                      : <Folder size={12} style={{ color: grp.color ?? 'var(--color-text-muted)' }} className="shrink-0" />
                    }

                    {/* 그룹 이름 (더블클릭 → 인라인 편집) */}
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => handleRenameGroup(grp)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameGroup(grp)
                          if (e.key === 'Escape') setRenamingGroupId(null)
                          e.stopPropagation()
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 min-w-0 text-xs bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] px-1 py-0.5 rounded outline-none border border-[var(--color-accent)]"
                      />
                    ) : (
                      <span
                        className="flex-1 min-w-0 text-xs text-[var(--color-text-subtle)] truncate"
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          setRenamingGroupId(grp.id)
                          setRenameValue(grp.name)
                        }}
                      >
                        {grp.name}
                        {conns.length > 0 && (
                          <span className="ml-1 text-[10px] text-[var(--color-null)]">({conns.length})</span>
                        )}
                      </span>
                    )}

                    {/* 그룹 액션 (hover) */}
                    {!isRenaming && (
                      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                        {/* 이 그룹에 새 연결 추가 */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditTarget(null)
                            setNewGroupTarget(grp.id)
                            setModalOpen(true)
                          }}
                          className="p-0.5 rounded hover:bg-[#4299e1]/20 text-[var(--color-accent)]"
                          title={t('cpAddConnToGroup', language)}
                        >
                          <Plus size={10} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setRenamingGroupId(grp.id)
                            setRenameValue(grp.name)
                          }}
                          className="p-0.5 rounded hover:bg-[#4299e1]/20 text-[var(--color-text-muted)]"
                          title={t('cpRenameGroupTitle', language)}
                        >
                          <Edit2 size={10} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteGroup(grp) }}
                          className="p-0.5 rounded hover:bg-[#fc8181]/20 text-[var(--color-error)]"
                          title={t('groupDeleteTitle', language)}
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 그룹 내 연결 */}
                  {isOpen && (
                    <div className="pl-4">
                      {conns.length === 0 ? (
                        <div className="px-3 py-1.5 text-[10px] text-[var(--color-null)] italic select-none">
                          {t('cpNoConnInGroup', language)}
                        </div>
                      ) : (
                        conns.map((cfg) => (
                          <ConnectionItemWithMove
                            key={cfg.id}
                            cfg={cfg}
                            activeIds={activeIds}
                            selectedConnId={selectedConnId}
                            groups={groups}
                            onConnect={handleConnect}
                            onDisconnect={handleDisconnect}
                            onEdit={(c) => { setEditTarget(c); setModalOpen(true) }}
                            onDelete={handleDelete}
                            onMoveToGroup={handleMoveToGroup}
                            setSelectedConn={setSelectedConn}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* 그룹 추가 인라인 입력 */}
            {addingGroup && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--color-bg-tertiary)]">
                <FolderPlus size={12} className="text-[var(--color-text-muted)] shrink-0" />
                <input
                  ref={newGroupInputRef}
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onBlur={handleAddGroup}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddGroup()
                    if (e.key === 'Escape') { setAddingGroup(false); setNewGroupName('') }
                  }}
                  placeholder={t('cpGroupNamePh', language)}
                  className="flex-1 text-xs bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] px-1.5 py-0.5 rounded outline-none border border-[var(--color-accent)] placeholder-[var(--color-null)]"
                />
                {/* 색상 선택 */}
                <div className="flex items-center gap-0.5">
                  {GROUP_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewGroupColor(c)}
                      className={`w-3 h-3 rounded-full transition-all ${newGroupColor === c ? 'ring-1 ring-white ring-offset-1 ring-offset-[var(--color-bg-primary)]' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 그룹 없는 연결 */}
            {ungrouped.length > 0 && (
              <>
                {groups.length > 0 && (
                  <div className="px-3 py-1 text-[10px] text-[var(--color-null)] uppercase tracking-wider select-none border-t border-[var(--color-bg-tertiary)] mt-1">
                    {t('cpUngrouped', language)}
                  </div>
                )}
                {ungrouped.map((cfg) => (
                  <ConnectionItemWithMove
                    key={cfg.id}
                    cfg={cfg}
                    activeIds={activeIds}
                    selectedConnId={selectedConnId}
                    groups={groups}
                    onConnect={handleConnect}
                    onDisconnect={handleDisconnect}
                    onEdit={(c) => { setEditTarget(c); setModalOpen(true) }}
                    onDelete={handleDelete}
                    onMoveToGroup={handleMoveToGroup}
                    setSelectedConn={setSelectedConn}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* 연결 추가/편집 모달 */}
      {modalOpen && (
        <ConnectionModal
          initial={editTarget}
          defaultGroupId={newGroupTarget ?? undefined}
          groups={groups}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditTarget(null); setNewGroupTarget(null) }}
        />
      )}
    </div>
  )
}

// ─── ConnectionItemWithMove ─────────────────────────────────────────────────

function ConnectionItemWithMove({
  cfg, activeIds, selectedConnId, groups,
  onConnect, onDisconnect, onEdit, onDelete, onMoveToGroup, setSelectedConn,
}: {
  cfg: ConnectConfig
  activeIds: Set<string>
  selectedConnId: string | null
  groups: SessionGroup[]
  onConnect: (cfg: ConnectConfig) => void
  onDisconnect: (id: string) => void
  onEdit: (cfg: ConnectConfig) => void
  onDelete: (cfg: ConnectConfig) => void
  onMoveToGroup: (cfg: ConnectConfig, groupId: string) => void
  setSelectedConn: (id: string) => void
}) {
  const language = useLanguageStore((s) => s.language)
  const isActive = activeIds.has(cfg.id)
  const isSelected = selectedConnId === cfg.id
  const [showMoveMenu, setShowMoveMenu] = useState(false)

  return (
    <div className="relative">
      <div
        className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer transition-colors
          ${isSelected ? 'bg-[var(--color-bg-hover)]' : 'hover:bg-[var(--color-bg-tertiary)]'}`}
        onClick={() => isActive && setSelectedConn(cfg.id)}
      >
        {/* 색상 배지 */}
        {cfg.color && (
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
        )}

        {/* 연결 상태 아이콘 */}
        {isActive
          ? <PlugZap size={12} className="text-[var(--color-success)] shrink-0" />
          : <Plug size={12} className="text-[var(--color-text-muted)] shrink-0" />
        }

        {/* 연결 이름 */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate text-[var(--color-text-primary)]">{cfg.name}</div>
          <div className="text-[10px] text-[var(--color-text-muted)] truncate">{cfg.host}:{cfg.port}</div>
        </div>

        {/* 액션 버튼 */}
        <div className="hidden group-hover:flex items-center gap-1 shrink-0">
          {isActive ? (
            <button
              onClick={(e) => { e.stopPropagation(); onDisconnect(cfg.id) }}
              className="p-0.5 rounded hover:bg-[#fc8181]/20 text-[var(--color-error)]"
              title={t('cpDisconnectTitle', language)}
            >
              <RefreshCw size={10} />
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onConnect(cfg) }}
              className="p-0.5 rounded hover:bg-[#68d391]/20 text-[var(--color-success)]"
              title={t('cpConnectTitle', language)}
            >
              <Plug size={10} />
            </button>
          )}
          {/* 그룹 이동 버튼 (그룹이 1개 이상일 때만) */}
          {groups.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowMoveMenu((v) => !v) }}
              className="p-0.5 rounded hover:bg-[#9f7aea]/20 text-[#9f7aea]"
              title={t('cpMoveToGroupTitle', language)}
            >
              <Folder size={10} />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(cfg) }}
            className="p-0.5 rounded hover:bg-[#4299e1]/20 text-[var(--color-accent)]"
            title={t('cpEditTitle', language)}
          >
            <Edit2 size={10} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(cfg) }}
            className="p-0.5 rounded hover:bg-[#fc8181]/20 text-[var(--color-error)]"
            title={t('cpDeleteTitle', language)}
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {/* 그룹 이동 드롭다운 */}
      {showMoveMenu && (
        <div
          className="absolute right-0 top-full z-50 w-40 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded shadow-xl py-1"
          onMouseLeave={() => setShowMoveMenu(false)}
        >
          <div className="px-2 py-1 text-[10px] text-[var(--color-null)] uppercase tracking-wider">{t('cpMoveGroupHeader', language)}</div>
          {/* 미분류로 이동 */}
          <button
            className="w-full text-left px-3 py-1 text-xs text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-hover)]"
            onClick={() => { onMoveToGroup(cfg, ''); setShowMoveMenu(false) }}
          >
            {t('cpUngrouped', language)}
          </button>
          {groups.map((grp) => (
            <button
              key={grp.id}
              className="w-full text-left px-3 py-1 text-xs text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-hover)] flex items-center gap-2"
              onClick={() => { onMoveToGroup(cfg, grp.id); setShowMoveMenu(false) }}
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: grp.color ?? 'var(--color-text-muted)' }} />
              <span className="truncate">{grp.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
