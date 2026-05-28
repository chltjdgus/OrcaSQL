/**
 * 글로벌 placeholder 모달 호스트 — App.tsx에 한 번만 마운트.
 * usePlaceholderStore의 pending 상태를 구독해서 어느 실행 경로든 동일한 모달이 뜨도록 한다.
 */
import PlaceholderModal from '@/components/QueryEditor/PlaceholderModal'
import { usePlaceholderStore } from '@/stores/usePlaceholderStore'

export default function PlaceholderModalHost() {
  const pending = usePlaceholderStore((s) => s.pending)
  const close = usePlaceholderStore((s) => s.close)
  const memory = usePlaceholderStore((s) => s.memory)
  const rememberValues = usePlaceholderStore((s) => s.rememberValues)

  if (!pending) return null

  return (
    <PlaceholderModal
      sql={pending.sql}
      groups={pending.groups}
      initialValues={memory.get(pending.tabId)}
      onClose={close}
      onSubmit={(substitutedSql, values) => {
        rememberValues(pending.tabId, values)
        const onResolve = pending.onResolve
        close()
        onResolve(substitutedSql)
      }}
    />
  )
}
