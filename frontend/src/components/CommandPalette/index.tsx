import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Search, Plug, Database, Table, Eye, ArrowUp, ArrowDown, CornerDownLeft } from 'lucide-react'
import { useCommandPaletteStore } from '@/stores/useCommandPaletteStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import { fuzzyMatch } from '@/lib/fuzzyMatch'
import { ListDatabases, ListTables } from '@/wailsjs/go/main/App'
import type { TableInfo } from '@/types'
import type { CommandGroup, CommandItem } from './types'

interface Props {
  /** App.tsx 가 기존 콜백을 래핑해 주입하는 액션 명령. */
  actions: CommandItem[]
  onSwitchConnection: (connId: string) => void
  onSelectDatabase: (connId: string, db: string) => void
  onNavigateTable: (connId: string, db: string, table: TableInfo) => void
}

const MAX_RESULTS = 60

/** 매치 글자를 강조해 라벨을 렌더. indices 가 비면 원문 그대로. */
function renderHighlight(text: string, indices: number[]): ReactNode {
  if (indices.length === 0) return text
  const set = new Set(indices)
  const out: ReactNode[] = []
  for (let i = 0; i < text.length; i++) {
    if (set.has(i)) {
      out.push(
        <span key={i} style={{ color: 'var(--color-accent-light)', fontWeight: 600 }}>
          {text[i]}
        </span>,
      )
    } else {
      out.push(text[i])
    }
  }
  return out
}

/**
 * Phase 63: 명령 팔레트 (Ctrl+K / Ctrl+P).
 *
 * 오픈 상태는 `useCommandPaletteStore` 가 소유(단축키·Monaco 트리거와 분리).
 * 액션은 props 로 주입, 연결/DB/테이블 네비 항목은 store + react-query 캐시(Phase 61 Infinity)에서 파생.
 */
export default function CommandPalette({ actions, onSwitchConnection, onSelectDatabase, onNavigateTable }: Props) {
  const open = useCommandPaletteStore((s) => s.open)
  const closePalette = useCommandPaletteStore((s) => s.closePalette)
  const language = useLanguageStore((s) => s.language)
  const activeConnections = useConnectionStore((s) => s.activeConnections)
  const selectedConnId = useConnectionStore((s) => s.selectedConnId)
  const selectedDatabase = useConnectionStore((s) => s.selectedDatabase)
  const queryClient = useQueryClient()

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dbs, setDbs] = useState<string[]>([])
  const [tablesByDb, setTablesByDb] = useState<Record<string, TableInfo[]>>({})

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 오픈 시: 입력 초기화 + 포커스 + 선택 연결/DB 스키마 선제 로드(캐시 재활용).
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    setDbs([])
    setTablesByDb({})
    const raf = requestAnimationFrame(() => inputRef.current?.focus())

    let cancelled = false
    const connId = selectedConnId
    if (connId) {
      void (async () => {
        try {
          const dbList = await queryClient.fetchQuery({
            queryKey: ['databases', connId],
            queryFn: () => ListDatabases(connId),
            staleTime: Infinity,
          })
          if (cancelled) return
          const list = dbList ?? []
          setDbs(list)
          const map: Record<string, TableInfo[]> = {}
          // 선택 DB 는 선제 로드, 나머지는 이미 캐시된 것만 노출.
          if (selectedDatabase && list.includes(selectedDatabase)) {
            try {
              const ts = await queryClient.fetchQuery({
                queryKey: ['tables', connId, selectedDatabase],
                queryFn: () => ListTables(connId, selectedDatabase),
                staleTime: Infinity,
              })
              if (!cancelled) map[selectedDatabase] = ts ?? []
            } catch { /* 무시 */ }
          }
          for (const db of list) {
            if (map[db]) continue
            const cached = queryClient.getQueryData<TableInfo[]>(['tables', connId, db])
            if (cached) map[db] = cached
          }
          if (!cancelled) setTablesByDb(map)
        } catch {
          /* 스키마 로드 실패 시 액션 그룹만으로 동작 */
        }
      })()
    }
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [open, selectedConnId, selectedDatabase, queryClient])

  // ── 명령 소스 파생 ────────────────────────────────────────────────────
  const connItems: CommandItem[] = useMemo(
    () =>
      activeConnections
        .filter((c) => c.id !== selectedConnId)
        .map((c) => ({
          id: `conn:${c.id}`,
          label: c.name,
          detail: `${c.user}@${c.host}:${c.port}`,
          group: 'connection' as CommandGroup,
          keywords: `${c.host} ${c.user}`,
          icon: <Plug size={14} />,
          run: () => onSwitchConnection(c.id),
        })),
    [activeConnections, selectedConnId, onSwitchConnection],
  )

  const dbItems: CommandItem[] = useMemo(() => {
    if (!selectedConnId) return []
    return dbs.map((db) => ({
      id: `db:${db}`,
      label: db,
      group: 'database' as CommandGroup,
      icon: <Database size={14} />,
      run: () => onSelectDatabase(selectedConnId, db),
    }))
  }, [dbs, selectedConnId, onSelectDatabase])

  const tableItems: CommandItem[] = useMemo(() => {
    if (!selectedConnId) return []
    const out: CommandItem[] = []
    for (const [db, tables] of Object.entries(tablesByDb)) {
      for (const tbl of tables) {
        const isView = tbl.type === 'VIEW'
        out.push({
          id: `tbl:${db}.${tbl.name}`,
          label: tbl.name,
          detail: `${db} · ${isView ? t('cmdTypeView', language) : t('cmdTypeTable', language)}`,
          group: 'table',
          keywords: db,
          icon: isView ? <Eye size={14} /> : <Table size={14} />,
          run: () => onNavigateTable(selectedConnId, db, tbl),
        })
      }
    }
    return out
  }, [tablesByDb, selectedConnId, language, onNavigateTable])

  // ── 필터 + 랭킹 ──────────────────────────────────────────────────────
  const showHeaders = query.trim() === ''
  const { items: visible, more } = useMemo(() => {
    // 닫혀 있을 땐 계산 생략 — App 리렌더마다 actions 배열이 새로 생성돼도 비용 0.
    const empty = { items: [] as { item: CommandItem; indices: number[] }[], more: 0 }
    if (!open) return empty
    const q = query.trim()
    const all = [...actions, ...connItems, ...dbItems, ...tableItems]
    if (!q) {
      const items = all.slice(0, MAX_RESULTS).map((item) => ({ item, indices: [] as number[] }))
      return { items, more: all.length - items.length }
    }
    const scored: { item: CommandItem; indices: number[]; score: number }[] = []
    for (const item of all) {
      const mLabel = fuzzyMatch(q, item.label)
      if (mLabel) {
        scored.push({ item, indices: mLabel.indices, score: mLabel.score })
      } else if (item.keywords) {
        const mk = fuzzyMatch(q, item.keywords)
        if (mk) scored.push({ item, indices: [], score: mk.score - 50 })
      }
    }
    scored.sort((a, b) => b.score - a.score)
    const items = scored.slice(0, MAX_RESULTS).map(({ item, indices }) => ({ item, indices }))
    return { items, more: scored.length - items.length }
  }, [open, query, actions, connItems, dbItems, tableItems])

  // 필터 변경 시 선택 초기화
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // 선택 항목이 뷰포트 밖이면 스크롤
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector(`[data-osql-cmd-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, open])

  const execute = useCallback(
    (item?: CommandItem) => {
      if (!item) return
      closePalette()
      item.run()
    },
    [closePalette],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => (visible.length ? (i + 1) % visible.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => (visible.length ? (i - 1 + visible.length) % visible.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      execute(visible[selectedIndex]?.item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closePalette()
    }
  }

  if (!open) return null

  const groupLabel = (g: CommandGroup): string =>
    g === 'action'
      ? t('cmdGroupActions', language)
      : g === 'connection'
        ? t('cmdGroupConnections', language)
        : g === 'database'
          ? t('cmdGroupDatabases', language)
          : t('cmdGroupTables', language)

  return (
    <div
      className="osql-command-palette-backdrop fixed inset-0 z-[60] flex items-start justify-center"
      style={{ paddingTop: '12vh', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePalette()
      }}
    >
      <div
        className="osql-command-palette w-[640px] max-w-[92vw] max-h-[70vh] flex flex-col rounded-lg overflow-hidden shadow-2xl"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* 검색 입력 */}
        <div
          className="osql-command-palette-input flex items-center gap-2 px-3 py-2.5 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <Search size={16} style={{ color: 'var(--color-text-muted)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('cmdPalettePlaceholder', language)}
            spellCheck={false}
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: 'var(--color-text-primary)' }}
          />
        </div>

        {/* 결과 리스트 */}
        <div ref={listRef} className="osql-command-palette-list flex-1 overflow-y-auto py-1">
          {visible.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('cmdPaletteNoResults', language)}
            </div>
          ) : (
            visible.map(({ item, indices }, idx) => {
              const header = showHeaders && (idx === 0 || visible[idx - 1].item.group !== item.group)
              const active = idx === selectedIndex
              return (
                <Fragment key={item.id}>
                  {header && (
                    <div
                      className="osql-command-palette-group px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {groupLabel(item.group)}
                    </div>
                  )}
                  <button
                    type="button"
                    data-osql-cmd-index={idx}
                    data-osql-cmd-key={item.id}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => execute(item)}
                    className="osql-command-palette-item w-full flex items-center gap-2.5 px-3 py-1.5 text-left"
                    style={active ? { background: 'var(--color-bg-selected)' } : undefined}
                  >
                    <span
                      className="shrink-0 flex items-center"
                      style={{ color: active ? 'var(--color-accent-light)' : 'var(--color-text-muted)' }}
                    >
                      {item.icon}
                    </span>
                    <span
                      className="flex-1 min-w-0 truncate text-sm"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {renderHighlight(item.label, indices)}
                    </span>
                    {item.detail && (
                      <span
                        className="shrink-0 truncate text-xs ml-2"
                        style={{ color: 'var(--color-text-muted)', maxWidth: '45%' }}
                      >
                        {item.detail}
                      </span>
                    )}
                  </button>
                </Fragment>
              )
            })
          )}
          {more > 0 && (
            <div
              className="osql-command-palette-more px-3 py-1.5 text-center text-[11px]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {more}{t('cmdPaletteMore', language)}
            </div>
          )}
        </div>

        {/* 힌트 풋터 */}
        <div
          className="osql-command-palette-hint flex items-center gap-3 px-3 py-1.5 border-t text-[11px]"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
        >
          <span className="flex items-center gap-1">
            <ArrowUp size={11} />
            <ArrowDown size={11} />
            {t('cmdPaletteHintNav', language)}
          </span>
          <span className="flex items-center gap-1">
            <CornerDownLeft size={11} />
            {t('cmdPaletteHintRun', language)}
          </span>
          <span className="ml-auto">Esc {t('cmdPaletteHintClose', language)}</span>
        </div>
      </div>
    </div>
  )
}
