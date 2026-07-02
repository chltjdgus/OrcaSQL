/**
 * 다크/라이트 모드 테마 스토어.
 * localStorage에 persist; HTML root에 data-theme 속성을 토글한다.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light'

interface ThemeState {
  theme: Theme
  toggleTheme: () => void
  setTheme: (t: Theme) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',

      toggleTheme: () => {
        const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
        applyTheme(next)
        set({ theme: next })
      },

      setTheme: (t) => {
        applyTheme(t)
        set({ theme: t })
      },
    }),
    {
      name: 'orcasql-theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme)
      },
    },
  ),
)

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  if (theme === 'light') {
    root.classList.add('light-theme')
  } else {
    root.classList.remove('light-theme')
  }
}
