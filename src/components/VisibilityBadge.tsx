import { VISIBILITY_SHORT, sharedTargetLabel } from '../lib/constants'
import type { RequestVisibility, SharedTargetType } from '../types/database'

interface SharedTargetLike {
  target_type: SharedTargetType | string
  target_value: string
}

interface VisibilityBadgeProps {
  visibility: RequestVisibility
  sharedTargets?: SharedTargetLike[]
  /** 공유대상 칩 최대 노출 개수. 초과분은 `외 N개`로 접는다. 미지정 시 전부 표시. */
  maxTargets?: number
}

/**
 * 공개범위 + 추가 공유 대상을 뱃지로 표시.
 * 예: [부서만] [+교학팀 전체] [+배움 › 교학팀]
 * 라벨 규칙은 sharedTargetLabel이 SSOT — 타임라인·선택 피커와 같은 표기를 쓴다.
 */
export function VisibilityBadge({ visibility, sharedTargets = [], maxTargets }: VisibilityBadgeProps) {
  const visible = maxTargets != null ? sharedTargets.slice(0, maxTargets) : sharedTargets
  const hidden = sharedTargets.length - visible.length

  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
        {VISIBILITY_SHORT[visibility]}
      </span>
      {visible.map((t) => (
        <span
          key={`${t.target_type}:${t.target_value}`}
          className="rounded bg-brand/10 px-1.5 py-0.5 text-xs font-medium text-brand"
        >
          +{sharedTargetLabel(t)}
        </span>
      ))}
      {hidden > 0 && (
        <span
          className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500"
          title={sharedTargets.slice(visible.length).map(sharedTargetLabel).join(', ')}
        >
          외 {hidden}개
        </span>
      )}
    </span>
  )
}
