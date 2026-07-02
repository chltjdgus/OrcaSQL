/**
 * 바이트 → 사람이 읽는 크기 문자열 (KB/MB/GB/TB). Phase 65/66 대시보드용.
 *
 * SchemaTree 의 로컬 `formatSize` 와 유사하나, 트리 배지용이 아니라 대시보드용이라
 * 0/음수를 '0 B' 로 표기한다(트리 쪽은 배지 숨김 위해 '' 반환).
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  return `${(bytes / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`
}

/** 정수 천단위 구분 (행수·실행횟수 등). */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('en-US')
}
