import type { UserRole } from '../types/database'

/**
 * 클라이언트 권한 헬퍼 — 서버 server/src/authz.ts의 능력 함수와 동일한 규칙이어야 한다.
 * 화면 노출을 정리하기 위한 편의일 뿐, 권한 경계는 서버가 강제한다.
 * 알 수 없는/폐기된 역할(viewer 등)은 전부 false → 최소 권한.
 */
type Role = UserRole | null | undefined

/** 요청 처리 — 배정·상태 전이·영향도·필드 편집·내부메모 */
export function canProcess(role: Role): boolean {
  return role === 'system' || role === 'system_admin'
}

/** 계정·역할 관리 */
export function canManageAccounts(role: Role): boolean {
  return role === 'system_admin'
}

/** 통계 대시보드 */
export function canSeeDashboard(role: Role): boolean {
  return role === 'system' || role === 'system_admin' || role === 'exec'
}

/** 내부메모 열람·작성 */
export function canSeeInternal(role: Role): boolean {
  return role === 'system' || role === 'system_admin'
}

/** 전 요청 열람 */
export function canSeeAllRequests(role: Role): boolean {
  return role === 'system' || role === 'system_admin' || role === 'exec'
}
