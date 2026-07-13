import type {
  RequestOrg,
  RequestPriority,
  RequestStatus,
  PriorityLevel,
  RequestVisibility,
  RequestTypeCode,
} from '../types/database'

// 역할 한국어 라벨 — 계정 관리·상단 메뉴가 공유한다.
// 내부값은 서버 user_role enum과 동일해야 한다.
export const ROLE_LABEL: Record<string, string> = {
  staff: '요청자',
  dept_monitor: '부서 모니터링 관리자',
  org_monitor: '기관 모니터링 관리자',
  system: '시스템팀 담당자',
  exec: '경영진',
  system_admin: '시스템팀 관리자',
  viewer: '(폐기) 뷰어',
}

// 계정 관리 역할 select에 노출할 역할 (폐기값 viewer 제외)
export const ASSIGNABLE_ROLES = [
  'staff',
  'dept_monitor',
  'org_monitor',
  'system',
  'exec',
  'system_admin',
] as const

// 기관 (request_org enum)
export const ORG_OPTIONS: RequestOrg[] = ['배움', '배론', '허브', '공통']

// 우선순위 (request_priority enum) — 하위 호환용
export const PRIORITY_OPTIONS: RequestPriority[] = ['긴급', '보통', '낮음']

// P1 확정 6종 상태 (서버 API 계약과 동일)
export const STATUS_OPTIONS: RequestStatus[] = [
  '접수',
  '진행중',
  '보류',
  '완료',
  '반려',
  '철회',
]

// 관리 보드 칸반 컬럼 — 철회는 아카이브성이므로 보드에서 제외
export const BOARD_STATUSES: RequestStatus[] = ['접수', '진행중', '보류', '완료', '반려']

// 열린(진행 중인) 상태 — 내 요청 기본 저장뷰에서 종결 제외 필터에 사용
export const OPEN_STATUSES: RequestStatus[] = ['접수', '진행중', '보류']

// 종결 상태 — server/src/services/impact.ts의 CLOSED와 동일 (영향도 소급 변경 금지 기준)
export const CLOSED_STATUSES: RequestStatus[] = ['완료', '반려', '철회']

// 상태별 뱃지 색상 (진한 배경 + 흰 글자로 한눈에 구분)
export const STATUS_BADGE: Record<RequestStatus, string> = {
  접수: 'bg-sky-500 text-white',
  진행중: 'bg-indigo-600 text-white',
  보류: 'bg-amber-500 text-white',
  완료: 'bg-green-600 text-white',
  반려: 'bg-red-600 text-white',
  철회: 'bg-gray-400 text-white line-through',
}

// P1~P4 레벨 뱃지 색상 (진한 배경 + 흰 글자, 접근성 대비 4.5:1 이상)
export const PRIORITY_LEVEL_BADGE: Record<PriorityLevel, string> = {
  P1: 'bg-red-700 text-white',
  P2: 'bg-orange-500 text-white',
  P3: 'bg-blue-600 text-white',
  P4: 'bg-gray-500 text-white',
}

// WIP 임계 — 칸반 컬럼당 카드 수가 이 값을 초과하면 경고 표시
export const WIP_LIMIT = 12

// 허용 전이 매트릭스 (서버 API 계약 §PATCH /api/requests/:id 와 동일)
export const ALLOWED_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  접수: ['진행중', '반려', '철회'],
  진행중: ['완료', '보류', '반려', '접수'], // 접수: 배정 취소(되돌리기) — 서버가 배정 정보를 초기화
  보류: ['진행중'],
  완료: ['진행중'], // 재작업
  반려: [],
  철회: [],
}

// 기한상태(request_view.due_status)별 뱃지 색상 — 초과·임박 강조
// DB 생성값: '기한초과'|'임박'|'여유'|RequestStatus(완료/반려/철회)
export function dueBadgeClass(due: string | null): string {
  switch (due) {
    case '기한초과':
      return 'bg-red-100 text-red-700 font-semibold'
    case '임박':
      return 'bg-amber-100 text-amber-800'
    case '여유':
      return 'bg-gray-100 text-gray-500'
    case '완료':
      return 'bg-green-100 text-green-700'
    default:
      return 'bg-gray-100 text-gray-500'
  }
}

// 우선순위 뱃지 색상
export const PRIORITY_BADGE: Record<RequestPriority, string> = {
  긴급: 'bg-red-100 text-red-700',
  보통: 'bg-gray-100 text-gray-600',
  낮음: 'bg-gray-100 text-gray-500',
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

// 긴급도 (urgency_level enum)
export type Urgency = '높음' | '보통' | '낮음'
export const URGENCY_OPTIONS: Urgency[] = ['높음', '보통', '낮음']

/**
 * 우선순위 격자 — 서버 server/src/sla.ts의 derivePriority와 동일해야 한다.
 * urgency(긴급도) × impact(영향도) 격자로 우선순위(P1~P4)를 산정한다 (곱셈 아님).
 * 클라이언트에서 배정 전 미리보기(예상 우선순위) 용도로만 쓴다 — 실제 값은 서버가 확정한다.
 */
export function derivePriorityPreview(urgency: Urgency, impact: Urgency): PriorityLevel {
  if (impact === '높음' && urgency === '높음') return 'P1'
  if (impact === '높음' && urgency === '보통') return 'P2'
  if (impact === '높음' && urgency === '낮음') return 'P3'
  if (impact === '보통' && urgency === '높음') return 'P2'
  if (impact === '보통' && urgency === '보통') return 'P3'
  if (impact === '보통' && urgency === '낮음') return 'P4'
  if (impact === '낮음' && urgency === '높음') return 'P3'
  return 'P4'
}

// 타입별 intake_detail 필드 정의 (서버 계약과 키 정확히 일치)
export interface IntakeField {
  key: string
  label: string
  placeholder?: string
  required: true
}

export const TYPE_FIELDS: Record<RequestTypeCode, IntakeField[]> = {
  error: [
    { key: 'screen_url', label: '발생 화면 URL', placeholder: 'https://...', required: true },
    { key: 'reproduce', label: '재현 방법', placeholder: '재현 절차를 단계별로 적어주세요', required: true },
    { key: 'occurred_at', label: '발생 시각', placeholder: '예: 2026-07-11 14:30', required: true },
  ],
  feature: [
    { key: 'purpose', label: '사용 목적', placeholder: '이 기능을 어떤 목적으로 사용하시나요?', required: true },
    { key: 'expected_effect', label: '기대 효과', placeholder: '기능 추가 후 기대되는 효과를 적어주세요', required: true },
  ],
  data: [
    { key: 'items', label: '필요 항목', placeholder: '필요한 데이터 항목을 적어주세요', required: true },
    { key: 'period', label: '기간', placeholder: '예: 2026-01-01 ~ 2026-06-30', required: true },
    { key: 'format', label: '형식', placeholder: '엑셀/CSV 등', required: true },
  ],
  file: [
    { key: 'target_file', label: '대상 파일', placeholder: '변경할 파일 경로 또는 이름', required: true },
    { key: 'change_detail', label: '변경 내용', placeholder: '어떤 내용으로 변경해야 하는지 적어주세요', required: true },
  ],
}

// 유형별 아이콘 (카드 UI용)
export const TYPE_ICON: Record<RequestTypeCode, string> = {
  error: '🐞',
  feature: '✨',
  data: '📊',
  file: '📄',
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

/** 담당자 select 후보 항목 (원 후보 목록 밖에서 편입된 경우 outsideCandidates=true) */
export interface AssigneeOption {
  id: string
  name: string | null
  email: string
  outsideCandidates: boolean
}

/**
 * 담당자 select 후보 목록 — 담당자 후보(보통 role='system')에 현재 담당자가 없어도
 * 그 담당자를 옵션으로 편입해 select value가 항상 실제 담당자와 일치하도록 한다.
 * ManageBoard.tsx의 인라인 select와 AdminPanel.tsx가 같은 규칙을 쓴다.
 */
export function withCurrentAssignee<T extends { id: string; name: string | null; email: string }>(
  candidates: T[],
  currentAssigneeId: string | null | undefined,
  allPeople: T[],
): AssigneeOption[] {
  const options: AssigneeOption[] = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    outsideCandidates: false,
  }))
  if (currentAssigneeId && !candidates.some((c) => c.id === currentAssigneeId)) {
    const found = allPeople.find((p) => p.id === currentAssigneeId)
    if (found) {
      options.push({ id: found.id, name: found.name, email: found.email, outsideCandidates: true })
    }
  }
  return options
}
