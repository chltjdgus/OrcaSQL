import { create } from 'zustand'

/**
 * Phase 63: 명령 팔레트(Command Palette) 오픈 상태.
 *
 * 트리거(window 단축키 `useGlobalShortcuts` + Monaco `addCommand`)와
 * 렌더(App.tsx 의 `<CommandPalette>`)의 결합을 최소화하기 위한 얇은 컨테이너.
 */
interface CommandPaletteStore {
  open: boolean
  openPalette: () => void
  closePalette: () => void
  toggle: () => void
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  open: false,
  openPalette: () => set({ open: true }),
  closePalette: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
}))
