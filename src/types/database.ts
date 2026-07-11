// =====================================================================
// schema.sql 기반 DB 타입 정의
// - 실제 프로덕션에서는 `supabase gen types typescript` 로 자동 생성 권장.
//   (예: npx supabase gen types typescript --project-id <ref> > src/types/database.ts)
// - 지금은 뼈대 단계라 핵심 enum/테이블을 수동으로 반영해 둔다.
// =====================================================================

// ---------- ENUM ----------
export type UserRole = 'staff' | 'system' | 'viewer'
export type RequestOrg = '배움' | '배론' | '허브' | '공통'
export type RequestStatus =
  | '접수'
  | '확인'
  | '진행중'
  | '검수대기'
  | '재작업'
  | '완료'
  | '보류'
  | '반려'
  | '이관'
export type RequestPriority = '긴급' | '보통' | '낮음'
export type RequestSource = 'web' | 'email'
export type RequestVisibility = 'private' | 'dept' | 'org' | 'shared'
export type RequestTypeCode = 'error' | 'feature' | 'data' | 'file'

// due_status: request_view 계산 컬럼(기한상태)
export type DueStatus =
  | '기한초과'
  | '임박'
  | '지연'
  | '여유'
  | RequestStatus // 완료/반려/보류/이관 상태는 그대로 노출

// ---------- Row 타입 ----------
export interface Profile {
  id: string
  email: string
  name: string | null
  org: string | null
  dept: string | null
  org_affil: RequestOrg | null
  role: UserRole
  created_at: string
}

export interface RequestType {
  code: RequestTypeCode
  label: string
  sort_order: number
  active: boolean
}

export interface RequestRow {
  id: number
  seq: string | null
  source: RequestSource
  org: RequestOrg
  type_code: RequestTypeCode
  priority: RequestPriority
  title: string
  body: string | null
  requester_id: string | null
  requester_name: string | null
  requester_email: string | null
  assignee_id: string | null
  status: RequestStatus
  visibility: RequestVisibility
  requester_dept: string | null
  requester_org: RequestOrg | null
  desired_due: string | null
  first_completed_at: string | null
  completed_at: string | null
  rework_count: number
  parent_request_id: number | null
  source_thread_id: string | null
  is_locked: boolean
  created_at: string
  updated_at: string
}

// request_view: requests + 계산필드(리드타임/기한상태/타입라벨)
export interface RequestView extends RequestRow {
  type_label: string | null
  first_lead_days: number | null
  final_lead_days: number | null
  due_status: DueStatus
}

export interface RequestComment {
  id: number
  request_id: number
  author_id: string | null
  body: string
  created_at: string
}

export interface RequestStatusHistory {
  id: number
  request_id: number
  from_status: RequestStatus | null
  to_status: RequestStatus
  changed_by: string | null
  changed_at: string
}

export interface RequestAttachment {
  id: number
  request_id: number
  storage_path: string
  file_name: string | null
  file_size: number | null
  mime_type: string | null
  uploaded_by: string | null
  created_at: string
}

// ---------- Supabase 클라이언트용 Database 타입 ----------
// Insert/Update 는 뼈대 단계에서 넉넉하게 Partial 로 둔다.
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Partial<Profile> & { id: string; email: string }
        Update: Partial<Profile>
      }
      request_types: {
        Row: RequestType
        Insert: Partial<RequestType> & { code: RequestTypeCode; label: string }
        Update: Partial<RequestType>
      }
      requests: {
        Row: RequestRow
        Insert: Partial<RequestRow> & {
          org: RequestOrg
          type_code: RequestTypeCode
          title: string
        }
        Update: Partial<RequestRow>
      }
      request_comments: {
        Row: RequestComment
        Insert: Partial<RequestComment> & { request_id: number; body: string }
        Update: Partial<RequestComment>
      }
      request_status_history: {
        Row: RequestStatusHistory
        Insert: Partial<RequestStatusHistory> & { request_id: number; to_status: RequestStatus }
        Update: Partial<RequestStatusHistory>
      }
      request_attachments: {
        Row: RequestAttachment
        Insert: Partial<RequestAttachment> & { request_id: number; storage_path: string }
        Update: Partial<RequestAttachment>
      }
    }
    Views: {
      request_view: {
        Row: RequestView
      }
    }
    Enums: {
      user_role: UserRole
      request_org: RequestOrg
      request_status: RequestStatus
      request_priority: RequestPriority
      request_source: RequestSource
      request_visibility: RequestVisibility
    }
  }
}
