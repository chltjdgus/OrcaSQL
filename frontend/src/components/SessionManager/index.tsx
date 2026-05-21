/**
 * SessionManager — 세션 관리 모달
 *
 * 레이아웃:
 * ┌──────────────────────────────────────────────────────┐
 * │ 제목                                         [닫기] │
 * ├────────────────────┬─────────────────────────────────┤
 * │  세션 트리 (좌)    │  연결 설정 폼 (우)              │
 * │  ─ 필터/정렬       │                                 │
 * │  ─ 그룹/세션 목록  │                                 │
 * ├────────────────────┴─────────────────────────────────┤
 * │  [+ 새 세션]  [+ 새 그룹]                            │
 * └──────────────────────────────────────────────────────┘
 */
import { useState, useEffect, useRef } from 'react'
import {
  X, Plus, FolderPlus, ChevronRight, ChevronDown as ChevronDownIcon,
  Folder, Server, Search, ArrowUpDown, MoreVertical, Edit2,
  Copy, Trash2, GripVertical, Wifi, WifiOff, Check,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  GetSavedConnections,
  GetSessionGroups,
  SaveSessionGroup,
  DeleteSessionGroup,
  SaveConnection,
  DeleteConnection,
  UpdateConnectionLastUsed,
  ConnectNew,
  ListDatabasesFromConfig,
  TestConnection,
} from '@/wailsjs/go/main/App'
import type { TestConnResult } from '@/wailsjs/go/main/App'
import { useConnectionStore } from '@/stores/connectionStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { logMsg } from '@/stores/useMessagesLogStore'
import { t } from '@/i18n'
import type { ConnectConfig, SessionGroup } from '@/types'
import DbCombobox from '@/components/common/DbCombobox'

// ─── 12가지 팔레트 색상 ──────────────────────────────────────────────────────
export const SESSION_COLORS = [
  '#4299e1', // blue
  '#48bb78', // green
  '#ed8936', // orange
  '#f56565', // red
  '#9f7aea', // purple
  '#38b2ac', // teal
  '#ed64a6', // pink
  '#ecc94b', // yellow
  '#667eea', // indigo
  '#fc8181', // light-red
  '#68d391', // light-green
  '#a0aec0', // gray
] as const

// ─── ColorPicker ─────────────────────────────────────────────────────────────
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 p-2">
      {/* 색상 없음 */}
      <button
        onClick={() => onChange('')}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center
          ${!value ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'} bg-[var(--color-bg-tertiary)]`}
        title="색상 없음"
      >
        {!value && <X size={10} className="text-[var(--color-accent)]" />}
      </button>
      {SESSION_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center
            ${value === c ? 'border-white' : 'border-transparent'}`}
          style={{ backgroundColor: c }}
          title={c}
        >
          {value === c && <Check size={10} className="text-white" />}
        </button>
      ))}
    </div>
  )
}

// ─── 기본 ConnectConfig ────────────────────────────────────────────────────
function defaultConfig(groupId = ''): ConnectConfig {
  return {
    id: '',
    name: '',
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: '',
    databases: [],
    charset: 'utf8mb4',
    tls: false,
    useSSH: false,
    sshHost: '',
    sshPort: 22,
    sshUser: '',
    sshKeyPath: '',
    sshPassword: '',
    useProxy: false,
    proxyType: 'socks5',
    proxyHost: '',
    proxyPort: 1080,
    proxyUser: '',
    proxyPassword: '',
    groupId,
    color: '',
    sortOrder: 0,
  }
}

// ─── SessionForm (우측 연결 설정 폼) ────────────────────────────────────────
function SessionForm({
  cfg,
  onConnected,
  onCancel,
}: {
  cfg: ConnectConfig
  onConnected: (cfg: ConnectConfig, connId: string) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<ConnectConfig>(cfg)
  const [testResult, setTestResult] = useState<TestConnResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [availableDbs, setAvailableDbs] = useState<string[]>([])

  // cfg 변경(세션 전환) 시 폼 리셋
  useEffect(() => {
    setForm(cfg)
    setTestResult(null)
    setAvailableDbs([])
  }, [cfg.id])

  function set<K extends keyof ConnectConfig>(k: K, v: ConnectConfig[K]) {
    setForm((f) => ({ ...f, [k]: v }))
    setTestResult(null)
  }

  async function handleTest() {
    setTesting(true)
    try {
      const r = await TestConnection(form)
      setTestResult(r)
      if (r.ok) {
        const dbs = await ListDatabasesFromConfig(form).catch(() => [])
        setAvailableDbs(dbs)
        toast.success(`연결 성공`)
      } else {
        toast.error(r.message)
      }
    } catch (e) {
      toast.error(`테스트 실패: ${e}`)
    } finally {
      setTesting(false)
    }
  }

  async function handleConnect() {
    if (!form.name.trim()) { toast.error('세션 이름을 입력하세요'); return }
    if (!form.host.trim()) { toast.error('호스트를 입력하세요'); return }
    setConnecting(true)
    try {
      const id = form.id || crypto.randomUUID()
      const toSave = { ...form, id }
      await SaveConnection(toSave)
      // BugFix-CX: 같은 창에 host+port+user 가 같은 활성 세션이 있으면 기존 탭으로 전환 — ConnectNew 호출 생략.
      // setActiveSession 만으로 activeConnections·sessions·selectedConnId 가 모두 일관 갱신되므로
      // 부모의 handleConnected (addActiveConnection / setSelectedConn) 경로는 건너뛰고 모달만 닫는다.
      const lang = useLanguageStore.getState().language
      const dup = useConnectionStore.getState().findActiveDuplicate(toSave.host, toSave.port, toSave.user)
      if (dup) {
        useConnectionStore.getState().setActiveSession(dup.id)
        toast(t('toastDuplicateSwitched', lang))
        logMsg({ kind: 'connection', level: 'info', title: `기존 탭으로 전환: ${dup.name}`, connName: dup.name })
        onCancel()  // SessionManager 에서 onCancel = onClose 로 wire 됨 → 모달 닫기.
        return
      }
      // BugFix-BA: 항상 새 connID 발급 — 같은 저장 연결을 두 번 열어도 새 탭으로 추가됨
      const connId = await ConnectNew(toSave)
      await UpdateConnectionLastUsed(toSave.id)
      onConnected(toSave, connId)
      toast.success(`${toSave.name} 연결됨`)
      logMsg({ kind: 'connection', level: 'success', title: `연결됨: ${toSave.name}`, connName: toSave.name })
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      toast.error(`연결 실패: ${errMsg}`)
      logMsg({ kind: 'connection', level: 'error', title: `연결 실패: ${form.name}`, detail: errMsg, connName: form.name })
    } finally {
      setConnecting(false)
    }
  }

  const inputCls = `w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs
    text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] placeholder-[var(--color-null)]`
  const labelCls = 'text-[10px] text-[var(--color-text-muted)] mb-0.5 block'

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* 기본 정보 */}
        <section>
          <div className="text-[11px] font-semibold text-[var(--color-accent)] mb-2 uppercase tracking-wide">기본 정보</div>
          <div className="space-y-2">
            <div>
              <label className={labelCls}>세션 이름 *</label>
              <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="My Server" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={labelCls}>호스트 *</label>
                <input className={inputCls} value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="localhost" />
              </div>
              <div className="w-20">
                <label className={labelCls}>포트</label>
                <input className={inputCls} type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value))} />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={labelCls}>사용자</label>
                <input className={inputCls} value={form.user} onChange={(e) => set('user', e.target.value)} placeholder="root" />
              </div>
              <div className="flex-1">
                <label className={labelCls}>비밀번호</label>
                <input className={inputCls} type="password" value={form.password ?? ''} onChange={(e) => set('password', e.target.value)} placeholder="••••••" />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={labelCls}>기본 데이터베이스 (다중선택 — 첫 항목이 기본 접속 DB)</label>
                <DbCombobox
                  selected={form.databases ?? (form.database ? [form.database] : [])}
                  availableDbs={availableDbs}
                  tested={testResult?.ok === true}
                  onChange={(dbs) => {
                    setForm((f) => ({ ...f, databases: dbs, database: dbs[0] ?? '' }))
                    setTestResult(null)
                  }}
                />
              </div>
              <div className="w-24">
                <label className={labelCls}>문자셋</label>
                <input className={inputCls} value={form.charset} onChange={(e) => set('charset', e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="tls" checked={form.tls} onChange={(e) => set('tls', e.target.checked)} className="accent-[var(--color-accent)]" />
              <label htmlFor="tls" className="text-xs text-[var(--color-text-subtle)]">TLS 사용</label>
            </div>
          </div>
        </section>

        {/* 색상 */}
        <section>
          <div className="text-[11px] font-semibold text-[var(--color-accent)] mb-1 uppercase tracking-wide">세션 색상</div>
          <ColorPicker value={form.color ?? ''} onChange={(c) => set('color', c)} />
        </section>

        {/* SSH 터널 */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <input type="checkbox" id="useSSH" checked={form.useSSH} onChange={(e) => set('useSSH', e.target.checked)} className="accent-[var(--color-accent)]" />
            <label htmlFor="useSSH" className="text-[11px] font-semibold text-[var(--color-accent)] uppercase tracking-wide">SSH 터널</label>
          </div>
          {form.useSSH && (
            <div className="space-y-2 pl-2 border-l border-[var(--color-border)]">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className={labelCls}>SSH 호스트</label>
                  <input className={inputCls} value={form.sshHost} onChange={(e) => set('sshHost', e.target.value)} />
                </div>
                <div className="w-16">
                  <label className={labelCls}>포트</label>
                  <input className={inputCls} type="number" value={form.sshPort} onChange={(e) => set('sshPort', Number(e.target.value))} />
                </div>
              </div>
              <div>
                <label className={labelCls}>SSH 사용자</label>
                <input className={inputCls} value={form.sshUser} onChange={(e) => set('sshUser', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>키 파일 경로</label>
                <input className={inputCls} value={form.sshKeyPath} onChange={(e) => set('sshKeyPath', e.target.value)} placeholder="~/.ssh/id_rsa" />
              </div>
              <div>
                <label className={labelCls}>SSH 비밀번호 (키 미사용 시)</label>
                <input className={inputCls} type="password" value={form.sshPassword ?? ''} onChange={(e) => set('sshPassword', e.target.value)} />
              </div>
            </div>
          )}
        </section>

        {/* 프록시 */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <input type="checkbox" id="useProxy" checked={form.useProxy} onChange={(e) => set('useProxy', e.target.checked)} className="accent-[var(--color-accent)]" />
            <label htmlFor="useProxy" className="text-[11px] font-semibold text-[var(--color-accent)] uppercase tracking-wide">프록시</label>
          </div>
          {form.useProxy && (
            <div className="space-y-2 pl-2 border-l border-[var(--color-border)]">
              <div className="flex gap-2 items-end">
                <div>
                  <label className={labelCls}>타입</label>
                  <select className={inputCls} value={form.proxyType} onChange={(e) => set('proxyType', e.target.value as 'socks5' | 'http')}>
                    <option value="socks5">SOCKS5</option>
                    <option value="http">HTTP</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className={labelCls}>호스트</label>
                  <input className={inputCls} value={form.proxyHost} onChange={(e) => set('proxyHost', e.target.value)} />
                </div>
                <div className="w-16">
                  <label className={labelCls}>포트</label>
                  <input className={inputCls} type="number" value={form.proxyPort} onChange={(e) => set('proxyPort', Number(e.target.value))} />
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* 하단 버튼 */}
      <div className="shrink-0 p-3 border-t border-[var(--color-border)] flex items-center gap-2">
        {testResult && (
          <span className={`text-[10px] flex-1 ${testResult.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
            {testResult.ok ? `✓ 연결 성공 (${testResult.serverVer})` : `✗ ${testResult.message}`}
          </span>
        )}
        {!testResult && <span className="flex-1" />}
        <button
          onClick={handleTest}
          disabled={testing}
          className="px-3 py-1.5 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-40"
        >
          {testing ? '테스트 중…' : '연결 테스트'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs rounded bg-[var(--color-bg-hover)] hover:bg-[var(--color-border)] text-[var(--color-text-primary)]"
        >
          취소
        </button>
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="px-3 py-1.5 text-xs rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
          title="설정 저장 후 곧바로 연결"
        >
          {connecting ? '연결 중…' : '연결'}
        </button>
      </div>
    </div>
  )
}

// ─── TreeNode 타입 ────────────────────────────────────────────────────────────
type TreeNode =
  | { kind: 'group'; group: SessionGroup; children: TreeNode[] }
  | { kind: 'session'; cfg: ConnectConfig }

// ─── buildTree ────────────────────────────────────────────────────────────────
function buildTree(groups: SessionGroup[], conns: ConnectConfig[]): TreeNode[] {
  const rootGroups = groups
    .filter((g) => !g.parentId || g.parentId === '')
    .sort((a, b) => a.order - b.order)

  function makeGroupNode(g: SessionGroup): TreeNode {
    const children: TreeNode[] = []
    // 하위 그룹 (2단계 제한)
    groups
      .filter((sg) => sg.parentId === g.id)
      .sort((a, b) => a.order - b.order)
      .forEach((sg) => {
        children.push(makeGroupNode(sg))
      })
    // 소속 세션
    conns
      .filter((c) => c.groupId === g.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .forEach((c) => children.push({ kind: 'session', cfg: c }))
    return { kind: 'group', group: g, children }
  }

  const nodes: TreeNode[] = rootGroups.map(makeGroupNode)
  // 그룹 없는 루트 세션
  conns
    .filter((c) => !c.groupId || c.groupId === '')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .forEach((c) => nodes.push({ kind: 'session', cfg: c }))

  return nodes
}

// ─── 컨텍스트 메뉴 ────────────────────────────────────────────────────────────
function CtxMenu({
  x, y, items, onClose,
}: {
  x: number; y: number
  items: { label: string; icon?: React.ReactNode; danger?: boolean; onClick: () => void }[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-[200] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded shadow-xl py-1 min-w-[140px]"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => { item.onClick(); onClose() }}
          className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--color-border)]
            ${item.danger ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]'}`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  )
}

// ─── DeleteConfirmModal ────────────────────────────────────────────────────────
function DeleteConfirmModal({
  targetName,
  isGroup,
  childCount,
  onConfirm,
  onCancel,
}: {
  targetName: string
  isGroup: boolean
  childCount: number
  onConfirm: (cascade: boolean) => void
  onCancel: () => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60">
      <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg p-5 w-80 shadow-2xl">
        <div className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">삭제 확인</div>
        {isGroup ? (
          <div className="text-xs text-[var(--color-text-subtle)] mb-4">
            <span className="font-medium text-[var(--color-error)]">{targetName}</span> 그룹을 삭제합니다.
            {childCount > 0 && (
              <div className="mt-1">
                하위에 <span className="font-medium text-[var(--color-warning)]">{childCount}개</span>의 세션이 있습니다.
                함께 삭제하시겠습니까?
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-[var(--color-text-subtle)] mb-4">
            <span className="font-medium text-[var(--color-error)]">{targetName}</span> 세션을 삭제하시겠습니까?
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:bg-[var(--color-border)]">
            취소
          </button>
          {isGroup && childCount > 0 && (
            <button
              onClick={() => onConfirm(false)}
              className="px-3 py-1.5 text-xs rounded bg-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
            >
              그룹만 삭제
            </button>
          )}
          <button
            onClick={() => onConfirm(true)}
            className="px-3 py-1.5 text-xs rounded bg-[var(--color-error)]/20 text-[var(--color-error)] hover:bg-[var(--color-error)]/30 border border-[var(--color-error)]/30"
          >
            {isGroup && childCount > 0 ? '모두 삭제' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── RenameInline ─────────────────────────────────────────────────────────────
function RenameInline({
  value, onDone,
}: { value: string; onDone: (v: string | null) => void }) {
  const [val, setVal] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.select() }, [])
  return (
    <input
      ref={ref}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(val.trim() || null)
        if (e.key === 'Escape') onDone(null)
        e.stopPropagation()
      }}
      onBlur={() => onDone(val.trim() || null)}
      className="flex-1 bg-[var(--color-bg-primary)] border border-[var(--color-accent)] rounded px-1 text-xs text-[var(--color-text-primary)] focus:outline-none min-w-0"
      onClick={(e) => e.stopPropagation()}
    />
  )
}

// ─── SessionManager (메인 모달) ───────────────────────────────────────────────
export default function SessionManager({
  onClose,
}: {
  onClose: () => void
}) {
  const { activeConnections, addActiveConnection, setSelectedConn, setSavedConnections } = useConnectionStore()

  const [groups, setGroups] = useState<SessionGroup[]>([])
  const [conns, setConns] = useState<ConnectConfig[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)   // connId or groupId
  const [selectedKind, setSelectedKind] = useState<'session' | 'group' | null>(null)
  const [filter, setFilter] = useState('')
  const [sortMode, setSortMode] = useState<'name' | 'host' | 'lastUsed'>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string; kind: 'session' | 'group' } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; kind: 'session' | 'group' } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragKind, setDragKind] = useState<'session' | 'group' | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  // ESC 키로 모달 닫기 (하위 다이얼로그가 없을 때만)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setDeleteTarget((dt) => {
        if (dt) return null   // 삭제 확인 다이얼로그가 열려 있으면 먼저 닫음
        onClose()
        return null
      })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // 활성 연결 ID 세트
  const activeIds = new Set(activeConnections.map((c) => c.id))

  // 현재 선택된 폼 데이터
  const selectedConn = conns.find((c) => c.id === selectedId)
  // selectedGroup은 추후 그룹 설정 폼 추가 시 활용
  // const selectedGroup = groups.find((g) => g.id === selectedId)
  const isNew = selectedId === '__new__'

  async function reload() {
    const [gs, cs] = await Promise.all([GetSessionGroups(), GetSavedConnections()])
    setGroups(gs ?? [])
    setConns(cs ?? [])
    setSavedConnections(cs ?? [])
    return { groups: gs ?? [], conns: cs ?? [] }
  }

  useEffect(() => {
    reload().then(({ groups: gs, conns: cs }) => {
      const lastConn = [...cs]
        .filter((c) => !!c.lastUsed)
        .sort((a, b) => new Date(b.lastUsed!).getTime() - new Date(a.lastUsed!).getTime())[0]

      if (!lastConn) return

      setSelectedId(lastConn.id)
      setSelectedKind('session')

      if (lastConn.groupId) {
        const parentGroup = gs.find((g) => g.id === lastConn.groupId)
        if (parentGroup) {
          const toExpand = new Set<string>()
          toExpand.add(parentGroup.id)
          if (parentGroup.parentId) toExpand.add(parentGroup.parentId)
          setExpandedGroups(toExpand)
        }
      }
    })
  }, [])

  // ─── 정렬된 세션 목록 ─────────────────────────────────────────────────────
  function sortedConns(list: ConnectConfig[]): ConnectConfig[] {
    return [...list].sort((a, b) => {
      let cmp = 0
      if (sortMode === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortMode === 'host') cmp = a.host.localeCompare(b.host)
      else if (sortMode === 'lastUsed') {
        const ta = a.lastUsed ? new Date(a.lastUsed).getTime() : 0
        const tb = b.lastUsed ? new Date(b.lastUsed).getTime() : 0
        cmp = tb - ta // 최신순이 기본
      }
      return sortAsc ? cmp : -cmp
    })
  }

  // ─── 필터 적용 ────────────────────────────────────────────────────────────
  const filteredConns = filter
    ? conns.filter((c) =>
        c.name.toLowerCase().includes(filter.toLowerCase()) ||
        c.host.toLowerCase().includes(filter.toLowerCase())
      )
    : conns

  const tree = buildTree(groups, sortedConns(filteredConns))

  // ─── 그룹 토글 ────────────────────────────────────────────────────────────
  function toggleGroup(id: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ─── 새 세션 추가 ─────────────────────────────────────────────────────────
  function handleNewSession() {
    // 현재 선택된 그룹의 하위에 새 세션 준비
    const groupId = selectedKind === 'group' && selectedId ? selectedId : ''
    setSelectedId('__new__')
    setSelectedKind('session')
    // __new__ 용 임시 설정 저장
    newSessionRef.current = defaultConfig(groupId)
  }
  const newSessionRef = useRef<ConnectConfig>(defaultConfig())

  // ─── 새 그룹 추가 ─────────────────────────────────────────────────────────
  async function handleNewGroup() {
    // 현재 선택된 그룹이 루트 그룹이면 하위로, 아니면 루트에
    const parentId = selectedKind === 'group' && selectedId
      ? (groups.find((g) => g.id === selectedId)?.parentId ? '' : selectedId)
      : ''
    const newGroup: SessionGroup = {
      id: crypto.randomUUID(),
      name: '새 그룹',
      color: '',
      parentId,
      order: groups.filter((g) => !g.parentId || g.parentId === '').length,
    }
    try {
      await SaveSessionGroup(newGroup)
      await reload()
      setExpandedGroups((prev) => {
        const next = new Set(prev)
        if (parentId) next.add(parentId)
        return next
      })
      setSelectedId(newGroup.id)
      setSelectedKind('group')
      setRenamingId(newGroup.id)
    } catch (e) {
      toast.error(`그룹 생성 실패: ${e}`)
    }
  }

  // ─── 연결 완료 ────────────────────────────────────────────────────────────
  async function handleConnected(cfg: ConnectConfig, connId: string) {
    await reload()
    addActiveConnection({ id: connId, cfgId: cfg.id, name: cfg.name, host: cfg.host, port: cfg.port, user: cfg.user, database: cfg.database, connectedAt: new Date().toISOString() })
    setSelectedConn(connId)
    onClose()
  }

  // ─── 컨텍스트 메뉴 핸들러 ─────────────────────────────────────────────────
  function openCtxMenu(e: React.MouseEvent, id: string, kind: 'session' | 'group') {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, id, kind })
  }

  async function handleDuplicate(id: string, kind: 'session' | 'group') {
    if (kind === 'session') {
      const orig = conns.find((c) => c.id === id)
      if (!orig) return
      const dup: ConnectConfig = { ...orig, id: crypto.randomUUID(), name: `${orig.name} (복사)`, sortOrder: (orig.sortOrder ?? 0) + 1 }
      await SaveConnection(dup)
    } else {
      const orig = groups.find((g) => g.id === id)
      if (!orig) return
      const dup: SessionGroup = { ...orig, id: crypto.randomUUID(), name: `${orig.name} (복사)`, order: orig.order + 1 }
      await SaveSessionGroup(dup)
    }
    await reload()
  }

  async function handleRename(id: string, kind: 'session' | 'group', newName: string) {
    if (kind === 'session') {
      const orig = conns.find((c) => c.id === id)
      if (!orig) return
      await SaveConnection({ ...orig, name: newName })
    } else {
      const orig = groups.find((g) => g.id === id)
      if (!orig) return
      await SaveSessionGroup({ ...orig, name: newName })
    }
    await reload()
    setRenamingId(null)
  }

  async function handleDelete(id: string, kind: 'session' | 'group') {
    if (kind === 'session') {
      await DeleteConnection(id)
    } else {
      const childCount = conns.filter((c) => c.groupId === id).length
      if (childCount === 0) {
        await DeleteSessionGroup(id, false)
      } else {
        const target = groups.find((g) => g.id === id)
        setDeleteTarget({ id, name: target?.name ?? '', kind })
        return
      }
    }
    await reload()
    if (selectedId === id) { setSelectedId(null); setSelectedKind(null) }
  }

  async function confirmDelete(cascade: boolean) {
    if (!deleteTarget) return
    if (deleteTarget.kind === 'group') {
      await DeleteSessionGroup(deleteTarget.id, cascade)
    } else {
      await DeleteConnection(deleteTarget.id)
    }
    await reload()
    if (selectedId === deleteTarget.id) { setSelectedId(null); setSelectedKind(null) }
    setDeleteTarget(null)
  }

  // ─── 드래그 앤 드롭 ───────────────────────────────────────────────────────
  function onDragStart(id: string, kind: 'session' | 'group') {
    setDragId(id)
    setDragKind(kind)
  }

  async function onDrop(targetId: string, targetKind: 'session' | 'group') {
    if (!dragId || dragId === targetId) { setDragId(null); setDragKind(null); setDropTargetId(null); return }
    if (dragKind === 'session') {
      // 세션을 그룹으로 이동
      const orig = conns.find((c) => c.id === dragId)
      if (!orig) return
      const groupId = targetKind === 'group' ? targetId : ''
      await SaveConnection({ ...orig, groupId })
    } else if (dragKind === 'group') {
      // 그룹을 다른 그룹(루트 하위)으로 이동 — 2단계 제한 준수
      const orig = groups.find((g) => g.id === dragId)
      if (!orig) return
      // 타깃이 루트 그룹이면 하위로 (1단계), 타깃이 세션이면 루트로
      const parentId = targetKind === 'group'
        ? (groups.find((g) => g.id === targetId)?.parentId ? '' : targetId)
        : ''
      await SaveSessionGroup({ ...orig, parentId })
    }
    await reload()
    setDragId(null); setDragKind(null); setDropTargetId(null)
  }

  // ─── 트리 노드 렌더 ───────────────────────────────────────────────────────
  function renderNode(node: TreeNode, depth = 0): React.ReactNode {
    if (node.kind === 'group') {
      const { group, children } = node
      const expanded = expandedGroups.has(group.id)
      const isSelected = selectedId === group.id && selectedKind === 'group'
      const isRenaming = renamingId === group.id
      const isDragOver = dropTargetId === group.id

      return (
        <div key={group.id}>
          <div
            className={`group flex items-center gap-1 px-2 py-1 cursor-pointer select-none rounded mx-1
              ${isSelected ? 'bg-[var(--color-accent)]/20' : isDragOver ? 'bg-[var(--color-accent)]/10' : 'hover:bg-[var(--color-bg-tertiary)]'}
              ${depth > 0 ? 'ml-4' : ''}`}
            draggable
            onDragStart={() => onDragStart(group.id, 'group')}
            onDragOver={(e) => { e.preventDefault(); setDropTargetId(group.id) }}
            onDragLeave={() => setDropTargetId(null)}
            onDrop={() => onDrop(group.id, 'group')}
            onClick={() => {
              toggleGroup(group.id)
              setSelectedId(group.id)
              setSelectedKind('group')
            }}
            onContextMenu={(e) => openCtxMenu(e, group.id, 'group')}
          >
            <GripVertical size={10} className="text-[var(--color-null)] shrink-0" />
            {group.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: group.color }} />}
            {expanded ? <ChevronDownIcon size={12} className="text-[var(--color-text-muted)] shrink-0" /> : <ChevronRight size={12} className="text-[var(--color-text-muted)] shrink-0" />}
            <Folder size={13} className="text-[var(--color-warning)] shrink-0" />
            {isRenaming ? (
              <RenameInline value={group.name} onDone={(v) => {
                if (v) handleRename(group.id, 'group', v)
                else setRenamingId(null)
              }} />
            ) : (
              <span className="flex-1 text-xs text-[var(--color-text-primary)] truncate">{group.name}</span>
            )}
            <button
              onClick={(e) => openCtxMenu(e, group.id, 'group')}
              className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-0.5 rounded hover:bg-[var(--color-border)]"
            >
              <MoreVertical size={11} className="text-[var(--color-text-muted)]" />
            </button>
          </div>
          {expanded && children.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    // kind === 'session'
    const { cfg } = node
    const isSelected = selectedId === cfg.id && selectedKind === 'session'
    const isActive = activeIds.has(cfg.id)
    const isRenaming = renamingId === cfg.id
    const isDragOver = dropTargetId === cfg.id

    return (
      <div
        key={cfg.id}
        className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer select-none rounded mx-1 group
          ${isSelected ? 'bg-[var(--color-accent)]/20' : isDragOver ? 'bg-[var(--color-border)]' : 'hover:bg-[var(--color-bg-tertiary)]'}
          ${depth > 0 ? 'ml-4' : ''}`}
        draggable
        onDragStart={() => onDragStart(cfg.id, 'session')}
        onDragOver={(e) => { e.preventDefault(); setDropTargetId(cfg.id) }}
        onDragLeave={() => setDropTargetId(null)}
        onDrop={() => onDrop(cfg.id, 'session')}
        onClick={() => { setSelectedId(cfg.id); setSelectedKind('session') }}
        onContextMenu={(e) => openCtxMenu(e, cfg.id, 'session')}
      >
        <GripVertical size={10} className="text-[var(--color-null)] shrink-0" />
        {cfg.color
          ? <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
          : <span className="w-2 h-2 shrink-0" />
        }
        {isActive
          ? <Wifi size={12} className="text-[var(--color-success)] shrink-0" />
          : <Server size={12} className="text-[var(--color-text-muted)] shrink-0" />
        }
        <div className="flex-1 min-w-0">
          {isRenaming ? (
            <RenameInline value={cfg.name} onDone={(v) => {
              if (v) handleRename(cfg.id, 'session', v)
              else setRenamingId(null)
            }} />
          ) : (
            <div className="text-xs text-[var(--color-text-primary)] truncate">{cfg.name}</div>
          )}
          <div className="text-[10px] text-[var(--color-null)] truncate">
            {cfg.user}@{cfg.host}:{cfg.port}
            {cfg.lastUsed && (
              <span className="ml-1">· {new Date(cfg.lastUsed).toLocaleDateString()}</span>
            )}
          </div>
        </div>
        {isActive && <WifiOff size={10} className="text-[var(--color-success)]" />}
        <button
          onClick={(e) => openCtxMenu(e, cfg.id, 'session')}
          className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-0.5 rounded hover:bg-[var(--color-border)]"
        >
          <MoreVertical size={11} className="text-[var(--color-text-muted)]" />
        </button>
      </div>
    )
  }

  // ─── 우측 폼 데이터 결정 ──────────────────────────────────────────────────
  const formCfg: ConnectConfig | null = isNew
    ? newSessionRef.current
    : (selectedConn ?? null)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backdropFilter: 'blur(2px)', backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-[860px] h-[600px] bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border)] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">세션 관리</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)]">
            <X size={14} />
          </button>
        </div>

        {/* 바디 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 좌측: 세션 트리 */}
          <div className="w-72 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-deep)]">
            {/* 필터 + 정렬 */}
            <div className="p-2 flex gap-1 border-b border-[var(--color-border)]">
              <div className="flex-1 flex items-center gap-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2">
                <Search size={11} className="text-[var(--color-null)] shrink-0" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="필터…"
                  className="flex-1 bg-transparent text-[11px] text-[var(--color-text-primary)] py-1 focus:outline-none placeholder-[var(--color-null)]"
                />
              </div>
              <button
                title="정렬"
                onClick={() => {
                  const modes: Array<'name' | 'host' | 'lastUsed'> = ['name', 'host', 'lastUsed']
                  const idx = modes.indexOf(sortMode)
                  const next = modes[(idx + 1) % modes.length]
                  if (next === sortMode) setSortAsc((v) => !v)
                  else { setSortMode(next); setSortAsc(true) }
                }}
                className="p-1.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text-muted)]"
              >
                <ArrowUpDown size={11} />
              </button>
            </div>
            <div className="text-[9px] text-[var(--color-null)] px-3 py-0.5">
              정렬: {sortMode === 'name' ? '이름' : sortMode === 'host' ? '호스트' : '최근 사용'} {sortAsc ? '↑' : '↓'}
            </div>

            {/* 트리 */}
            <div className="flex-1 overflow-y-auto py-1">
              {tree.length === 0 && (
                <div className="text-[11px] text-[var(--color-null)] text-center py-8">
                  저장된 세션이 없습니다<br />
                  <span className="text-[10px]">아래 버튼으로 추가하세요</span>
                </div>
              )}
              {tree.map((node) => renderNode(node))}
            </div>

            {/* 하단 버튼 */}
            <div className="shrink-0 border-t border-[var(--color-border)] p-2 flex gap-1">
              <button
                onClick={handleNewSession}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 border border-[var(--color-accent)]/30"
              >
                <Plus size={12} /> 새 세션
              </button>
              <button
                onClick={handleNewGroup}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] rounded bg-[var(--color-border)] text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-hover)]"
              >
                <FolderPlus size={12} /> 새 그룹
              </button>
            </div>
          </div>

          {/* 우측: 연결 설정 폼 */}
          <div className="flex-1 overflow-hidden">
            {formCfg ? (
              <SessionForm
                key={isNew ? '__new__' : selectedId ?? ''}
                cfg={formCfg}
                onConnected={handleConnected}
                onCancel={onClose}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-[var(--color-null)] text-sm flex-col gap-2">
                <Server size={32} className="text-[var(--color-border)]" />
                <span>좌측에서 세션을 선택하거나 새로 추가하세요</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 컨텍스트 메뉴 */}
      {ctxMenu && (
        <CtxMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              label: '이름 바꾸기',
              icon: <Edit2 size={11} />,
              onClick: () => setRenamingId(ctxMenu.id),
            },
            {
              label: '복제',
              icon: <Copy size={11} />,
              onClick: () => handleDuplicate(ctxMenu.id, ctxMenu.kind),
            },
            {
              label: '삭제',
              icon: <Trash2 size={11} />,
              danger: true,
              onClick: () => handleDelete(ctxMenu.id, ctxMenu.kind),
            },
          ]}
        />
      )}

      {/* 삭제 확인 모달 */}
      {deleteTarget && (
        <DeleteConfirmModal
          targetName={deleteTarget.name}
          isGroup={deleteTarget.kind === 'group'}
          childCount={deleteTarget.kind === 'group'
            ? conns.filter((c) => c.groupId === deleteTarget.id).length
            : 0}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
