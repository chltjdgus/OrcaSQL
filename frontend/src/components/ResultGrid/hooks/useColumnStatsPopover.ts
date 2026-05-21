import { useMemo, useRef, useState } from 'react'
import type { ColStats } from '../types'

/**
 * ResultGrid 컬럼 헤더의 통계 팝오버 상태.
 * 헤더 셀 클릭 시 statsColIdx 토글 + anchor 위치 ref 갱신.
 * 팝오버 위치 보정·외부 클릭 닫기는 ColumnStatsPopover.tsx 내부에서 처리.
 */
export function useColumnStatsPopover(localRows: unknown[][]) {
  const [statsColIdx, setStatsColIdx] = useState<number | null>(null)
  const statsPopoverRef = useRef<HTMLDivElement>(null)
  const statsAnchorRef = useRef<{ x: number; y: number; colIdx: number } | null>(null)

  const columnStats = useMemo<ColStats | null>(() => {
    if (statsColIdx === null) return null
    const values = localRows.map((row) => row[statsColIdx])
    const total = values.length
    const nullCount = values.filter((v) => v === null || v === undefined).length
    const nonNull = values.filter((v) => v !== null && v !== undefined)
    const distinctCount = new Set(nonNull.map((v) => String(v))).size
    const fillRate = total > 0 ? ((total - nullCount) / total) * 100 : 0

    // 숫자형 판별
    const numericVals = nonNull.map((v) => Number(v)).filter((n) => !isNaN(n))
    const isNumeric = nonNull.length > 0 && numericVals.length === nonNull.length

    let min: number | null = null, max: number | null = null
    let avg: number | null = null, sum: number | null = null
    if (isNumeric && numericVals.length > 0) {
      min = Math.min(...numericVals)
      max = Math.max(...numericVals)
      sum = numericVals.reduce((a, b) => a + b, 0)
      avg = sum / numericVals.length
    }

    // 상위 5개 값 (빈도)
    const freq = new Map<string, number>()
    nonNull.forEach((v) => {
      const k = String(v)
      freq.set(k, (freq.get(k) ?? 0) + 1)
    })
    const topValues = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    return { total, nullCount, distinctCount, fillRate, isNumeric, min, max, avg, sum, topValues }
  }, [statsColIdx, localRows])

  return {
    statsColIdx,
    setStatsColIdx,
    statsPopoverRef,
    statsAnchorRef,
    columnStats,
  }
}
