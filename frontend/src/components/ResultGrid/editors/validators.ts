import { t, type Language } from '@/i18n'

export interface ValidationResult {
  ok: boolean
  /** ok=false 일 때만 의미 있음. 사용자 표시용 에러 메시지 */
  error?: string
}

const ok: ValidationResult = { ok: true }

const INT_TYPES = new Set(['INT', 'BIGINT', 'SMALLINT', 'MEDIUMINT', 'TINYINT', 'INTEGER'])
const FLOAT_TYPES = new Set(['DECIMAL', 'FLOAT', 'DOUBLE', 'NUMERIC', 'REAL'])

/**
 * 클라이언트 측 타입 검증 — Wails 호출 직전에 사용자 실수를 막기 위함.
 * 최종 검증은 MySQL 엔진이 수행하지만, 왕복 전에 명백한 오류를 차단한다.
 *
 * 빈 문자열과 NULL은 upstream에서 처리(setNull 분기 / PK 분기)하므로 통과.
 */
export function validateCellValue(
  value: string,
  colType: string,
  options: {
    nullable: boolean
    isNull: boolean
    enumValues?: string[]
    language: Language
  },
): ValidationResult {
  const { isNull, enumValues, language } = options

  if (isNull) return ok // NULL은 setNull 경로에서 nullable 검증됨
  if (value === '') return ok // 빈 값 = DB 기본값 (INSERT) 또는 빈 문자열 (UPDATE)

  const upper = colType.toUpperCase()

  // ── 정수형 ──────────────────────────────────────────────────────────────
  if (INT_TYPES.has(upper)) {
    if (!/^-?\d+$/.test(value.trim())) {
      return { ok: false, error: t('validateInt', language) }
    }
    return ok
  }

  // ── 실수형 ──────────────────────────────────────────────────────────────
  if (FLOAT_TYPES.has(upper)) {
    if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value.trim())) {
      return { ok: false, error: t('validateNumeric', language) }
    }
    return ok
  }

  // ── 날짜/시간 ───────────────────────────────────────────────────────────
  if (upper === 'DATE') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      return { ok: false, error: t('validateDate', language) }
    }
    return ok
  }
  if (upper === 'DATETIME' || upper === 'TIMESTAMP') {
    // "YYYY-MM-DD HH:MM:SS" 또는 "YYYY-MM-DDTHH:MM:SS" (+ 선택적 분수 초)
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value.trim())) {
      return { ok: false, error: t('validateDateTime', language) }
    }
    return ok
  }
  if (upper === 'TIME') {
    // "HH:MM:SS" 또는 "HH:MM" (MySQL은 -838:59:59 ~ 838:59:59 범위 허용)
    if (!/^-?\d{1,3}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value.trim())) {
      return { ok: false, error: t('validateTime', language) }
    }
    return ok
  }
  if (upper === 'YEAR') {
    const n = Number(value.trim())
    if (!Number.isInteger(n) || n < 1901 || n > 2155) {
      return { ok: false, error: t('validateYear', language) }
    }
    return ok
  }

  // ── BIT / BOOLEAN ───────────────────────────────────────────────────────
  if (upper === 'BIT' || upper === 'BOOLEAN' || upper === 'BOOL') {
    const v = value.trim().toLowerCase()
    if (!['0', '1', 'true', 'false'].includes(v)) {
      return { ok: false, error: t('validateBoolean', language) }
    }
    return ok
  }

  // ── ENUM ────────────────────────────────────────────────────────────────
  if (upper === 'ENUM') {
    if (enumValues && enumValues.length > 0 && !enumValues.includes(value)) {
      return {
        ok: false,
        error: language === 'ko'
          ? `허용되지 않은 ENUM 값 — 사용 가능: ${enumValues.join(', ')}`
          : `Invalid ENUM value — allowed: ${enumValues.join(', ')}`,
      }
    }
    return ok
  }

  // ── SET ─────────────────────────────────────────────────────────────────
  if (upper === 'SET') {
    if (enumValues && enumValues.length > 0) {
      const parts = value.split(',').map((p) => p.trim()).filter(Boolean)
      const invalid = parts.filter((p) => !enumValues.includes(p))
      if (invalid.length > 0) {
        return {
          ok: false,
          error: language === 'ko'
            ? `허용되지 않은 SET 값: ${invalid.join(', ')} — 사용 가능: ${enumValues.join(', ')}`
            : `Invalid SET values: ${invalid.join(', ')} — allowed: ${enumValues.join(', ')}`,
        }
      }
    }
    return ok
  }

  // ── JSON ────────────────────────────────────────────────────────────────
  if (upper === 'JSON') {
    try {
      JSON.parse(value)
      return ok
    } catch {
      return { ok: false, error: t('validateJson', language) }
    }
  }

  // CHAR / VARCHAR / TEXT / BLOB 계열 — 클라이언트 검증 없음
  return ok
}
