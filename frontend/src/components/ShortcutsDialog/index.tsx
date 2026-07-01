import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useThemeStore } from '@/stores/useThemeStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'

interface Props {
  open: boolean
  onClose: () => void
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/**
 * Win 표기를 Mac 키 심볼(⌃⌥⇧⌘)로 변환.
 * - 'Tab' 후행: 연결 탭 전환은 Mac 관행상 ⌃Tab (Cmd+Tab 은 OS 앱 스위처).
 * - 'Enter' → ↵, 'PageUp/PageDown' → PgUp/PgDn.
 */
function fmtKb(win: string): string {
  if (!isMac) return win
  const parts = win.split('+')
  const last = parts.pop() ?? ''
  const mods = new Set(parts)
  const ctrlAsControl = last === 'Tab'
  let out = ''
  if (mods.has('Ctrl') && ctrlAsControl) out += '⌃'
  if (mods.has('Alt')) out += '⌥'
  if (mods.has('Shift')) out += '⇧'
  if (mods.has('Ctrl') && !ctrlAsControl) out += '⌘'
  if (last === 'Enter') return out + '↵'
  if (last === 'PageUp') return out + 'PgUp'
  if (last === 'PageDown') return out + 'PgDn'
  return out + last
}

interface ShortcutRow {
  win: string
  desc: { ko: string; en: string }
}
interface ShortcutSection {
  title: { ko: string; en: string }
  items: ShortcutRow[]
}

/**
 * BugFix-AZ: SQLyog 호환 단축키 매핑. 표시는 Win/Mac 동시.
 * 각 항목의 `win` 값을 fmtKb 가 OS 표기로 변환한다.
 */
const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: { ko: '쿼리 실행', en: 'Query Execution' },
    items: [
      { win: 'F9',                 desc: { ko: '쿼리 실행 (전체)',  en: 'Execute Query' } },
      { win: 'Ctrl+F9',            desc: { ko: '선택 영역 실행',    en: 'Execute Selection' } },
      { win: 'Ctrl+Shift+Enter',   desc: { ko: '선택 영역 실행 (대체)', en: 'Execute Selection (alt)' } },
      { win: 'Ctrl+Shift+F',       desc: { ko: 'SQL 포맷',          en: 'Format SQL' } },
      { win: 'Ctrl+H',             desc: { ko: '쿼리 히스토리',     en: 'Query History' } },
      { win: 'Ctrl+Shift+B',       desc: { ko: '즐겨찾기 토글',     en: 'Toggle Favorites' } },
    ],
  },
  {
    title: { ko: '탭 & 창', en: 'Tabs & Window' },
    items: [
      { win: 'Ctrl+T',             desc: { ko: '새 쿼리 탭',        en: 'New Query Tab' } },
      { win: 'Ctrl+W',             desc: { ko: '현재 탭 닫기',      en: 'Close Current Tab' } },
      { win: 'Ctrl+Shift+N',       desc: { ko: '새 연결',           en: 'New Connection' } },
      { win: 'Ctrl+Tab',           desc: { ko: '다음 연결로 전환',  en: 'Next Connection' } },
      { win: 'Ctrl+Shift+Tab',     desc: { ko: '이전 연결로 전환',  en: 'Previous Connection' } },
      ...(isMac
        ? [
            { win: 'Ctrl+Alt+ArrowRight', desc: { ko: '다음 쿼리 탭', en: 'Next Query Tab' } },
            { win: 'Ctrl+Alt+ArrowLeft',  desc: { ko: '이전 쿼리 탭', en: 'Previous Query Tab' } },
          ]
        : [
            { win: 'Ctrl+PageDown', desc: { ko: '다음 쿼리 탭', en: 'Next Query Tab' } },
            { win: 'Ctrl+PageUp',   desc: { ko: '이전 쿼리 탭', en: 'Previous Query Tab' } },
          ]),
      { win: isMac ? '⌘Q' : 'Alt+F4',  desc: { ko: '종료',         en: 'Exit' } },
    ],
  },
  {
    title: { ko: '포커스 이동', en: 'Focus' },
    items: [
      { win: 'Ctrl+B',             desc: { ko: '객체 브라우저',     en: 'Object Browser' } },
      { win: 'Ctrl+E',             desc: { ko: 'SQL 에디터',        en: 'SQL Editor' } },
      { win: 'Ctrl+R',             desc: { ko: '결과 그리드',       en: 'Result Grid' } },
    ],
  },
  {
    title: { ko: '보기 & 도구', en: 'View & Tools' },
    items: [
      { win: 'Ctrl+K',             desc: { ko: '명령 팔레트 (Ctrl+P)', en: 'Command Palette (Ctrl+P)' } },
      { win: 'F5',                 desc: { ko: '스키마 새로고침',   en: 'Refresh Schema' } },
      { win: 'Ctrl+Shift+P',       desc: { ko: '프로세스 목록',     en: 'Process List' } },
      { win: 'Ctrl+U',             desc: { ko: '사용자 관리자',     en: 'User Manager' } },
      { win: 'Ctrl+Shift+D',       desc: { ko: '데이터 검색',       en: 'Data Search' } },
      { win: 'Ctrl+Alt+S',         desc: { ko: '스키마 동기화',     en: 'Schema Sync' } },
      { win: 'Ctrl+Alt+W',         desc: { ko: '데이터 동기화',     en: 'Data Sync' } },
      { win: 'Ctrl+Alt+E',         desc: { ko: '백업 / SQL Dump',   en: 'Backup / SQL Dump' } },
      { win: 'Ctrl+Alt+D',         desc: { ko: 'ER 다이어그램',     en: 'ER Diagram' } },
      { win: 'Ctrl+,',             desc: { ko: '환경설정',          en: 'Settings' } },
      { win: isMac ? 'Ctrl+Alt+I' : 'F12', desc: { ko: '개발자 도구', en: 'Developer Tools' } },
    ],
  },
]

/** 'Ctrl+Alt+ArrowRight' 등 ShortcutsDialog 전용 표기를 사람-읽기용으로 정규화 */
function prettyKey(s: string): string {
  return s.replace('ArrowRight', '→').replace('ArrowLeft', '←')
}

/**
 * 키보드 단축키 목록 다이얼로그.
 * MenuBar > Help > Keyboard Shortcuts 에서 열림.
 */
export default function ShortcutsDialog({ open, onClose }: Props) {
  const { theme } = useThemeStore()
  const { language } = useLanguageStore()
  const isDark = theme === 'dark'

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const overlay    = 'fixed inset-0 z-50 flex items-center justify-center'
  const dialogCls  = isDark
    ? 'relative z-10 w-[520px] max-h-[85vh] flex flex-col rounded-xl border border-[#2d3748] bg-[#161b27] shadow-2xl'
    : 'relative z-10 w-[520px] max-h-[85vh] flex flex-col rounded-xl border border-[#d1d5db] bg-white shadow-2xl'
  const headerCls  = isDark
    ? 'flex items-center justify-between border-b border-[#2d3748] px-5 py-3'
    : 'flex items-center justify-between border-b border-[#e5e7eb] px-5 py-3'
  const titleCls   = isDark ? 'text-sm font-semibold text-[#e2e8f0]' : 'text-sm font-semibold text-[#111827]'
  const closeCls   = isDark
    ? 'rounded p-0.5 text-[#718096] hover:bg-[#2d3748] hover:text-[#e2e8f0] transition-colors'
    : 'rounded p-0.5 text-[#9ca3af] hover:bg-[#f3f4f6] hover:text-[#111827] transition-colors'
  const sectionTitleCls = isDark ? 'text-[10px] font-semibold uppercase tracking-widest text-[#4a5568] mb-2' : 'text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af] mb-2'
  const rowCls     = 'flex items-center justify-between py-1.5'
  const descCls    = isDark ? 'text-xs text-[#a0aec0]' : 'text-xs text-[#374151]'
  const keyCls     = isDark
    ? 'px-1.5 py-0.5 text-[10px] font-mono rounded border border-[#2d3748] bg-[#0f1117] text-[#e2e8f0]'
    : 'px-1.5 py-0.5 text-[10px] font-mono rounded border border-[#d1d5db] bg-[#f3f4f6] text-[#111827]'
  const sepCls     = isDark ? 'border-t border-[#1e2230] my-3' : 'border-t border-[#f3f4f6] my-3'
  const platformBadge = isDark ? 'text-[9px] text-[#4a5568] uppercase tracking-wider' : 'text-[9px] text-[#9ca3af] uppercase tracking-wider'

  return (
    <div className={overlay} onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className={dialogCls} onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className={headerCls}>
          <div className="flex items-baseline gap-2">
            <span className={titleCls}>{t('menuShortcuts', language)}</span>
            <span className={platformBadge}>{isMac ? 'macOS' : 'Windows'}</span>
          </div>
          <button onClick={onClose} className={closeCls}>
            <X size={14} />
          </button>
        </div>

        {/* 단축키 목록 */}
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {SHORTCUT_SECTIONS.map((section, si) => (
            <div key={si}>
              <p className={sectionTitleCls}>{section.title[language as 'ko' | 'en'] ?? section.title.ko}</p>
              <div>
                {section.items.map((item, ii) => (
                  <div key={ii} className={rowCls}>
                    <span className={descCls}>{item.desc[language as 'ko' | 'en'] ?? item.desc.ko}</span>
                    <span className={keyCls}>{prettyKey(fmtKb(item.win))}</span>
                  </div>
                ))}
              </div>
              {si < SHORTCUT_SECTIONS.length - 1 && <div className={sepCls} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
