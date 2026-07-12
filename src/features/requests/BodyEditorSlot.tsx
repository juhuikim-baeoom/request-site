/**
 * BodyEditorSlot — 상세내용 에디터 영역 슬롯.
 *
 * 잠정 구현: <textarea> (plain text).
 * 본문 값 형식 = plain text (body: string) 그대로 전송.
 *
 * 슬롯 계약 (교체 시 지킬 인터페이스):
 *   - value: string
 *   - onChange(v: string): void
 *   - disabled?: boolean
 *   - ariaLabelledby: string  (상세내용 라벨 id)
 *   - id: string
 *   - minHeight?: string      (기본 200px)
 *   - placeholder?: string
 *
 * // 향후 서상연 팀장 에디터로 교체 예정
 */
export interface BodyEditorSlotProps {
  id: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  ariaLabelledby: string
  minHeight?: string
  placeholder?: string
}

export function BodyEditorSlot({
  id,
  value,
  onChange,
  disabled,
  ariaLabelledby,
  minHeight = '200px',
  placeholder,
}: BodyEditorSlotProps) {
  return (
    <textarea
      id={id}
      aria-labelledby={ariaLabelledby}
      className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-gray-50 disabled:text-gray-400 resize-y"
      style={{ minHeight }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
    />
  )
}
