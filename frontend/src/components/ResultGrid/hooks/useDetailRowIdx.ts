import { useCallback, useEffect, useState } from 'react'
import type { QueryResult } from '@/types'

/**
 * Row Detail 모달의 시각 인덱스 상태 + prev/next 핸들러.
 * - result 변경 시 자동 닫힘.
 * - prev/next 는 RowDetailModal 의 prop 시그니처(undefined 또는 함수) 와 정확히 일치하도록 분기.
 */
export function useDetailRowIdx({ result, rowCount }: { result: QueryResult; rowCount: number }) {
  const [detailRowIdx, setDetailRowIdx] = useState<number | null>(null)

  useEffect(() => {
    setDetailRowIdx(null)
  }, [result])

  const openDetail = useCallback((rowIdx: number) => setDetailRowIdx(rowIdx), [])
  const closeDetail = useCallback(() => setDetailRowIdx(null), [])

  const prevDetail = detailRowIdx !== null && detailRowIdx > 0
    ? () => setDetailRowIdx((i) => (i ?? 1) - 1)
    : undefined
  const nextDetail = detailRowIdx !== null && detailRowIdx < rowCount - 1
    ? () => setDetailRowIdx((i) => (i ?? 0) + 1)
    : undefined

  return { detailRowIdx, openDetail, closeDetail, prevDetail, nextDetail }
}
