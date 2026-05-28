/**
 * 언어 설정 스토어 (Zustand + persist).
 * OS 언어를 초기값으로 사용하고 localStorage 에 저장한다.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Language } from '@/i18n'

interface LanguageState {
  language: Language
  setLanguage: (l: Language) => void
}

const osLang: Language = navigator.language.startsWith('ko') ? 'ko' : 'en'

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      language: osLang,
      setLanguage: (language) => set({ language }),
    }),
    { name: 'orcasql-language' },
  ),
)
