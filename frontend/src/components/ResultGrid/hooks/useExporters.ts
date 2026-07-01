import { useCallback } from 'react'
import toast from 'react-hot-toast'
import type { QueryResult } from '@/types'
import { t, type Language } from '@/i18n'

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface Params {
  result: QueryResult
  /** copyToClipboard 에서 NULL 셀을 표시할 문자열 (useSettingsStore display.nullDisplayText) */
  nullText: string
  /** toast 메시지 i18n 용 (BugFix-CI). */
  language: Language
  /** 내보내기 메뉴 닫기 콜백 (copyToClipboard 는 호출하지 않음) */
  onComplete: () => void
}

/**
 * ResultGrid 의 데이터 내보내기 5종(CSV / JSON / SQL INSERT / Excel / 클립보드 복사).
 * toast 문자열은 i18n (gridExport*Done / gridExportExcelFallback / gridClipboardCopied) — BugFix-CI.
 */
export function useExporters({ result, nullText, language, onComplete }: Params) {
  const exportCSV = useCallback(() => {
    const header = result.columns.map((c) => c.name).join(',')
    const body = result.rows
      .map((row) => row.map((cell) => (cell === null ? '' : `"${String(cell).replace(/"/g, '""')}"`)).join(','))
      .join('\n')
    downloadBlob(`${header}\n${body}`, 'result.csv', 'text/csv;charset=utf-8;')
    toast.success(t('gridExportCsvDone', language))
    onComplete()
  }, [result, language, onComplete])

  const exportJSON = useCallback(() => {
    const cols = result.columns.map((c) => c.name)
    const records = result.rows.map((row) => {
      const obj: Record<string, unknown> = {}
      row.forEach((val, i) => { obj[cols[i]] = val })
      return obj
    })
    downloadBlob(JSON.stringify(records, null, 2), 'result.json', 'application/json')
    toast.success(t('gridExportJsonDone', language))
    onComplete()
  }, [result, language, onComplete])

  const exportSQL = useCallback(() => {
    const tableName = 'result_table'
    const cols = result.columns.map((c) => `\`${c.name}\``).join(', ')
    const rows = result.rows
      .map((row) => {
        const vals = row.map((cell) => {
          if (cell === null) return 'NULL'
          if (typeof cell === 'number') return String(cell)
          return `'${String(cell).replace(/'/g, "''")}'`
        }).join(', ')
        return `(${vals})`
      })
      .join(',\n')
    const sql = `INSERT INTO \`${tableName}\` (${cols})\nVALUES\n${rows};`
    downloadBlob(sql, 'result.sql', 'text/plain;charset=utf-8;')
    toast.success(t('gridExportSqlDone', language))
    onComplete()
  }, [result, language, onComplete])

  const exportExcel = useCallback(() => {
    const cols = result.columns.map((c) => c.name)
    const data = [cols, ...result.rows.map((r) => r.map((v) => v ?? ''))]
    if (typeof window !== 'undefined' && (window as unknown as { XLSX?: unknown }).XLSX) {
      const XLSX = (window as unknown as { XLSX: { utils: { aoa_to_sheet: (d: unknown[][]) => unknown; book_new: () => unknown; book_append_sheet: (wb: unknown, ws: unknown, name: string) => void }; writeFile: (wb: unknown, name: string) => void } }).XLSX
      const ws = XLSX.utils.aoa_to_sheet(data)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Result')
      XLSX.writeFile(wb, 'result.xlsx')
      toast.success(t('gridExportExcelDone', language))
    } else {
      exportCSV()
      toast(t('gridExportExcelFallback', language), { icon: 'ℹ️' })
    }
    onComplete()
  }, [result, language, onComplete, exportCSV])

  const copyToClipboard = useCallback(() => {
    const header = result.columns.map((c) => c.name).join('\t')
    const body = result.rows.map((row) => row.map((cell) => (cell === null ? nullText : String(cell))).join('\t')).join('\n')
    navigator.clipboard.writeText(`${header}\n${body}`)
    toast.success(t('gridClipboardCopied', language))
  }, [result, nullText, language])

  return { exportCSV, exportJSON, exportSQL, exportExcel, copyToClipboard }
}
