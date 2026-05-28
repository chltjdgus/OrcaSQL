import React, { useCallback, useEffect, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { t, type Language } from '@/i18n'
import type { QueryResult } from '@/types'
import { validateCellValue } from './editors/validators'
import {
  NEW_ROW_DATETIME_TYPES,
  NEW_ROW_LONG_TEXT_TYPES,
  NEW_ROW_NUMERIC_TYPES,
  NULL_SENTINEL,
  ROW_HEIGHT,
  type TableSchemaMeta,
} from './types'

// ─── 신규 행 행(`<tr>`) 렌더 헬퍼 ────────────────────────────────────────
// 가상 스크롤 중간(특정 행 아래)과 그리드 맨 아래 두 위치에서 동일하게 사용.

interface RenderNewRowTrArgs {
  result: QueryResult
  newRow: Record<string, string>
  setNewRow: React.Dispatch<React.SetStateAction<Record<string, string> | null>>
  isInserting: boolean
  confirmInsert: () => void
  effectiveColType: (colName: string, fallback: string) => string
  getEnumValues: (colName: string) => string[]
  schemaMeta: TableSchemaMeta | null
  setInsertAfterRowIdx: (idx: number | null) => void
  language: Language
}

export function renderNewRowTr(args: RenderNewRowTrArgs) {
  const { result, newRow, setNewRow, isInserting, confirmInsert,
    effectiveColType, getEnumValues, schemaMeta, setInsertAfterRowIdx, language } = args
  const cancel = () => { setNewRow(null); setInsertAfterRowIdx(null) }
  const setVal = (colName: string, v: string) =>
    setNewRow((prev) => prev ? { ...prev, [colName]: v } : null)

  // 컬럼별 타입/메타/검증 사전 계산 — render 중 한 번만
  const cells = result.columns.map((col) => {
    const effType = effectiveColType(col.name, col.type)
    const enumVals = (effType === 'ENUM' || effType === 'SET') ? getEnumValues(col.name) : []
    const colInfo = schemaMeta?.columns.get(col.name)
    const nullable = colInfo ? colInfo.nullable : col.nullable
    const isAutoInc = !!colInfo && colInfo.extra.toLowerCase().includes('auto_increment')
    const hasDefault = !!colInfo && colInfo.default !== ''
    // 필수 = NOT NULL && AUTO_INCREMENT 아님 && DB 기본값 없음
    const required = !nullable && !isAutoInc && !hasDefault
    const raw = newRow[col.name] ?? ''
    const isNull = raw === NULL_SENTINEL

    let invalid = false
    let invalidReason: string | undefined

    if (required && raw === '') {
      invalid = true
      invalidReason = t('newRowRequiredField', language)
    } else if (!isNull && raw !== '') {
      const v = validateCellValue(raw, effType, {
        nullable,
        isNull: false,
        enumValues: (effType === 'ENUM' || effType === 'SET') ? enumVals : undefined,
        language,
      })
      if (!v.ok) {
        invalid = true
        invalidReason = v.error
      }
    }

    return { col, effType, enumVals, nullable, required, invalid, invalidReason }
  })

  const hasInvalid = cells.some((c) => c.invalid)

  return (
    <tr
      key="osql-new-row"
      data-osql-newrow
      style={{ height: ROW_HEIGHT }}
      className="osql-new-row bg-[var(--color-bg-tertiary)]/70 ring-1 ring-inset ring-[var(--color-accent)]/40"
    >
      {/* # 컬럼 자리 — 저장/취소 버튼 + 단축키 안내 */}
      <td className="w-10 p-0 border-b border-r border-[var(--color-bg-tertiary)] select-none">
        <div
          className="flex items-center justify-center gap-0.5 h-full"
          title={t('newRowShortcutHint', language)}
        >
          <button
            type="button"
            onClick={() => void confirmInsert()}
            disabled={isInserting || hasInvalid}
            title={t('newRowInsertBtnTitle', language)}
            className="osql-new-row-save flex items-center justify-center w-4 h-4 rounded text-[var(--color-success)] hover:bg-[var(--color-success)]/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={11} />
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={isInserting}
            title={t('newRowCancelBtnTitle', language)}
            className="osql-new-row-cancel flex items-center justify-center w-4 h-4 rounded text-[var(--color-error)] hover:bg-[var(--color-error)]/20 disabled:opacity-30 transition-colors"
          >
            <X size={11} />
          </button>
        </div>
      </td>
      {cells.map(({ col, effType, enumVals, nullable, required, invalid, invalidReason }, i) => (
        <td
          key={col.name}
          className="p-0 border-b border-r border-[var(--color-bg-tertiary)] relative"
          data-osql-newrow-cell={col.name}
        >
          {/* 필수 필드 표식 — 좌상단 작은 점 (붉은색) */}
          {required && (
            <span
              aria-hidden
              title={t('newRowRequiredField', language)}
              className="absolute top-0 left-0 z-[1] w-1.5 h-1.5 m-0.5 rounded-full bg-red-500/80 pointer-events-none"
            />
          )}
          <NewRowCell
            colName={col.name}
            colType={effType}
            value={newRow[col.name] ?? ''}
            nullable={nullable}
            enumValues={enumVals}
            disabled={isInserting}
            autoFocus={i === 0}
            invalid={invalid}
            invalidReason={invalidReason}
            onChange={(v) => setVal(col.name, v)}
            onSetNull={() => setVal(col.name, NULL_SENTINEL)}
            onConfirm={() => void confirmInsert()}
            onCancel={cancel}
          />
        </td>
      ))}
    </tr>
  )
}

// ─── 신규 행 — 컬럼 타입별 입력 ──────────────────────────────────────────
// 셀 인라인 편집(getCellEditor)과 동일한 타입 분기를 쓰되, 신규 행 UI 는 항상
// 모든 셀이 입력 가능 상태이므로 onBlur=커밋 / 자동포커스(showPicker) 사이드이펙트
// 없이 직접 컨트롤된 입력만 렌더한다.

interface NewRowCellProps {
  colName: string
  colType: string
  value: string
  nullable: boolean
  enumValues: string[]
  disabled?: boolean
  autoFocus?: boolean
  /** true 면 셀 전체에 빨간 ring 표시 (필수 누락 또는 타입 불일치) */
  invalid?: boolean
  /** invalid=true 일 때 title 로 노출할 사용자 친화 메시지 */
  invalidReason?: string
  onChange: (v: string) => void
  onSetNull: () => void
  onConfirm: () => void
  onCancel: () => void
}

export default function NewRowCell({
  colName,
  colType,
  value,
  nullable,
  enumValues,
  disabled,
  autoFocus,
  invalid,
  invalidReason,
  onChange,
  onSetNull,
  onConfirm,
  onCancel,
}: NewRowCellProps) {
  const isNull = value === NULL_SENTINEL
  const upper = (colType || '').toUpperCase()
  const focusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (autoFocus) focusRef.current?.focus()
  }, [autoFocus])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onConfirm() }
    if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onSetNull()
    }
  }, [onConfirm, onCancel, onSetNull])

  // 공통 클래스:
  //   - focus:ring-2 — input/select/button 어디서든 포커스 시각화 (Tab 이동 가시성)
  //   - invalid 시 빨간 ring + 빨간 border (필수 누락·타입 불일치)
  const stateCls = invalid
    ? 'border-red-500 ring-2 ring-red-500/70 focus:ring-red-500'
    : isNull
      ? 'border-[var(--color-null)] italic text-[var(--color-text-muted)] focus:ring-2 focus:ring-[var(--color-accent)]'
      : 'border-[var(--color-accent)] focus:border-[var(--color-accent-light)] text-[var(--color-text-primary)] focus:ring-2 focus:ring-[var(--color-accent)]'
  const baseCls = `w-full h-full px-2 bg-[var(--color-bg-tertiary)] text-xs outline-none ring-inset border-b-2 ${stateCls} disabled:opacity-50`
  const titleAttr = invalidReason || undefined

  // ENUM
  if (upper === 'ENUM' && enumValues.length > 0) {
    const NULL_OPT = NULL_SENTINEL
    return (
      <select
        ref={focusRef as React.RefObject<HTMLSelectElement>}
        value={isNull ? NULL_OPT : value}
        onChange={(e) => {
          const v = e.target.value
          if (v === NULL_OPT) onSetNull()
          else onChange(v)
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
        className={baseCls}
        title={titleAttr}
        style={{ height: ROW_HEIGHT }}
      >
        {/* 빈 값(컬럼 기본값/AUTO_INCREMENT 위임) */}
        <option value="">{`(${colName})`}</option>
        {nullable && <option value={NULL_OPT}>NULL</option>}
        {!isNull && value && !enumValues.includes(value) && <option value={value}>{value}</option>}
        {enumValues.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    )
  }

  // BOOLEAN / BIT(1) / TINYINT(1)
  if (upper === 'BIT' || upper === 'BOOLEAN' || upper === 'BOOL') {
    const boolVal = !isNull && (value === '1' || value.toLowerCase() === 'true')
    const cycle = () => {
      // '' → '1' → '0' → '' (nullable 일 땐 NULL 도 사이클)
      if (value === '') onChange('1')
      else if (value === '1') onChange('0')
      else if (value === '0' && nullable) onSetNull()
      else onChange('')
    }
    return (
      <button
        ref={focusRef as React.RefObject<HTMLButtonElement>}
        type="button"
        onClick={cycle}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            // Enter 는 행 커밋, Space 만 토글
            if (e.key === ' ') cycle()
            else onConfirm()
            return
          }
          onKeyDown(e)
        }}
        disabled={disabled}
        className={`${baseCls} flex items-center justify-center font-medium`}
        title={titleAttr}
        style={{ height: ROW_HEIGHT }}
      >
        {isNull
          ? <span className="text-[10px] italic text-[var(--color-null)]">NULL</span>
          : value === ''
            ? <span className="text-[10px] text-[var(--color-null)]">{colName}</span>
            : <span className={boolVal ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>{boolVal ? '1' : '0'}</span>}
      </button>
    )
  }

  // DATE / DATETIME / TIMESTAMP / TIME / YEAR
  if (NEW_ROW_DATETIME_TYPES.has(upper)) {
    let inputType = 'text'
    let step: string | undefined
    let min: string | undefined
    let max: string | undefined
    switch (upper) {
      case 'DATE': inputType = 'date'; break
      case 'DATETIME': case 'TIMESTAMP': inputType = 'datetime-local'; step = '1'; break
      case 'TIME': inputType = 'time'; step = '1'; break
      case 'YEAR': inputType = 'number'; min = '1901'; max = '2155'; break
    }
    const toHtml = (v: string) => (upper === 'DATETIME' || upper === 'TIMESTAMP') ? v.replace(' ', 'T') : v
    const fromHtml = (v: string) => (upper === 'DATETIME' || upper === 'TIMESTAMP') ? v.replace('T', ' ') : v
    return (
      <input
        ref={focusRef as React.RefObject<HTMLInputElement>}
        type={inputType}
        value={isNull ? '' : toHtml(value)}
        placeholder={isNull ? 'NULL' : colName}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(fromHtml(e.target.value))}
        onKeyDown={onKeyDown}
        disabled={disabled}
        className={baseCls}
        title={titleAttr}
        style={{ height: ROW_HEIGHT }}
      />
    )
  }

  // NUMERIC
  if (NEW_ROW_NUMERIC_TYPES.has(upper)) {
    const isInt = upper === 'INT' || upper === 'BIGINT' || upper === 'SMALLINT' || upper === 'MEDIUMINT' || upper === 'TINYINT'
    return (
      <input
        ref={focusRef as React.RefObject<HTMLInputElement>}
        type="text"
        inputMode={isInt ? 'numeric' : 'decimal'}
        value={isNull ? '' : value}
        placeholder={isNull ? 'NULL' : colName}
        onChange={(e) => {
          const v = e.target.value
          const re = isInt ? /^-?\d*$/ : /^-?\d*\.?\d*$/
          if (v === '' || v === '-' || re.test(v)) onChange(v)
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
        className={baseCls}
        title={titleAttr}
        style={{ height: ROW_HEIGHT, MozAppearance: 'textfield' }}
      />
    )
  }

  // TEXT / JSON / BLOB / LONGTEXT — 한 줄 입력으로 두되 풀스크린 보기 가능 (단순화)
  if (NEW_ROW_LONG_TEXT_TYPES.has(upper)) {
    return (
      <input
        ref={focusRef as React.RefObject<HTMLInputElement>}
        value={isNull ? '' : value}
        placeholder={isNull ? 'NULL' : colName}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        className={baseCls}
        title={titleAttr}
        style={{ height: ROW_HEIGHT }}
      />
    )
  }

  // 기본 — TEXT / VARCHAR / CHAR / SET / 알 수 없는 타입
  return (
    <input
      ref={focusRef as React.RefObject<HTMLInputElement>}
      value={isNull ? '' : value}
      placeholder={isNull ? 'NULL' : colName}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      disabled={disabled}
      className={baseCls}
      title={titleAttr}
      style={{ height: ROW_HEIGHT }}
    />
  )
}
