// 라우트 공통 검증 헬퍼

/** 경로 :id 를 양의 정수로 파싱. 유효하지 않으면 null (NaN이 SQL로 새는 것 방지) */
export function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

// enum 화이트리스트 (잘못된 값이 DB까지 내려가 500 나는 것 방지 → 400)
export const ORGS = ['배움', '배론', '허브', '공통'] as const
export const TYPE_CODES = ['error', 'feature', 'data', 'file'] as const
export const PRIORITIES = ['높음', '보통', '낮음'] as const
export const VISIBILITIES = ['private', 'dept', 'function', 'org', 'shared'] as const
export const STATUSES = [
  '접수', '진행중', '보류', '완료', '반려', '철회',
] as const

// 직무 단위(target_type='function') 공유 대상 큐레이션 6종 — 클라이언트
// src/lib/constants.ts의 FUNCTION_TARGETS와 동일해야 한다(서버는 클라이언트 코드를
// import할 수 없어 사본을 둔다). 서버 내에서는 정의를 여기 한 곳으로 두고
// services/sharing.ts(입력 검증)와 routes/meta.ts(옵션 노출 필터)가 함께 참조한다 —
// org_directory.dept_function은 검증되지 않는 자유 텍스트이므로, 이 화이트리스트 밖 값을
// /api/dept-options가 내보내면 접수 폼이 그 값을 체크박스로 렌더하고 제출 시
// parseSharedTargets가 400으로 거부해 접수 전체가 깨진다.
export const FUNCTION_TARGETS = [
  '교학팀',
  '상담영업팀',
  '기획마케팅팀',
  '상품개발팀',
  '경영지원팀',
  '시스템팀',
] as const

export function isOneOf(list: readonly string[], v: unknown): boolean {
  return typeof v === 'string' && list.includes(v)
}
