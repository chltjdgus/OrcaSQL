// 앱 전역 Window 확장 — SchemaTree 확장 노드 키를 beforeunload에서 수집하기 위함
interface Window {
  __schemaExpandedKeys?: string[]
  // Monaco Editor 워커 설정
  MonacoEnvironment?: {
    getWorker?: (_moduleId: string, label: string) => Worker
    getWorkerUrl?: (_moduleId: string, label: string) => string
  }
}
