// 네이티브 확인 다이얼로그 — WKWebView/WebView2 가 native confirm/alert 를 silently
// 차단하므로 (BugFix-AN, BugFix-BT 참조) 모든 confirm 은 이 헬퍼를 경유한다.
//
// 사용 예:
//   if (await nativeConfirm({ title: t('foo', lang), message: '…', language })) { … }
//
// 기본 OK/Cancel Label 은 i18n 키(`confirmDefaultOk`/`confirmDefaultCancel`) 에서 가져오며,
// 호출자는 호출 시점에 language 만 넘기면 된다. 커스텀 라벨은 옵션으로 override 가능.

import { Dialogs } from '@wailsio/runtime'
import { t, type Language } from '@/i18n'

interface NativeConfirmOptions {
  title: string
  message: string
  language: Language
  okLabel?: string
  cancelLabel?: string
}

export async function nativeConfirm(opts: NativeConfirmOptions): Promise<boolean> {
  const ok = opts.okLabel ?? t('confirmDefaultOk', opts.language)
  const cancel = opts.cancelLabel ?? t('confirmDefaultCancel', opts.language)
  const clicked = await Dialogs.Question({
    Title: opts.title,
    Message: opts.message,
    Buttons: [
      { Label: ok, IsDefault: true },
      { Label: cancel, IsCancel: true },
    ],
  })
  return clicked === ok
}
