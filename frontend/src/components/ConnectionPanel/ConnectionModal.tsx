import { useState, useEffect } from 'react'
import { X, Loader2, CheckCircle2, XCircle, Wifi } from 'lucide-react'
import type { ConnectConfig, SessionGroup } from '@/types'
import { TestConnection, ListDatabasesFromConfig } from '@/wailsjs/go/main/App'
import type { TestConnResult } from '@/wailsjs/go/main/App'
import DbCombobox from '@/components/common/DbCombobox'

const CONN_COLORS = [
  '', '#4299e1', '#68d391', '#fc8181', '#f6ad55',
  '#9f7aea', '#76e4f7', '#fbd38d', '#b794f4',
]

// uuid 패키지 없이 간단히 생성
function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface Props {
  initial: ConnectConfig | null
  defaultGroupId?: string
  groups?: SessionGroup[]
  onSave: (cfg: ConnectConfig) => void
  onClose: () => void
}

const defaultConfig: ConnectConfig = {
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
}

/** ErrorKind에 맞는 한국어 원인 설명 */
function describeError(result: TestConnResult): { title: string; detail: string } {
  const msg = result.message ?? ''
  switch (result.errorKind) {
    case 'host':
      return {
        title: '호스트에 연결할 수 없음',
        detail: `${msg}\n\n확인: 호스트/포트가 올바른지, 방화벽이 열려 있는지, MySQL이 실행 중인지 확인하세요.`,
      }
    case 'auth':
      return {
        title: '인증 실패 (Access Denied)',
        detail: `${msg}\n\n확인: 사용자명·비밀번호가 정확한지, 해당 사용자가 원격 접속 권한을 갖는지 확인하세요.`,
      }
    case 'database':
      return {
        title: '데이터베이스를 찾을 수 없음',
        detail: `${msg}\n\n확인: 기본 데이터베이스 이름이 올바른지, 해당 DB가 존재하는지 확인하세요.\n비워두면 연결 후 선택할 수 있습니다.`,
      }
    case 'ssh':
      return {
        title: 'SSH 터널 연결 실패',
        detail: `${msg}\n\n확인: SSH 호스트/포트/사용자, 개인키 경로 또는 SSH 비밀번호를 확인하세요.`,
      }
    case 'proxy':
      return {
        title: '프록시 연결 실패',
        detail: `${msg}\n\n확인: 프록시 타입(SOCKS5/HTTP), 호스트/포트, 인증 정보를 확인하세요.`,
      }
    case 'tls':
      return {
        title: 'TLS/SSL 오류',
        detail: `${msg}\n\n확인: 서버의 TLS 설정과 클라이언트의 TLS 옵션이 일치하는지 확인하세요.`,
      }
    default:
      return { title: '연결 오류', detail: msg }
  }
}

/**
 * 연결 추가/편집 모달.
 * - 연결 테스트: 저장 없이 즉시 연결 검증, 에러 원인 분류 표시
 * - 저장: 연결 여부와 무관하게 항상 가능
 */
export default function ConnectionModal({ initial, defaultGroupId, groups = [], onSave, onClose }: Props) {
  const [cfg, setCfg] = useState<ConnectConfig>(() => ({
    ...defaultConfig,
    ...(initial ?? {}),
    id: initial?.id || generateId(),
    groupId: initial?.groupId ?? defaultGroupId ?? '',
  }))
  const [tab, setTab] = useState<'basic' | 'ssh' | 'proxy'>('basic')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // 연결 테스트 상태
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConnResult | null>(null)
  // 테스트 성공 시 가져온 DB 목록
  const [availableDbs, setAvailableDbs] = useState<string[]>([])

  function set<K extends keyof ConnectConfig>(key: K, value: ConnectConfig[K]) {
    setCfg((prev) => ({ ...prev, [key]: value }))
    // 연결 관련 설정이 바뀌면 테스트 결과 + DB 목록 초기화
    if (key !== 'name' && key !== 'database') {
      setTestResult(null)
      setAvailableDbs([])
    }
  }

  /** 연결 테스트 — 저장하지 않음. 성공 시 DB 목록도 가져옴 */
  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    setAvailableDbs([])
    try {
      const result = await TestConnection(cfg)
      setTestResult(result)
      if (result.ok) {
        // 테스트 성공 → DB 목록 fetch (백그라운드, 실패해도 무시)
        ListDatabasesFromConfig(cfg)
          .then((dbs) => setAvailableDbs(dbs))
          .catch(() => { /* DB 목록 실패는 무시 */ })
      }
    } catch (e) {
      setTestResult({
        ok: false,
        serverVer: '',
        errorKind: 'other',
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setTesting(false)
    }
  }

  /** 저장 — 연결 여부와 무관하게 항상 실행 */
  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!cfg.name.trim()) return
    onSave(cfg)
  }

  const errorInfo = testResult && !testResult.ok ? describeError(testResult) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg shadow-2xl w-[500px] max-h-[90vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {initial ? '연결 편집' : '새 연결'}
          </h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* 탭 */}
        <div className="flex border-b border-[var(--color-border)] px-5">
          {(['basic', 'ssh', 'proxy'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-colors mr-2
                ${tab === t
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                }`}
            >
              {t === 'basic' ? '기본 설정' : t === 'ssh' ? 'SSH 터널' : '프록시'}
            </button>
          ))}
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {tab === 'basic' && (
            <>
              <Field label="연결 이름 *" required>
                <input
                  type="text"
                  value={cfg.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="My MySQL Server"
                  className={inputCls}
                  required
                />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="호스트" className="col-span-2">
                  <input type="text" value={cfg.host} onChange={(e) => set('host', e.target.value)} className={inputCls} />
                </Field>
                <Field label="포트">
                  <input type="number" value={cfg.port} onChange={(e) => set('port', Number(e.target.value))} className={inputCls} min={1} max={65535} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="사용자">
                  <input type="text" value={cfg.user} onChange={(e) => set('user', e.target.value)} className={inputCls} />
                </Field>
                <Field label="비밀번호">
                  <input type="password" value={cfg.password ?? ''} onChange={(e) => set('password', e.target.value)} className={inputCls} placeholder="OS 키체인에 저장" />
                </Field>
              </div>
              <Field label="기본 데이터베이스">
                <DbCombobox
                  selected={cfg.databases ?? (cfg.database ? [cfg.database] : [])}
                  availableDbs={availableDbs}
                  tested={testResult?.ok === true}
                  onChange={(dbs) => {
                    set('databases', dbs)
                    set('database', dbs[0] ?? '')
                  }}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="문자셋">
                  <select value={cfg.charset} onChange={(e) => set('charset', e.target.value)} className={inputCls}>
                    <option value="utf8mb4">utf8mb4</option>
                    <option value="utf8">utf8</option>
                    <option value="latin1">latin1</option>
                  </select>
                </Field>
                <Field label="TLS">
                  <div className="flex items-center h-8 gap-2">
                    <input
                      type="checkbox"
                      id="tls"
                      checked={cfg.tls}
                      onChange={(e) => set('tls', e.target.checked)}
                      className="w-4 h-4 rounded"
                    />
                    <label htmlFor="tls" className="text-xs text-[var(--color-text-muted)]">TLS/SSL 활성화</label>
                  </div>
                </Field>
              </div>
              {/* 그룹 & 색상 */}
              <div className="grid grid-cols-2 gap-2">
                {groups.length > 0 && (
                  <Field label="그룹">
                    <select
                      value={cfg.groupId ?? ''}
                      onChange={(e) => set('groupId', e.target.value)}
                      className={inputCls}
                    >
                      <option value="">미분류</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="색상 배지">
                  <div className="flex items-center gap-1.5 h-8">
                    {CONN_COLORS.map((c) => (
                      <button
                        key={c || 'none'}
                        type="button"
                        title={c || '없음'}
                        onClick={() => set('color', c || undefined)}
                        className={`w-4 h-4 rounded-full border transition-all shrink-0
                          ${(cfg.color ?? '') === c
                            ? 'ring-2 ring-white ring-offset-1 ring-offset-[var(--color-bg-tertiary)]'
                            : 'border-[var(--color-border)]'
                          }
                          ${!c ? 'bg-[var(--color-border)] text-[var(--color-text-muted)] flex items-center justify-center text-[8px]' : ''}`}
                        style={c ? { backgroundColor: c } : {}}
                      >
                        {!c && <span>✕</span>}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            </>
          )}

          {tab === 'ssh' && (
            <>
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="checkbox"
                  id="useSsh"
                  checked={cfg.useSSH}
                  onChange={(e) => set('useSSH', e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="useSsh" className="text-xs font-medium text-[var(--color-text-primary)]">SSH 터널 사용</label>
              </div>
              {cfg.useSSH && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="SSH 호스트" className="col-span-2">
                      <input type="text" value={cfg.sshHost} onChange={(e) => set('sshHost', e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="SSH 포트">
                      <input type="number" value={cfg.sshPort} onChange={(e) => set('sshPort', Number(e.target.value))} className={inputCls} />
                    </Field>
                  </div>
                  <Field label="SSH 사용자">
                    <input type="text" value={cfg.sshUser} onChange={(e) => set('sshUser', e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="개인키 경로">
                    <input type="text" value={cfg.sshKeyPath} onChange={(e) => set('sshKeyPath', e.target.value)} className={inputCls} placeholder="~/.ssh/id_rsa" />
                  </Field>
                  <Field label="SSH 비밀번호 (키 없을 때)">
                    <input type="password" value={cfg.sshPassword ?? ''} onChange={(e) => set('sshPassword', e.target.value)} className={inputCls} />
                  </Field>
                  <div className="rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] px-3 py-2 text-[10px] text-[var(--color-text-muted)] mt-1">
                    <span className="text-[var(--color-success)] font-medium">TOFU 호스트 키 검증</span> — 첫 연결 시 서버 공개키가{' '}
                    <code className="text-[var(--color-text-subtle)]">~/.orcasql/known_hosts</code>에 자동 저장됩니다.
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'proxy' && (
            <>
              <div className="rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] px-3 py-2 text-[10px] text-[var(--color-text-muted)] space-y-0.5 mb-3">
                <p><span className="text-[var(--color-accent)] font-medium">SOCKS5</span> — SSH 동적 포워딩: <code className="text-[var(--color-text-subtle)]">ssh -D 1080 user@server</code></p>
                <p><span className="text-[var(--color-accent)] font-medium">HTTP</span> — nginx/squid CONNECT 프록시</p>
              </div>
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="checkbox"
                  id="useProxy"
                  checked={cfg.useProxy}
                  onChange={(e) => {
                    set('useProxy', e.target.checked)
                    if (e.target.checked) set('useSSH', false)
                  }}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="useProxy" className="text-xs font-medium text-[var(--color-text-primary)]">프록시 사용</label>
              </div>
              {cfg.useProxy && (
                <>
                  <Field label="프록시 타입">
                    <select
                      value={cfg.proxyType}
                      onChange={(e) => {
                        const t = e.target.value as 'socks5' | 'http'
                        set('proxyType', t)
                        set('proxyPort', t === 'socks5' ? 1080 : 3128)
                      }}
                      className={inputCls}
                    >
                      <option value="socks5">SOCKS5</option>
                      <option value="http">HTTP CONNECT</option>
                    </select>
                  </Field>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="프록시 호스트" className="col-span-2">
                      <input type="text" value={cfg.proxyHost} onChange={(e) => set('proxyHost', e.target.value)} className={inputCls} placeholder="127.0.0.1" />
                    </Field>
                    <Field label="포트">
                      <input type="number" value={cfg.proxyPort} onChange={(e) => set('proxyPort', Number(e.target.value))} className={inputCls} min={1} max={65535} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="프록시 사용자 (선택)">
                      <input type="text" value={cfg.proxyUser} onChange={(e) => set('proxyUser', e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="프록시 비밀번호 (선택)">
                      <input type="password" value={cfg.proxyPassword ?? ''} onChange={(e) => set('proxyPassword', e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                </>
              )}
            </>
          )}

          {/* ─── 연결 테스트 결과 표시 ─────────────────────────────────── */}
          {testResult && (
            <div
              className={`mt-2 rounded-lg border px-3 py-2.5 text-xs ${
                testResult.ok
                  ? 'border-[var(--color-success)]/40 bg-[var(--color-success)]/10'
                  : 'border-[var(--color-error)]/40 bg-[var(--color-error)]/10'
              }`}
            >
              {testResult.ok ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-[var(--color-success)] shrink-0" />
                  <div>
                    <span className="font-medium text-[var(--color-success)]">연결 성공</span>
                    {testResult.serverVer && (
                      <span className="ml-2 text-[var(--color-text-subtle)]">MySQL {testResult.serverVer}</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <XCircle size={14} className="text-[var(--color-error)] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--color-error)]">{errorInfo?.title}</p>
                    <pre className="mt-1 whitespace-pre-wrap text-[10px] text-[var(--color-text-subtle)] break-all font-mono leading-relaxed">
                      {errorInfo?.detail}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </form>

        {/* 푸터 */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--color-border)]">
          {/* 연결 테스트 버튼 (좌측) */}
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-[var(--color-accent)]/50
              text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Wifi size={12} />
            )}
            {testing ? '테스트 중…' : '연결 테스트'}
          </button>

          {/* 취소 / 저장 (우측) */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`${btnCls} bg-[var(--color-bg-hover)] hover:bg-[var(--color-border)] text-[var(--color-text-primary)]`}
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={!cfg.name.trim()}
              className={`${btnCls} bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 소형 컴포넌트 ─────────────────────────────────────────────────────────

const inputCls =
  'w-full h-8 px-2.5 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] transition-colors'

const btnCls = 'px-4 py-1.5 text-xs rounded font-medium transition-colors'

function Field({
  label,
  children,
  className = '',
  required = false,
}: {
  label: string
  children: React.ReactNode
  className?: string
  required?: boolean
}) {
  return (
    <div className={className}>
      <label className="block text-[10px] text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">
        {label}{required && ' *'}
      </label>
      {children}
    </div>
  )
}
