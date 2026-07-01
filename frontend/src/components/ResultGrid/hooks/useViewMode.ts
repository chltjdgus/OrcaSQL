import { useCallback, useState } from 'react'

/**
 * ResultGrid 의 viewMode('grid'|'form') + FormView 의 현재 행 인덱스 관리.
 * setViewModeForm 호출 시 formRowIdx 를 0 으로 리셋한다.
 */
export function useViewMode() {
  const [viewMode, setViewMode] = useState<'grid' | 'form'>('grid')
  const [formRowIdx, setFormRowIdx] = useState(0)

  const setViewModeGrid = useCallback(() => setViewMode('grid'), [])
  const setViewModeForm = useCallback(() => {
    setViewMode('form')
    setFormRowIdx(0)
  }, [])

  return { viewMode, formRowIdx, setFormRowIdx, setViewModeGrid, setViewModeForm }
}
