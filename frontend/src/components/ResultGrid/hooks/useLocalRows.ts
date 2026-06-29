import { useEffect, useState } from 'react'
import type { QueryResult } from '@/types'

/**
 * ResultGrid 본체의 `localRows` (편집·삭제·삽입 결과를 즉시 반영하는 클라이언트
 * 측 행 사본) 상태를 관리한다. `result` 가 바뀌면 새 행으로 재초기화.
 *
 * 외부 [result] reset useEffect 도 본체에 남아있지만 그쪽은 다른 도메인
 * (editingCell·columnVisibility·columnPinning·newRow·insertAfterRowIdx) 의
 * 잔여 reset 책임만 가짐 — Wave 2c/2d 에서 분해 예정.
 */
export function useLocalRows(result: QueryResult) {
  const [localRows, setLocalRows] = useState<unknown[][]>(() => [...(result.rows ?? [])])

  useEffect(() => {
    setLocalRows([...(result.rows ?? [])])
  }, [result])

  return { localRows, setLocalRows }
}
