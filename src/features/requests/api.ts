import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend, apiUpload, API_BASE } from '../../lib/api'
import type {
  RequestOrg,
  RequestPriority,
  RequestStatus,
  RequestTypeCode,
  RequestType,
  RequestVisibility,
  RequestRow,
  RequestView,
  RequestComment,
  RequestStatusHistory,
  RequestAttachment,
  RequestSharedTarget,
  DeptOption,
  SharedTargetType,
} from '../../types/database'
import type { Urgency } from '../../lib/constants'

/** 내가 볼 수 있는 요청 목록 (공개범위 적용). 최신순 */
export function useRequestViews() {
  return useQuery({
    queryKey: ['requests', 'view'],
    queryFn: () => apiGet<RequestView[]>('/api/requests'),
  })
}

/** 볼 수 있는 요청들의 추가 공유 대상 (뱃지 표시용). request_id → 목록 */
export function useVisibleSharedTargets() {
  return useQuery({
    queryKey: ['requests', 'shared_targets'],
    queryFn: async (): Promise<Map<number, RequestSharedTarget[]>> => {
      const rows = await apiGet<RequestSharedTarget[]>('/api/requests/shared-targets')
      const map = new Map<number, RequestSharedTarget[]>()
      for (const t of rows) {
        const list = map.get(t.request_id) ?? []
        list.push(t)
        map.set(t.request_id, list)
      }
      return map
    },
  })
}

// ---------- 요청 상세 ----------
export interface PersonRef {
  id: string
  name: string | null
  email: string
  dept_function: string | null
  org_affil: RequestOrg | null
}

export interface RequestDetailData {
  view: RequestView
  requester: PersonRef | null
  assignee: PersonRef | null
  sharedTargets: RequestSharedTarget[]
}

export function useRequestDetail(id: number) {
  return useQuery({
    queryKey: ['requests', 'detail', id],
    enabled: Number.isFinite(id),
    queryFn: () => apiGet<RequestDetailData>(`/api/requests/${id}`),
  })
}

export interface CommentWithAuthor extends RequestComment {
  author: { name: string | null } | null
}

export function useRequestComments(id: number) {
  return useQuery({
    queryKey: ['requests', 'comments', id],
    enabled: Number.isFinite(id),
    queryFn: () => apiGet<CommentWithAuthor[]>(`/api/requests/${id}/comments`),
  })
}

export interface HistoryWithActor extends RequestStatusHistory {
  actor: { name: string | null } | null
}

export function useRequestHistory(id: number) {
  return useQuery({
    queryKey: ['requests', 'history', id],
    enabled: Number.isFinite(id),
    queryFn: () => apiGet<HistoryWithActor[]>(`/api/requests/${id}/history`),
  })
}

export function useRequestAttachments(id: number) {
  return useQuery({
    queryKey: ['requests', 'attachments', id],
    enabled: Number.isFinite(id),
    queryFn: () => apiGet<RequestAttachment[]>(`/api/requests/${id}/attachments`),
  })
}

/** 첨부 다운로드 URL (권한 검사는 서버가 수행) */
export function getAttachmentUrl(attachmentId: number): string {
  return `${API_BASE}/api/attachments/${attachmentId}/download`
}

export function useAddComment(requestId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      apiSend('POST', `/api/requests/${requestId}/comments`, { body: body.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests', 'comments', requestId] })
    },
  })
}

// ---------- 본인 접수건 수정 / 철회 ----------
export interface UpdateRequestInput {
  title?: string
  body?: string
  priority?: RequestPriority
  visibility?: RequestVisibility
  desired_due?: string | null
}

export function useUpdateRequest(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: UpdateRequestInput) => apiSend('PATCH', `/api/requests/${id}`, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests', 'detail', id] })
      void queryClient.invalidateQueries({ queryKey: ['requests', 'view'] })
    },
  })
}

/** 요청자 본인이 '접수' 상태 요청을 '철회'로 취소 (소프트 취소, 이력 보존) */
export function useCancelRequest(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiSend('PATCH', `/api/requests/${id}`, { status: '철회' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests', 'detail', id] })
      void queryClient.invalidateQueries({ queryKey: ['requests', 'view'] })
      void queryClient.invalidateQueries({ queryKey: ['requests', 'history', id] })
    },
  })
}

// ---------- 관리 보드 (시스템팀) ----------
export interface BoardProfile {
  id: string
  name: string | null
  email: string
  role: 'staff' | 'system' | 'viewer'
  org_affil: RequestOrg | null
  dept_function: string | null
}

/** 전체 프로필 (담당자 후보·이름 매핑용) */
export function useAllProfiles() {
  return useQuery({
    queryKey: ['profiles', 'all'],
    queryFn: () => apiGet<BoardProfile[]>('/api/profiles'),
    staleTime: 5 * 60_000,
  })
}

/** 관리 보드용 상태/담당자 변경 (시스템팀). 상태 변경 시 이력·완료일은 트리거가 처리 */
export function useBoardUpdate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      id: number
      patch: { status?: RequestStatus; assignee_id?: string | null }
    }) => apiSend('PATCH', `/api/requests/${vars.id}`, vars.patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
  })
}

/** 요청 유형 목록 (활성 유형만, 정렬순) */
export function useRequestTypes() {
  return useQuery({
    queryKey: ['request_types'],
    queryFn: () => apiGet<RequestType[]>('/api/request-types'),
    staleTime: 5 * 60_000,
  })
}

/** 세부부서 옵션 목록(기관×직무) — 추가 공유 UI용 */
export function useDeptOptions() {
  return useQuery({
    queryKey: ['dept_options'],
    queryFn: () => apiGet<DeptOption[]>('/api/dept-options'),
    staleTime: 10 * 60_000,
  })
}

export interface SharedTargetInput {
  target_type: SharedTargetType
  target_value: string
}

export type { RequestPriority } // re-export so other screens keep working
export type { Urgency } // re-export so other screens keep working; source of truth: constants.ts

export interface CreateRequestInput {
  org: RequestOrg
  type_code: RequestTypeCode
  urgency: Urgency
  visibility: RequestVisibility
  title: string
  body?: string
  desired_due: string // yyyy-mm-dd
  intake_detail: Record<string, string>
  files: File[]
  sharedTargets: SharedTargetInput[]
}

/** 요청 생성 → 접수번호 포함 행 반환. 첨부가 있으면 개별 업로드 */
export function useCreateRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateRequestInput): Promise<RequestRow> => {
      // 1) 요청 생성 (+ 공유대상). seq/스냅샷은 서버 트리거가 채움
      const request = await apiSend<RequestRow>('POST', '/api/requests', {
        org: input.org,
        type_code: input.type_code,
        urgency: input.urgency,
        visibility: input.visibility,
        title: input.title.trim(),
        body: input.body,
        desired_due: input.desired_due || null,
        intake_detail: input.intake_detail,
        sharedTargets: input.sharedTargets,
      })

      // 2) 첨부 업로드 (각 파일 개별 multipart)
      for (const file of input.files) {
        const fd = new FormData()
        fd.append('file', file, file.name)
        await apiUpload(`/api/requests/${request.id}/attachments`, fd)
      }

      return request
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
  })
}
