import { useState } from 'react'
import { Table2, GitBranch } from 'lucide-react'
import ExplainTreeView from '@/components/ExplainTree'
import type { ExplainRow } from '@/types'
import InlineEmptyState from './InlineEmptyState'

type ProfileView = 'table' | 'tree'

export default function InlineProfileTab({
  explainRows, explainJSON, isDark,
}: {
  explainRows?: ExplainRow[]
  explainJSON?: string
  isDark: boolean
}) {
  const [view, setView] = useState<ProfileView>('table')

  if (!explainRows || explainRows.length === 0) {
    return <InlineEmptyState message="EXPLAIN 데이터 로드 중... (SELECT 쿼리 실행 후 자동 분석)" />
  }

  const typeColor: Record<string, string> = {
    ALL:    'text-[#fc8181] font-bold',
    index:  'text-[#f6ad55]',
    range:  'text-[#68d391]',
    ref:    'text-[#68d391]',
    eq_ref: 'text-[#68d391]',
    const:  'text-[#4299e1]',
    system: 'text-[#4299e1]',
  }

  const barCls     = isDark ? 'border-[#2d3748] bg-[#0f1117]' : 'border-[#e2e8f0] bg-[#f8fafc]'
  const btnActCls  = isDark ? 'bg-[#252b3b] text-[#e2e8f0]' : 'bg-[#dbeafe] text-[#1e40af]'
  const btnIdleCls = isDark ? 'text-[#718096] hover:text-[#a0aec0] hover:bg-[#1e2230]' : 'text-[#64748b] hover:text-[#1e293b] hover:bg-[#e2e8f0]'
  const theadCls   = isDark ? 'bg-[#161b27]' : 'bg-[#f1f5f9]'
  const thCls      = isDark ? 'text-[#718096] border-[#2d3748]' : 'text-[#64748b] border-[#e2e8f0]'
  const trCls      = isDark ? 'hover:bg-[#1e2230] border-[#161b27]' : 'hover:bg-[#f0f9ff] border-[#f1f5f9]'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className={`flex items-center gap-1 px-2 py-1 border-b shrink-0 ${barCls}`}>
        <button
          onClick={() => setView('table')}
          className={`flex items-center gap-1 px-2.5 py-1 text-[10px] rounded transition-colors ${view === 'table' ? btnActCls : btnIdleCls}`}
        >
          <Table2 size={10} /> 표 형식
        </button>
        <button
          onClick={() => setView('tree')}
          disabled={!explainJSON}
          title={!explainJSON ? 'EXPLAIN FORMAT=JSON 로드 중...' : '실행 계획 트리 보기'}
          className={`flex items-center gap-1 px-2.5 py-1 text-[10px] rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed
            ${view === 'tree' ? btnActCls : btnIdleCls}`}
        >
          <GitBranch size={10} /> 트리 보기
          {!explainJSON && <span className="ml-1 text-[8px] text-[#4a5568]">로드 중</span>}
        </button>
      </div>

      {view === 'table' && (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-[11px] border-collapse">
            <thead className={`sticky top-0 ${theadCls}`}>
              <tr>
                {['id','select_type','table','type','possible_keys','key','key_len','ref','rows','filtered','Extra'].map((col) => (
                  <th key={col} className={`px-3 py-2 text-left border-b whitespace-nowrap font-medium ${thCls}`}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {explainRows.map((row, i) => (
                <tr key={i} className={`border-b ${trCls}`}>
                  <td className="px-3 py-1.5 text-[#718096]">{row.id}</td>
                  <td className="px-3 py-1.5 text-[#a0aec0]">{row.selectType}</td>
                  <td className="px-3 py-1.5 text-[#4299e1] font-medium">{row.table}</td>
                  <td className={`px-3 py-1.5 ${typeColor[row.type] ?? 'text-[#e2e8f0]'}`}>{row.type}</td>
                  <td className="px-3 py-1.5 text-[#718096] max-w-[120px] truncate">{row.possibleKeys ?? 'NULL'}</td>
                  <td className="px-3 py-1.5 text-[#68d391]">{row.key ?? 'NULL'}</td>
                  <td className="px-3 py-1.5 text-[#718096]">{row.keyLen ?? 'NULL'}</td>
                  <td className="px-3 py-1.5 text-[#718096]">{row.ref ?? 'NULL'}</td>
                  <td className="px-3 py-1.5 text-[#f6ad55] font-medium">{row.rows?.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-[#a0aec0]">{row.filtered}</td>
                  <td className="px-3 py-1.5 text-[#718096] max-w-[200px] truncate" title={row.extra ?? ''}>{row.extra}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'tree' && explainJSON && (
        <div className="flex-1 overflow-hidden">
          <ExplainTreeView jsonStr={explainJSON} />
        </div>
      )}

      {view === 'tree' && !explainJSON && (
        <InlineEmptyState message="EXPLAIN FORMAT=JSON 로드 중... (MySQL 5.6+ 에서 지원)" />
      )}
    </div>
  )
}
