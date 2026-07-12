// =====================================================================
// 앱 공통 타입 정의.
// supabase.ts 는 현재 DB 구조의 구조적 타입 저장소로 계속 활용되지만,
// 아래 별칭들은 모두 이 파일에서 import하여 사용한다.
// DB 스키마 변경 시 supabase.ts 의 해당 테이블/뷰 Row 타입도 함께 갱신할 것.
// =====================================================================
import type { Database } from './supabase'

export type { Database }

type Tables = Database['public']['Tables']
type Views = Database['public']['Views']
type Enums = Database['public']['Enums']

// ---------- ENUM ----------
export type UserRole = Enums['user_role']
export type RequestOrg = Enums['request_org']

// P1 확정 7종 상태 (서버 API 계약과 동일) — 검수대기는 진행중↔완료 사이 검수 단계
export type RequestStatus = '접수' | '진행중' | '검수대기' | '보류' | '완료' | '반려' | '철회'

// 이의제기 상태 (request_disputes.status_cd)
export type DisputeStatusCd = 'OPEN' | 'ACCEPTED' | 'REJECTED'

// GET /api/requests/:id/disputes 응답 항목 — 서버가 이름을 조인해 내려준다
export interface RequestDispute {
  id: number
  reason: string
  status_cd: DisputeStatusCd
  review_comment: string | null
  reviewed_at: string | null
  created_at: string
  raised_by_name: string | null
  reviewed_by_name: string | null
}

// P1 배정 시 서버가 산정하는 우선순위 레벨
export type PriorityLevel = 'P1' | 'P2' | 'P3' | 'P4'

/** @deprecated P1 서버는 priority_level 사용. 하위 호환용으로 유지. */
export type RequestPriority = '긴급' | '보통' | '낮음'
export type RequestSource = Enums['request_source']
export type RequestVisibility = Enums['request_visibility']

// request_types.code 는 DB상 text 지만, 앱에서는 4종 고정 코드로 다룬다.
export type RequestTypeCode = 'error' | 'feature' | 'data' | 'file'

// request_view.due_status(계산 컬럼)의 의미상 값
// DB뷰가 생성하는 실제 값: '기한초과'|'임박'|'여유'|RequestStatus(완료/반려/철회)
export type DueStatus =
  | '기한초과'
  | '임박'
  | '여유'
  | RequestStatus

// 추가 공유부서 대상 유형
export type SharedTargetType = 'function' | 'dept'

// ---------- Row 타입 ----------
export type Profile = Tables['profiles']['Row']
export type OrgDirectory = Tables['org_directory']['Row']
export type RequestType = Tables['request_types']['Row']
export type RequestRow = Tables['requests']['Row']
export type RequestComment = Tables['request_comments']['Row']
export type RequestStatusHistory = Tables['request_status_history']['Row']
export type RequestAttachment = Tables['request_attachments']['Row']
export type RequestSharedTarget = Tables['request_shared_targets']['Row']
export type RequestView = Views['request_view']['Row']

// /api/dept-options 엔드포인트 반환 항목 (기관×직무 조합).
// supabase.ts의 Supabase RPC 타입에 의존하지 않고 직접 정의.
export interface DeptOption {
  org_affil: RequestOrg
  dept_function: string
}

// ---------- Insert 타입 (필요 시) ----------
export type RequestInsert = Tables['requests']['Insert']
export type RequestCommentInsert = Tables['request_comments']['Insert']
export type RequestAttachmentInsert = Tables['request_attachments']['Insert']
export type RequestSharedTargetInsert = Tables['request_shared_targets']['Insert']
