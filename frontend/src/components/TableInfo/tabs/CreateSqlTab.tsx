/**
 * 16-B — CREATE 코드 탭: SHOW CREATE TABLE 결과 (read-only, Monaco SQL 하이라이트) + 복사 버튼.
 */
import Editor from '@monaco-editor/react'
import { Copy } from 'lucide-react'
import toast from 'react-hot-toast'
import { t } from '@/i18n'
import { useLanguageStore } from '@/stores/useLanguageStore'
import { useTableDesignerStore } from '@/stores/useTableDesignerStore'
import { useThemeStore } from '@/stores/useThemeStore'

export default function CreateSqlTab() {
  const meta = useTableDesignerStore((s) => s.editedMeta)
  const { theme } = useThemeStore()
  const language = useLanguageStore((s) => s.language)
  const isDark = theme === 'dark'
  if (!meta) return null

  const ddl = meta.createStmt || t('createSqlEmpty', language)

  const copyDDL = () => {
    void navigator.clipboard.writeText(ddl)
    toast.success(t('ddlCopied', language))
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">CREATE TABLE DDL</span>
        <button
          onClick={copyDDL}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          <Copy size={10} /> {t('tvCopy', language)}
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <Editor
          language="sql"
          value={ddl}
          theme={isDark ? 'vs-dark' : 'light'}
          options={{
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            padding: { top: 8 },
            renderLineHighlight: 'none',
          }}
        />
      </div>
    </div>
  )
}
