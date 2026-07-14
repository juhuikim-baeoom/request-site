/**
 * 검수·이의제기 정책 상수.
 * 7 / 3 / 14 라는 수치를 다른 모듈이 직접 쓰지 않도록 여기에만 둔다.
 */
export const INSPECTION_DAYS = 7           // 검수대기 → 자동완료까지
export const INSPECTION_REMINDER_DAYS = 3  // 검수대기 진입 후 리마인더 발송 시점
export const DISPUTE_WINDOW_DAYS = 14      // 최종 완료 후 이의제기 가능 기간

export type CompletionRoute = 'REQUESTER' | 'AUTO' | 'SYSTEM_FORCED'
export type DisputeStatusCd = 'OPEN' | 'ACCEPTED' | 'REJECTED'

/** 최종 완료 시각 기준으로 아직 이의제기가 가능한지 */
export function isDisputable(completedAt: Date | null, now: Date = new Date()): boolean {
  if (completedAt === null) return false
  const deadline = new Date(completedAt.getTime() + DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  return now <= deadline
}
