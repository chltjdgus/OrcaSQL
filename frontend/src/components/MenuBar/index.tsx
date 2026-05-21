/**
 * SQLyog 스타일 메뉴바.
 * File / Database / Query / Tools / Help 드롭다운 메뉴.
 * 네이티브 OS 메뉴 대신 커스텀 React 드롭다운으로 구현.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronRight } from 'lucide-react'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)

/**
 * Win 표기("Ctrl+Shift+N", "Ctrl+Alt+E", "Ctrl+Tab" 등)를 받아
 * Mac 에서는 Apple 키 심볼(⌃⌥⇧⌘ 순)로 변환한다. 'Ctrl+Tab' 류는
 * macOS 관행 상 Cmd 가 아닌 Control 키(⌃) 로 매핑한다.
 */
function fmtKb(win: string): string {
  if (!isMac) return win
  const parts = win.split('+')
  const last = parts.pop() ?? ''
  const mods = new Set(parts)
  const ctrlAsControl = last === 'Tab' // 연결 탭 전환은 ⌃Tab 유지 (⌘Tab = OS 앱 스위처)
  let out = ''
  if (mods.has('Ctrl') && ctrlAsControl) out += '⌃'
  if (mods.has('Alt')) out += '⌥'
  if (mods.has('Shift')) out += '⇧'
  if (mods.has('Ctrl') && !ctrlAsControl) out += '⌘'
  // F-keys / Enter / arrows 는 그대로 표시
  if (last === 'Enter') return out + '↵'
  if (last === 'PageUp') return out + 'PgUp'
  if (last === 'PageDown') return out + 'PgDn'
  return out + last
}
import { useConnectionStore } from '@/stores/connectionStore'
import { useThemeStore } from '@/stores/useThemeStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import AboutDialog from '@/components/AboutDialog'
import ShortcutsDialog from '@/components/ShortcutsDialog'
import ResetConfirmDialog from '@/components/ResetConfirmDialog'
import logoSrc from '@/assets/logo.png'
import logoDarkSrc from '@/assets/logo-dark.png'
import { GetAppInfo, OpenDevTools } from '@/wailsjs/go/main/App'
import toast from 'react-hot-toast'

interface MenuAction {
  label: string
  shortcut?: string
  disabled?: boolean
  separator?: false
  action: () => void
  submenu?: never
}
interface MenuSeparator {
  separator: true
  label?: never
  action?: never
  submenu?: never
  shortcut?: never
  disabled?: never
}
interface MenuSubmenu {
  label: string
  submenu: MenuItem[]
  separator?: false
  action?: never
  shortcut?: never
  disabled?: boolean
}
type MenuItem = MenuAction | MenuSeparator | MenuSubmenu

interface MenuDef {
  id: string    // 내부 상태 추적용 고정 식별자
  label: string // 번역된 표시 텍스트
  items: MenuItem[]
}

interface Props {
  onNewConn?: () => void
  onOpenBackup?: () => void
  onOpenSync?: () => void
  onOpenDataSync?: () => void
  onOpenSearch?: () => void
  onOpenER?: () => void
  onGetSQL?: () => string
  onSetSQL?: (sql: string) => void
  onExecute?: () => void
  onExecuteSelection?: () => void
  onShowHistory?: () => void
  onShowFavorites?: () => void
  onShowProcessList?: () => void
  onShowServerVars?: () => void
  onShowUserManager?: () => void
  onOpenSettings?: () => void
}

export default function MenuBar({
  onNewConn,
  onOpenBackup,
  onOpenSync,
  onOpenDataSync,
  onOpenSearch,
  onOpenER,
  onExecute,
  onExecuteSelection,
  onShowHistory,
  onShowFavorites,
  onShowProcessList,
  onShowServerVars,
  onShowUserManager,
  onOpenSettings,
}: Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [version, setVersion] = useState<string>('')
  const barRef = useRef<HTMLDivElement>(null)
  const { addTab, selectedConnId, selectedDatabase } = useConnectionStore()
  const { theme, toggleTheme } = useThemeStore()
  const { language } = useLanguageStore()

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 앱 버전 로드 (로고 옆에 표시)
  useEffect(() => {
    GetAppInfo()
      .then((info) => setVersion(info.version))
      .catch(() => setVersion('dev'))
  }, [])

  const menus: MenuDef[] = [
    {
      id: 'File',
      label: t('menuFile', language),
      items: [
        { label: t('menuNewConn', language), shortcut: fmtKb('Ctrl+Shift+N'), action: () => onNewConn?.() },
        { separator: true },
        { label: t('menuNewQueryTab', language), shortcut: fmtKb('Ctrl+T'), action: () => addTab(selectedConnId, selectedDatabase ?? null) },
        { separator: true },
        { label: t('menuExit', language), shortcut: isMac ? '⌘Q' : 'Alt+F4', action: () => window.close() },
      ],
    },
    {
      id: 'Database',
      label: t('menuDatabase', language),
      items: [
        { label: t('menuBackup', language),    shortcut: fmtKb('Ctrl+Alt+E'), action: () => onOpenBackup?.() },
        { label: t('menuSchemaSync', language), shortcut: fmtKb('Ctrl+Alt+S'), action: () => onOpenSync?.() },
        { label: t('menuDataSync', language),   shortcut: fmtKb('Ctrl+Alt+W'), action: () => onOpenDataSync?.() },
        { separator: true },
        { label: t('menuDataSearch', language), shortcut: fmtKb('Ctrl+Shift+D'), action: () => onOpenSearch?.() },
        { label: t('menuER', language),         shortcut: fmtKb('Ctrl+Alt+D'), action: () => onOpenER?.() },
        { separator: true },
        { label: t('menuRefreshSchema', language), shortcut: 'F5', action: () => window.dispatchEvent(new CustomEvent('schema:refresh')) },
      ],
    },
    {
      id: 'Query',
      label: t('menuQuery', language),
      items: [
        { label: t('menuExecute', language),          shortcut: 'F9',                action: () => onExecute?.() },
        { label: t('menuExecuteSelection', language), shortcut: fmtKb('Ctrl+F9'),    action: () => onExecuteSelection?.() },
        { separator: true },
        { label: t('menuHistory', language),   shortcut: fmtKb('Ctrl+H'),       action: () => onShowHistory?.() },
        { label: t('menuFavorites', language), shortcut: fmtKb('Ctrl+Shift+B'), action: () => onShowFavorites?.() },
        { separator: true },
        {
          label: t('menuFormatSQL', language),
          shortcut: fmtKb('Ctrl+Shift+F'),
          action: () => window.dispatchEvent(new CustomEvent('query:format')),
        },
      ],
    },
    {
      id: 'Tools',
      label: t('menuTools', language),
      items: [
        {
          label: t('menuShow', language),
          submenu: [
            {
              label: t('menuProcesses', language),
              shortcut: fmtKb('Ctrl+Shift+P'),
              action: () => onShowProcessList?.(),
            },
            {
              label: t('menuServerVars', language),
              action: () => onShowServerVars?.(),
            },
          ],
        },
        {
          label: t('menuUserManager', language),
          shortcut: fmtKb('Ctrl+U'),
          action: () => onShowUserManager?.(),
        },
        { separator: true },
        {
          label: t('menuTheme', language),
          submenu: [
            {
              label: (theme === 'dark' ? '✓ ' : '  ') + t('menuDarkMode', language),
              action: () => { if (theme !== 'dark') toggleTheme() },
            },
            {
              label: (theme === 'light' ? '✓ ' : '  ') + t('menuLightMode', language),
              action: () => { if (theme !== 'light') toggleTheme() },
            },
          ],
        },
        { separator: true },
        {
          label: t('settings', language) + '...',
          shortcut: fmtKb('Ctrl+,'),
          action: () => onOpenSettings?.(),
        },
      ],
    },
    {
      id: 'Help',
      label: t('menuHelp', language),
      items: [
        { label: t('menuAbout', language), action: () => setAboutOpen(true) },
        { label: t('menuShortcuts', language), action: () => setShortcutsOpen(true) },
        { separator: true },
        {
          label: t('menuDevTools', language),
          shortcut: isMac ? '⌥⌘I' : 'F12',
          action: () => {
            OpenDevTools().catch((err) => {
              const msg = err instanceof Error ? err.message : String(err)
              toast.error(`${t('toastDevToolsFailed', language)}: ${msg}`)
            })
          },
        },
        { separator: true },
        { label: t('menuResetAllSettings', language), action: () => setResetOpen(true) },
      ],
    },
  ]

  const handleMenuClick = useCallback((id: string) => {
    setOpenMenu((prev) => (prev === id ? null : id))
  }, [])

  const handleItemClick = useCallback((item: MenuAction) => {
    item.action()
    setOpenMenu(null)
  }, [])

  const barBg = theme === 'dark' ? 'bg-[#111827] border-[#1e2a3a]' : 'bg-[#f1f3f7] border-[#d1d5db]'
  const btnBase = theme === 'dark'
    ? 'text-[#a0aec0] hover:text-[#e2e8f0] hover:bg-[#1e2a3a]'
    : 'text-[#4b5563] hover:text-[#111827] hover:bg-[#dde2ea]'
  return (
    <>
      <div
        className={`osql-menubar flex items-center border-b shrink-0 select-none ${isMac ? 'h-10' : 'h-8'} ${barBg}`}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* macOS: 트래픽 라이트 버튼 공간 확보 */}
        {isMac && <div className="w-[72px] shrink-0" />}

        {/* 앱 로고 — Windows는 타이틀바 아이콘과 겹치므로 숨김 */}
        {!isWindows && (
          <>
            <img
              src={theme === 'dark' ? logoDarkSrc : logoSrc}
              alt="OrcaSQL"
              className="h-5 w-auto shrink-0 ml-2 select-none pointer-events-none"
              style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
              draggable={false}
            />
            {version && (
              <span
                className={`ml-1.5 mr-2 text-[10px] font-mono shrink-0 select-none pointer-events-none ${
                  theme === 'dark' ? 'text-[#718096]' : 'text-[#9ca3af]'
                }`}
                style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
              >
                v{version}
              </span>
            )}
          </>
        )}

        <div
          ref={barRef}
          className="flex items-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
        {menus.map((menu) => (
          <div key={menu.id} className="relative">
            <button
              className={`px-3 h-7 text-xs transition-colors ${
                openMenu === menu.id
                  ? 'bg-[#4299e1] text-white'
                  : btnBase
              }`}
              onMouseDown={() => handleMenuClick(menu.id)}
              onMouseEnter={() => openMenu && setOpenMenu(menu.id)}
            >
              {menu.label}
            </button>

            {openMenu === menu.id && (
              <DropdownMenu
                items={menu.items}
                onItemClick={handleItemClick}
                onClose={() => setOpenMenu(null)}
                theme={theme}
              />
            )}
          </div>
        ))}
        </div>

        {/* 드래그 가능한 나머지 빈 공간 */}
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
      </div>

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ResetConfirmDialog open={resetOpen} onClose={() => setResetOpen(false)} />
    </>
  )
}

// ─── DropdownMenu ─────────────────────────────────────────────────────────────

interface DropdownMenuProps {
  items: MenuItem[]
  onItemClick: (item: MenuAction) => void
  onClose: () => void
  sub?: boolean
  theme?: string
}

function DropdownMenu({ items, onItemClick, onClose, sub = false, theme = 'dark' }: DropdownMenuProps) {
  const isDark = theme === 'dark'
  const menuBg = isDark
    ? 'bg-[#1e2230] border-[#2d3748]'
    : 'bg-white border-[#d1d5db] shadow-lg'
  const sepColor = isDark ? 'border-[#2d3748]' : 'border-[#e5e7eb]'
  const itemCls = isDark
    ? 'text-[#e2e8f0] hover:bg-[#4299e1] hover:text-white'
    : 'text-[#374151] hover:bg-[#4299e1] hover:text-white'
  const shortcutCls = isDark ? 'text-[#718096]' : 'text-[#9ca3af]'

  return (
    <div
      className={`absolute ${sub ? 'left-full top-0' : 'left-0 top-full'} z-50 mt-px min-w-[200px] border rounded shadow-xl py-1 ${menuBg}`}
    >
      {items.map((item, idx) => {
        if (item.separator) {
          return <div key={idx} className={`my-1 border-t ${sepColor}`} />
        }
        if ('submenu' in item && item.submenu) {
          return (
            <SubMenuItem
              key={item.label}
              item={item as MenuSubmenu}
              onItemClick={onItemClick}
              onClose={onClose}
              theme={theme}
            />
          )
        }
        const action = item as MenuAction
        return (
          <button
            key={action.label}
            disabled={action.disabled}
            className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors disabled:opacity-40 ${itemCls}`}
            onMouseDown={() => onItemClick(action)}
          >
            <span>{action.label}</span>
            {action.shortcut && (
              <span className={`ml-4 text-[10px] group-hover:text-white ${shortcutCls}`}>{action.shortcut}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function SubMenuItem({
  item,
  onItemClick,
  onClose,
  theme = 'dark',
}: {
  item: MenuSubmenu
  onItemClick: (item: MenuAction) => void
  onClose: () => void
  theme?: string
}) {
  const [hovered, setHovered] = useState(false)
  const isDark = theme === 'dark'
  const itemCls = isDark
    ? 'text-[#e2e8f0] hover:bg-[#4299e1] hover:text-white'
    : 'text-[#374151] hover:bg-[#4299e1] hover:text-white'

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors disabled:opacity-40 ${itemCls}`}
        disabled={item.disabled}
      >
        <span>{item.label}</span>
        <ChevronRight size={10} className="shrink-0 text-[#4a5568] ml-auto" />
      </button>
      {hovered && !item.disabled && (
        <DropdownMenu
          items={item.submenu}
          onItemClick={onItemClick}
          onClose={onClose}
          sub
          theme={theme}
        />
      )}
    </div>
  )
}
