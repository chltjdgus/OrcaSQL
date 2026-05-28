import { useEffect, useState } from 'react'
import type { SortingState } from '@tanstack/react-table'
import type { QueryResult } from '@/types'

export interface ContextMenuPos {
  x: number
  y: number
  rowIdx: number
  colIdx: number
}

/**
 * ResultGrid 본체의 우클릭 컨텍스트 메뉴 위치 상태.
 *
 * `result`/`sorting` 변경 시 자동 닫힘 (시각 인덱스가 다른 행을 가리키게
 * 되므로). onContextMenu 이벤트 핸들러는 selection/focus/ctxMenu 4개 도메인을
 * 동시에 갱신하므로 본체 JSX 안에 inline 으로 유지한다.
 */
export function useContextMenu(result: QueryResult, sorting: SortingState) {
  const [ctxMenu, setCtxMenu] = useState<ContextMenuPos | null>(null)

  useEffect(() => {
    setCtxMenu(null)
  }, [result])

  useEffect(() => {
    setCtxMenu(null)
  }, [sorting])

  return { ctxMenu, setCtxMenu }
}
