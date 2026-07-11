// =====================================================================
// 편의 별칭 — Supabase 자동 생성 타입(./supabase.ts)에서 파생.
// 앱 코드는 이 파일의 별칭(Profile, RequestRow, RequestOrg 등)을 import 한다.
// 스키마 변경 시 supabase.ts 만 재생성하면 아래 별칭이 자동으로 따라간다.
// =====================================================================
import type { Database } from './supabase'

export type { Database }

type Tables = Database['public']['Tables']
type Views = Database['public']['Views']
type Enums = Database['public']['Enums']

// ---------- ENUM ----------
export type UserRole = Enums['user_role']
export type RequestOrg = Enums['request_org']
export type RequestStatus = Enums['request_status']
export type RequestPriority = Enums['request_priority']
export type RequestSource = Enums['request_source']
export type RequestVisibility = Enums['request_visibility']

// request_types.code 는 DB상 text 지만, 앱에서는 4종 고정 코드로 다룬다.
export type RequestTypeCode = 'error' | 'feature' | 'data' | 'file'

// request_view.due_status(계산 컬럼)의 의미상 값
export type DueStatus =
  | '기한초과'
  | '임박'
  | '지연'
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

// list_dept_options() RPC 반환 항목 (기관×직무 조합)
export type DeptOption =
  Database['public']['Functions']['list_dept_options']['Returns'][number]

// ---------- Insert 타입 (필요 시) ----------
export type RequestInsert = Tables['requests']['Insert']
export type RequestCommentInsert = Tables['request_comments']['Insert']
export type RequestAttachmentInsert = Tables['request_attachments']['Insert']
export type RequestSharedTargetInsert = Tables['request_shared_targets']['Insert']
