/**
 * Phase 16 — HeidiSQL 스타일 테이블 디자이너 편집 상태 스토어.
 *
 * 구조:
 *  - originalMeta: 서버에서 마지막으로 로드한 TableMeta (diff 기준)
 *  - editedMeta:   사용자 편집 중인 TableMeta
 *  - selectedRowIds: 하단 그리드에서 선택된 행 id 집합 (multi-select)
 *
 * 특징:
 *  - 컬럼은 UI 행 식별을 위한 휘발성 `id` 를 붙여 관리한다 (rowId).
 *  - originalName 필드를 통해 rename / 신규 / 순서 변경을 구분한다.
 *  - persist 하지 않음 — 디자이너를 닫으면 초기화.
 */

import { create } from 'zustand'
import toast from 'react-hot-toast'
import { GetTableMeta, BuildTableAlter, GenerateCreateSQL } from '@/wailsjs/go/main/App'
import { runLoggedQuery } from '@/utils/queryLog'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'
import type { TableMeta, ColumnDef, IndexDef, ForeignKeyDef, CheckConstraintDef, AlterStatement, TableDefinition } from '@/types'

/** UI 전용 wrapper — 각 컬럼 행에 rowId 를 붙인다. */
export interface ColumnRow extends ColumnDef {
  rowId: string
}

interface TableDesignerState {
  // 로드 상태
  connId: string | null
  database: string | null
  table: string | null
  /** 'edit' = 기존 테이블 ALTER, 'create' = 신규 테이블 CREATE */
  mode: 'edit' | 'create'
  loading: boolean
  applying: boolean

  // diff 기준
  originalMeta: TableMeta | null
  originalRows: ColumnRow[]

  // 편집 중
  editedMeta: TableMeta | null
  editedRows: ColumnRow[]

  // 그리드 선택
  selectedRowIds: Set<string>

  // ── 액션 ──
  loadTable: (connId: string, database: string, table: string) => Promise<void>
  /** 신규 테이블 생성 모드 진입 — 빈 TableMeta 로 초기화 */
  initNewTable: (connId: string, database: string) => void
  reload: () => Promise<void>
  revert: () => void
  reset: () => void
  isDirty: () => boolean

  // 메타 편집
  updateMeta: (patch: Partial<TableMeta>) => void
  setIndexes: (indexes: IndexDef[]) => void
  setForeignKeys: (fks: ForeignKeyDef[]) => void
  setCheckConstraints: (checks: CheckConstraintDef[]) => void

  // 컬럼 편집
  updateRow: (rowId: string, patch: Partial<ColumnDef>) => void
  addRowAfterSelected: () => void
  deleteSelected: () => void
  moveSelected: (dir: -1 | 1) => void
  setSelected: (ids: string[], mode?: 'replace' | 'toggle' | 'add') => void
  selectSingle: (id: string) => void

  // 저장
  buildAlter: () => Promise<AlterStatement | null>
  save: (connName: string) => Promise<void>
}

let rowIdCounter = 0
function makeRowId(): string {
  rowIdCounter += 1
  return `row_${Date.now()}_${rowIdCounter}`
}

function attachRowIds(columns: ColumnDef[]): ColumnRow[] {
  return columns.map((c) => ({ ...c, rowId: makeRowId() }))
}

function stripRowIds(rows: ColumnRow[]): ColumnDef[] {
  return rows.map(({ rowId: _rowId, ...rest }) => rest)
}

function emptyMeta(): TableMeta {
  return {
    name: '',
    comment: '',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci',
    autoIncrement: 0,
    rowFormat: '',
    columns: [],
    indexes: [],
    foreignKeys: [],
    checkConstraints: [],
    partitions: [],
    createStmt: '',
  }
}

function blankColumn(index: number): ColumnDef {
  return {
    name: '',
    dataType: 'VARCHAR',
    length: '255',
    notNull: false,
    default: '',
    autoInc: false,
    primaryKey: false,
    unique: false,
    unsigned: false,
    zeroFill: false,
    comment: '',
    ordinalPos: index,
    collation: '',
    onUpdate: '',
    originalName: '', // 신규
  }
}

function deepClone<T>(v: T): T {
  return structuredClone(v)
}

export const useTableDesignerStore = create<TableDesignerState>((set, get) => ({
  connId: null,
  database: null,
  table: null,
  mode: 'edit',
  loading: false,
  applying: false,
  originalMeta: null,
  originalRows: [],
  editedMeta: null,
  editedRows: [],
  selectedRowIds: new Set<string>(),

  loadTable: async (connId, database, table) => {
    set({ connId, database, table, mode: 'edit', loading: true })
    try {
      const meta = await GetTableMeta(connId, database, table)
      const originalRows = attachRowIds(meta.columns ?? [])
      set({
        originalMeta: deepClone(meta),
        editedMeta: deepClone(meta),
        originalRows: deepClone(originalRows),
        editedRows: deepClone(originalRows),
        selectedRowIds: new Set<string>(),
        loading: false,
      })
    } catch (e) {
      set({ loading: false })
      toast.error(`${t('tdsMetaLoadFailPrefix', useLanguageStore.getState().language)}${e instanceof Error ? e.message : String(e)}`)
    }
  },

  initNewTable: (connId, database) => {
    const meta = emptyMeta()
    set({
      connId,
      database,
      table: null,
      mode: 'create',
      loading: false,
      applying: false,
      originalMeta: deepClone(meta),
      editedMeta: deepClone(meta),
      originalRows: [],
      editedRows: [],
      selectedRowIds: new Set<string>(),
    })
  },

  reload: async () => {
    const { connId, database, table, mode } = get()
    if (mode === 'create' || !connId || !database || !table) return
    await get().loadTable(connId, database, table)
  },

  revert: () => {
    const { originalMeta, originalRows } = get()
    if (!originalMeta) return
    set({
      editedMeta: deepClone(originalMeta),
      editedRows: deepClone(originalRows),
      selectedRowIds: new Set<string>(),
    })
  },

  reset: () =>
    set({
      connId: null,
      database: null,
      table: null,
      mode: 'edit',
      loading: false,
      applying: false,
      originalMeta: null,
      originalRows: [],
      editedMeta: null,
      editedRows: [],
      selectedRowIds: new Set<string>(),
    }),

  isDirty: () => {
    const { mode, originalMeta, editedMeta, originalRows, editedRows } = get()
    if (!editedMeta) return false
    if (mode === 'create') {
      // 신규 모드: 이름·컬럼 입력 또는 옵션 변경 시 dirty
      return !!editedMeta.name.trim() || editedRows.length > 0
    }
    if (!originalMeta) return false
    // 얕은 비교로 충분하지 않으므로 JSON 직렬화 비교
    const om = {
      ...originalMeta,
      columns: stripRowIds(originalRows),
    }
    const em = {
      ...editedMeta,
      columns: stripRowIds(editedRows),
    }
    return JSON.stringify(om) !== JSON.stringify(em)
  },

  updateMeta: (patch) =>
    set((s) => (s.editedMeta ? { editedMeta: { ...s.editedMeta, ...patch } } : s)),

  setIndexes: (indexes) =>
    set((s) => (s.editedMeta ? { editedMeta: { ...s.editedMeta, indexes } } : s)),

  setForeignKeys: (fks) =>
    set((s) =>
      s.editedMeta ? { editedMeta: { ...s.editedMeta, foreignKeys: fks } } : s,
    ),

  setCheckConstraints: (checks) =>
    set((s) =>
      s.editedMeta ? { editedMeta: { ...s.editedMeta, checkConstraints: checks } } : s,
    ),

  updateRow: (rowId, patch) =>
    set((s) => ({
      editedRows: s.editedRows.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)),
    })),

  addRowAfterSelected: () =>
    set((s) => {
      const rows = [...s.editedRows]
      const count = rows.length + 1
      const newCol: ColumnRow = { ...blankColumn(count), rowId: makeRowId() }

      // 마지막으로 선택된 행 아래에 삽입
      let insertIdx = rows.length
      if (s.selectedRowIds.size > 0) {
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (s.selectedRowIds.has(rows[i].rowId)) {
            insertIdx = i + 1
            break
          }
        }
      }
      rows.splice(insertIdx, 0, newCol)
      return {
        editedRows: rows.map((r, i) => ({ ...r, ordinalPos: i + 1 })),
        selectedRowIds: new Set([newCol.rowId]),
      }
    }),

  deleteSelected: () =>
    set((s) => {
      if (s.selectedRowIds.size === 0) return s
      const remaining = s.editedRows
        .filter((r) => !s.selectedRowIds.has(r.rowId))
        .map((r, i) => ({ ...r, ordinalPos: i + 1 }))
      return { editedRows: remaining, selectedRowIds: new Set<string>() }
    }),

  moveSelected: (dir) =>
    set((s) => {
      if (s.selectedRowIds.size === 0) return s
      const rows = [...s.editedRows]
      // 방향에 따라 처리 순서 결정 (위로는 오름차순, 아래로는 내림차순)
      const indices: number[] = []
      rows.forEach((r, i) => {
        if (s.selectedRowIds.has(r.rowId)) indices.push(i)
      })
      if (dir === -1) {
        for (const i of indices) {
          if (i === 0) continue
          if (s.selectedRowIds.has(rows[i - 1].rowId)) continue
          ;[rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]
        }
      } else {
        for (let k = indices.length - 1; k >= 0; k -= 1) {
          const i = indices[k]
          if (i >= rows.length - 1) continue
          if (s.selectedRowIds.has(rows[i + 1].rowId)) continue
          ;[rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]
        }
      }
      return {
        editedRows: rows.map((r, i) => ({ ...r, ordinalPos: i + 1 })),
      }
    }),

  setSelected: (ids, mode = 'replace') =>
    set((s) => {
      if (mode === 'replace') return { selectedRowIds: new Set(ids) }
      const next = new Set(s.selectedRowIds)
      if (mode === 'toggle') {
        for (const id of ids) {
          if (next.has(id)) next.delete(id)
          else next.add(id)
        }
      } else {
        for (const id of ids) next.add(id)
      }
      return { selectedRowIds: next }
    }),

  selectSingle: (id) => set({ selectedRowIds: new Set([id]) }),

  buildAlter: async () => {
    const { mode, originalMeta, editedMeta, originalRows, editedRows, database, table } = get()
    if (!editedMeta || !database) return null
    const newCols = stripRowIds(editedRows)
    if (mode === 'create') {
      const def: TableDefinition = {
        name: editedMeta.name,
        engine: editedMeta.engine,
        charset: editedMeta.charset,
        collation: editedMeta.collation,
        comment: editedMeta.comment,
        columns: newCols,
        indexes: editedMeta.indexes,
        foreignKeys: editedMeta.foreignKeys,
      }
      try {
        return await GenerateCreateSQL(database, def)
      } catch (e) {
        toast.error(`${t('tdsCreateGenFailPrefix', useLanguageStore.getState().language)}${e instanceof Error ? e.message : String(e)}`)
        return null
      }
    }
    if (!originalMeta || !table) return null
    const oldMeta: TableMeta = { ...originalMeta, columns: stripRowIds(originalRows) }
    const newMeta: TableMeta = { ...editedMeta, columns: newCols }
    try {
      return await BuildTableAlter(database, table, oldMeta, newMeta)
    } catch (e) {
      toast.error(`${t('tdsAlterGenFailPrefix', useLanguageStore.getState().language)}${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  },

  save: async (connName) => {
    const { mode, connId, database, editedMeta, editedRows } = get()
    const lang = useLanguageStore.getState().language
    if (!connId || !database || !editedMeta) return
    if (mode === 'create') {
      if (!editedMeta.name.trim()) { toast.error(t('tdsEnterTableName', lang)); return }
      if (editedRows.length === 0) { toast.error(t('tdsAddAtLeastOneCol', lang)); return }
    } else if (!get().isDirty()) {
      toast(t('tdsNoChanges', lang))
      return
    }
    set({ applying: true })
    try {
      const stmt = await get().buildAlter()
      if (!stmt || !stmt.sql) {
        toast(mode === 'create' ? t('tdsCreateSqlGenFail', lang) : t('tdsNoChanges', lang))
        return
      }
      // BugFix-CW: 디자이너 ALTER/CREATE 도 Messages 영역에 노출 (history 는 Go 측 자동 저장)
      // connName 인자는 runLoggedQuery 가 활성 연결 store 에서 다시 조회하므로 미사용.
      void connName
      await runLoggedQuery({
        connId,
        database,
        sql: stmt.sql,
        sourceLabel: mode === 'create' ? 'CREATE TABLE' : 'ALTER TABLE',
      })
      if (mode === 'create') {
        const newName = editedMeta.name
        toast.success(lang === 'ko' ? `테이블 '${newName}' 생성 완료` : `Table '${newName}' created`)
        // SchemaTree 새로고침
        window.dispatchEvent(new Event('schema:refresh'))
        // 생성된 테이블의 편집 모드로 자동 전환
        set({ table: newName, mode: 'edit' })
        await get().loadTable(connId, database, newName)
      } else {
        toast.success(t('tdsStructSaved', lang))
        await get().reload()
      }
    } catch (e) {
      toast.error(`${t('tdsSaveFailPrefix', lang)}${e instanceof Error ? e.message : String(e)}`)
    } finally {
      set({ applying: false })
    }
  },
}))
