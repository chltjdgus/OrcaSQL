import { useEffect, useState } from 'react'
import { X, Database } from 'lucide-react'
import { GetAppInfo } from '@/wailsjs/go/main/App'
import type { AppInfo } from '@/wailsjs/go/main/App'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * About 다이얼로그.
 * GetAppInfo() 바인딩으로 main.go의 Version 상수를 읽어 표시한다.
 */
export default function AboutDialog({ open, onClose }: Props) {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    GetAppInfo()
      .then(setInfo)
      .catch(() => {
        // 개발 환경 fallback
        setInfo({
          name: 'OrcaSQL',
          version: '0.1.0-dev',
          description: 'Windows · macOS 네이티브 MySQL GUI 클라이언트 — 쿼리 편집기, 결과 그리드 인라인 편집, 스키마 관리, SSH 터널을 한 앱에서.',
          copyright: 'Copyright © 2026',
        })
      })
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* 배경 오버레이 */}
      <div className="absolute inset-0 bg-black/60" />

      {/* 다이얼로그 */}
      <div
        className="relative z-10 w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">OrcaSQL 정보</span>
          <button
            onClick={onClose}
            className="rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* 본문 */}
        <div className="flex flex-col items-center gap-4 px-6 py-8">
          {/* 앱 아이콘 영역 */}
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-accent)]/20 ring-1 ring-[var(--color-accent)]/30">
            <Database size={32} className="text-[var(--color-accent)]" />
          </div>

          {/* 앱 이름 + 버전 */}
          <div className="text-center">
            <p className="text-lg font-bold text-[var(--color-text-primary)]">
              {info?.name ?? 'OrcaSQL'}
            </p>
            <p className="mt-0.5 text-xs font-mono text-[var(--color-accent)]">
              v{info?.version ?? '…'}
            </p>
          </div>

          {/* 설명 */}
          <p className="text-center text-xs leading-relaxed text-[var(--color-text-muted)]">
            {info?.description}
          </p>

          {/* 기술 스택 배지 */}
          <div className="flex flex-wrap justify-center gap-1.5">
            {['Wails v3', 'Go 1.25', 'React 19', 'TypeScript'].map((tech) => (
              <span
                key={tech}
                className="rounded-full bg-[var(--color-border)] px-2.5 py-0.5 text-[10px] text-[var(--color-text-subtle)]"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>

        {/* 푸터 */}
        <div className="border-t border-[var(--color-border)] px-5 py-3 text-center text-[10px] text-[var(--color-null)]">
          {info?.copyright}
        </div>
      </div>
    </div>
  )
}
