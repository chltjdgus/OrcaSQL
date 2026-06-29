/**
 * Query Favorites (즐겨찾기/스니펫) 패널.
 * - 즐겨찾기 목록 표시 (사용 횟수 내림차순)
 * - 새 즐겨찾기 추가 / 수정 / 삭제
 * - 항목 클릭 → 에디터에 SQL 삽입
 * - 카테고리 / 태그 필터
 */
import { useState, useCallback, useDeferredValue, useOptimistic } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Star, Plus, Pencil, Trash2, X, Check, Search, Tag, ChevronDown, ChevronRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import type { Snippet } from '@/types'
import {
  ListFavorites,
  AddFavorite,
  UpdateFavorite,
  DeleteFavorite,
  UseFavorite,
} from '@/wailsjs/go/main/App'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t, type Language } from '@/i18n'
import { nativeConfirm } from '@/utils/nativeConfirm'

// ─── 폼 초기값 ────────────────────────────────────────────────────────────────
const emptySnippet = (): Omit<Snippet, 'id' | 'createdAt' | 'updatedAt' | 'useCount'> => ({
  title: '',
  sql: '',
  category: '',
  tags: [],
})

interface Props {
  onClose: () => void
  /** 편집기에 SQL을 삽입하는 콜백 */
  onInsertSQL?: (sql: string) => void
  /** 편집기에서 현재 선택된 텍스트를 반환하는 콜백 */
  getSelectedSQL?: () => string
}

export default function Favorites({ onClose, onInsertSQL, getSelectedSQL }: Props) {
  const qc = useQueryClient()
  const { language } = useLanguageStore()
  const [search, setSearch] = useState('')
  // React 19: 검색 필터 계산 지연
  const deferredSearch = useDeferredValue(search)
  const [filterCategory, setFilterCategory] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<Snippet | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [addInitialSQL, setAddInitialSQL] = useState('')

  // ─── 데이터 로드 ──────────────────────────────────────────────────────
  const { data: snippets = [] } = useQuery<Snippet[]>({
    queryKey: ['favorites'],
    queryFn: () => ListFavorites(),
  })

  // React 19: useOptimistic — 삭제/추가 즉각 반영 후 실패 시 롤백
  type OptAction =
    | { type: 'delete'; id: string }
    | { type: 'add'; item: Snippet }
    | { type: 'update'; item: Snippet }

  const [optimisticSnippets, dispatchOptimistic] = useOptimistic(
    snippets,
    (state: Snippet[], action: OptAction): Snippet[] => {
      switch (action.type) {
        case 'delete': return state.filter((s) => s.id !== action.id)
        case 'add':    return [action.item, ...state]
        case 'update': return state.map((s) => s.id === action.item.id ? action.item : s)
      }
    },
  )

  // ─── 뮤테이션 ─────────────────────────────────────────────────────────
  const addMut = useMutation({
    mutationFn: (s: Snippet) => AddFavorite(s),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['favorites'] }); setIsAdding(false) },
    onError: () => toast.error(t('favAddFail', language)),
  })
  const updateMut = useMutation({
    mutationFn: (s: Snippet) => UpdateFavorite(s),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['favorites'] }); setEditTarget(null) },
    onError: () => toast.error(t('favUpdateFail', language)),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => DeleteFavorite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
    onError: () => toast.error(t('favDeleteFail', language)),
  })
  const useMut = useMutation({
    mutationFn: (id: string) => UseFavorite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
  })

  // ─── 필터 — optimisticSnippets 기준으로 렌더링 ────────────────────────
  const isSearchStale = search !== deferredSearch
  const categories = [...new Set(optimisticSnippets.map((s) => s.category).filter(Boolean))]
  const filtered = optimisticSnippets.filter((s) => {
    const q = deferredSearch.toLowerCase()
    const matchQ = !q || s.title.toLowerCase().includes(q) || s.sql.toLowerCase().includes(q) || s.tags.some((tag) => tag.toLowerCase().includes(q))
    const matchCat = !filterCategory || s.category === filterCategory
    return matchQ && matchCat
  })

  // ─── 핸들러 ───────────────────────────────────────────────────────────
  const handleUse = useCallback((snippet: Snippet) => {
    useMut.mutate(snippet.id)
    onInsertSQL?.(snippet.sql)
    toast.success(`"${snippet.title}" ${t('favInsertedSuffix', language)}`)
  }, [onInsertSQL, useMut, language])

  const handleDelete = useCallback((id: string, title: string) => {
    const msg = language === 'ko'
      ? `"${title}" 을(를) 삭제하시겠습니까?`
      : `Delete "${title}"?`
    void nativeConfirm({
      title: t('favDeleteTitle', language),
      message: msg,
      language,
    }).then((ok) => {
      if (!ok) return
      // React 19: 즉시 낙관적 삭제 → 실제 뮤테이션 실행
      dispatchOptimistic({ type: 'delete', id })
      deleteMut.mutate(id)
    })
  }, [deleteMut, dispatchOptimistic, language])

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <Star size={13} className="text-[#f6e05e]" />
          <span className="text-xs font-medium text-[var(--color-text-subtle)]">{t('favTitle', language)}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setAddInitialSQL(getSelectedSQL?.() ?? ''); setIsAdding(true) }}
            className="p-1 rounded hover:bg-[var(--color-border)] text-[#68d391] transition-colors"
            title={t('favAddNew', language)}
          >
            <Plus size={13} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* 검색 */}
      <div className="px-3 py-2 border-b border-[var(--color-border)] shrink-0">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('favSearchPh', language)}
            className={`w-full pl-6 pr-3 py-1 text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] placeholder-[var(--color-null)] focus:outline-none focus:border-[var(--color-accent)] transition-opacity ${isSearchStale ? 'opacity-60' : ''}`}
          />
        </div>
      </div>

      {/* 카테고리 필터 */}
      {categories.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--color-border)] shrink-0 overflow-x-auto">
          <button
            onClick={() => setFilterCategory(null)}
            className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors ${!filterCategory ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-white'}`}
          >
            {t('favAll', language)}
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
              className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors ${filterCategory === cat ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-white'}`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* 추가 폼 */}
      {isAdding && (
        <SnippetForm
          initial={{ ...emptySnippet(), sql: addInitialSQL } as Snippet}
          onSave={(s) => { dispatchOptimistic({ type: 'add', item: s }); addMut.mutate(s) }}
          onCancel={() => setIsAdding(false)}
          language={language}
        />
      )}

      {/* 목록 */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-[var(--color-null)]">
            <Star size={20} />
            <p className="mt-2 text-xs">{t('favEmpty', language)}</p>
          </div>
        ) : (
          filtered.map((s) => (
            <SnippetRow
              key={s.id}
              snippet={s}
              expanded={expandedId === s.id}
              editing={editTarget?.id === s.id}
              onToggleExpand={() => setExpandedId(expandedId === s.id ? null : s.id)}
              onUse={() => handleUse(s)}
              onEdit={() => setEditTarget(s)}
              onDelete={() => handleDelete(s.id, s.title)}
              onSaveEdit={(updated) => { dispatchOptimistic({ type: 'update', item: updated }); updateMut.mutate(updated) }}
              onCancelEdit={() => setEditTarget(null)}
              language={language}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── SnippetRow ───────────────────────────────────────────────────────────────

interface SnippetRowProps {
  snippet: Snippet
  expanded: boolean
  editing: boolean
  language: Language
  onToggleExpand: () => void
  onUse: () => void
  onEdit: () => void
  onDelete: () => void
  onSaveEdit: (s: Snippet) => void
  onCancelEdit: () => void
}

function SnippetRow({
  snippet, expanded, editing, language, onToggleExpand, onUse, onEdit, onDelete, onSaveEdit, onCancelEdit,
}: SnippetRowProps) {
  if (editing) {
    return (
      <SnippetForm
        initial={snippet}
        onSave={onSaveEdit}
        onCancel={onCancelEdit}
        language={language}
      />
    )
  }

  return (
    <div className="border-b border-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-secondary)] transition-colors">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none group"
        onClick={onToggleExpand}
      >
        {expanded ? (
          <ChevronDown size={11} className="text-[var(--color-text-muted)] shrink-0" />
        ) : (
          <ChevronRight size={11} className="text-[var(--color-text-muted)] shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--color-text-primary)] truncate font-medium">{snippet.title}</span>
            {snippet.category && (
              <span className="text-[10px] px-1.5 py-0 rounded bg-[var(--color-border)] text-[var(--color-text-subtle)] shrink-0">
                {snippet.category}
              </span>
            )}
          </div>
          {snippet.tags.length > 0 && (
            <div className="flex items-center gap-1 mt-0.5">
              <Tag size={9} className="text-[var(--color-text-muted)]" />
              <span className="text-[10px] text-[var(--color-text-muted)] truncate">{snippet.tags.join(', ')}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onUse() }}
            className="px-2 py-0.5 text-[10px] rounded bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/40 transition-colors"
          >
            {t('favInsert', language)}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-subtle)]"
          >
            <Pencil size={10} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-error)]"
          >
            <Trash2 size={10} />
          </button>
        </div>
        {snippet.useCount > 0 && (
          <span className="text-[10px] text-[var(--color-null)] shrink-0 ml-1">{snippet.useCount}{t('favUseCountSuffix', language)}</span>
        )}
      </div>

      {expanded && (
        <div className="px-3 pb-2">
          <pre className="text-[10px] font-mono text-[var(--color-text-subtle)] bg-[var(--color-bg-deep)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all border border-[var(--color-border)]">
            {snippet.sql}
          </pre>
        </div>
      )}
    </div>
  )
}

// ─── SnippetForm ──────────────────────────────────────────────────────────────

interface SnippetFormProps {
  initial: Snippet
  language: Language
  onSave: (s: Snippet) => void
  onCancel: () => void
}

function SnippetForm({ initial, language, onSave, onCancel }: SnippetFormProps) {
  const [form, setForm] = useState<Snippet>({ ...initial })
  const [tagInput, setTagInput] = useState(initial.tags?.join(', ') ?? '')

  const handleSave = () => {
    if (!form.title.trim()) { toast.error(t('favFormTitleRequired', language)); return }
    if (!form.sql.trim()) { toast.error(t('favFormSQLRequired', language)); return }
    const tags = tagInput.split(',').map((tg) => tg.trim()).filter(Boolean)
    onSave({ ...form, tags })
  }

  const field = (key: keyof Snippet) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }))

  return (
    <div className="border-b border-[var(--color-accent)]/30 bg-[var(--color-bg-secondary)] p-3 space-y-2">
      <input
        type="text"
        value={form.title}
        onChange={field('title')}
        placeholder={t('favFormTitlePh', language)}
        className="w-full px-2 py-1 text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] placeholder-[var(--color-null)] focus:outline-none focus:border-[var(--color-accent)]"
      />
      <textarea
        value={form.sql}
        onChange={field('sql')}
        placeholder="SQL *"
        rows={4}
        className="w-full px-2 py-1 text-xs font-mono bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] placeholder-[var(--color-null)] focus:outline-none focus:border-[var(--color-accent)] resize-y"
      />
      <div className="flex gap-2">
        <input
          type="text"
          value={form.category}
          onChange={field('category')}
          placeholder={t('favFormCategoryPh', language)}
          className="flex-1 px-2 py-1 text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] placeholder-[var(--color-null)] focus:outline-none focus:border-[var(--color-accent)]"
        />
        <input
          type="text"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          placeholder={t('favFormTagsPh', language)}
          className="flex-1 px-2 py-1 text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] placeholder-[var(--color-null)] focus:outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-white transition-colors"
        >
          <X size={10} /> {t('favFormCancel', language)}
        </button>
        <button
          onClick={handleSave}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          <Check size={10} /> {t('favFormSave', language)}
        </button>
      </div>
    </div>
  )
}
