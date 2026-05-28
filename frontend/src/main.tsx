import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import './monacoWorker'
import App from './App'
import './index.css'

// CDN 대신 로컬 번들 Monaco 사용 (Wails WebView2 추적 방지 차단 방지)
loader.config({ monaco })

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

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
