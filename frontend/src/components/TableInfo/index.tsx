/**
 * 16 — HeidiSQL 스타일 테이블 디자이너 (Info 탭 확장).
 *
 * 레이아웃:
 *  ┌──────────────────────────────────────────────────────────┐
 *  │ [기본] [옵션] [인덱스] [외래키] [제약] [분할] [CREATE]   │ ← 상단 탭
 *  ├──────────────────────────────────────────────────────────┤
 *  │  (상단 탭 콘텐츠)                                        │
 *  ├══════════════════════════════════════════════════════════┤ ← 리사이즈 핸들
 *  │  [행 추가] [제거] [↑] [↓]                                │
 *  │  (컬럼 편집 그리드)                                      │
 *  ├──────────────────────────────────────────────────────────┤
 *  │  [도움말]                    [되돌리기] [저장]           │
 *  └──────────────────────────────────────────────────────────┘
 */

import { useEffect, useState, useCallback } from 'react'
import { Group, Panel, Separator, type PanelSize } from 'react-resizable-panels'
import { Save, Undo2, HelpCircle, RefreshCw, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

import { useTableDesignerStore } from '@/stores/useTableDesignerStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

import ColumnGrid from './ColumnGrid'
import AlterPreviewModal from './AlterPreviewModal'
import BasicTab from './tabs/BasicTab'
import OptionsTab from './tabs/OptionsTab'
import IndexesTab from './tabs/IndexesTab'
import ForeignKeysTab from './tabs/ForeignKeysTab'
import ChecksTab from './tabs/ChecksTab'
import PartitionsTab from './tabs/PartitionsTab'
import CreateSqlTab from './tabs/CreateSqlTab'
import type { AlterStatement } from '@/types'

type TopTab = 'basic' | 'options' | 'indexes' | 'fks' | 'checks' | 'partitions' | 'create'

const TAB_LABELS: Record<TopTab, string> = {
  basic: '기본',
  options: '옵션',
  indexes: '인덱스',
  fks: '외래 키',
  checks: '제약 조건',
  partitions: '분할',
  create: 'CREATE 코드',
}

interface Props {
  connId: string
  connName: string
  database: string
  table: string
  /** 활성 QueryEditor 탭에 SQL 삽입 */
  onInsertSQL: (sql: string) => void
}

export default function TableInfo({ connId, connName, database, table, onInsertSQL }: Props) {
  const loading = useTableDesignerStore((s) => s.loading)
  const applying = useTableDesignerStore((s) => s.applying)
  const editedMeta = useTableDesignerStore((s) => s.editedMeta)
  const mode = useTableDesignerStore((s) => s.mode)
  const storeDatabase = useTableDesignerStore((s) => s.database)
  const dirty = useTableDesignerStore((s) => s.isDirty())
  const isDirty = useTableDesignerStore((s) => s.isDirty)
  const loadTable = useTableDesignerStore((s) => s.loadTable)
  const reload = useTableDesignerStore((s) => s.reload)
  const revert = useTableDesignerStore((s) => s.revert)
  const reset = useTableDesignerStore((s) => s.reset)
  const buildAlter = useTableDesignerStore((s) => s.buildAlter)
  const save = useTableDesignerStore((s) => s.save)

  const topPanelSize = useSettingsStore((s) => s.settings.tableDesigner.topPanelSize)
  const updateGridSettings = useSettingsStore((s) => s.updateTableDesigner)

  const isCreate = mode === 'create'
  /** 표시용 DB 명: 신규 모드는 store(initNewTable 시 세팅), 편집 모드는 props (selectedTable.db) */
  const displayDatabase = isCreate ? (storeDatabase ?? '') : database

  const [activeTab, setActiveTab] = useState<TopTab>('basic')
  const [previewStmt, setPreviewStmt] = useState<AlterStatement | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  // 편집 모드: 테이블 props 변경 시 재로드. 신규 모드는 외부에서 initNewTable 로 store 가 이미 세팅됨.
  useEffect(() => {
    if (table && connId && database) {
      void loadTable(connId, database, table)
    }
  }, [connId, database, table, loadTable])

  useEffect(() => () => reset(), [reset])

  const handleSaveClick = useCallback(async () => {
    if (!isDirty()) {
      toast('변경 사항이 없습니다')
      return
    }
    const stmt = await buildAlter()
    if (!stmt || !stmt.sql) {
      toast('변경 사항이 없습니다')
      return
    }
    setPreviewStmt(stmt)
  }, [buildAlter, isDirty])

  const handleConfirm = useCallback(async () => {
    await save(connName)
    setPreviewStmt(null)
  }, [save, connName])

  const handleRevert = useCallback(() => {
    if (!isDirty()) return
    revert()
    toast('편집이 되돌려졌습니다')
  }, [revert, isDirty])

  const handlePanelResize = useCallback(
    (panelSize: PanelSize) => {
      updateGridSettings({ topPanelSize: Math.round(panelSize.asPercentage) })
    },
    [updateGridSettings],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-[var(--color-text-muted)]">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-xs">테이블 메타 로드 중...</span>
      </div>
    )
  }

  if (!editedMeta) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-xs">
        테이블 메타를 로드할 수 없습니다.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--color-bg-primary)]">
      {/* 상단 헤더 */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
        <span className="text-[11px] font-semibold text-[var(--color-text-primary)]">
          {displayDatabase}.{isCreate ? (editedMeta.name.trim() || '<신규 테이블>') : editedMeta.name}
        </span>
        {dirty && <span className="text-[var(--color-warning)] text-[10px]">●</span>}
        <span className="text-[9px] text-[var(--color-null)] ml-1">
          {isCreate ? 'New Table' : 'Table Designer'}
        </span>
        {!isCreate && (
          <button
            onClick={() => void reload()}
            className="ml-auto p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
            title="새로고침"
          >
            <RefreshCw size={11} />
          </button>
        )}
      </div>

      <Group orientation="vertical">
        {/* 상단 패널 */}
        <Panel
          id="designer-top"
          defaultSize={`${topPanelSize}%`}
          minSize="20%"
          maxSize="80%"
          onResize={handlePanelResize}
        >
          <div className="flex flex-col h-full overflow-hidden">
            {/* 상단 탭 바 */}
            <div className="flex border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0 overflow-x-auto">
              {(Object.keys(TAB_LABELS) as TopTab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={`px-3 py-1 text-[10px] whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === t
                      ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                      : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {TAB_LABELS[t]}
                </button>
              ))}
            </div>

            {/* 상단 탭 콘텐츠 */}
            <div className="flex-1 overflow-auto">
              {activeTab === 'basic' && <BasicTab />}
              {activeTab === 'options' && <OptionsTab />}
              {activeTab === 'indexes' && <IndexesTab />}
              {activeTab === 'fks' && <ForeignKeysTab />}
              {activeTab === 'checks' && <ChecksTab />}
              {activeTab === 'partitions' && <PartitionsTab />}
              {activeTab === 'create' && <CreateSqlTab />}
            </div>
          </div>
        </Panel>

        <Separator className="osql-separator-vertical" />

        {/* 하단 패널 — 컬럼 그리드 + 푸터 */}
        <Panel id="designer-bottom" minSize="20%">
          <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <ColumnGrid
                database={displayDatabase}
                table={isCreate ? '' : table}
                onInsertSQL={onInsertSQL}
              />
            </div>

            {/* 푸터 — 도움말 / 되돌리기 / 저장 */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
              <button
                onClick={() => setShowHelp(true)}
                className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <HelpCircle size={11} /> 도움말
              </button>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={handleRevert}
                  disabled={!dirty || applying}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-40"
                >
                  <Undo2 size={11} /> 되돌리기
                </button>
                <button
                  onClick={() => void handleSaveClick()}
                  disabled={!dirty || applying}
                  className="flex items-center gap-1 px-3 py-1 text-[10px] rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors disabled:opacity-50"
                >
                  <Save size={11} /> {applying ? (isCreate ? '생성 중...' : '저장 중...') : (isCreate ? '생성' : '저장')}
                </button>
              </div>
            </div>
          </div>
        </Panel>
      </Group>

      {/* 미리보기 모달 */}
      {previewStmt && (
        <AlterPreviewModal
          stmt={previewStmt}
          applying={applying}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setPreviewStmt(null)}
        />
      )}

      {/* 도움말 모달 */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] max-w-[90vw] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4"
      >
        <div className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">테이블 디자이너 도움말</div>
        <div className="text-[11px] text-[var(--color-text-subtle)] space-y-2">
          <div>
            <strong className="text-[var(--color-text-primary)]">헤더 동작</strong>
            <ul className="list-disc ml-5 mt-1 space-y-0.5">
              <li>클릭: 해당 열로 정렬 (asc → desc → none)</li>
              <li>우클릭: 열 표시/숨김 토글, 모든 열 보이기</li>
            </ul>
          </div>
          <div>
            <strong className="text-[var(--color-text-primary)]">행 동작</strong>
            <ul className="list-disc ml-5 mt-1 space-y-0.5">
              <li>클릭: 단일 선택</li>
              <li>Shift/Ctrl 클릭: 다중 선택 / 토글</li>
              <li>우클릭: 복사, 이동, 인덱스 추가, ALTER ADD COLUMN 생성</li>
            </ul>
          </div>
          <div>
            <strong className="text-[var(--color-text-primary)]">아이콘 범례</strong>
            <ul className="list-disc ml-5 mt-1 space-y-0.5">
              <li><span className="text-[var(--color-pk)]">🔑</span> PK = Primary Key</li>
              <li><span className="text-[var(--color-success)]">AI</span> = Auto Increment</li>
              <li><span className="text-[var(--color-accent)]">U</span> = Unique</li>
            </ul>
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

