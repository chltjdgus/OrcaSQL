/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // @wailsio/runtime + Monaco 포함 시 번들이 커지므로 limit 상향
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // id 경로 기반으로 monaco-editor 코드를 별도 청크로 분리
        manualChunks(id) {
          if (id.includes('node_modules/monaco-editor')) return 'monaco-editor'
          if (id.includes('node_modules/@wailsio')) return 'wails-runtime'
        },
      },
    },
  },
  // Wails v3 dev server: Taskfile.yml 의 VITE_PORT (기본 9245) 와 일치해야 함.
  // host 를 IPv4 로 고정 — Vite 8 + Node 18+ 가 dual-stack lookup 으로 IPv6 우선 바인딩하면
  // Wails ExternalAssetHandler 의 `dial tcp4 127.0.0.1:9245` 가 거부됨.
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_PORT) || 9245,
    strictPort: true,
  },
  // Monaco Editor worker 사전 번들링
  optimizeDeps: {
    include: [
      'monaco-editor/esm/vs/editor/editor.worker',
      'monaco-editor/esm/vs/language/json/json.worker',
      'monaco-editor/esm/vs/language/css/css.worker',
      'monaco-editor/esm/vs/language/typescript/ts.worker',
    ],
  },
  worker: {
    format: 'es',
  },
  // BugFix-CA: vitest 단위 테스트 환경 — happy-dom (jsdom 보다 가벼움), DOM API 가 필요한
  // React 컴포넌트도 mount 가능. setup.ts 에서 jest-dom matcher 등록.
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // wails 가상 모듈 + Wails 자동생성 바인딩은 스텁으로 대체
    alias: {
      '@wailsio/runtime': path.resolve(__dirname, './src/test/stubs/wailsio-runtime.ts'),
      '@/wailsjs/go/main/App': path.resolve(__dirname, './src/test/stubs/wailsjs-app.ts'),
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/wailsjs/**', 'src/test/**', 'src/types/**', '**/*.d.ts'],
    },
  },
})
