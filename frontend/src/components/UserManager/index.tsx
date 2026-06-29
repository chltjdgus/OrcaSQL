/**
 * User Manager 패널.
 * MySQL 사용자 목록 조회, 생성/삭제, GRANT/REVOKE 관리.
 */
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users, Plus, Trash2, X, Key, Shield, ChevronDown, ChevronRight,
  Eye, EyeOff, RefreshCw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import type { UserRow } from '@/types'
import {
  ListUsers, CreateUser, DropUser, GetUserGrants,
  GrantPrivileges, RevokePrivileges,
  ChangeUserPassword, SetAccountLock,
} from '@/wailsjs/go/main/App'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import { nativeConfirm } from '@/utils/nativeConfirm'

// 일반적인 MySQL 권한 목록
const COMMON_PRIVS = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE',
  'CREATE', 'DROP', 'INDEX', 'ALTER',
  'EXECUTE', 'REFERENCES', 'TRIGGER',
  'CREATE TEMPORARY TABLES', 'LOCK TABLES',
  'CREATE VIEW', 'SHOW VIEW',
  'CREATE ROUTINE', 'ALTER ROUTINE', 'EVENT',
  'ALL PRIVILEGES',
]

interface Props {
  connId: string
  onClose: () => void
}

export default function UserManager({ connId, onClose }: Props) {
  const qc = useQueryClient()
  const language = useLanguageStore((s) => s.language)
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const { data: users = [], isLoading, refetch } = useQuery<UserRow[]>({
    queryKey: ['users', connId],
    queryFn: () => ListUsers(connId),
  })

  const dropMut = useMutation({
    mutationFn: ({ user, host }: { user: string; host: string }) =>
      DropUser(connId, user, host),
    onSuccess: () => {
      toast.success(t('umDeleteDone', language))
      qc.invalidateQueries({ queryKey: ['users', connId] })
      setSelectedUser(null)
    },
    onError: (e) => toast.error(`${t('umDeleteFailPrefix', language)}${e}`),
  })

  async function handleDrop(u: UserRow) {
    const ok = await nativeConfirm({
      title: t('userDeleteTitle', language),
      message: t('userDeleteBody', language).replace('{user}', u.user).replace('{host}', u.host),
      language,
    })
    if (!ok) return
    dropMut.mutate({ user: u.user, host: u.host })
  }

  return (
    <div className="flex h-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      {/* 좌: 사용자 목록 */}
      <div className="w-56 shrink-0 flex flex-col border-r border-[var(--color-border)]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-2">
            <Users size={12} className="text-[var(--color-text-subtle)]" />
            <span className="text-xs font-medium text-[var(--color-text-subtle)]">{t('umUsers', language)}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { refetch(); setSelectedUser(null) }}
              className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)]"
            >
              <RefreshCw size={11} />
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-success)]"
              title={t('umAddUser', language)}
            >
              <Plus size={11} />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)]"
            >
              <X size={11} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="px-3 py-4 text-[10px] text-[var(--color-null)]">{t('labelLoading', language)}</div>
          ) : (
            users.map((u) => (
              <div
                key={`${u.user}@${u.host}`}
                onClick={() => setSelectedUser(u)}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer border-b border-[var(--color-bg-tertiary)] group transition-colors ${
                  selectedUser?.user === u.user && selectedUser?.host === u.host
                    ? 'bg-[var(--color-bg-tertiary)]'
                    : 'hover:bg-[var(--color-bg-secondary)]'
                }`}
              >
                <div>
                  <div className="text-[11px] text-[var(--color-text-primary)]">{u.user}</div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">@{u.host}</div>
                </div>
                <div className="flex items-center gap-1">
                  {u.accountLocked === 'Y' && (
                    <span className="text-[9px] px-1 rounded bg-[var(--color-error)]/20 text-[var(--color-error)]">locked</span>
                  )}
                  {u.passwordExpired === 'Y' && (
                    <span className="text-[9px] px-1 rounded bg-[var(--color-warning)]/20 text-[var(--color-warning)]">expired</span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDrop(u) }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--color-border)] text-[var(--color-error)]"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 우: 상세 패널 */}
      <div className="flex-1 overflow-hidden">
        {showCreate ? (
          <CreateUserForm
            connId={connId}
            onDone={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['users', connId] }) }}
            onCancel={() => setShowCreate(false)}
          />
        ) : selectedUser ? (
          <UserDetail connId={connId} user={selectedUser} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-null)]">
            <Users size={24} />
            <p className="mt-2 text-xs">{t('umSelectUserHint', language)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── CreateUserForm ───────────────────────────────────────────────────────────

function CreateUserForm({
  connId, onDone, onCancel,
}: {
  connId: string
  onDone: () => void
  onCancel: () => void
}) {
  const language = useLanguageStore((s) => s.language)
  const [user, setUser] = useState('')
  const [host, setHost] = useState('%')
  const [pw, setPw] = useState('')
  const [showPw, setShowPw] = useState(false)

  const createMut = useMutation({
    mutationFn: () => CreateUser(connId, user, host, pw),
    onSuccess: () => { toast.success(`'${user}'@'${host}' ${t('umCreateDoneSuffix', language)}`); onDone() },
    onError: (e) => toast.error(`${t('umCreateFailPrefix', language)}${e}`),
  })

  return (
    <div className="p-4 space-y-3 max-w-md">
      <div className="flex items-center gap-2 mb-2">
        <Plus size={12} className="text-[var(--color-success)]" />
        <span className="text-xs font-medium text-[var(--color-text-subtle)]">{t('umNewUser', language)}</span>
      </div>
      <div className="space-y-2">
        <FieldRow label="Username">
          <input
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder={t('umPhUserExample', language)}
            className={inputCls}
          />
        </FieldRow>
        <FieldRow label="Host">
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={t('umPhAllHosts', language)}
            className={inputCls}
          />
        </FieldRow>
        <FieldRow label="Password">
          <div className="relative flex-1">
            <input
              type={showPw ? 'text' : 'password'}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder={t('umPassword', language)}
              className={`${inputCls} pr-7`}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            >
              {showPw ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          </div>
        </FieldRow>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => createMut.mutate()}
          disabled={!user || !host || createMut.isPending}
          className="px-3 py-1.5 text-xs rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
        >
          {createMut.isPending ? t('umCreating', language) : t('umCreate', language)}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs rounded bg-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-white"
        >
          {t('commonCancel', language)}
        </button>
      </div>
    </div>
  )
}

// ─── UserDetail ───────────────────────────────────────────────────────────────

function UserDetail({ connId, user }: { connId: string; user: UserRow }) {
  const qc = useQueryClient()
  const language = useLanguageStore((s) => s.language)
  const [grantsOpen, setGrantsOpen] = useState(true)
  const [showGrantForm, setShowGrantForm] = useState(false)
  const [showChangePw, setShowChangePw] = useState(false)

  const grantsQuery = useQuery<string[]>({
    queryKey: ['grants', connId, user.user, user.host],
    queryFn: () => GetUserGrants(connId, user.user, user.host),
  })

  const lockMut = useMutation({
    mutationFn: (lock: boolean) => SetAccountLock(connId, user.user, user.host, lock),
    onSuccess: (_, lock) => {
      toast.success(lock ? t('umLockDone', language) : t('umUnlockDone', language))
      qc.invalidateQueries({ queryKey: ['users', connId] })
    },
    onError: (e) => toast.error(`${t('umFailPrefix', language)}${e}`),
  })

  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 space-y-3">
      {/* 기본 정보 */}
      <section className="bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border)] p-3 space-y-1.5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Key size={11} className="text-[var(--color-pk)]" />
            <span className="text-xs font-medium text-[var(--color-text-subtle)]">{t('umUserInfo', language)}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowChangePw((v) => !v)}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-white transition-colors"
              title={t('umChangePwTitle', language)}
            >
              <Key size={9} /> {t('umPassword', language)}
            </button>
            <button
              onClick={() => lockMut.mutate(user.accountLocked !== 'Y')}
              disabled={lockMut.isPending}
              className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded transition-colors disabled:opacity-40 ${
                user.accountLocked === 'Y'
                  ? 'bg-[var(--color-error)]/20 text-[var(--color-error)] hover:bg-[var(--color-error)]/30'
                  : 'bg-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-white'
              }`}
            >
              {user.accountLocked === 'Y' ? t('umUnlock', language) : t('umLock', language)}
            </button>
          </div>
        </div>
        <InfoRow label="Username" value={user.user} />
        <InfoRow label="Host" value={user.host} />
        <InfoRow label="Plugin" value={user.plugin} />
        <InfoRow label="Account Locked" value={user.accountLocked === 'Y' ? '🔒 YES' : 'NO'} />
        <InfoRow label="Password Expired" value={user.passwordExpired === 'Y' ? '⚠️ YES' : 'NO'} />
        {showChangePw && (
          <ChangePasswordForm
            connId={connId}
            user={user.user}
            host={user.host}
            onDone={() => setShowChangePw(false)}
          />
        )}
      </section>

      {/* GRANTS */}
      <section className="bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border)]">
        <button
          className="w-full flex items-center justify-between px-3 py-2"
          onClick={() => setGrantsOpen((v) => !v)}
        >
          <div className="flex items-center gap-1.5">
            <Shield size={11} className="text-[var(--color-success)]" />
            <span className="text-xs font-medium text-[var(--color-text-subtle)]">Grants</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); setShowGrantForm((v) => !v) }}
              className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-success)]"
              title={t('umGrantPrivTitle', language)}
            >
              <Plus size={10} />
            </button>
            {grantsOpen ? <ChevronDown size={11} className="text-[var(--color-text-muted)]" /> : <ChevronRight size={11} className="text-[var(--color-text-muted)]" />}
          </div>
        </button>

        {grantsOpen && (
          <div className="border-t border-[var(--color-border)]">
            {showGrantForm && (
              <GrantForm
                connId={connId}
                user={user.user}
                host={user.host}
                onDone={() => setShowGrantForm(false)}
              />
            )}
            {grantsQuery.isLoading ? (
              <div className="px-3 py-3 text-[10px] text-[var(--color-null)]">{t('labelLoading', language)}</div>
            ) : (
              (grantsQuery.data ?? []).map((g, i) => (
                <div key={i} className="px-3 py-1.5 border-b border-[var(--color-bg-tertiary)] text-[10px] font-mono text-[var(--color-text-subtle)] break-all">
                  {g}
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  )
}

// ─── ChangePasswordForm ───────────────────────────────────────────────────────

function ChangePasswordForm({
  connId, user, host, onDone,
}: {
  connId: string
  user: string
  host: string
  onDone: () => void
}) {
  const language = useLanguageStore((s) => s.language)
  const [newPw, setNewPw] = useState('')
  const [showPw, setShowPw] = useState(false)

  const mut = useMutation({
    mutationFn: () => ChangeUserPassword(connId, user, host, newPw),
    onSuccess: () => { toast.success(t('umChangePwDone', language)); onDone() },
    onError: (e) => toast.error(`${t('umChangePwFailPrefix', language)}${e}`),
  })

  return (
    <div className="mt-2 pt-2 border-t border-[var(--color-border)] space-y-2">
      <span className="text-[10px] text-[var(--color-text-subtle)] font-medium">{t('umNewPassword', language)}</span>
      <FieldRow label="">
        <div className="relative flex-1">
          <input
            type={showPw ? 'text' : 'password'}
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder={t('umNewPassword', language)}
            className={`${inputCls} pr-7`}
            onKeyDown={(e) => { if (e.key === 'Enter') mut.mutate() }}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
          >
            {showPw ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
        </div>
      </FieldRow>
      <div className="flex gap-2">
        <button
          onClick={() => mut.mutate()}
          disabled={!newPw || mut.isPending}
          className="px-3 py-1 text-[10px] rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
        >
          {mut.isPending ? t('umChanging', language) : t('umChange', language)}
        </button>
        <button
          onClick={onDone}
          className="px-3 py-1 text-[10px] rounded bg-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-white"
        >
          {t('commonCancel', language)}
        </button>
      </div>
    </div>
  )
}

// ─── GrantForm ────────────────────────────────────────────────────────────────

function GrantForm({
  connId, user, host, onDone,
}: {
  connId: string
  user: string
  host: string
  onDone: () => void
}) {
  const qc = useQueryClient()
  const language = useLanguageStore((s) => s.language)
  const [selected, setSelected] = useState<string[]>(['SELECT'])
  const [onDb, setOnDb] = useState('*.*')
  const [revokeMode, setRevokeMode] = useState(false)

  const mutFn = useCallback(() => {
    const privs = selected.join(', ')
    return revokeMode
      ? RevokePrivileges(connId, privs, onDb, user, host)
      : GrantPrivileges(connId, privs, onDb, user, host)
  }, [connId, selected, onDb, user, host, revokeMode])

  const mut = useMutation({
    mutationFn: mutFn,
    onSuccess: () => {
      toast.success(revokeMode ? t('umRevokeDone', language) : t('umGrantDone', language))
      qc.invalidateQueries({ queryKey: ['grants', connId, user, host] })
      onDone()
    },
    onError: (e) => toast.error(`${t('umFailPrefix', language)}${e}`),
  })

  function togglePriv(p: string) {
    setSelected((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    )
  }

  return (
    <div className="px-3 py-2 border-b border-[var(--color-border)] space-y-2 bg-[var(--color-bg-secondary)]">
      {/* GRANT/REVOKE 모드 */}
      <div className="flex items-center gap-2">
        <div className="flex rounded overflow-hidden border border-[var(--color-border)]">
          {[false, true].map((rev) => (
            <button
              key={String(rev)}
              onClick={() => setRevokeMode(rev)}
              className={`px-2 py-0.5 text-[10px] transition-colors ${
                revokeMode === rev ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)] bg-[var(--color-bg-secondary)]'
              }`}
            >
              {rev ? 'REVOKE' : 'GRANT'}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-[var(--color-text-muted)]">ON</span>
        <input
          type="text"
          value={onDb}
          onChange={(e) => setOnDb(e.target.value)}
          className="flex-1 px-2 py-0.5 text-[10px] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] focus:outline-none"
          placeholder="*.* or db.table"
        />
      </div>

      {/* 권한 체크박스 */}
      <div className="flex flex-wrap gap-1.5">
        {COMMON_PRIVS.map((p) => (
          <label key={p} className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(p)}
              onChange={() => togglePriv(p)}
              className="accent-[var(--color-accent)]"
            />
            <span className="text-[10px] text-[var(--color-text-subtle)]">{p}</span>
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => mut.mutate()}
          disabled={selected.length === 0 || mut.isPending}
          className={`px-2 py-1 text-[10px] rounded disabled:opacity-40 ${
            revokeMode
              ? 'bg-[var(--color-error)]/20 text-[var(--color-error)] hover:bg-[var(--color-error)]/30'
              : 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]'
          }`}
        >
          {revokeMode ? 'REVOKE' : 'GRANT'}
        </button>
        <button
          onClick={onDone}
          className="px-2 py-1 text-[10px] rounded bg-[var(--color-border)] text-[var(--color-text-subtle)]"
        >
          {t('commonCancel', language)}
        </button>
      </div>
    </div>
  )
}

// ─── 소형 컴포넌트 ─────────────────────────────────────────────────────────────

const inputCls = 'flex-1 px-2 py-1 text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] placeholder-[var(--color-null)] focus:outline-none focus:border-[var(--color-accent)]'

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-[10px] text-[var(--color-text-muted)] shrink-0">{label}</span>
      <div className="flex-1 flex items-center">{children}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 text-[10px] text-[var(--color-text-muted)] shrink-0">{label}</span>
      <span className="text-[10px] text-[var(--color-text-primary)] font-mono">{value}</span>
    </div>
  )
}
