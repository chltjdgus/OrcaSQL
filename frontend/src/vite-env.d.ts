/// <reference types="vite/client" />

// CSS side-effect import 지원 (TypeScript 6.0+ 호환)
declare module '*.css'
declare module '*.scss'
declare module '*.png' {
  const src: string
  export default src
}
