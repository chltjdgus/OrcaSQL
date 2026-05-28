import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, X, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { ImportCSVData } from '@/wailsjs/go/main/App'

interface ImportModalProps {
  connId: string
  database: string
  table: string
  onClose: () => void
}

type Delimiter = ',' | '\t' | ';' | '|'

const DELIMITER_OPTIONS: { label: string; value: Delimiter }[] = [
  { label: '쉼표 (,)', value: ',' },
  { label: '탭 (\\t)', value: '\t' },
  { label: '세미콜론 (;)', value: ';' },
  { label: '파이프 (|)', value: '|' },
]

const PREVIEW_ROWS = 5

/**
 * CSV 데이터 임포트 모달.
 * - 파일 선택 또는 드래그 & 드롭으로 .csv/.tsv/.txt 파일 로드
 * - 구분자 선택, 헤더 포함 여부 설정
 * - 상위 5행 미리보기
 * - Import 버튼으로 BATCH INSERT 실행
 */
export default function ImportModal({ connId, database, table, onClose }: ImportModalProps) {
  const [csvContent, setCsvContent] = useState<string>('')
  const [fileName, setFileName] = useState<string>('')
  const [delimiter, setDelimiter] = useState<Delimiter>(',')
  const [hasHeader, setHasHeader] = useState(true)
  const [isDragging, setIsDragging] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number; errors: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 파일 읽기
  function readFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result
      if (typeof text === 'string') {
        setCsvContent(text)
        setFileName(file.name)
        setImportResult(null)
        // 파일명 기반 구분자 자동 감지
        if (file.name.endsWith('.tsv')) setDelimiter('\t')
      }
    }
    reader.readAsText(file, 'UTF-8')
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) readFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) readFile(file)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave() {
    setIsDragging(false)
  }

  // CSV 파싱 (미리보기 전용 — Go로 보내기 전 클라이언트 사이드)
  const parsedPreview = useMemo(() => {
    if (!csvContent) return { headers: [] as string[], rows: [] as string[][] }
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim() !== '')
    const parsed = lines.slice(0, PREVIEW_ROWS + (hasHeader ? 1 : 0)).map((line) => {
      // 간단한 클라이언트 CSV 파싱 (따옴표 처리)
      return parseCSVLine(line, delimiter)
    })
    if (parsed.length === 0) return { headers: [], rows: [] }
    if (hasHeader) {
      return { headers: parsed[0], rows: parsed.slice(1) }
    }
    const colCount = parsed[0].length
    return {
      headers: Array.from({ length: colCount }, (_, i) => `col${i + 1}`),
      rows: parsed,
    }
  }, [csvContent, delimiter, hasHeader])

  const totalLines = useMemo(() => {
    if (!csvContent) return 0
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim() !== '')
    return hasHeader ? Math.max(0, lines.length - 1) : lines.length
  }, [csvContent, hasHeader])

  async function handleImport() {
    if (!csvContent) {
      toast.error('파일을 선택하세요')
      return
    }
    setIsImporting(true)
    setImportResult(null)
    try {
      const result = await ImportCSVData(connId, database, table, csvContent, hasHeader, delimiter)
      setImportResult(result)
      if (result.errors) {
        toast.error(`임포트 부분 완료: ${result.inserted}행 삽입, ${result.skipped}행 실패`)
      } else {
        toast.success(`${result.inserted.toLocaleString()}행 삽입 완료`)
      }
    } catch (e) {
      toast.error(`임포트 실패: ${e}`)
    } finally {
      setIsImporting(false)
    }
  }

  // ESC 키로 닫기
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isImporting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isImporting, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={(e) => { if (e.target === e.currentTarget && !isImporting) onClose() }}>
      <div className="bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded-lg shadow-2xl w-[680px] max-h-[80vh] flex flex-col text-[var(--color-text-primary)]">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
          <div>
            <h2 className="text-sm font-semibold">데이터 가져오기 (CSV)</h2>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
              <span className="text-[var(--color-accent)]">{database}</span>
              <span className="text-[var(--color-null)]"> · </span>
              <span className="text-[var(--color-success)]">{table}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isImporting}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-4">

          {/* 파일 드롭존 */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
              ${isDragging ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5' : 'border-[var(--color-border)] hover:border-[var(--color-null)]'}
              ${csvContent ? 'border-[var(--color-bg-selected)] bg-[var(--color-bg-selected)]/20' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt"
              className="hidden"
              onChange={handleFileChange}
            />
            {csvContent ? (
              <div className="flex flex-col items-center gap-1">
                <CheckCircle2 size={20} className="text-[var(--color-success)]" />
                <p className="text-sm text-[var(--color-text-primary)] font-medium">{fileName}</p>
                <p className="text-[10px] text-[var(--color-text-muted)]">{totalLines.toLocaleString()}행 감지됨 (헤더 {hasHeader ? '포함' : '미포함'})</p>
                <p className="text-[10px] text-[var(--color-accent)] mt-1">다른 파일을 선택하려면 클릭하세요</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload size={24} className="text-[var(--color-null)]" />
                <p className="text-sm text-[var(--color-text-muted)]">CSV 파일을 드롭하거나 클릭하여 선택</p>
                <p className="text-[10px] text-[var(--color-null)]">.csv / .tsv / .txt 지원</p>
              </div>
            )}
          </div>

          {/* 옵션 */}
          <div className="flex items-center gap-6">
            {/* 구분자 */}
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-[var(--color-text-muted)] whitespace-nowrap">구분자</label>
              <select
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value as Delimiter)}
                className="bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded text-[11px] text-[var(--color-text-primary)] px-2 py-1 focus:outline-none focus:border-[var(--color-accent)]"
              >
                {DELIMITER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* 헤더 포함 여부 */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              <span className="text-[11px] text-[var(--color-text-primary)]">첫 행을 컬럼명으로 사용</span>
            </label>
          </div>

          {/* 미리보기 */}
          {parsedPreview.headers.length > 0 && (
            <div>
              <p className="text-[10px] text-[var(--color-text-muted)] mb-1.5">미리보기 (최대 {PREVIEW_ROWS}행)</p>
              <div className="overflow-x-auto rounded border border-[var(--color-border)]">
                <table className="text-[10px] w-full">
                  <thead>
                    <tr className="bg-[var(--color-bg-deep)]">
                      {parsedPreview.headers.map((h, i) => (
                        <th key={i} className="px-2 py-1.5 text-left text-[var(--color-accent)] font-medium border-b border-[var(--color-border)] whitespace-nowrap max-w-[120px] truncate">
                          {h || `(빈 컬럼)`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedPreview.rows.map((row, ri) => (
                      <tr key={ri} className="border-b border-[var(--color-bg-tertiary)] last:border-0">
                        {parsedPreview.headers.map((_, ci) => (
                          <td key={ci} className="px-2 py-1 text-[var(--color-text-subtle)] max-w-[120px] truncate">
                            {row[ci] ?? <span className="text-[var(--color-null)]">NULL</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 임포트 결과 */}
          {importResult && (
            <div className={`rounded p-3 text-[11px] flex items-start gap-2
              ${importResult.errors ? 'bg-[var(--color-error)]/10 border border-[var(--color-error)]/30' : 'bg-[var(--color-success)]/10 border border-[var(--color-success)]/30'}`}
            >
              {importResult.errors
                ? <AlertCircle size={14} className="text-[var(--color-error)] mt-0.5 shrink-0" />
                : <CheckCircle2 size={14} className="text-[var(--color-success)] mt-0.5 shrink-0" />
              }
              <div>
                <p className={importResult.errors ? 'text-[var(--color-error)]' : 'text-[var(--color-success)]'}>
                  {importResult.inserted.toLocaleString()}행 삽입
                  {importResult.skipped > 0 && ` · ${importResult.skipped.toLocaleString()}행 건너뜀`}
                </p>
                {importResult.errors && (
                  <p className="text-[var(--color-error)]/80 mt-0.5 text-[10px]">{importResult.errors}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 푸터 버튼 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border)] shrink-0">
          <button
            onClick={onClose}
            disabled={isImporting}
            className="px-3 py-1.5 text-[11px] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] transition-colors disabled:opacity-40"
          >
            {importResult ? '닫기' : '취소'}
          </button>
          <button
            onClick={handleImport}
            disabled={!csvContent || isImporting}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isImporting ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                임포트 중...
              </>
            ) : (
              <>
                <Upload size={11} />
                {totalLines > 0 ? `${totalLines.toLocaleString()}행 임포트` : '임포트'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 클라이언트 사이드 CSV 라인 파서 (미리보기 전용) ──────────────────────

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}
