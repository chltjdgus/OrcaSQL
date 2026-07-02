/**
 * 전역 설정 스토어.
 * localStorage에 persist; 앱 재시작 후에도 설정값 유지.
 *
 * 설정 카테고리:
 *  - editor: Monaco 에디터 옵션 (fontSize, fontFamily, tabSize, wordWrap, minimap, lineNumbers)
 *  - query: 쿼리 실행 관련 (selectLimit)
 *  - display: 결과 표시 관련 (nullDisplayText)
 *  - formatter: SQL 포매터 옵션 (sql-formatter 라이브러리 옵션 전체)
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PanelTab, ResultPanelLayout } from '@/types'

export interface EditorSettings {
  fontSize: number            // 10 ~ 24, 기본 13
  fontFamily: string          // 모노스페이스 폰트
  tabSize: number             // 2 | 4, 기본 2
  wordWrap: 'on' | 'off'     // 기본 'on'
  minimap: boolean            // 기본 false
  lineNumbers: 'on' | 'off'  // 기본 'on'
}

export interface QuerySettings {
  selectLimit: number         // SELECT TOP N 기본값, 기본 1000
  queryTimeout: number        // 쿼리 타임아웃 (초), 5~300, 기본 30
  notifyThresholdSec: number  // OS 알림 임계값 (초), 0 = 알림 비활성, 기본 5
}

export interface DisplaySettings {
  nullDisplayText: string     // NULL 셀 표시 텍스트, 기본 'NULL'
}

export interface SchemaTreeSettings {
  /** true이면 row count 배지 표시, false이면 용량(size) 배지 표시. 기본 false (size) */
  showRowCount: boolean
}

// ─── Result Panel (Phase 17) ────────────────────────────────────────────
export interface ResultPanelSettings {
  /** 기본 4개 탭의 표시 순서. tableData/info는 항상 뒤에 append */
  tabOrder: PanelTab[]
  layout: ResultPanelLayout
}

// ─── Table Designer (Phase 16) ─────────────────────────────────────────
// 하단 컬럼 그리드의 헤더 숨김 / 순서 상태. 앱 재시작 후에도 유지.
export type TableDesignerGridKey =
  | 'ordinal' | 'flags' | 'name' | 'type' | 'length'
  | 'unsigned' | 'nullable' | 'zerofill' | 'default' | 'comment'
  | 'collation' | 'onUpdate'

export interface TableDesignerSettings {
  /** 헤더 드래그 결과 — 표시 순서 (빈 배열이면 기본 순서) */
  columnOrder: TableDesignerGridKey[]
  /** 체크 해제된 열 */
  hiddenColumnKeys: TableDesignerGridKey[]
  /** 상/하 분할 높이 비율 (상단 패널 퍼센트, 20 ~ 80) */
  topPanelSize: number
}

// ─── 포매터 설정 ────────────────────────────────────────────────────────────
//
// sql-formatter v15 의 FormatOptions 를 그대로 노출. IntelliJ Code Style → SQL
// 트리 구조와 유사하게 카테고리별로 묶어서 UI 에 노출한다.
export type FormatterCase = 'preserve' | 'upper' | 'lower'
export type FormatterIndentStyle = 'standard' | 'tabularLeft' | 'tabularRight'
export type FormatterLogicalNewline = 'before' | 'after'
export type FormatterDialect =
  | 'sql' | 'mysql' | 'mariadb' | 'postgresql' | 'sqlite'
  | 'bigquery' | 'redshift' | 'snowflake' | 'tsql' | 'db2' | 'plsql'

export interface FormatterSettings {
  // 일반
  dialect: FormatterDialect       // 기본 'mysql'
  tabWidth: number                // 1~8, 기본 2
  useTabs: boolean                // 기본 false
  linesBetweenQueries: number     // 0~5, 기본 2
  // 케이스
  keywordCase: FormatterCase      // 기본 'upper'
  identifierCase: FormatterCase   // 기본 'preserve'
  dataTypeCase: FormatterCase     // 기본 'upper'
  functionCase: FormatterCase     // 기본 'upper'
  // 들여쓰기 / 정렬
  indentStyle: FormatterIndentStyle       // 기본 'standard'
  logicalOperatorNewline: FormatterLogicalNewline // 기본 'before'
  newlineBeforeSemicolon: boolean         // 기본 false
  // 줄바꿈 / 공백
  expressionWidth: number          // 20~250, 기본 50
  denseOperators: boolean          // 기본 false
}

export interface AppSettings {
  editor: EditorSettings
  query: QuerySettings
  display: DisplaySettings
  schemaTree: SchemaTreeSettings
  formatter: FormatterSettings
  tableDesigner: TableDesignerSettings
  resultPanel: ResultPanelSettings
}

interface SettingsState {
  settings: AppSettings
  updateEditor: (patch: Partial<EditorSettings>) => void
  updateQuery: (patch: Partial<QuerySettings>) => void
  updateDisplay: (patch: Partial<DisplaySettings>) => void
  updateSchemaTree: (patch: Partial<SchemaTreeSettings>) => void
  updateFormatter: (patch: Partial<FormatterSettings>) => void
  updateTableDesigner: (patch: Partial<TableDesignerSettings>) => void
  updateResultPanel: (patch: Partial<ResultPanelSettings>) => void
  resetToDefaults: () => void
  /** 현재 settings 를 직렬화한 JSON 문자열을 반환 */
  exportToJSON: () => string
  /**
   * JSON 문자열을 파싱하여 settings 를 덮어쓴다.
   * 알 수 없는 키는 무시되고, 누락된 키는 DEFAULT_SETTINGS 로 채워진다.
   * 잘못된 JSON 일 경우 Error 던짐.
   */
  importFromJSON: (json: string) => void
}

export const DEFAULT_SETTINGS: AppSettings = {
  editor: {
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    tabSize: 2,
    wordWrap: 'on',
    minimap: false,
    lineNumbers: 'on',
  },
  query: {
    selectLimit: 1000,
    queryTimeout: 30,
    notifyThresholdSec: 5,
  },
  display: {
    nullDisplayText: 'NULL',
  },
  schemaTree: {
    showRowCount: false,
  },
  formatter: {
    dialect: 'mysql',
    tabWidth: 2,
    useTabs: false,
    linesBetweenQueries: 2,
    keywordCase: 'upper',
    identifierCase: 'preserve',
    dataTypeCase: 'upper',
    functionCase: 'upper',
    indentStyle: 'standard',
    logicalOperatorNewline: 'before',
    newlineBeforeSemicolon: false,
    expressionWidth: 50,
    denseOperators: false,
  },
  tableDesigner: {
    columnOrder: [],
    hiddenColumnKeys: [],
    topPanelSize: 40,
  },
  resultPanel: {
    tabOrder: ['results', 'messages', 'history'],
    layout: {
      panels: [{
        id: 'main',
        tabIds: ['results', 'messages', 'history'],
        activeTab: 'results',
      }],
    },
  },
}

/** persisted 데이터 + DEFAULT_SETTINGS 를 깊은 병합. 누락 키는 기본값으로 채움. */
function mergeWithDefaults(p: Partial<AppSettings> | undefined): AppSettings {
  return {
    editor:        { ...DEFAULT_SETTINGS.editor,        ...(p?.editor        ?? {}) },
    query:         { ...DEFAULT_SETTINGS.query,         ...(p?.query         ?? {}) },
    display:       { ...DEFAULT_SETTINGS.display,       ...(p?.display       ?? {}) },
    schemaTree:    { ...DEFAULT_SETTINGS.schemaTree,    ...(p?.schemaTree    ?? {}) },
    formatter:     { ...DEFAULT_SETTINGS.formatter,     ...(p?.formatter     ?? {}) },
    tableDesigner: { ...DEFAULT_SETTINGS.tableDesigner, ...(p?.tableDesigner ?? {}) },
    resultPanel: {
      ...DEFAULT_SETTINGS.resultPanel,
      ...(p?.resultPanel ?? {}),
      // layout은 중첩 구조이므로 shallow spread로 panels 배열이 날아가지 않도록 명시적 처리
      layout: p?.resultPanel?.layout ?? DEFAULT_SETTINGS.resultPanel.layout,
    },
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,

      updateEditor: (patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            editor: { ...s.settings.editor, ...patch },
          },
        })),

      updateQuery: (patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            query: { ...s.settings.query, ...patch },
          },
        })),

      updateDisplay: (patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            display: { ...s.settings.display, ...patch },
          },
        })),

      updateSchemaTree: (patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            schemaTree: { ...s.settings.schemaTree, ...patch },
          },
        })),

      updateFormatter: (patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            formatter: { ...s.settings.formatter, ...patch },
          },
        })),

      updateTableDesigner: (patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            tableDesigner: { ...s.settings.tableDesigner, ...patch },
          },
        })),

      updateResultPanel: (patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            resultPanel: { ...s.settings.resultPanel, ...patch },
          },
        })),

      resetToDefaults: () => set({ settings: DEFAULT_SETTINGS }),

      exportToJSON: () => {
        const payload = {
          version: 1,
          exportedAt: new Date().toISOString(),
          settings: get().settings,
        }
        return JSON.stringify(payload, null, 2)
      },

      importFromJSON: (json) => {
        const parsed: unknown = JSON.parse(json)
        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error('Invalid settings file')
        }
        // 두 가지 포맷 지원: { settings: {...} } 또는 곧바로 {...}
        const raw = (parsed as { settings?: unknown }).settings ?? parsed
        if (typeof raw !== 'object' || raw === null) {
          throw new Error('Invalid settings file')
        }
        set({ settings: mergeWithDefaults(raw as Partial<AppSettings>) })
      },
    }),
    {
      name: 'orcasql-settings',
      // 새 필드가 추가될 때 기존 localStorage 데이터와 DEFAULT_SETTINGS를 deep merge.
      // 구버전 persist 데이터에 없는 키는 DEFAULT_SETTINGS 값으로 채운다.
      merge: (persisted, current) => {
        const p = (persisted as Partial<SettingsState>).settings as Partial<AppSettings> | undefined
        return {
          ...current,
          settings: mergeWithDefaults(p),
        }
      },
    },
  ),
)
