import { Dialogs } from '@wailsio/runtime'
import { t, type Language } from '@/i18n'

/**
 * WKWebView/WebView2 가 native `window.confirm` 을 silently 차단하므로 Wails
 * 네이티브 다이얼로그로 우회 (BugFix-AN/BT 패턴). Confirm 버튼 클릭 시 true,
 * 그 외(취소·닫기) false.
 *
 * Phase 47 (Wave 2c) 에서 `useRowDeletion` hook 과 본체 JSX(헤더 삭제 버튼·
 * 컨텍스트 메뉴 onDeleteSelected) 양쪽이 공유하도록 별도 파일로 분리.
 */
export async function confirmRowDelete(count: number, language: Language): Promise<boolean> {
  const message = count <= 1
    ? t('gridDeleteRowsBodySingular', language)
    : t('gridDeleteRowsBodyPluralKo', language).replace('{n}', String(count))
  const okLabel = t('gridDeleteRowsConfirm', language)
  const cancelLabel = t('gridDeleteRowsCancel', language)
  const clicked = await Dialogs.Question({
    Title: t('gridDeleteRowsTitle', language),
    Message: message,
    Buttons: [
      { Label: okLabel, IsDefault: true },
      { Label: cancelLabel, IsCancel: true },
    ],
  })
  return clicked === okLabel
}
