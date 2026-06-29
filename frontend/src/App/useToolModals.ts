import { useCallback, useState } from 'react'

/**
 * App.tsx 의 도구 모달 11개의 show-state + Settings 의 initialTab + openSettings 헬퍼를 한 곳에 모은 hook.
 *
 * 단순 useState 11쌍을 묶기만 한 컨테이너로, 호출부의 시그니처(setShow*(true|false|(v)=>!v))는 변경 없음.
 * 본체 `App()` 함수의 잡음을 줄이고, 후속 Wave(useGlobalShortcuts/useSessionRestore) 가 모달 토글에 의존할 때
 * 단일 hook 만 주입받으면 되도록 통합한다.
 */
export function useToolModals() {
  const [showHistory, setShowHistory] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  const [showProcessList, setShowProcessList] = useState(false)
  const [showServerVars, setShowServerVars] = useState(false)
  const [showUserManager, setShowUserManager] = useState(false)
  const [showDataSync, setShowDataSync] = useState(false)
  const [showBackup, setShowBackup] = useState(false)
  const [showSchemaSync, setShowSchemaSync] = useState(false)
  const [showDataSearch, setShowDataSearch] = useState(false)
  const [showERDiagram, setShowERDiagram] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined)

  /** Settings 다이얼로그를 (선택적으로 특정 탭으로) 연다. */
  const openSettings = useCallback((tab?: string) => {
    setSettingsInitialTab(tab)
    setShowSettings(true)
  }, [])

  return {
    showHistory, setShowHistory,
    showFavorites, setShowFavorites,
    showProcessList, setShowProcessList,
    showServerVars, setShowServerVars,
    showUserManager, setShowUserManager,
    showDataSync, setShowDataSync,
    showBackup, setShowBackup,
    showSchemaSync, setShowSchemaSync,
    showDataSearch, setShowDataSearch,
    showERDiagram, setShowERDiagram,
    showSettings, setShowSettings,
    settingsInitialTab,
    openSettings,
  }
}
