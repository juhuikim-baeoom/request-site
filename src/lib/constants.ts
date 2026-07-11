import type {
  RequestOrg,
  RequestPriority,
  RequestStatus,
  RequestVisibility,
  RequestTypeCode,
} from '../types/database'

// 기관 (request_org enum)
export const ORG_OPTIONS: RequestOrg[] = ['배움', '배론', '허브', '공통']

// 우선순위 (request_priority enum)
export const PRIORITY_OPTIONS: RequestPriority[] = ['긴급', '보통', '낮음']

// 상태 (request_status enum)
export const STATUS_OPTIONS: RequestStatus[] = [
  '접수',
  '확인',
  '진행중',
  '검수대기',
  '재작업',
  '완료',
  '보류',
  '반려',
  '이관',
  '철회',
]

// 상태별 뱃지 색상 (진한 배경 + 흰 글자로 한눈에 구분)
export const STATUS_BADGE: Record<RequestStatus, string> = {
  접수: 'bg-sky-500 text-white',
  확인: 'bg-blue-600 text-white',
  진행중: 'bg-indigo-600 text-white',
  검수대기: 'bg-violet-600 text-white',
  재작업: 'bg-orange-500 text-white',
  완료: 'bg-green-600 text-white',
  보류: 'bg-amber-500 text-white',
  반려: 'bg-red-600 text-white',
  이관: 'bg-teal-600 text-white',
  철회: 'bg-gray-400 text-white line-through',
}

// 기한상태(request_view.due_status)별 뱃지 색상 — 초과·지연·임박 강조
export function dueBadgeClass(due: string | null): string {
  switch (due) {
    case '기한초과':
      return 'bg-red-100 text-red-700 font-semibold'
    case '지연':
      return 'bg-orange-100 text-orange-700 font-semibold'
    case '임박':
      return 'bg-amber-100 text-amber-800'
    case '여유':
      return 'bg-gray-100 text-gray-500'
    case '완료':
      return 'bg-green-50 text-green-600'
    default:
      return 'bg-gray-100 text-gray-500'
  }
}

// 우선순위 뱃지 색상
export const PRIORITY_BADGE: Record<RequestPriority, string> = {
  긴급: 'bg-red-100 text-red-700',
  보통: 'bg-gray-100 text-gray-600',
  낮음: 'bg-gray-50 text-gray-400',
}

// 공개범위 (request_visibility enum, 5단계) — 라벨/설명
export const VISIBILITY_OPTIONS: {
  value: RequestVisibility
  label: string
  description: string
}[] = [
  { value: 'private', label: '본인만', description: '본인과 시스템팀만 볼 수 있습니다.' },
  {
    value: 'dept',
    label: '부서만 (같은 기관·같은 직무)',
    description: '같은 기관의 같은 직무 담당자 + 시스템팀.',
  },
  {
    value: 'function',
    label: '동일 직무 전체',
    description: '기관과 무관하게 같은 직무 전체 (예: 3개 기관 교학팀).',
  },
  { value: 'org', label: '소속기관 전체', description: '같은 소속기관 전원.' },
  { value: 'shared', label: '전 직원', description: '모든 직원이 볼 수 있습니다.' },
]

// 뱃지 등 짧은 라벨
export const VISIBILITY_SHORT: Record<RequestVisibility, string> = {
  private: '본인만',
  dept: '부서만',
  function: '직무 전체',
  org: '기관 전체',
  shared: '전 직원',
}

// 유형별 상세내용 작성 안내문구 (요구사항 §2)
export const TYPE_HINTS: Record<RequestTypeCode, string> = {
  error: '증상, 발생 화면 URL, 재현 방법을 함께 적어주세요.',
  feature: '원하는 기능과 사용 목적을 구체적으로 적어주세요.',
  data: '필요한 데이터 항목·기간·형식(엑셀/CSV 등)을 적어주세요.',
  file: '대상 파일과 변경할 내용을 적어주세요.',
}

// 추가 공유 — 직무 단위(target_type='function') 선택 항목 (큐레이션된 6종)
export const FUNCTION_TARGETS: string[] = [
  '교학팀',
  '상담영업팀',
  '기획마케팅팀',
  '상품개발팀',
  '경영지원팀',
  '시스템팀',
]

// 추가 공유 — 세부부서(target_type='dept') 값/라벨 규칙
//   value: '배움|교학팀' (RLS 매칭용), label: '배움_교학팀' (표시용)
export function deptTargetValue(org: RequestOrg | string, fn: string): string {
  return `${org}|${fn}`
}
export function deptTargetLabel(org: RequestOrg | string, fn: string): string {
  return `${org}_${fn}`
}
export function parseDeptTargetValue(value: string): { org: string; fn: string } {
  const [org, fn] = value.split('|')
  return { org: org ?? '', fn: fn ?? '' }
}
