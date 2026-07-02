// macOS WKWebView(Wails)는 시스템 "단어 자동 대문자화" 설정에 따라 <input>/<textarea>
// 문장 첫 글자를 자동으로 대문자로 바꾼다. 데스크톱 WebKit 에서는 HTML autocapitalize 속성이
// 무시되므로 autocorrect="off" 를 부여해야 비활성화된다. (Windows WebView2 는 원래 이 동작 없음)
//
// 142개+ 입력에 개별 속성을 다는 대신, DOM 에 추가되는 모든 텍스트 입력에 한 번만 적용한다.

// autocorrect/대문자화 영향을 받지 않는(=처리 불필요) input type 들
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'range',
  'color',
  'file',
  'button',
  'submit',
  'reset',
  'image',
  'hidden',
  'number',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
])

function applyTo(el: Element): void {
  if (el instanceof HTMLTextAreaElement) {
    setNoAutoCapitalize(el)
    return
  }
  if (el instanceof HTMLInputElement) {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    if (NON_TEXT_INPUT_TYPES.has(type)) return
    setNoAutoCapitalize(el)
  }
}

function setNoAutoCapitalize(el: HTMLInputElement | HTMLTextAreaElement): void {
  // 컴포넌트가 명시적으로 지정한 값은 존중 (현재 없음)
  if (!el.hasAttribute('autocorrect')) el.setAttribute('autocorrect', 'off')
  if (!el.hasAttribute('autocapitalize')) el.setAttribute('autocapitalize', 'off')
  if (!el.hasAttribute('spellcheck')) el.setAttribute('spellcheck', 'false')
}

function scan(root: ParentNode): void {
  root.querySelectorAll('input, textarea').forEach(applyTo)
}

/**
 * 앱 전역 자동 대문자화 비활성화. main.tsx 에서 1회 호출.
 * 초기 DOM 스캔 + 이후 동적으로 추가되는 입력까지 MutationObserver 로 처리.
 */
export function installDisableAutoCapitalize(): void {
  scan(document)

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue
        applyTo(node)
        scan(node)
      }
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })
}
