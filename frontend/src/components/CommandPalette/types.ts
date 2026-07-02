import type { ReactNode } from 'react'

export type CommandGroup = 'action' | 'connection' | 'database' | 'table'

/**
 * Phase 63: 명령 팔레트의 단일 실행 가능 항목.
 *
 * 액션 항목은 App.tsx 가 기존 콜백을 래핑해 주입하고,
 * 연결/DB/테이블 항목은 CommandPalette 가 store + react-query 캐시에서 파생한다.
 */
export interface CommandItem {
  /** 고유 키 (React key + data-osql-cmd-key). */
  id: string
  /** 표시 라벨 (퍼지 매칭·하이라이트 대상). */
  label: string
  /** 보조 설명 (라벨 우측 회색). */
  detail?: string
  /** 그룹. */
  group: CommandGroup
  /** 라벨 외 추가 검색 키워드 (하이라이트 없이 필터에만 사용). */
  keywords?: string
  /** 좌측 아이콘. */
  icon?: ReactNode
  /** 실행. 팔레트는 실행 직후 자동으로 닫힌다. */
  run: () => void
}
