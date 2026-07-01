/**
 * 인덱스·FK 플래그 아이콘 — Data 그리드 헤더, Info 키 컬럼, Info IndexesTab 등
 * 인덱스 종류를 표시하는 모든 위치에서 동일한 아이콘 세트를 쓰기 위해 추출.
 *
 * 시각 규칙 (인덱스 4종은 동일 KeyRound + 색상 구분, FK 만 별도 아이콘):
 *   PRIMARY  → KeyRound  size 10 / --color-pk           (gold)
 *   UNIQUE   → KeyRound  size 10 / --color-error        (red)
 *   INDEX    → KeyRound  size 10 / --color-text-subtle  (gray)
 *   FULLTEXT → KeyRound  size 10 / --color-success      (green)
 *   FK       → Link      size 10 / --color-warning      (orange) — 사슬 = 외래 관계
 */
import type { ReactNode } from 'react'
import { KeyRound, Link as LinkIcon } from 'lucide-react'
import { t } from '@/i18n'

export type IndexFlag = 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'FULLTEXT' | 'FK'

interface IconProps {
  flag: IndexFlag
  language?: 'ko' | 'en'
}

/** 단일 플래그 아이콘 — title 은 i18n 적용 */
export function IndexFlagIcon({ flag, language = 'ko' }: IconProps) {
  const entry = renderEntry(flag, language)
  if (!entry) return null
  return <span title={entry.title}>{entry.icon}</span>
}

interface BadgesProps {
  flags: Set<IndexFlag>
  language: 'ko' | 'en'
}

/**
 * 다중 플래그 묶음 — PRIMARY 가 있으면 INDEX 는 숨김 (중복 회피).
 * 여러 아이콘은 `-ml-1.5` 로 살짝 겹쳐서 표시.
 */
export function IndexFlagBadges({ flags, language }: BadgesProps) {
  const ordered: IndexFlag[] = []
  if (flags.has('PRIMARY')) ordered.push('PRIMARY')
  if (flags.has('UNIQUE') && !flags.has('PRIMARY')) ordered.push('UNIQUE')
  // PRIMARY 와 INDEX 가 동시에 설정된 경우 둘 다 표시 — 한 컬럼이 PK 이면서 다른 일반 인덱스에 속할 수 있음
  if (flags.has('INDEX')) ordered.push('INDEX')
  if (flags.has('FULLTEXT')) ordered.push('FULLTEXT')
  if (flags.has('FK')) ordered.push('FK')
  if (ordered.length === 0) return null
  return (
    <span className="osql-index-flag-badges inline-flex items-center shrink-0">
      {ordered.map((f, i) => {
        const e = renderEntry(f, language)
        if (!e) return null
        return (
          <span key={f} title={e.title} className={i === 0 ? '' : '-ml-1.5'}>
            {e.icon}
          </span>
        )
      })}
    </span>
  )
}

function renderEntry(flag: IndexFlag, language: 'ko' | 'en'): { icon: ReactNode; title: string } | null {
  switch (flag) {
    case 'PRIMARY':
      return { icon: <KeyRound size={10} className="text-[var(--color-pk)]" />, title: t('idxPrimary', language) }
    case 'UNIQUE':
      return { icon: <KeyRound size={10} className="text-[var(--color-error)]" />, title: t('idxUnique', language) }
    case 'INDEX':
      return { icon: <KeyRound size={10} className="text-[var(--color-text-subtle)]" />, title: t('idxIndex', language) }
    case 'FULLTEXT':
      return { icon: <KeyRound size={10} className="text-[var(--color-success)]" />, title: t('idxFulltext', language) }
    case 'FK':
      return { icon: <LinkIcon size={10} className="text-[var(--color-warning)]" />, title: t('idxForeign', language) }
    default:
      return null
  }
}
