import { useEffect, useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useThemeStore } from '@/stores/useThemeStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import { ResetAllUserData } from '@/wailsjs/go/main/App'

interface Props {
  open: boolean
  onClose: () => void
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const CONFIRM_TEXT = 'OrcaSQL'

/**
 * 도움말 메뉴 > 모든 설정 초기화 다이얼로그.
 * 1차 경고 → 2차 'OrcaSQL' 텍스트 매치 입력 → 백엔드 호출 → 토스트 후 앱 종료.
 */
export default function ResetConfirmDialog({ open, onClose }: Props) {
  const { theme } = useThemeStore()
  const { language } = useLanguageStore()
  const isDark = theme === 'dark'

  const [typed, setTyped] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setTyped('')
      setSubmitting(false)
      return
    }
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, submitting, onClose])

  if (!open) return null

  const canProceed = typed === CONFIRM_TEXT && !submitting

  const handleProceed = async () => {
    if (!canProceed) return
    setSubmitting(true)
    try {
      await ResetAllUserData()
      toast.success(t('resetSuccessQuit', language), { duration: 1400 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`${t('resetFailed', language)}: ${msg}`)
      setSubmitting(false)
    }
  }

  const overlay = 'fixed inset-0 z-50 flex items-center justify-center'
  const dialogCls = isDark
    ? 'relative z-10 w-[460px] flex flex-col rounded-xl border border-[#2d3748] bg-[#161b27] shadow-2xl'
    : 'relative z-10 w-[460px] flex flex-col rounded-xl border border-[#d1d5db] bg-white shadow-2xl'
  const headerCls = isDark
    ? 'flex items-center justify-between border-b border-[#2d3748] px-5 py-3'
    : 'flex items-center justify-between border-b border-[#e5e7eb] px-5 py-3'
  const titleCls = isDark ? 'text-sm font-semibold text-[#e2e8f0]' : 'text-sm font-semibold text-[#111827]'
  const closeCls = isDark
    ? 'rounded p-0.5 text-[#718096] hover:bg-[#2d3748] hover:text-[#e2e8f0] transition-colors disabled:opacity-30'
    : 'rounded p-0.5 text-[#9ca3af] hover:bg-[#f3f4f6] hover:text-[#111827] transition-colors disabled:opacity-30'
  const warnBoxCls = isDark
    ? 'flex items-start gap-2 rounded-md border border-red-900/40 bg-red-950/30 p-3 text-xs text-[#fca5a5]'
    : 'flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700'
  const noteCls = isDark ? 'text-[11px] text-[#a0aec0] leading-relaxed' : 'text-[11px] text-[#6b7280] leading-relaxed'
  const labelCls = isDark ? 'text-xs text-[#cbd5e0]' : 'text-xs text-[#374151]'
  const inputCls = isDark
    ? 'w-full rounded border border-[#2d3748] bg-[#0f1117] px-2 py-1.5 text-sm text-[#e2e8f0] outline-none focus:border-red-500'
    : 'w-full rounded border border-[#d1d5db] bg-white px-2 py-1.5 text-sm text-[#111827] outline-none focus:border-red-500'
  const cancelBtn = isDark
    ? 'rounded px-3 py-1.5 text-xs text-[#a0aec0] hover:bg-[#2d3748] disabled:opacity-40'
    : 'rounded px-3 py-1.5 text-xs text-[#374151] hover:bg-[#f3f4f6] disabled:opacity-40'
  const dangerBtn = canProceed
    ? 'rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors'
    : 'rounded bg-red-600/40 px-3 py-1.5 text-xs font-medium text-white/70 cursor-not-allowed'

  return (
    <div className={overlay} onClick={() => !submitting && onClose()}>
      <div className="absolute inset-0 bg-black/60" />
      <div className={dialogCls} onClick={(e) => e.stopPropagation()}>
        <div className={headerCls}>
          <span className={titleCls}>{t('resetConfirmTitle', language)}</span>
          <button onClick={onClose} disabled={submitting} className={closeCls}>
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className={warnBoxCls}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{t('resetConfirmWarning', language)}</span>
          </div>

          {isMac && (
            <p className={noteCls}>{t('resetMacosNote', language)}</p>
          )}

          <div className="space-y-1.5">
            <label className={labelCls}>{t('resetConfirmTypeHint', language)}</label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t('resetConfirmTypePlaceholder', language)}
              disabled={submitting}
              className={inputCls}
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </div>

        <div className={isDark ? 'flex justify-end gap-2 border-t border-[#2d3748] px-5 py-3' : 'flex justify-end gap-2 border-t border-[#e5e7eb] px-5 py-3'}>
          <button onClick={onClose} disabled={submitting} className={cancelBtn}>
            {t('resetCancel', language)}
          </button>
          <button onClick={handleProceed} disabled={!canProceed} className={dangerBtn}>
            {t('resetConfirmProceed', language)}
          </button>
        </div>
      </div>
    </div>
  )
}
