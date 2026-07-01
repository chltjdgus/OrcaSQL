/**
 * @wailsio/runtime 타입 선언.
 *
 * 실제 모듈은 npm 패키지가 아니라 wails3 dev / wails3 build 실행 시
 * Wails가 가상 모듈로 주입한다. vite.config.ts 의 external 에 등록되어
 * 번들에서 제외되며, 런타임에서 Wails가 직접 제공한다.
 */
declare module '@wailsio/runtime' {
  /** Go 메서드 호출 인터페이스 */
  export interface CallInterface {
    /** 메서드 이름으로 호출. 형식: "ServiceName.MethodName" (예: "App.SaveConnection") */
    ByName(name: string, ...args: unknown[]): Promise<unknown>
    /** 메서드 ID(숫자 해시)로 호출. 자동 생성 바인딩(bindings/)에서 사용 */
    ByID(id: number, ...args: unknown[]): Promise<unknown>
  }

  export const Call: CallInterface

  /** CancellablePromise — 자동 생성 바인딩 호환용 */
  export type CancellablePromise<T> = Promise<T>

  /** Create — 자동 생성 바인딩 호환용 (모델 인스턴스 생성) */
  export const Create: {
    (ctor: new (...args: unknown[]) => unknown, source?: object): unknown
  }

  /** 네이티브 다이얼로그 — WKWebView/WebView2 가 native confirm/alert 를 차단하므로 이쪽을 사용해야 함 */
  export interface DialogButton {
    Label?: string
    IsCancel?: boolean
    IsDefault?: boolean
  }
  export interface MessageDialogOptions {
    Title?: string
    Message?: string
    Buttons?: DialogButton[]
    Detached?: boolean
  }
  export const Dialogs: {
    /** 클릭한 버튼의 Label 을 resolve. 닫힘/취소 시 빈 문자열 또는 IsCancel 버튼 Label */
    Question(options: MessageDialogOptions): Promise<string>
    Info(options: MessageDialogOptions): Promise<string>
    Warning(options: MessageDialogOptions): Promise<string>
    Error(options: MessageDialogOptions): Promise<string>
  }
}

