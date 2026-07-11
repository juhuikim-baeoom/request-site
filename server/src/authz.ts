import { sql, type SQL } from 'drizzle-orm'
import type { CurrentUser } from './types.js'

export function isSystem(u: CurrentUser): boolean {
  return u.role === 'system'
}
export function isViewerUp(u: CurrentUser): boolean {
  return u.role === 'system' || u.role === 'viewer'
}

interface ReqRef {
  requesterId: string | null
  visibility: 'private' | 'dept' | 'function' | 'org' | 'shared'
  requesterOrg: string | null
  requesterFunction: string | null
}
interface SharedRef { targetType: string; targetValue: string }

/** schema.sql can_see_request 이식 */
export function canSeeRequest(u: CurrentUser, req: ReqRef, shared: SharedRef[]): boolean {
  if (isViewerUp(u)) return true
  if (req.requesterId && req.requesterId === u.id) return true
  if (req.visibility === 'shared') return true
  if (req.visibility === 'org' && req.requesterOrg && req.requesterOrg === u.orgAffil) return true
  if (req.visibility === 'function' && req.requesterFunction && req.requesterFunction === u.deptFunction) return true
  if (
    req.visibility === 'dept' && req.requesterOrg && req.requesterFunction &&
    req.requesterOrg === u.orgAffil && req.requesterFunction === u.deptFunction
  ) return true
  for (const st of shared) {
    // NULL 직무/기관은 매칭 대상에서 제외 (원본 SQL의 NULL 전파 = 항상 거짓 재현)
    if (st.targetType === 'function' && u.deptFunction != null && st.targetValue === u.deptFunction) return true
    if (
      st.targetType === 'dept' && u.orgAffil != null && u.deptFunction != null &&
      st.targetValue === `${u.orgAffil}|${u.deptFunction}`
    ) return true
  }
  return false
}

/**
 * 목록 조회용 WHERE 필터. `r` 별칭(requests 또는 request_view) 기준.
 * viewer_up(system/viewer)은 전체, staff는 공개범위+본인+공유대상.
 */
export function visibilityFilter(u: CurrentUser): SQL {
  if (isViewerUp(u)) return sql`true`
  const uid = u.id
  const org = u.orgAffil
  const fn = u.deptFunction
  // org/fn 중 하나라도 null이면 dept 공유대상은 매칭 불가(null 바인딩 → SQL에서 항상 거짓)
  const deptTarget = org != null && fn != null ? `${org}|${fn}` : null
  return sql`(
    r.requester_id = ${uid}
    or r.visibility = 'shared'
    or (r.visibility = 'org' and r.requester_org is not null and r.requester_org::text = ${org})
    or (r.visibility = 'function' and r.requester_function is not null and r.requester_function = ${fn})
    or (r.visibility = 'dept' and r.requester_org is not null and r.requester_function is not null
        and r.requester_org::text = ${org} and r.requester_function = ${fn})
    or exists (
      select 1 from request_shared_targets st
      where st.request_id = r.id and (
        (st.target_type = 'function' and st.target_value = ${fn})
        or (st.target_type = 'dept' and st.target_value = ${deptTarget})
      )
    )
  )`
}
