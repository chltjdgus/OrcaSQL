import type { ColumnMeta } from '@/types'
import { DateTimeEditor } from './DateTimeEditor'
import { BooleanEditor } from './BooleanEditor'
import { NumericEditor } from './NumericEditor'
import { EnumEditor } from './EnumEditor'
import { SetEditor } from './SetEditor'
import { TextAreaEditor } from './TextAreaEditor'

/** 모든 타입별 에디터가 구현하는 공통 Props */
export interface CellEditorProps {
  value: string
  isNull: boolean
  onChange: (value: string) => void
  onSetNull: () => void
  onConfirm: () => void
  onCancel: () => void
  disabled?: boolean
  columnMeta: ColumnMeta
  nullable: boolean
  mode: 'inline' | 'form'
  /** 인라인 모드에서 팝오버 위치 계산용 (td의 getBoundingClientRect) */
  anchorRect?: DOMRect
  /** ENUM/SET 컬럼의 허용 값 목록 (columnType 파싱 결과) */
  enumValues?: string[]
}

const DATETIME_TYPES = new Set(['DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR'])
const NUMERIC_TYPES = new Set([
  'INT', 'BIGINT', 'SMALLINT', 'MEDIUMINT', 'TINYINT',
  'DECIMAL', 'FLOAT', 'DOUBLE', 'NUMERIC',
])
const LONG_TEXT_TYPES = new Set(['TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYTEXT', 'JSON', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB'])

/** 컬럼 타입 문자열을 기반으로 적절한 에디터 컴포넌트를 반환.
 *
 *  반환 우선순위:
 *  - DATETIME 계열 → DateTimeEditor (팝오버 + date picker)
 *  - BIT/BOOL → BooleanEditor (인라인 토글)
 *  - ENUM/SET → EnumEditor/SetEditor (팝오버 선택)
 *  - TEXT/JSON/BLOB 등 긴 문자열 → TextAreaEditor (팝오버 multi-line)
 *  - INT/FLOAT/DECIMAL 등 수치 → NumericEditor (인라인 + 스피너)
 *  - 그 외 일반 텍스트 (VARCHAR/CHAR/BINARY/VARBINARY 등) → TextAreaEditor (BugFix-CQ) */
export function getCellEditor(colType: string): React.ComponentType<CellEditorProps> {
  const upper = colType.toUpperCase()

  if (DATETIME_TYPES.has(upper)) return DateTimeEditor
  if (upper === 'BIT' || upper === 'BOOLEAN' || upper === 'BOOL') return BooleanEditor
  if (upper === 'ENUM') return EnumEditor
  if (upper === 'SET') return SetEditor
  if (LONG_TEXT_TYPES.has(upper)) return TextAreaEditor
  if (NUMERIC_TYPES.has(upper)) return NumericEditor

  // VARCHAR/CHAR/BINARY/VARBINARY 및 미인식 타입은 별도 수정창(TextAreaEditor) 사용
  return TextAreaEditor
}

export { DateTimeEditor, BooleanEditor, NumericEditor, EnumEditor, SetEditor, TextAreaEditor }
