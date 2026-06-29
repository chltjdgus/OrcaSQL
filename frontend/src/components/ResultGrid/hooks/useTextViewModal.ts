import { useCallback, useState } from 'react'

/** ResultGrid 의 "전체 텍스트 보기" 모달 상태. CellValue 가 onExpand 로 트리거. */
export interface TextViewState {
  content: string
  colName: string
}

export function useTextViewModal() {
  const [viewingText, setViewingText] = useState<TextViewState | null>(null)

  const openTextView = useCallback((content: string, colName: string) => {
    setViewingText({ content, colName })
  }, [])

  const closeTextView = useCallback(() => setViewingText(null), [])

  return { viewingText, openTextView, closeTextView }
}
