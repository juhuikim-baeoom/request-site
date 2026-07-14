import { useMemo } from 'react'
import { VISIBILITY_OPTIONS } from '../../lib/constants'
import type { RequestVisibility } from '../../types/database'
import { SharingTargetPicker } from './SharingTargetPicker'

const fieldCls =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-gray-50 disabled:text-gray-400'
const sidebarLabelCls = 'block text-xs font-medium text-gray-700'

export interface SharingValue {
  visibility: RequestVisibility
  fnTargets: Set<string> // 직무 단위 — FUNCTION_TARGETS 값
  deptTargets: Set<string> // 세부부서 단위 — deptTargetValue(기관, 직무) 값
}

interface SharingEditorProps {
  value: SharingValue
  onChange: (next: SharingValue) => void
  disabled?: boolean
}

/**
 * 공개범위 + 공유대상 선택 UI.
 * 접수 폼과 요청 상세의 공유 범위 수정이 이 컴포넌트를 공유한다 —
 * 선택 규칙이 두 벌이 되면 접수와 수정의 동작이 갈라진다.
 * 공유대상 선택 자체는 SharingTargetPicker가 담당한다.
 */
export function SharingEditor({ value, onChange, disabled }: SharingEditorProps) {
  const visibilityDesc = useMemo(
    () => VISIBILITY_OPTIONS.find((o) => o.value === value.visibility)?.description,
    [value.visibility],
  )

  return (
    <div className="space-y-3">
      {/* 공개범위 */}
      <div>
        <label htmlFor="field-visibility" className={sidebarLabelCls}>
          공개범위 <span className="text-red-500" aria-hidden="true">*</span>
        </label>
        <select
          id="field-visibility"
          className={fieldCls}
          value={value.visibility}
          onChange={(e) =>
            onChange({ ...value, visibility: e.target.value as RequestVisibility })
          }
          disabled={disabled}
          aria-describedby={visibilityDesc ? 'hint-visibility' : undefined}
          aria-required="true"
        >
          {VISIBILITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {visibilityDesc && (
          <p id="hint-visibility" className="mt-1 text-xs text-gray-500">
            {visibilityDesc}
          </p>
        )}
      </div>

      {/* 공유대상 — 검색 + 칩 */}
      <SharingTargetPicker
        fnTargets={value.fnTargets}
        deptTargets={value.deptTargets}
        onChange={(next) => onChange({ ...value, ...next })}
        disabled={disabled}
      />
    </div>
  )
}
