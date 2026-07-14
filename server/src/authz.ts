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
 * 공유 설정(공개범위 + 공유 대상) 변경 권한.
 * 본문 편집(canProcess 또는 요청자 본인 && 접수)과 규칙이 다르다:
 * 요청자 본인은 상태와 무관하게(종결 후에도) 공유를 바꿀 수 있다.
 * 공유는 처리 내용을 바꾸지 않고 "누가 볼 수 있는가"만 바꾸므로 더 넓게 열어도 안전하다.
 */
export function canChangeSharing(u: CurrentUser, requesterId: string | null): boolean {
  return canProcess(u) || (requesterId != null && requesterId === u.id)
}

/**
 * 요청이 나에게 보이는 "근거"는 넷뿐이다:
 *   ① 내가 요청자   ② 모니터 소속 범위   ③ 공유(공개범위·공유대상)   ④ 전체열람 특권
 * 목록 필터(visibilityFilter)와 목록 화면의 탭(공유받은 / 우리 기관·부서)이
 * 같은 조각을 쓰도록 ②③을 아래 두 함수로 떼어냈다 — 필터와 탭이 서로 어긋나지 않게 하기 위함.
 * 모든 조각은 `r` 별칭(requests 또는 request_view) 기준이다.
 */

/**
 * ② 모니터 소속 범위 — 공개범위와 무관하게 자기 기관/부서 요청을 본다.
 * 모니터 역할이 아니거나 소속이 null이면 null 바인딩 → SQL에서 항상 거짓.
 */
export function monitorScopeSql(u: CurrentUser): SQL {
  const org = u.orgAffil
  const fn = u.deptFunction
  const orgMonitorOrg = isOrgMonitor(u) ? org : null
  const deptMonitorOrg = isDeptMonitor(u) && fn != null ? org : null
  const deptMonitorFn = isDeptMonitor(u) && org != null ? fn : null

  return sql`(
    (r.requester_org is not null and r.requester_org::text = ${orgMonitorOrg})
    or (r.requester_org is not null and r.requester_function is not null
        and r.requester_org::text = ${deptMonitorOrg} and r.requester_function = ${deptMonitorFn})
  )`
}

/**
 * ③ 공유 근거 — 공개범위가 내 소속을 덮거나, 명시적 공유대상이 나를 지목한 경우.
 * 역할 특권(④ 전체열람, ② 모니터 범위)은 여기 포함하지 않는다:
 * "공유받은 요청" 탭이 전체열람 권한자에게 회사 전체를 보여주면 라벨이 거짓말이 된다.
 */
export function sharedWithMeSql(u: CurrentUser): SQL {
  const org = u.orgAffil
  const fn = u.deptFunction
  const deptTarget = org != null && fn != null ? `${org}|${fn}` : null

  return sql`(
    r.visibility = 'shared'
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

/**
 * 목록 조회용 WHERE 필터 = ① 내가 요청자 or ② 모니터 범위 or ③ 공유.
 * 전체 열람(system·system_admin·exec)은 true(④).
 */
export function visibilityFilter(u: CurrentUser): SQL {
  if (canSeeAllRequests(u)) return sql`true`
  return sql`(
    r.requester_id = ${u.id}
    or ${monitorScopeSql(u)}
    or ${sharedWithMeSql(u)}
  )`
}
