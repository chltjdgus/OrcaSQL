import { useLanguageStore } from '@/stores/useLanguageStore'
import { t } from '@/i18n'

export default function NoConnMsg() {
  const language = useLanguageStore((s) => s.language)
  return (
    <div className="flex items-center justify-center h-full text-[#4a5568] text-sm">
      {t('noConnectionMsg', language)}
    </div>
  )
}
