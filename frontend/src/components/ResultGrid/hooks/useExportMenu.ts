import { useCallback, useState } from 'react'

/** ResultGrid 의 내보내기 드롭다운 메뉴 open/close 상태. */
export function useExportMenu() {
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  const openExportMenu = useCallback(() => setExportMenuOpen(true), [])
  const closeExportMenu = useCallback(() => setExportMenuOpen(false), [])
  const toggleExportMenu = useCallback(() => setExportMenuOpen((v) => !v), [])

  return { exportMenuOpen, openExportMenu, closeExportMenu, toggleExportMenu }
}
