// ─── Go 바인딩 대응 타입 ──────────────────────────────────────────────────
// Go 구조체와 1:1 대응. wails3 generate bindings 실행 시 wailsjs/에 자동 생성됨.

export interface ConnectConfig {
  id: string
  name: string
  host: string
  port: number
  user: string
  password?: string
  database: string            // 기본 접속 DB (databases[0] 자동 동기)
  databases?: string[]        // 즐겨찾기/멀티셀렉 DB 목록
  charset: string
  tls: boolean
  // SSH
  useSSH: boolean
  sshHost: string
  sshPort: number
  sshUser: string
  sshKeyPath: string
  sshPassword?: string // SSH 패스워드 인증 (키 경로 없을 때)
  // 프록시 (SOCKS5 | HTTP CONNECT)
  useProxy: boolean
  proxyType: 'socks5' | 'http'
  proxyHost: string
  proxyPort: number
  proxyUser: string
  proxyPassword?: string
  // 세션 관리 메타데이터
  groupId?: string    // 소속 그룹 ID ('' = 루트)
  color?: string      // 세션 색상 hex (e.g. "#4299e1")
  lastUsed?: string   // ISO 8601 마지막 연결 시각
  sortOrder?: number  // 그룹 내 정렬 순서
}

/** 세션 그룹 (폴더). 최대 2단계: 루트 그룹 → 하위 그룹. */
export interface SessionGroup {
  id: string
  name: string
  color?: string      // 그룹 색상 hex
  parentId?: string   // '' = 루트 레벨
  order: number
}

export interface ConnectionInfo {
  id: string
  /**
   * BugFix-BA: 활성 연결을 발생시킨 저장 cfg 의 ID.
   * `id` 는 매 연결마다 고유 UUID 가 발급되지만, `cfgId` 는 SessionManager 의 저장된 연결 ID 와 같다.
   * QuickConnect 드롭다운 등 "이 저장 연결이 어딘가에 활성인가?" 를 체크할 때 사용한다.
   * 백엔드(`Connect`/`ConnectNew`) 가 채우는 게 아니라 프론트가 `addActiveConnection` 시 직접 채운다.
   */
  cfgId?: string
  name: string
  host: string
  port: number
  user: string
  database: string
  connectedAt: string // ISO 8601
}

export interface ColumnMeta {
  name: string
  type: string
  nullable: boolean
}

/** 인라인 편집을 위한 테이블 컨텍스트. 단일 테이블 SELECT 시 Go가 자동으로 채워준다 */
export interface TableEditContext {
  database: string
  table: string
  pkColumns: string[] // WHERE 조건에 사용할 PK 컬럼 이름 목록
}

/** UpdateRowValue 호출 시 WHERE 조건 쌍 */
export interface RowPKValue {
  column: string
  value: string // 모든 타입을 문자열로 직렬화
}

/** InsertRow 호출 시 컬럼·값 쌍 */
export interface ColumnValue {
  column: string
  value: string
  setNull: boolean
}

export interface QueryResult {
  columns: ColumnMeta[]
  rows: unknown[][]
  affected: number
  lastId: number
  duration: number // nanoseconds
  sql: string
  /** 인라인 편집 컨텍스트 — 단일 테이블 SELECT일 때만 존재 */
  editCtx?: TableEditContext
  /** true = 결과 행 상한선 초과로 일부 행이 잘림 */
  truncated?: boolean
}

export interface ResultChunk {
  columns?: ColumnMeta[] // 첫 번째 청크에만 포함
  rows: unknown[][]
  chunkIndex: number
  isLast: boolean
  total: number
}

/**
 * ExecuteMultiQuery 응답.
 * Wails 바인딩이 항상 성공으로 반환하며, 에러 정보는 구조체에 내장된다.
 */
export interface MultiExecResult {
  results: QueryResult[]
  /** 실패한 statement 0-기반 인덱스. -1이면 전부 성공 */
  failedIndex: number
  /** 실패한 SQL 문 (failedIndex >= 0 일 때만 유효) */
  failedSQL: string
  /** 오류 메시지 (failedIndex >= 0 일 때만 유효) */
  error: string
  /** 미실행 SQL — failedIndex 이후 statement들 (계속 실행에 사용) */
  remainingSQL: string
  /** 전체 statement 수 */
  totalCount: number
}

export function isMultiExecResult(v: unknown): v is MultiExecResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    Array.isArray(r['results']) &&
    typeof r['failedIndex'] === 'number' &&
    typeof r['totalCount'] === 'number'
  )
}

export interface TableInfo {
  name: string
  type: 'BASE TABLE' | 'VIEW'
  engine: string
  rows: number
  sizeBytes: number   // data_length + index_length
  comment: string
}

export interface ColumnInfo {
  name: string
  ordinalPos: number
  default: string
  nullable: boolean
  dataType: string
  columnType: string
  key: string
  extra: string
  comment: string
}

export interface IndexInfo {
  name: string
  columns: string
  unique: boolean
  indexType: string
}

// ─── Table Designer 타입 (Go schema.designer 대응) ───────────────────────

export interface ColumnDef {
  name: string
  dataType: string
  length: string
  notNull: boolean
  default: string
  autoInc: boolean
  primaryKey: boolean
  unique: boolean
  unsigned: boolean
  zeroFill: boolean
  comment: string
  ordinalPos: number
  collation: string
  onUpdate: string
  /** Phase 16 디자이너 rename 감지용 — 신규 컬럼이면 빈 문자열 */
  originalName?: string
}

export interface IndexDef {
  name: string
  columns: string[]
  columnDirections: string[] // 각 컬럼 정렬 방향: 'ASC' | 'DESC'
  unique: boolean
  fullText: boolean
  indexType: string
  isPrimary: boolean
}

export interface ForeignKeyDef {
  name: string
  column: string
  refTable: string
  refColumn: string
  onDelete: string
  onUpdate: string
}

export interface TableDefinition {
  name: string
  engine: string
  charset: string
  collation: string
  comment: string
  columns: ColumnDef[]
  indexes: IndexDef[]
  foreignKeys: ForeignKeyDef[]
}

export interface AlterStatement {
  sql: string
  preview: string
}

// ─── Phase 16 — HeidiSQL 스타일 테이블 디자이너 ───────────────────────

export interface CheckConstraintDef {
  name: string
  expression: string
  enforced: boolean
}

export interface PartitionInfo {
  name: string
  method: string
  expression: string
  description: string
  tableRows: number
  dataLength: number
  indexLength: number
  subpartitionName: string
}

export interface TableMeta {
  // 기본 정보
  name: string
  comment: string
  // 옵션
  engine: string
  charset: string
  collation: string
  autoIncrement: number
  rowFormat: string
  // 컬럼 및 제약
  columns: ColumnDef[]
  indexes: IndexDef[]
  foreignKeys: ForeignKeyDef[]
  checkConstraints: CheckConstraintDef[]
  partitions: PartitionInfo[]
  // SHOW CREATE TABLE 원본
  createStmt: string
}

export interface ObjectInfo {
  name: string
  objType: string
  definer: string
  created: string
  modified: string
  comment: string
}

// ─── UI 전용 타입 ────────────────────────────────────────────────────────

export type PanelTab = 'results' | 'messages' | 'history' | 'tableData' | 'info'
export type ToolTab = 'history' | 'tableData' | 'info'

export interface ResultPanelInstance {
  id: string
  tabIds: PanelTab[]
  activeTab: PanelTab
}

export interface ResultPanelLayout {
  panels: ResultPanelInstance[]
}

export interface QueryTab {
  id: string
  title: string
  sql: string
  connId: string | null
  database: string | null
  /** 단일 쿼리 결과 (하위 호환). ExecuteMultiQuery 사용 시 results[0]과 동일 */
  result: QueryResult | null
  /** 멀티 statement 실행 결과 배열. 단일 쿼리도 1-element 배열로 저장 */
  results: QueryResult[]
  /** EXPLAIN 결과 배열 — results[i] 와 1:1 대응, SELECT가 아니면 null */
  explainData: Array<{ rows: ExplainRow[]; json?: string } | null>
  /** 인라인 편집 컨텍스트 — 현재 표시 중인 결과의 editCtx를 전파 */
  editCtx?: TableEditContext
  isRunning: boolean
  /** 마지막 실행에서 발생한 오류 정보 (실패 시 설정, 새 실행 시 초기화) */
  queryError?: { sql: string; message: string; stmtIndex?: number; totalCount?: number }
}

/** 연결별 독립 워크스페이스 세션 (Phase 7-B) */
export interface ConnectionSession {
  id: string              // connId와 동일
  connId: string
  name: string            // 연결 표시 이름
  host: string            // 상태바 표시용
  tabs: QueryTab[]
  activeTabId: string | null
  selectedDatabase: string | null  // 세션별 선택된 DB
}

export type SchemaNodeType = 'connection' | 'database' | 'table' | 'view' | 'column'

export interface SchemaNode {
  id: string
  type: SchemaNodeType
  name: string
  connId: string
  database?: string
  table?: string
  children?: SchemaNode[]
  loaded: boolean
  columnInfo?: ColumnInfo
}

export interface ExplainRow {
  id: number
  selectType: string
  table: string
  partitions?: string
  type: string
  possibleKeys?: string
  key?: string
  keyLen?: string
  ref?: string
  rows?: number
  filtered?: number
  extra?: string
}

export interface HistoryEntry {
  id: string
  sql: string
  connName: string
  database: string
  executedAt: string   // ISO 8601
  duration: number     // nanoseconds
  rowCount: number
  affected: number
  hasError: boolean
  errorMsg?: string
  /** "" or "ui" = UI 경로(기본), "mcp" = MCP 서버 경로 (Phase 43) */
  source?: string
}

// ─── Session Restore ─────────────────────────────────────────────────────

export interface TabState {
  id: string
  title: string
  sql: string
  connId: string
  connName: string
  database: string
  isActive: boolean
}

/**
 * Phase 14-A: 연결별 독립 세션 상태.
 * 각 연결마다 자신의 쿼리 탭, 활성 탭, 선택 DB를 가진다.
 */
export interface ConnectionSessionState {
  selectedDatabase?: string
  tabs?: TabState[]
  activeTabId?: string
}

export interface SessionState {
  savedAt: string

  // BugFix-BK: 연결별 독립 세션 (key = cfgId — 저장된 연결 영구 ID).
  // Phase 14-A 의 connId 키 방식은 BugFix-BA 의 ConnectNew 휘발 UUID 와 충돌 → cfgId 기반으로 전환.
  perConnection?: Record<string, ConnectionSessionState>

  // BugFix-BK: 자동 재연결 대상 (cfgId 목록).
  // 같은 cfgId 가 여러 번 등장하면 그 만큼 탭이 열림(ConnectNew 가 새 connId 발급).
  activeCfgIds?: string[]
  selectedCfgId?: string

  // ── Deprecated: 구버전 호환 (Phase 14 포맷, Load 시 폴백) ──
  activeConnIds?: string[]
  selectedConnId?: string

  // ── Deprecated: 구버전 호환 (Load 시 백엔드에서 perConnection 으로 자동 이관) ──
  tabs?: TabState[]
  activeTabId?: string
  selectedDatabase?: string
  schemaExpanded?: string[]
  openPanels?: string[]
}

// ─── Backup / SQL Dump ───────────────────────────────────────────────────

export interface DumpOptions {
  connId: string
  database: string
  tables: string[]
  noData: boolean
  noCreate: boolean
  dropTable: boolean
  insertIgnore: boolean
  batchSize: number
}

export interface DumpProgress {
  table: string
  phase: 'ddl' | 'data' | 'done'
  rowsDone: number
  totalRows: number
  percent: number
}

// ─── Schema Sync ─────────────────────────────────────────────────────────

export interface SchemaDiffItem {
  objectType: string
  objectName: string
  subName: string
  action: 'ADD' | 'DROP' | 'MODIFY'
  sourceDdl: string
  targetDdl: string
  sql: string
}

export interface SchemaSyncResult {
  diffs: SchemaDiffItem[]
  syncSql: string
  analyzed: string
}

// ─── Data Search ─────────────────────────────────────────────────────────

export interface DataSearchResult {
  table: string
  column: string
  rows: string[][]
  total: number
}

// ─── Query Favorites ─────────────────────────────────────────────────────

export interface Snippet {
  id: string
  title: string
  sql: string
  category: string
  tags: string[]
  createdAt: string  // ISO 8601
  updatedAt: string  // ISO 8601
  useCount: number
}

// ─── Data Sync ────────────────────────────────────────────────────────────

export type DataDiffAction = 'INSERT' | 'UPDATE' | 'DELETE'

export interface DataDiffRow {
  pk: string
  action: DataDiffAction
  srcRow: Record<string, string> | null
  dstRow: Record<string, string> | null
  sql: string
}

export interface DataSyncResult {
  table: string
  srcCount: number
  dstCount: number
  diffs: DataDiffRow[]
  syncSql: string
  analyzed: string // ISO 8601
}

// ─── Process List ────────────────────────────────────────────────────────

export interface ProcessRow {
  id: number
  user: string
  host: string
  db: string
  command: string
  time: number
  state: string
  info: string
}

// ─── Server Variables / Status ────────────────────────────────────────────

export interface VariableRow {
  name: string
  value: string
}

// ─── User Manager ─────────────────────────────────────────────────────────

export interface UserRow {
  user: string
  host: string
  plugin: string
  passwordExpired: string
  accountLocked: string
}

// ─── Type Guards ─────────────────────────────────────────────────────────

export function isQueryResult(val: unknown): val is QueryResult {
  return (
    typeof val === 'object' &&
    val !== null &&
    'columns' in val &&
    'rows' in val &&
    Array.isArray((val as QueryResult).columns) &&
    Array.isArray((val as QueryResult).rows)
  )
}

export function isResultChunk(val: unknown): val is ResultChunk {
  return (
    typeof val === 'object' &&
    val !== null &&
    'rows' in val &&
    'chunkIndex' in val &&
    'isLast' in val
  )
}
