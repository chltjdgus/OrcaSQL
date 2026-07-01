import { useCallback, useState } from 'react'

/**
 * 편집 성공 시 시각 위치 셀 키(`${rowIdx}-${colIdx}`)를 2초간 강조 표시.
 * useInlineEdit 의 onEditSuccess 콜백과 FormView 의 onRowUpdate 양쪽이 동일 setter 를 사용한다.
 */
export function useRecentlyEdited() {
  const [recentlyEdited, setRecentlyEdited] = useState<Set<string>>(new Set())

  const flashRecentlyEdited = useCallback((cellKey: string) => {
    setRecentlyEdited((prev) => new Set(prev).add(cellKey))
    setTimeout(() => {
      setRecentlyEdited((prev) => {
        const n = new Set(prev)
        n.delete(cellKey)
        return n
      })
    }, 2000)
  }, [])

  return { recentlyEdited, flashRecentlyEdited }
}
