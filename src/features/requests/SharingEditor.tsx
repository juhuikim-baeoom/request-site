import { useMemo, useState } from 'react'
import { VISIBILITY_OPTIONS, FUNCTION_TARGETS, deptTargetValue, deptTargetLabel } from '../../lib/constants'
import { useDeptOptions } from './api'
import type { RequestVisibility } from '../../types/database'

const fieldCls =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-gray-50 disabled:text-gray-400'
const sidebarLabelCls = 'block text-xs font-medium text-gray-700'

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

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
 * 공개범위 + 공유 대상 선택 UI.
 * 접수 폼과 요청 상세의 공유 범위 수정이 이 컴포넌트를 공유한다 —
 * 선택 규칙이 두 벌이 되면 접수와 수정의 동작이 갈라진다.
 */
export function SharingEditor({ value, onChange, disabled }: SharingEditorProps) {
  const { data: deptOptions } = useDeptOptions()
  const [shareOpen, setShareOpen] = useState(false)

  const visibilityDesc = useMemo(
    () => VISIBILITY_OPTIONS.find((o) => o.value === value.visibility)?.description,
    [value.visibility],
  )

  const deptGroups = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>()
    for (const o of deptOptions ?? []) {
      if (!o.dept_function) continue
      const list = groups.get(o.org_affil) ?? []
      list.push({
        value: deptTargetValue(o.org_affil, o.dept_function),
        label: deptTargetLabel(o.org_affil, o.dept_function),
      })
      groups.set(o.org_affil, list)
    }
    return [...groups.entries()]
  }, [deptOptions])

  const sharedCount = value.fnTargets.size + value.deptTargets.size

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

      {/* 공유대상 — 기본 접힘, 선택 수 뱃지 */}
      <div>
        <button
          type="button"
          onClick={() => setShareOpen((v) => !v)}
          className="flex w-full items-center justify-between text-xs font-medium text-brand"
          aria-expanded={shareOpen}
          aria-controls="share-panel"
        >
          <span>+ 공유대상 추가</span>
          <span className="flex items-center gap-1">
            {sharedCount > 0 && !shareOpen && (
              <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {sharedCount}
              </span>
            )}
            <span aria-hidden="true">{shareOpen ? '▴' : '▾'}</span>
          </span>
        </button>

        <div
          id="share-panel"
          hidden={!shareOpen}
          className="mt-2 space-y-3 rounded-lg bg-gray-50 p-3"
        >
          <p className="text-xs text-gray-500">
            공개범위에 더해 특정 직무·부서에도 이 요청을 공유합니다.
          </p>

          {/* 직무 단위 */}
          <div>
            <p className="text-xs font-semibold text-gray-500">직무 단위</p>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {FUNCTION_TARGETS.map((fn) => (
                <label
                  key={fn}
                  className="inline-flex items-center gap-1.5 text-sm text-gray-700"
                >
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-brand focus:ring-brand"
                    checked={value.fnTargets.has(fn)}
                    onChange={() =>
                      onChange({ ...value, fnTargets: toggle(value.fnTargets, fn) })
                    }
                    disabled={disabled}
                  />
                  {fn} 전체
                </label>
              ))}
            </div>
          </div>

          {/* 세부부서 */}
          {deptGroups.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500">세부부서</p>
              <div className="mt-1.5 space-y-2">
                {deptGroups.map(([orgName, items]) => (
                  <div
                    key={orgName}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
                  >
                    <span className="w-10 shrink-0 text-xs font-medium text-gray-400">
                      {orgName}
                    </span>
                    {items.map((it) => (
                      <label
                        key={it.value}
                        className="inline-flex items-center gap-1.5 text-sm text-gray-700"
                      >
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 text-brand focus:ring-brand"
                          checked={value.deptTargets.has(it.value)}
                          onChange={() =>
                            onChange({ ...value, deptTargets: toggle(value.deptTargets, it.value) })
                          }
                          disabled={disabled}
                        />
                        {it.label}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
