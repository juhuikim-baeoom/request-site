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

export function isOneOf(list: readonly string[], v: unknown): boolean {
  return typeof v === 'string' && list.includes(v)
}
