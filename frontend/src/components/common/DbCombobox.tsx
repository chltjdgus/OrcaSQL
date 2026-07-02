import { useState, useRef, useEffect, useCallback } from 'react'
import { Database, X } from 'lucide-react'

/**
 * DB 멀티태그 콤보박스 — ConnectionModal·SessionManager 공용
 *
 * - 선택된 DB 들을 X 버튼이 달린 태그(chip) 로 표시
 * - 첫 태그 = 기본 접속 DB (강조 색상). 호출 측에서 onChange 결과의 [0] 을
 *   `database` 단일 필드에 동기시켜 백엔드와 호환을 맞춘다.
 * - 검색창에 타이핑 후 Enter → 직접 추가 (목록에 없어도 가능)
 * - 드롭다운 목록에서 클릭 → 토글 (이미 있으면 제거, 없으면 추가)
 * - 태그 X 버튼 클릭 → 제거
 * - 입력값이 빈 상태에서 Backspace → 마지막 태그 제거
 */
export default function DbCombobox({
  selected,
  availableDbs,
  tested,
  onChange,
}: {
  selected: string[]
  availableDbs: string[]
  tested: boolean
  onChange: (dbs: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedSet = new Set(selected)
  const filtered = availableDbs.filter((db) =>
    db.toLowerCase().includes(inputVal.toLowerCase())
  )

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setInputVal('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const addDb = useCallback((db: string) => {
    const trimmed = db.trim()
    if (!trimmed || selectedSet.has(trimmed)) return
    onChange([...selected, trimmed])
  }, [selected, selectedSet, onChange])

  const removeDb = useCallback((db: string) => {
    onChange(selected.filter((d) => d !== db))
  }, [selected, onChange])

  const toggleDb = useCallback((db: string) => {
    if (selectedSet.has(db)) {
      removeDb(db)
    } else {
      addDb(db)
    }
  }, [selectedSet, addDb, removeDb])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (inputVal.trim()) {
        addDb(inputVal)
        setInputVal('')
      } else if (filtered.length === 1 && !selectedSet.has(filtered[0])) {
        addDb(filtered[0])
        setInputVal('')
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setInputVal('')
    } else if (e.key === 'Backspace' && inputVal === '' && selected.length > 0) {
      removeDb(selected[selected.length - 1])
    }
  }, [inputVal, filtered, selectedSet, selected, addDb, removeDb])

  const placeholder = selected.length === 0
    ? (tested || availableDbs.length > 0
        ? '직접 입력 또는 목록에서 선택...'
        : '연결 테스트 후 목록 사용 가능 (직접 입력도 가능)')
    : ''

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={[
          'min-h-[32px] w-full rounded border px-2 py-1 flex flex-wrap gap-1 items-center cursor-text',
          'bg-[var(--color-bg-primary)] transition-colors',
          open ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)] hover:border-[var(--color-null)]',
        ].join(' ')}
        onClick={() => {
          setOpen(true)
          setTimeout(() => inputRef.current?.focus(), 0)
        }}
      >
        {selected.map((db, i) => (
          <span
            key={db}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono
              ${i === 0
                ? 'bg-[var(--color-bg-selected)] text-[var(--color-accent-light)] border border-[var(--color-accent)]/40'
                : 'bg-[var(--color-border)] text-[var(--color-text-subtle)] border border-[var(--color-bg-hover)]'}`}
            title={i === 0 ? '기본 접속 DB' : '추가 DB'}
          >
            <Database size={9} className="shrink-0" />
            {db}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeDb(db) }}
              className="hover:text-[var(--color-error)] transition-colors ml-0.5 leading-none"
            >
              <X size={9} />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={(e) => { setInputVal(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 min-w-[120px] bg-transparent text-[11px] text-[var(--color-text-primary)] placeholder-[var(--color-null)] outline-none py-0.5"
        />
      </div>

      {open && (
        <div className="absolute left-0 top-full mt-0.5 z-50 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-xl">
          {availableDbs.length === 0 ? (
            <div className="px-3 py-2 text-[10px] text-[var(--color-null)]">
              {tested
                ? '목록 가져오는 중... (이름을 직접 입력 후 Enter)'
                : '연결 테스트 성공 시 목록 자동 표시. 직접 입력 후 Enter로 추가 가능.'}
            </div>
          ) : (
            <>
              {inputVal.trim() && !availableDbs.includes(inputVal.trim()) && (
                <button
                  type="button"
                  onClick={() => { addDb(inputVal); setInputVal('') }}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--color-success)] hover:bg-[var(--color-bg-hover)] flex items-center gap-1.5 border-b border-[var(--color-border)]"
                >
                  <span className="text-[10px] bg-[var(--color-success)]/15 px-1 rounded">추가</span>
                  {inputVal.trim()}
                </button>
              )}
              <div className="max-h-44 overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-[var(--color-null)]">검색 결과 없음</div>
                ) : (
                  filtered.map((db) => {
                    const isSelected = selectedSet.has(db)
                    return (
                      <button
                        key={db}
                        type="button"
                        onClick={() => toggleDb(db)}
                        className={[
                          'w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors',
                          isSelected ? 'bg-[var(--color-bg-selected)]/60 text-[var(--color-accent-light)]' : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]',
                        ].join(' ')}
                      >
                        <span className={`w-3 h-3 rounded border flex items-center justify-center shrink-0
                          ${isSelected ? 'bg-[var(--color-accent)] border-[var(--color-accent)]' : 'border-[var(--color-null)]'}`}>
                          {isSelected && <span className="text-white text-[8px] leading-none">✓</span>}
                        </span>
                        <Database size={10} className={`shrink-0 ${isSelected ? 'text-[var(--color-accent-light)]' : 'text-[var(--color-warning)]'}`} />
                        <span className="truncate">{db}</span>
                      </button>
                    )
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
