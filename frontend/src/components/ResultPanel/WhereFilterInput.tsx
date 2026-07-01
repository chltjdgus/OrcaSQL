/**
 * Phase 62 — Data 탭 WHERE 필터 입력 (컬럼명 자동완성 + 검색 기록).
 *
 * 기능:
 *  - 컬럼명 자동완성: 커서 위치의 식별자 토큰을 컬럼 목록과 매칭해 드롭다운 제안.
 *    ↑/↓ 이동, Enter/Tab 선택, Esc 닫기. 선택 시 토큰만 컬럼명으로 치환.
 *  - 검색 기록: 적용했던 WHERE 절을 시계 아이콘 드롭다운에서 재선택/삭제.
 *  - 입력 폭 확장: 많은 조건을 담을 수 있도록 넓은 입력 박스.
 *
 * 상태(whereInput/activeWhere)와 기록 저장은 부모(TableDataTab)가 관리하고,
 * 이 컴포넌트는 표시·상호작용만 담당한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, History, Trash2 } from 'lucide-react'
import { t, type Language } from '@/i18n'

interface Props {
  value: string
  onChange: (v: string) => void
  onApply: () => void
  onClear: () => void
  /** 자동완성 대상 컬럼명 목록 */
  columns: string[]
  /** 최신순 검색 기록 */
  history: string[]
  /** 기록 항목 선택 → 입력에 채우고 즉시 적용 */
  onPickHistory: (where: string) => void
  onRemoveHistory: (where: string) => void
  onClearHistory: () => void
  isDark: boolean
  language: Language
}

const MAX_SUGGEST = 8
/** 커서 앞 식별자 토큰(백틱 포함) 추출용 */
const TOKEN_RE = /[`A-Za-z0-9_]+$/

export default function WhereFilterInput({
  value, onChange, onApply, onClear,
  columns, history, onPickHistory, onRemoveHistory, onClearHistory,
  isDark, language,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const [suggestOpen, setSuggestOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [matches, setMatches] = useState<string[]>([])
  const [tokenStart, setTokenStart] = useState(0)
  const [highlight, setHighlight] = useState(0)

  // 커서 위치 기준으로 자동완성 후보 갱신
  const refreshSuggestions = useCallback(
    (text: string, caret: number) => {
      const before = text.slice(0, caret)
      const m = before.match(TOKEN_RE)
      const rawToken = m ? m[0] : ''
      const token = rawToken.replace(/`/g, '')
      if (token.length < 1 || columns.length === 0) {
        setSuggestOpen(false)
        setMatches([])
        return
      }
      const lower = token.toLowerCase()
      // startsWith 우선, 그다음 includes — 이미 완전히 입력된 컬럼은 제외
      const starts: string[] = []
      const contains: string[] = []
      for (const c of columns) {
        const cl = c.toLowerCase()
        if (cl === lower) continue
        if (cl.startsWith(lower)) starts.push(c)
        else if (cl.includes(lower)) contains.push(c)
      }
      const matched = [...starts, ...contains].slice(0, MAX_SUGGEST)
      setMatches(matched)
      setTokenStart(caret - rawToken.length)
      setHighlight(0)
      setSuggestOpen(matched.length > 0)
      if (matched.length > 0) setHistoryOpen(false)
    },
    [columns],
  )

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value
    onChange(text)
    refreshSuggestions(text, e.target.selectionStart ?? text.length)
  }

  // 토큰을 선택한 컬럼명으로 치환
  const acceptSuggestion = useCallback(
    (col: string) => {
      const el = inputRef.current
      const caret = el?.selectionStart ?? value.length
      const before = value.slice(0, tokenStart)
      const after = value.slice(caret)
      const next = `${before}${col}${after}`
      onChange(next)
      setSuggestOpen(false)
      setMatches([])
      const newCaret = tokenStart + col.length
      requestAnimationFrame(() => {
        el?.focus()
        el?.setSelectionRange(newCaret, newCaret)
      })
    },
    [value, tokenStart, onChange],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestOpen && matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => (h + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => (h - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        acceptSuggestion(matches[highlight])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSuggestOpen(false)
        return
      }
    }
    if (e.key === 'Enter') {
      setSuggestOpen(false)
      setHistoryOpen(false)
      onApply()
    } else if (e.key === 'Escape') {
      setHistoryOpen(false)
    }
  }

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    if (!suggestOpen && !historyOpen) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setSuggestOpen(false)
        setHistoryOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [suggestOpen, historyOpen])

  const metaCls = isDark ? 'text-[#718096]' : 'text-[#64748b]'
  const boxBg = isDark ? '#1a1f2e' : '#ffffff'
  const boxBorder = isDark ? '#2d3748' : '#cbd5e0'
  const dropBg = isDark ? 'bg-[#1a1f2e] border-[#2d3748]' : 'bg-[#ffffff] border-[#cbd5e0]'
  const itemHover = isDark ? 'hover:bg-[#252b3b]' : 'hover:bg-[#f1f5f9]'
  const itemText = isDark ? 'text-[#e2e8f0]' : 'text-[#1e293b]'

  const pickHistory = (w: string) => {
    setHistoryOpen(false)
    setSuggestOpen(false)
    onPickHistory(w)
  }

  const hasHistory = history.length > 0

  const highlightItem = useMemo(() => matches[highlight], [matches, highlight])

  return (
    <div
      ref={rootRef}
      className="osql-where-filter relative flex items-center gap-1 flex-1 min-w-[260px] max-w-[640px] border rounded px-2 py-0.5"
      style={{ background: boxBg, borderColor: boxBorder }}
    >
      <span className={`text-[9px] shrink-0 font-mono ${metaCls}`}>WHERE</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={(e) => refreshSuggestions(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        placeholder="id > 0 AND name LIKE '%a%'"
        spellCheck={false}
        autoComplete="off"
        className={`osql-where-filter-input flex-1 bg-transparent text-[10px] outline-none min-w-0 font-mono ${isDark ? 'text-[#e2e8f0] placeholder-[#2d3748]' : 'text-[#1e293b] placeholder-[#94a3b8]'}`}
      />

      {value && (
        <button
          onClick={() => { onClear(); setSuggestOpen(false) }}
          className={`osql-where-filter-clear ${metaCls} hover:text-[#e2e8f0] transition-colors`}
          title={t('whereClearInput', language)}
        >
          <X size={9} />
        </button>
      )}

      {/* 검색 기록 토글 */}
      <button
        onClick={() => { setHistoryOpen((o) => !o); setSuggestOpen(false) }}
        className={`osql-where-filter-history-btn transition-colors ${historyOpen ? 'text-[#4299e1]' : `${metaCls} hover:text-[#4299e1]`} ${!hasHistory ? 'opacity-40' : ''}`}
        title={t('whereHistoryTitle', language)}
      >
        <History size={10} />
      </button>

      {/* 적용 */}
      <button
        onClick={onApply}
        className={`osql-where-filter-apply ${metaCls} hover:text-[#4299e1] transition-colors`}
        title={t('rpFilterApply', language)}
      >
        <Search size={9} />
      </button>

      {/* 자동완성 드롭다운 */}
      {suggestOpen && matches.length > 0 && (
        <div className={`osql-where-filter-suggest absolute left-0 top-full mt-1 z-50 min-w-[180px] max-w-[280px] py-1 border rounded shadow-xl ${dropBg}`}>
          <div className={`px-2 pb-1 text-[8px] uppercase ${metaCls}`}>{t('whereSuggestHint', language)}</div>
          {matches.map((col) => (
            <button
              key={col}
              onMouseEnter={() => setHighlight(matches.indexOf(col))}
              onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(col) }}
              className={`w-full text-left px-2 py-1 text-[11px] font-mono truncate ${itemText} ${col === highlightItem ? (isDark ? 'bg-[#252b3b]' : 'bg-[#e2e8f0]') : itemHover}`}
            >
              {col}
            </button>
          ))}
        </div>
      )}

      {/* 검색 기록 드롭다운 */}
      {historyOpen && (
        <div className={`osql-where-filter-history absolute left-0 top-full mt-1 z-50 min-w-[240px] max-w-[420px] py-1 border rounded shadow-xl ${dropBg}`}>
          <div className={`flex items-center justify-between px-2 pb-1 ${metaCls}`}>
            <span className="text-[8px] uppercase">{t('whereHistoryTitle', language)}</span>
            {hasHistory && (
              <button
                onMouseDown={(e) => { e.preventDefault(); onClearHistory() }}
                className={`flex items-center gap-0.5 text-[9px] hover:text-[#fc8181] transition-colors`}
                title={t('whereHistoryClear', language)}
              >
                <Trash2 size={9} /> {t('whereHistoryClear', language)}
              </button>
            )}
          </div>
          {!hasHistory && (
            <div className={`px-2 py-2 text-[10px] ${metaCls}`}>{t('whereHistoryEmpty', language)}</div>
          )}
          {history.map((w) => (
            <div
              key={w}
              className={`group flex items-center gap-1 px-2 py-1 ${itemHover}`}
            >
              <button
                onMouseDown={(e) => { e.preventDefault(); pickHistory(w) }}
                className={`flex-1 text-left text-[11px] font-mono truncate ${itemText}`}
                title={w}
              >
                {w}
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); onRemoveHistory(w) }}
                className={`${metaCls} hover:text-[#fc8181] transition-colors shrink-0`}
                title={t('whereHistoryRemove', language)}
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
