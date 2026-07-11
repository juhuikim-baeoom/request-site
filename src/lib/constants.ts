import type {
  RequestOrg,
  RequestPriority,
  RequestVisibility,
  RequestTypeCode,
} from '../types/database'

// 기관 (request_org enum)
export const ORG_OPTIONS: RequestOrg[] = ['배움', '배론', '허브', '공통']

// 우선순위 (request_priority enum)
export const PRIORITY_OPTIONS: RequestPriority[] = ['긴급', '보통', '낮음']

// 공개범위 (request_visibility enum) — 라벨/설명
export const VISIBILITY_OPTIONS: {
  value: RequestVisibility
  label: string
  description: string
}[] = [
  { value: 'private', label: '본인만', description: '본인과 시스템팀만 볼 수 있습니다.' },
  { value: 'dept', label: '부서', description: '같은 부서 + 시스템팀이 볼 수 있습니다.' },
  { value: 'org', label: '기관', description: '같은 소속기관 + 시스템팀이 볼 수 있습니다.' },
  { value: 'shared', label: '전체', description: '전 직원이 볼 수 있습니다.' },
]

// 유형별 상세내용 작성 안내문구 (요구사항 §2)
export const TYPE_HINTS: Record<RequestTypeCode, string> = {
  error: '증상, 발생 화면 URL, 재현 방법을 함께 적어주세요.',
  feature: '원하는 기능과 사용 목적을 구체적으로 적어주세요.',
  data: '필요한 데이터 항목·기간·형식(엑셀/CSV 등)을 적어주세요.',
  file: '대상 파일과 변경할 내용을 적어주세요.',
}
