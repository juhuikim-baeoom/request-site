import { VISIBILITY_SHORT, parseDeptTargetValue, deptTargetLabel } from '../lib/constants'
import type { RequestVisibility, SharedTargetType } from '../types/database'

interface SharedTargetLike {
  target_type: SharedTargetType | string
  target_value: string
}

interface VisibilityBadgeProps {
  visibility: RequestVisibility
  sharedTargets?: SharedTargetLike[]
}

function sharedLabel(t: SharedTargetLike): string {
  if (t.target_type === 'function') return `${t.target_value} 전체`
  // dept: '배움|교학팀' → '배움_교학팀'
  const { org, fn } = parseDeptTargetValue(t.target_value)
  return deptTargetLabel(org, fn)
}

/**
 * 공개범위 + 추가 공유 대상을 뱃지로 표시.
 * 예: [부서만] [+교학팀 전체] [+배움_교학팀]
 */
export function VisibilityBadge({ visibility, sharedTargets = [] }: VisibilityBadgeProps) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
        {VISIBILITY_SHORT[visibility]}
      </span>
      {sharedTargets.map((t) => (
        <span
          key={`${t.target_type}:${t.target_value}`}
          className="rounded bg-brand/10 px-1.5 py-0.5 text-xs font-medium text-brand"
        >
          +{sharedLabel(t)}
        </span>
      ))}
    </span>
  )
}
