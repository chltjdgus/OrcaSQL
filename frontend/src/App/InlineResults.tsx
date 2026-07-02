import { useCallback, useEffect, useRef, useState } from 'react'
import { Table2, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { useConnectionStore } from '@/stores/connectionStore'
import { useThemeStore } from '@/stores/useThemeStore'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import ResultGrid from '@/components/ResultGrid'
import type { QueryResult, TableEditContext, ExplainRow } from '@/types'
import InlineEmptyState from './InlineEmptyState'
import InlineProfileTab from './InlineProfileTab'

export default function InlineResults({
  result, results, isRunning, editCtx, connId, explainData,
}: {
  result: QueryResult | null
  results: QueryResult[]
  isRunning: boolean
  editCtx?: TableEditContext
  connId?: string
  explainData?: Array<{ rows: ExplainRow[]; json?: string } | null>
}) {
  const { activeTabId, updateTab } = useConnectionStore()
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const language = useLanguageStore((s) => s.language)
  const [activeResultIdx, setActiveResultIdx] = useState(0)
  const [activeSubTab, setActiveSubTab] = useState<'data' | 'profile'>('data')
  // Ctrl+R 단축키로 결과 영역에 포커스 이동
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = () => containerRef.current?.focus()
    window.addEventListener('focus:result', h)
    return () => window.removeEventListener('focus:result', h)
  }, [])

  // 새 쿼리 실행 시 첫 번째 결과로 리셋
  useEffect(() => { setActiveResultIdx(0) }, [results])

  // 결과 인덱스 변경 시 서브탭 리셋
  useEffect(() => { setActiveSubTab('data') }, [activeResultIdx])

  const handleInsertSQL = useCallback((sql: string) => {
    if (!activeTabId) return
    updateTab(activeTabId, { sql })
    toast.success(t('toastSqlInserted', language))
  }, [activeTabId, updateTab, language])

  // DDL/DML(columns=0) 결과는 결과 영역에서 미노출 — Messages 영역에 동일 정보 노출됨.
  // origIdx 는 explainData 인덱스 매핑(useQueryExec 의 data 전체 길이 기준)을 위해 보존.
  const rawResults = results.length > 0 ? results : (result ? [result] : [])
  const allResults = rawResults
    .map((r, origIdx) => ({ result: r, origIdx }))
    .filter(({ result: r }) => (r.columns?.length ?? 0) > 0)
  const currentEntry = allResults[activeResultIdx] ?? allResults[0] ?? null
  const currentResult = currentEntry?.result ?? null
  const displayCount = allResults.length

  return (
    <div ref={containerRef} tabIndex={-1} className="osql-inline-results flex flex-col h-full overflow-hidden outline-none">
      {/* 다중 결과 서브탭 (SELECT 가 2개 이상일 때만) */}
      {displayCount > 1 && (
        <div className={`flex items-center gap-0.5 px-2 py-1 border-b shrink-0 overflow-x-auto ${isDark ? 'bg-[#0f1117] border-[#2d3748]' : 'bg-[#f8fafc] border-[#e2e8f0]'}`}>
          {allResults.map(({ result: r }, i) => (
            <button
              key={i}
              onClick={() => setActiveResultIdx(i)}
              className={`flex items-center gap-1 px-2.5 py-0.5 text-[10px] rounded transition-colors whitespace-nowrap
                ${activeResultIdx === i
                  ? (isDark ? 'bg-[#252b3b] text-[#e2e8f0]' : 'bg-[#dbeafe] text-[#1e40af]')
                  : (isDark ? 'text-[#718096] hover:text-[#a0aec0] hover:bg-[#1e2230]' : 'text-[#64748b] hover:text-[#1e293b] hover:bg-[#e2e8f0]')}`}
            >
              <Table2 size={9} />
              {`Result ${i + 1}`}
              <span className="text-[8px] text-[#4299e1] ml-0.5">{(r.rows?.length ?? 0).toLocaleString()}행</span>
            </button>
          ))}
        </div>
      )}

      {/* [Data][Profile] 서브탭 스트립 — SELECT 결과이고 실행 중이 아닐 때만 표시 */}
      {!isRunning && currentResult && (
        <div className={`flex items-center gap-0.5 px-2 py-0.5 border-b shrink-0 ${isDark ? 'bg-[#0f1117] border-[#2d3748]' : 'bg-[#f8fafc] border-[#e2e8f0]'}`}>
          <button
            onClick={() => setActiveSubTab('data')}
            className={`flex items-center gap-1 px-2.5 py-0.5 text-[10px] rounded transition-colors
              ${activeSubTab === 'data'
                ? (isDark ? 'bg-[#252b3b] text-[#e2e8f0]' : 'bg-[#dbeafe] text-[#1e40af]')
                : (isDark ? 'text-[#718096] hover:text-[#a0aec0] hover:bg-[#1e2230]' : 'text-[#64748b] hover:text-[#1e293b] hover:bg-[#e2e8f0]')}`}
          >
            <Table2 size={9} /> Data
          </button>
          <button
            onClick={() => setActiveSubTab('profile')}
            className={`flex items-center gap-1 px-2.5 py-0.5 text-[10px] rounded transition-colors
              ${activeSubTab === 'profile'
                ? (isDark ? 'bg-[#252b3b] text-[#e2e8f0]' : 'bg-[#dbeafe] text-[#1e40af]')
                : (isDark ? 'text-[#718096] hover:text-[#a0aec0] hover:bg-[#1e2230]' : 'text-[#64748b] hover:text-[#1e293b] hover:bg-[#e2e8f0]')}`}
          >
            <Zap size={9} /> Profile
          </button>
        </div>
      )}

      {/* 결과 표시 영역 — DDL/DML 은 allResults 에서 필터링되어 currentResult 가 null. Messages 영역에 동일 정보. */}
      <div className="flex-1 overflow-hidden">
        {isRunning ? (
          <InlineEmptyState icon={<span className="animate-spin text-2xl">⟳</span>} message={t('msgQueryRunning', language)} />
        ) : currentResult ? (
          activeSubTab === 'data' ? (
            <ResultGrid
              result={currentResult}
              editCtx={currentResult.editCtx ?? editCtx}
              connId={connId}
              onInsertSQL={handleInsertSQL}
            />
          ) : (
            <InlineProfileTab
              explainRows={explainData?.[currentEntry?.origIdx ?? 0]?.rows}
              explainJSON={explainData?.[currentEntry?.origIdx ?? 0]?.json}
              isDark={isDark}
            />
          )
        ) : (
          <InlineEmptyState message={t('msgNoResult', language)} />
        )}
      </div>
    </div>
  )
}
