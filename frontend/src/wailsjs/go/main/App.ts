/**
 * @file Wails v3 자동 생성 바인딩 스텁
 * @warning 이 파일은 `wails3 generate bindings` 실행 시 자동 덮어씌워집니다.
 *          직접 수정하지 마세요.
 *
 * 실제 바인딩이 생성되기 전 TypeScript 컴파일을 통과하기 위한 스텁입니다.
 */

import type {
  ConnectConfig,
  ConnectionInfo,
  SessionGroup,
  QueryResult,
  MultiExecResult,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  HistoryEntry,
  ExplainRow,
  TableDefinition,
  TableMeta,
  AlterStatement,
  DumpOptions,
  SchemaSyncResult,
  DataSearchResult,
  Snippet,
  ProcessRow,
  VariableRow,
  UserRow,
} from '@/types'

export interface ProfileRow {
  status: string
  duration: number
}

export interface ObjectInfo {
  name: string
  objType: string
  definer: string
  created: string
  modified: string
  comment: string
}

// ─── Wails v3 런타임 호출 ─────────────────────────────────────────────────
// Wails v3는 @wailsio/runtime 의 Call.ByName() 을 사용합니다.
// wails3 dev / wails3 build 시 런타임이 자동 주입됩니다.
// 순수 브라우저(plain vite dev)에서는 reject 됩니다.
//
// Call.ByName 형식: "ServiceName.MethodName"
//   - ServiceName: application.NewService(appInstance) 등록 시 Go 타입명 → "App"
//   - MethodName : Go exported 메서드명

import { Call as $Call } from '@wailsio/runtime'

/**
 * Wails v3 Go 메서드 호출 래퍼.
 * 자동생성 bindings/websql/app.js 와 동일하게 @wailsio/runtime 을 사용한다.
 * Call.ByName("App.MethodName", ...args) 형식으로 호출한다.
 *
 * @wailsio/runtime 은 vite.config.ts 에서 external 로 등록되어 있으므로
 * vite build 시 번들에서 제외되고, wails3 build/dev 가 런타임에 주입한다.
 */
function callGo<T>(method: string, ...args: unknown[]): Promise<T> {
  return $Call.ByName(`main.App.${method}`, ...args) as Promise<T>
}

// ─── 연결 관리 ────────────────────────────────────────────────────────────

export function Connect(cfg: ConnectConfig): Promise<string> {
  return callGo<string>('Connect', cfg)
}

/** Connect 와 동일하지만 항상 새 connID 를 발급 — 같은 저장된 연결을 여러 탭에서 동시 오픈할 때 사용. */
export function ConnectNew(cfg: ConnectConfig): Promise<string> {
  return callGo<string>('ConnectNew', cfg)
}

export function Disconnect(connID: string): Promise<void> {
  return callGo<void>('Disconnect', connID)
}

export function ListConnections(): Promise<ConnectionInfo[]> {
  return callGo<ConnectionInfo[]>('ListConnections')
}

export function ResetAllUserData(): Promise<void> {
  return callGo<void>('ResetAllUserData')
}

export function OpenDevTools(): Promise<void> {
  return callGo<void>('OpenDevTools')
}

export function Ping(connID: string): Promise<void> {
  return callGo<void>('Ping', connID)
}

/** Ping을 수행하고 지연 시간(ms)을 반환한다. 실패 시 reject */
export function PingWithLatency(connID: string): Promise<number> {
  return callGo<number>('PingWithLatency', connID)
}

/** 기존 연결을 끊고 저장된 설정으로 재연결한다 */
export function Reconnect(connID: string): Promise<void> {
  return callGo<void>('Reconnect', connID)
}

// ─── 연결 설정 저장 ───────────────────────────────────────────────────────

export function SaveConnection(cfg: ConnectConfig): Promise<void> {
  return callGo<void>('SaveConnection', cfg)
}

// ─── 연결 테스트 ──────────────────────────────────────────────────────────

export interface TestConnResult {
  ok: boolean
  serverVer: string
  /** "host" | "auth" | "database" | "ssh" | "proxy" | "tls" | "other" */
  errorKind: string
  message: string
}

export function TestConnection(cfg: ConnectConfig): Promise<TestConnResult> {
  return callGo<TestConnResult>('TestConnection', cfg)
}

export function DeleteConnection(connID: string): Promise<void> {
  return callGo<void>('DeleteConnection', connID)
}

export function GetSavedConnections(): Promise<ConnectConfig[]> {
  return callGo<ConnectConfig[]>('GetSavedConnections')
}

// ─── 쿼리 실행 ───────────────────────────────────────────────────────────

export function ExecuteQuery(connID: string, connName: string, database: string, sql: string): Promise<QueryResult> {
  return callGo<QueryResult>('ExecuteQuery', connID, connName, database, sql)
}

export function ExecuteQueryStream(connID: string, sql: string): Promise<void> {
  return callGo<void>('ExecuteQueryStream', connID, sql)
}

export function ExecuteMultiQuery(connID: string, tabID: string, connName: string, database: string, sql: string): Promise<MultiExecResult> {
  return callGo<MultiExecResult>('ExecuteMultiQuery', connID, tabID, connName, database, sql)
}

export interface RowPKValue {
  column: string
  value: string
}

export function UpdateRowValue(
  connID: string,
  database: string,
  table: string,
  column: string,
  newValue: string,
  setNull: boolean,
  pkValues: RowPKValue[],
): Promise<void> {
  return callGo<void>('UpdateRowValue', connID, database, table, column, newValue, setNull, pkValues)
}

export interface ColumnValue {
  column: string
  value: string
  setNull: boolean
}

export function InsertRow(
  connID: string,
  database: string,
  table: string,
  columnValues: ColumnValue[],
): Promise<void> {
  return callGo<void>('InsertRow', connID, database, table, columnValues)
}

// tabID: ExecuteMultiQuery에 전달한 tabID와 동일한 값을 사용
export function CancelQuery(tabID: string): Promise<void> {
  return callGo<void>('CancelQuery', tabID)
}
export function SetQueryTimeout(seconds: number): Promise<void> {
  return callGo<void>('SetQueryTimeout', seconds)
}
export function GetQueryTimeout(): Promise<number> {
  return callGo<number>('GetQueryTimeout')
}
export function SetResultLimit(n: number): Promise<void> {
  return callGo<void>('SetResultLimit', n)
}
export function GetResultLimit(): Promise<number> {
  return callGo<number>('GetResultLimit')
}
export interface KnownHostEntry {
  line: string
  host: string
  keyType: string
  fingerprint: string
}
export function ListKnownHosts(): Promise<KnownHostEntry[]> {
  return callGo<KnownHostEntry[]>('ListKnownHosts')
}
export function DeleteKnownHost(line: string): Promise<void> {
  return callGo<void>('DeleteKnownHost', line)
}

// ─── 스키마 조회 ─────────────────────────────────────────────────────────

export function ListDatabasesFromConfig(cfg: ConnectConfig): Promise<string[]> {
  return callGo<string[]>('ListDatabasesFromConfig', cfg)
}

export function ListDatabases(connID: string): Promise<string[]> {
  return callGo<string[]>('ListDatabases', connID)
}

export function ListTables(connID: string, database: string): Promise<TableInfo[]> {
  return callGo<TableInfo[]>('ListTables', connID, database)
}

export function ListColumns(connID: string, database: string, table: string): Promise<ColumnInfo[]> {
  return callGo<ColumnInfo[]>('ListColumns', connID, database, table)
}

export function ListIndexes(connID: string, database: string, table: string): Promise<IndexInfo[]> {
  return callGo<IndexInfo[]>('ListIndexes', connID, database, table)
}

export function GetTableDDL(connID: string, database: string, table: string): Promise<string> {
  return callGo<string>('GetTableDDL', connID, database, table)
}

export interface FKInfo {
  tableName: string
  columnName: string
  refTableName: string
  refColumnName: string
  constraintName: string
}

export function GetForeignKeys(connID: string, database: string): Promise<FKInfo[]> {
  return callGo<FKInfo[]>('GetForeignKeys', connID, database)
}

// ─── 쿼리 히스토리 ───────────────────────────────────────────────────────

export function GetQueryHistory(): Promise<HistoryEntry[]> {
  return callGo<HistoryEntry[]>('GetQueryHistory')
}

export function GetHistoryDates(): Promise<string[]> {
  return callGo<string[]>('GetHistoryDates')
}

export function GetHistoryByDate(date: string): Promise<HistoryEntry[]> {
  return callGo<HistoryEntry[]>('GetHistoryByDate', date)
}

export function SearchHistory(query: string, date: string): Promise<HistoryEntry[]> {
  return callGo<HistoryEntry[]>('SearchHistory', query, date)
}

export function DeleteHistoryEntry(id: string): Promise<void> {
  return callGo<void>('DeleteHistoryEntry', id)
}

export function ClearHistory(): Promise<void> {
  return callGo<void>('ClearHistory')
}

/**
 * UI 직접 호출(인라인 셀 UPDATE / 행 INSERT 등 ExecuteQuery 우회 경로)을
 * 히스토리에 기록한다. duration 은 나노초, executedAt 은 ISO 문자열 또는 빈 값.
 * BugFix-CW.
 */
export function RecordHistoryEntry(entry: HistoryEntry): Promise<void> {
  return callGo<void>('RecordHistoryEntry', entry)
}

// ─── Query Profiler ───────────────────────────────────────────────────────

export function GetExplain(connID: string, sql: string): Promise<ExplainRow[]> {
  return callGo<ExplainRow[]>('GetExplain', connID, sql)
}

export function GetProfile(connID: string): Promise<ProfileRow[]> {
  return callGo<ProfileRow[]>('GetProfile', connID)
}

export function GetExplainJSON(connID: string, sql: string): Promise<string> {
  return callGo<string>('GetExplainJSON', connID, sql)
}

// ─── Table Designer ───────────────────────────────────────────────────────

export function GetTableDefinition(connID: string, database: string, table: string): Promise<TableDefinition> {
  return callGo<TableDefinition>('GetTableDefinition', connID, database, table)
}

export function GenerateAlterSQL(database: string, table: string, old: TableDefinition, newDef: TableDefinition): Promise<AlterStatement> {
  return callGo<AlterStatement>('GenerateAlterSQL', database, table, old, newDef)
}

export function GenerateCreateSQL(database: string, def: TableDefinition): Promise<AlterStatement> {
  return callGo<AlterStatement>('GenerateCreateSQL', database, def)
}

export function ExecuteAlterTable(connID: string, sql: string): Promise<void> {
  return callGo<void>('ExecuteAlterTable', connID, sql)
}

// Phase 16 — HeidiSQL 스타일 디자이너
export function GetTableMeta(connID: string, database: string, table: string): Promise<TableMeta> {
  return callGo<TableMeta>('GetTableMeta', connID, database, table)
}

export function BuildTableAlter(database: string, table: string, oldMeta: TableMeta, newMeta: TableMeta): Promise<AlterStatement> {
  return callGo<AlterStatement>('BuildTableAlter', database, table, oldMeta, newMeta)
}

// ─── Stored Objects ───────────────────────────────────────────────────────

export function ListProcedures(connID: string, database: string): Promise<ObjectInfo[]> {
  return callGo<ObjectInfo[]>('ListProcedures', connID, database)
}

export function ListFunctions(connID: string, database: string): Promise<ObjectInfo[]> {
  return callGo<ObjectInfo[]>('ListFunctions', connID, database)
}

export function ListTriggers(connID: string, database: string, table: string): Promise<ObjectInfo[]> {
  return callGo<ObjectInfo[]>('ListTriggers', connID, database, table)
}

export function ListEvents(connID: string, database: string): Promise<ObjectInfo[]> {
  return callGo<ObjectInfo[]>('ListEvents', connID, database)
}

export function GetObjectDDL(connID: string, database: string, objType: string, name: string): Promise<string> {
  return callGo<string>('GetObjectDDL', connID, database, objType, name)
}

// ─── Backup / SQL Dump ────────────────────────────────────────────────────

export function DumpDatabase(opts: DumpOptions): Promise<string> {
  return callGo<string>('DumpDatabase', opts)
}

export function GetDumpTableList(connID: string, database: string): Promise<string[]> {
  return callGo<string[]>('GetDumpTableList', connID, database)
}

// ─── Schema Sync ──────────────────────────────────────────────────────────

export function CompareSchemas(
  srcConnID: string, srcDB: string,
  dstConnID: string, dstDB: string,
): Promise<SchemaSyncResult> {
  return callGo<SchemaSyncResult>('CompareSchemas', srcConnID, srcDB, dstConnID, dstDB)
}

export function ApplySyncSQL(connID: string, database: string, sql: string): Promise<void> {
  return callGo<void>('ApplySyncSQL', connID, database, sql)
}

// ─── Data Sync ────────────────────────────────────────────────────────────

export function CompareTableData(
  srcConnID: string, srcDB: string, srcTable: string,
  dstConnID: string, dstDB: string, dstTable: string,
  maxRows: number,
): Promise<import('@/types').DataSyncResult> {
  return callGo<import('@/types').DataSyncResult>(
    'CompareTableData', srcConnID, srcDB, srcTable, dstConnID, dstDB, dstTable, maxRows,
  )
}

export function SyncTableData(dstConnID: string, dstDB: string, syncSQL: string): Promise<void> {
  return callGo<void>('SyncTableData', dstConnID, dstDB, syncSQL)
}

// ─── Data Search ──────────────────────────────────────────────────────────

export function SearchInDatabase(
  connID: string, database: string, keyword: string, maxPerTable: number,
): Promise<DataSearchResult[]> {
  return callGo<DataSearchResult[]>('SearchInDatabase', connID, database, keyword, maxPerTable)
}

// ─── Session Restore ──────────────────────────────────────────────────────

export function SaveSession(state: import('@/types').SessionState): Promise<void> {
  return callGo<void>('SaveSession', state)
}

export function LoadSession(): Promise<import('@/types').SessionState> {
  return callGo<import('@/types').SessionState>('LoadSession')
}

export function ClearSession(): Promise<void> {
  return callGo<void>('ClearSession')
}

export function ResetSession(): Promise<void> {
  return callGo<void>('ResetSession')
}

// ─── Connection Import / Export ───────────────────────────────────────────

export function ExportConnections(): Promise<string> {
  return callGo<string>('ExportConnections')
}

export function ImportConnections(jsonStr: string): Promise<number> {
  return callGo<number>('ImportConnections', jsonStr)
}

// ─── Query Favorites ─────────────────────────────────────────────────────

export function ListFavorites(): Promise<Snippet[]> {
  return callGo<Snippet[]>('ListFavorites')
}

export function AddFavorite(snippet: Snippet): Promise<void> {
  return callGo<void>('AddFavorite', snippet)
}

export function UpdateFavorite(snippet: Snippet): Promise<void> {
  return callGo<void>('UpdateFavorite', snippet)
}

export function DeleteFavorite(id: string): Promise<void> {
  return callGo<void>('DeleteFavorite', id)
}

export function UseFavorite(id: string): Promise<void> {
  return callGo<void>('UseFavorite', id)
}

// ─── CSV Import ───────────────────────────────────────────────────────────

export interface ImportResult {
  inserted: number
  skipped: number
  errors: string
}

/**
 * CSV 문자열을 파싱하여 지정 테이블에 BATCH INSERT한다.
 * delimiter: 구분자 문자열 (예: ",", "\t", ";"). 빈 문자열이면 ","로 처리.
 */
export function ImportCSVData(
  connID: string,
  database: string,
  table: string,
  csvContent: string,
  hasHeader: boolean,
  delimiter: string,
): Promise<ImportResult> {
  return callGo<ImportResult>('ImportCSVData', connID, database, table, csvContent, hasHeader, delimiter)
}

// ─── Table Data Export ────────────────────────────────────────────────────

export function ExportTableData(
  connID: string,
  database: string,
  table: string,
  format: string,
  limit: number,
): Promise<string> {
  return callGo<string>('ExportTableData', connID, database, table, format, limit)
}

// ─── Table Utilities ─────────────────────────────────────────────────────

export function RenameTable(connID: string, database: string, oldName: string, newName: string): Promise<void> {
  return callGo<void>('RenameTable', connID, database, oldName, newName)
}

export function CopyTable(connID: string, database: string, srcTable: string, dstTable: string, withData: boolean): Promise<void> {
  return callGo<void>('CopyTable', connID, database, srcTable, dstTable, withData)
}

export function CreateDatabase(connID: string, database: string): Promise<void> {
  return callGo<void>('CreateDatabase', connID, database)
}

export function DropDatabase(connID: string, database: string): Promise<void> {
  return callGo<void>('DropDatabase', connID, database)
}

// ─── Process List ─────────────────────────────────────────────────────────

export function GetProcessList(connID: string): Promise<ProcessRow[]> {
  return callGo<ProcessRow[]>('GetProcessList', connID)
}

export function KillProcess(connID: string, processID: number, killQuery: boolean): Promise<void> {
  return callGo<void>('KillProcess', connID, processID, killQuery)
}

// ─── Server Variables / Status ────────────────────────────────────────────

export function GetServerVariables(connID: string, scope: string): Promise<VariableRow[]> {
  return callGo<VariableRow[]>('GetServerVariables', connID, scope)
}

export function GetServerStatus(connID: string, scope: string): Promise<VariableRow[]> {
  return callGo<VariableRow[]>('GetServerStatus', connID, scope)
}

// ─── User Manager ─────────────────────────────────────────────────────────

export function ListUsers(connID: string): Promise<UserRow[]> {
  return callGo<UserRow[]>('ListUsers', connID)
}

export function CreateUser(connID: string, user: string, host: string, password: string): Promise<void> {
  return callGo<void>('CreateUser', connID, user, host, password)
}

export function DropUser(connID: string, user: string, host: string): Promise<void> {
  return callGo<void>('DropUser', connID, user, host)
}

export function GetUserGrants(connID: string, user: string, host: string): Promise<string[]> {
  return callGo<string[]>('GetUserGrants', connID, user, host)
}

export function GrantPrivileges(connID: string, privileges: string, onClause: string, user: string, host: string): Promise<void> {
  return callGo<void>('GrantPrivileges', connID, privileges, onClause, user, host)
}

export function RevokePrivileges(connID: string, privileges: string, onClause: string, user: string, host: string): Promise<void> {
  return callGo<void>('RevokePrivileges', connID, privileges, onClause, user, host)
}

export function ChangeUserPassword(connID: string, user: string, host: string, newPassword: string): Promise<void> {
  return callGo<void>('ChangeUserPassword', connID, user, host, newPassword)
}

export function SetAccountLock(connID: string, user: string, host: string, lock: boolean): Promise<void> {
  return callGo<void>('SetAccountLock', connID, user, host, lock)
}

// ─── 앱 정보 ────────────────────────────────────────────────────────────────

export interface AppInfo {
  name: string
  version: string
  description: string
  copyright: string
}

export function GetAppInfo(): Promise<AppInfo> {
  return callGo<AppInfo>('GetAppInfo')
}

// ─── 세션 그룹 관리 ──────────────────────────────────────────────────────────
// bindings/websql/app.js 에도 동일 메서드가 추가되어 있습니다.
// wails3 generate bindings 실행 후 app.js 쪽이 ByID 로 교체되면
// 이 스텁도 그쪽을 위임하도록 교체하세요.

export function GetSessionGroups(): Promise<SessionGroup[]> {
  return callGo<SessionGroup[]>('GetSessionGroups')
}

export function SaveSessionGroup(grp: SessionGroup): Promise<void> {
  return callGo<void>('SaveSessionGroup', grp)
}

export function DeleteSessionGroup(groupID: string, cascade: boolean): Promise<void> {
  return callGo<void>('DeleteSessionGroup', groupID, cascade)
}

export function ReorderGroups(groups: SessionGroup[]): Promise<void> {
  return callGo<void>('ReorderGroups', groups)
}

export function ReorderConnections(conns: ConnectConfig[]): Promise<void> {
  return callGo<void>('ReorderConnections', conns)
}

export function UpdateConnectionLastUsed(connID: string): Promise<void> {
  return callGo<void>('UpdateConnectionLastUsed', connID)
}

export function GetConnectionWithCredential(connID: string): Promise<ConnectConfig> {
  return callGo<ConnectConfig>('GetConnectionWithCredential', connID)
}

/** OS 네이티브 알림 표시. Windows: WinRT Toast, macOS: osascript, Linux: notify-send */
export function ShowNotification(title: string, body: string): Promise<void> {
  return callGo<void>('ShowNotification', title, body)
}

// ─── MCP 서버 (Phase 43) ────────────────────────────────────────────────────
//
// Claude / IDE 등 외부 MCP 클라이언트가 OrcaSQL 의 활성 연결을 통해 DB 질의 가능.
// 토큰은 OS 키체인 보관, GetMCPConfig 응답에는 포함되지 않음.

export interface MCPConfig {
  enabled: boolean
  port: number
  allowWrite: boolean
  allowDDL: boolean
  /** [] = 모두 차단(기본), ["*"] = 모두, [...] = 화이트리스트 */
  allowedConnIDs: string[]
  createdAt?: string
}

export interface MCPStatus {
  running: boolean
  port: number
  endpoint: string
  startedAt?: string
  lastError?: string
  configError?: string
}

export function GetMCPConfig(): Promise<MCPConfig> {
  return callGo<MCPConfig>('GetMCPConfig')
}

export function UpdateMCPConfig(cfg: MCPConfig): Promise<void> {
  return callGo<void>('UpdateMCPConfig', cfg)
}

export function StartMCPServer(): Promise<void> {
  return callGo<void>('StartMCPServer')
}

export function StopMCPServer(): Promise<void> {
  return callGo<void>('StopMCPServer')
}

export function GetMCPStatus(): Promise<MCPStatus> {
  return callGo<MCPStatus>('GetMCPStatus')
}

export function RegenerateMCPToken(): Promise<string> {
  return callGo<string>('RegenerateMCPToken')
}

export function RevealMCPToken(): Promise<string> {
  return callGo<string>('RevealMCPToken')
}

/**
 * MCP 클라이언트 설정 JSON 조각을 반환한다.
 * @param client "claude-code" | "cursor"
 */
export function GetMCPClientConfigSnippet(client: string): Promise<string> {
  return callGo<string>('GetMCPClientConfigSnippet', client)
}

/**
 * AI 채팅창에 붙여넣을 영문 프롬프트를 반환한다 (Phase 43).
 * 사용자가 채팅 시작 시 한 번 붙이면 AI 가 list_connections → list_databases 를
 * 자동 호출해 자가 탐색하고 무엇을 도와줄지 묻는다.
 */
export function GetMCPAIPromptSnippet(): Promise<string> {
  return callGo<string>('GetMCPAIPromptSnippet')
}

/**
 * 지정 포트가 즉시 listen 가능한지 사전 검사한다.
 * 호출자는 GetMCPStatus 와 비교해 본인 서버가 점유 중인지 구분해야 함.
 */
export function CheckMCPPortAvailable(port: number): Promise<boolean> {
  return callGo<boolean>('CheckMCPPortAvailable', port)
}

export interface TestMCPResult {
  success: boolean
  durationMs: number
  endpoint?: string
  message?: string
}

/**
 * MCP 자가 헬스체크 — 로컬 서버에 initialize 요청을 보내 응답을 검증한다.
 * 환경설정 → MCP "연결 테스트" 버튼이 호출.
 */
export function TestMCPConnection(): Promise<TestMCPResult> {
  return callGo<TestMCPResult>('TestMCPConnection')
}
