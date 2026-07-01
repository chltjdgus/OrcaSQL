import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import './monacoWorker'
import App from './App'
import './index.css'
import { installDisableAutoCapitalize } from './utils/disableAutoCapitalize'
// Phase 61: 세션 단위 캐싱 정책을 담은 공용 QueryClient 싱글턴.
// store(비-React) 에서도 동일 인스턴스를 import 해 캐시를 조작한다.
import { queryClient } from './lib/queryClient'

// CDN 대신 로컬 번들 Monaco 사용 (Wails WebView2 추적 방지 차단 방지)
loader.config({ monaco })

// macOS WKWebView 의 입력 첫 글자 자동 대문자화 비활성화 (앱 전역)
installDisableAutoCapitalize()

const root = document.getElementById('root')
if (!root) throw new Error('#root element not found')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#1e2230',
            color: '#e2e8f0',
            border: '1px solid #2d3748',
            fontSize: '13px',
          },
          success: { iconTheme: { primary: '#68d391', secondary: '#1e2230' } },
          error: { iconTheme: { primary: '#fc8181', secondary: '#1e2230' } },
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
)
