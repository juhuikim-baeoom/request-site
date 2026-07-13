import { sql, type SQL } from 'drizzle-orm'
import type { CurrentUser } from './types.js'

/**
 * 능력(capability) 기반 권한 판정.
 * 라우트는 역할 이름 대신 능력을 묻는다 — 역할이 늘어도 호출부를 고치지 않기 위함이다.
 * 모든 함수는 화이트리스트다: 알 수 없는/폐기된 역할(viewer 등)은 false → 최소 권한.
 */

/** 요청 처리 — 배정·상태 전이·영향도 조정·필드 편집·내부메모 작성 */
export function canProcess(u: CurrentUser): boolean {
  return u.role === 'system' || u.role === 'system_admin'
}

/** 계정·역할 관리 — /api/users, 조직도 import */
export function canManageAccounts(u: CurrentUser): boolean {
  return u.role === 'system_admin'
}

/** 통계 대시보드 열람 */
export function canSeeDashboard(u: CurrentUser): boolean {
  return u.role === 'system' || u.role === 'system_admin' || u.role === 'exec'
}

/** 내부메모 열람 — 시스템팀 전용. 경영진·모니터링 관리자에게도 감춘다. */
export function canSeeInternal(u: CurrentUser): boolean {
  return u.role === 'system' || u.role === 'system_admin'
}

/** 공개범위와 무관하게 전 요청 열람 */
export function canSeeAllRequests(u: CurrentUser): boolean {
  return u.role === 'system' || u.role === 'system_admin' || u.role === 'exec'
}

/** 부서 모니터링 관리자 — 자기 부서(기관+직무) 요청을 추가로 본다 */
function isDeptMonitor(u: CurrentUser): boolean {
  return u.role === 'dept_monitor'
}

/** 기관 모니터링 관리자 — 자기 기관 요청을 추가로 본다 */
function isOrgMonitor(u: CurrentUser): boolean {
  return u.role === 'org_monitor'
}

interface CommentRef {
  isInternal: boolean
  authorId: string | null
}

/**
 * 댓글 열람 권한.
 * 내부메모(is_internal=true)는 시스템팀 또는 작성자에게만 보인다.
 */
export function canSeeComment(u: CurrentUser, comment: CommentRef): boolean {
  if (!comment.isInternal) return true
  if (canSeeInternal(u)) return true
  if (comment.authorId && comment.authorId === u.id) return true
  return false
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
  if (canSeeAllRequests(u)) return true
  if (req.requesterId && req.requesterId === u.id) return true

  // 모니터링 범위 — 본인 소속에서 도출. 소속이 null이면 추가 범위 없음.
  if (
    isOrgMonitor(u) && u.orgAffil != null &&
    req.requesterOrg != null && req.requesterOrg === u.orgAffil
  ) return true
  if (
    isDeptMonitor(u) && u.orgAffil != null && u.deptFunction != null &&
    req.requesterOrg != null && req.requesterFunction != null &&
    req.requesterOrg === u.orgAffil && req.requesterFunction === u.deptFunction
  ) return true

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
 * 전체 열람(system·system_admin·exec)은 true.
 * 모니터링 관리자는 본인 소속 범위를 추가로 본다. 소속이 null이면 추가 범위 없음.
 */
export function visibilityFilter(u: CurrentUser): SQL {
  if (canSeeAllRequests(u)) return sql`true`
  const uid = u.id
  const org = u.orgAffil
  const fn = u.deptFunction
  const deptTarget = org != null && fn != null ? `${org}|${fn}` : null

  // 모니터링 범위: 해당 역할이 아니거나 소속이 null이면 null 바인딩 → SQL에서 항상 거짓
  const orgMonitorOrg = isOrgMonitor(u) ? org : null
  const deptMonitorOrg = isDeptMonitor(u) && fn != null ? org : null
  const deptMonitorFn = isDeptMonitor(u) && org != null ? fn : null

  return sql`(
    r.requester_id = ${uid}
    or (r.requester_org is not null and r.requester_org::text = ${orgMonitorOrg})
    or (r.requester_org is not null and r.requester_function is not null
        and r.requester_org::text = ${deptMonitorOrg} and r.requester_function = ${deptMonitorFn})
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
