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
  RequestDispute,
  DeptOption,
  SharedTargetType,
  PriorityLevel,
  UserRole,
} from '../../types/database'
import type { Urgency } from '../../lib/constants'

// ---------- 임팩트(배정 시) ----------
export type ImpactLevel = '높음' | '보통' | '낮음'

/**
 * 목록 행 = request_view + "왜 나에게 보이는가" 근거 플래그.
 * 서버(`GET /api/requests`)가 계산한다 — 공개범위·공유대상·소속 매칭을 프론트가 다시 계산하면
 * 서버의 열람 필터와 어긋날 수 있다. 둘 다 "내 것이 아닌 것"만 참이다.
 */
export type RequestListRow = RequestView & {
  /** 공개범위나 명시적 공유대상이 나를 지목 (역할 특권 제외) → "공유받은 요청" 탭 */
  shared_to_me: boolean
  /** 모니터 역할의 소속 범위(기관/부서) → "우리 기관"·"우리 부서" 탭 */
  in_monitor_scope: boolean
}

/** 내가 볼 수 있는 요청 목록 (공개범위 적용). 최신순 */
export function useRequestViews() {
  return useQuery({
    queryKey: ['requests', 'view'],
    queryFn: () => apiGet<RequestListRow[]>('/api/requests'),
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

/** request_view (csat 필드 포함 — RequestView 타입이 이미 포함하므로 별칭 유지) */
export type RequestViewWithCsat = RequestView

export interface RequestDetailData {
  view: RequestViewWithCsat
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

export interface SharingHistoryRow {
  id: number
  changed_at: string
  from_visibility: string | null
  to_visibility: string | null
  added: Array<{ target_type: string; target_value: string }>
  removed: Array<{ target_type: string; target_value: string }>
  actor: { name: string | null } | null // 상태 이력과 같은 형태 (json_build_object)
}

export function useRequestSharingHistory(id: number) {
  return useQuery({
    queryKey: ['requests', 'sharing-history', id],
    enabled: Number.isFinite(id),
    queryFn: () => apiGet<SharingHistoryRow[]>(`/api/requests/${id}/sharing-history`),
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

export interface AddCommentInput {
  body: string
  is_internal?: boolean
}

export interface AddCommentResult {
  id: number
}

export function useAddComment(requestId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AddCommentInput | string): Promise<AddCommentResult> => {
      if (typeof input === 'string') {
        return apiSend('POST', `/api/requests/${requestId}/comments`, { body: input.trim() })
      }
      return apiSend('POST', `/api/requests/${requestId}/comments`, {
        body: input.body.trim(),
        ...(input.is_internal !== undefined ? { is_internal: input.is_internal } : {}),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests', 'comments', requestId] })
    },
  })
}

/** 댓글에 연결된 첨부파일 업로드 (comment_id 링크) */
export function useUploadCommentAttachment(requestId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { file: File; commentId: number }): Promise<RequestAttachment> => {
      const fd = new FormData()
      // @fastify/multipart(v9): 텍스트 필드는 반드시 파일 파트보다 먼저 전송해야
      // request.file() 이후 part.fields에 담긴다.
      fd.append('comment_id', String(vars.commentId))
      fd.append('file', vars.file, vars.file.name)
      return apiUpload<RequestAttachment>(`/api/requests/${requestId}/attachments`, fd)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests', 'attachments', requestId] })
    },
  })
}

/** 재작업: 완료→진행중 전이 (시스템팀 전용) */
export function useRework(requestId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { reason?: string }) =>
      apiSend('PATCH', `/api/requests/${requestId}`, {
        status: '진행중' as RequestStatus,
        ...(vars.reason ? { reason: vars.reason } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests', 'detail', requestId] })
      void queryClient.invalidateQueries({ queryKey: ['requests', 'view'] })
      void queryClient.invalidateQueries({ queryKey: ['requests', 'history', requestId] })
    },
  })
}

// ---------- 본인 접수건 수정 / 철회 ----------
// visibility는 여기 없다 — PUT /api/requests/:id/sharing 전용(useChangeSharing).
// 보내면 서버가 400 USE_SHARING_ENDPOINT로 거부한다.
export interface UpdateRequestInput {
  title?: string
  body?: string
  urgency?: Urgency
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

/**
 * 공유 설정 변경 (시스템팀 또는 요청자 본인, 상태 무관) — 공개범위 + 공유 대상 전체 교체.
 * PATCH /api/requests/:id 의 visibility는 폐기됐다 — 여기가 유일한 변경 경로다.
 */
export function useChangeSharing(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { visibility: RequestVisibility; shared_targets: SharedTargetInput[] }) =>
      apiSend('PUT', `/api/requests/${id}/sharing`, {
        visibility: vars.visibility,
        shared_targets: vars.shared_targets,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
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

// ---------- 요청 처리 화면 (시스템팀) ----------
export interface BoardProfile {
  id: string
  name: string | null
  email: string
  role: UserRole
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

/**
 * 상태 변경 훅 — PATCH /api/requests/:id { status, reason? }
 * 낙관적 업데이트: onMutate 에서 캐시 즉시 반영, 실패 시 롤백.
 */
export function useChangeStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: number; status: RequestStatus; reason?: string }) =>
      apiSend('PATCH', `/api/requests/${vars.id}`, {
        status: vars.status,
        ...(vars.reason != null ? { reason: vars.reason } : {}),
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['requests', 'view'] })
      const previous = queryClient.getQueryData<RequestView[]>(['requests', 'view'])
      // 서버(changeStatus)는 진행중 → 접수 전이 시 배정 관련 필드를 전부 null로 비운다
      // (server/src/services/transition.ts 참고). 낙관적 업데이트도 동일하게 맞춰
      // 재조회 전까지 카드가 칸반 '접수'(배정됨) 컬럼에 잘못 나타나지 않게 한다.
      const clearedOnBack: Partial<RequestView> =
        vars.status === '접수'
          ? {
              assignee_id: null,
              impact: null,
              priority_level: null,
              assigned_at: null,
              first_response_at: null,
              response_due_at: null,
              resolution_due_at: null,
              sla_policy_id: null,
              sla_response_breached: false,
            }
          : {}
      queryClient.setQueryData<RequestView[]>(['requests', 'view'], (old) =>
        old?.map((r) =>
          r.id === vars.id ? { ...r, status: vars.status, ...clearedOnBack } : r,
        ),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['requests', 'view'], ctx.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
  })
}

/** 담당자 변경 훅 — PATCH /api/requests/:id { assignee_id } (status 와 분리) */
export function useChangeAssignee() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: number; assignee_id: string | null }) =>
      apiSend('PATCH', `/api/requests/${vars.id}`, { assignee_id: vars.assignee_id }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['requests', 'view'] })
      const previous = queryClient.getQueryData<RequestView[]>(['requests', 'view'])
      queryClient.setQueryData<RequestView[]>(['requests', 'view'], (old) =>
        old?.map((r) =>
          r.id === vars.id ? { ...r, assignee_id: vars.assignee_id } : r,
        ),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['requests', 'view'], ctx.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
  })
}

/**
 * 배정 훅 — POST /api/requests/:id/assign { assigneeId, impact }
 * 접수 → 진행중 전이 + priority_level·assigned_at·resolution_due_at 서버 세팅.
 * 시스템팀 전용.
 */
export function useAssignRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: number; assigneeId: string; impact: ImpactLevel }) =>
      apiSend('POST', `/api/requests/${vars.id}/assign`, {
        assigneeId: vars.assigneeId,
        impact: vars.impact,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
  })
}

/** 영향도 재조정 (시스템팀 전용) — priority_level·SLA 기한이 서버에서 재산정된다 */
export function useChangeImpact(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { impact: ImpactLevel }) =>
      apiSend<{ ok: boolean; priority_level: PriorityLevel }>(
        'PATCH',
        `/api/requests/${id}/impact`,
        { impact: vars.impact },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
  })
}

export interface BulkUpdateInput {
  ids: number[]
  patch: { status: RequestStatus; reason?: string } | { assignee_id: string | null }
}

export interface BulkUpdateResult {
  succeeded: number[]
  failed: Array<{ id: number; error: string }>
  /** 낙관적 업데이트 undo 를 위해 직전 캐시 스냅샷 반환 */
  previous: RequestView[] | undefined
}

/**
 * 벌크 업데이트 훅 — 선택된 id 들에 순차 PATCH.
 * 부분 실패를 취합해 BulkUpdateResult 로 반환.
 * undo 용으로 직전 캐시 스냅샷(previous)도 함께 반환.
 */
export function useBulkUpdate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: BulkUpdateInput): Promise<BulkUpdateResult> => {
      const previous = queryClient.getQueryData<RequestView[]>(['requests', 'view'])
      const succeeded: number[] = []
      const failed: Array<{ id: number; error: string }> = []

      for (const id of input.ids) {
        try {
          await apiSend('PATCH', `/api/requests/${id}`, input.patch)
          succeeded.push(id)
        } catch (err) {
          failed.push({
            id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      return { succeeded, failed, previous }
    },
    onSettled: () => {
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

/** useCreateRequest 반환값 — 부분 업로드 실패 포함 */
export interface CreateRequestResult {
  id: number
  seq: string | null
  failedFiles: File[]
  /** 업로드 시도한 총 파일 수 (부분 실패 메시지 "N건 중 M건 실패" 표시용) */
  totalFiles: number
}

/**
 * 요청 생성 → 첨부 순차 업로드.
 * 요청 생성 후 파일 업로드 중 일부 실패해도 요청은 1건만(중복 생성 금지).
 * failedFiles: 업로드 실패한 파일 목록. 빈 배열이면 전부 성공.
 */
export function useCreateRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateRequestInput): Promise<CreateRequestResult> => {
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
        shared_targets: input.sharedTargets,
      })

      // 2) 첨부 순차 업로드 — 실패해도 요청 중복 생성 없이 failedFiles 수집
      const failedFiles: File[] = []
      for (const file of input.files) {
        try {
          const fd = new FormData()
          fd.append('file', file, file.name)
          await apiUpload(`/api/requests/${request.id}/attachments`, fd)
        } catch {
          failedFiles.push(file)
        }
      }

      return { id: request.id, seq: request.seq ?? null, failedFiles, totalFiles: input.files.length }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
  })
}

/**
 * 실패한 첨부파일만 기존 요청 id로 재업로드.
 * 새 요청 생성 없이 POST /api/requests/:id/attachments 재시도.
 */
export function useRetryAttachments(requestId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (files: File[]): Promise<{ failedFiles: File[] }> => {
      const failedFiles: File[] = []
      for (const file of files) {
        try {
          const fd = new FormData()
          fd.append('file', file, file.name)
          await apiUpload(`/api/requests/${requestId}/attachments`, fd)
        } catch {
          failedFiles.push(file)
        }
      }
      return { failedFiles }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests', 'attachments', requestId] })
    },
  })
}

// ---------- 검수·이의제기 (Task 10·11 패널이 useMutation으로 감쌀 plain 함수들) ----------

/** 검수 승인 — 요청자 본인, 검수대기 상태에서만 */
export async function approveInspection(
  id: number,
  csat?: { rating: number; comment?: string },
): Promise<{ ok: true }> {
  return apiSend('PATCH', `/api/requests/${id}`, {
    status: '완료' as RequestStatus,
    ...(csat ? { csat_rating: csat.rating, csat_comment: csat.comment ?? null } : {}),
  })
}

/** 재작업 요청 — 요청자 본인, 검수대기 상태에서만. 사유 필수 */
export async function requestRework(id: number, reason: string): Promise<{ ok: true }> {
  return apiSend('PATCH', `/api/requests/${id}`, { status: '진행중' as RequestStatus, reason })
}

/** 강제 완료 — 시스템팀, 검수대기 상태에서만. 사유 필수 */
export async function forceComplete(id: number, reason: string): Promise<{ ok: true }> {
  return apiSend('PATCH', `/api/requests/${id}`, { status: '완료' as RequestStatus, reason })
}

/** 요청의 이의제기 이력 조회 */
export async function fetchDisputes(id: number): Promise<RequestDispute[]> {
  const res = await apiGet<{ disputes: RequestDispute[] }>(`/api/requests/${id}/disputes`)
  return res.disputes
}

/** 이의제기 — 요청자 본인, 완료 후 14일 이내 */
export async function raiseDispute(id: number, reason: string): Promise<{ id: number }> {
  return apiSend('POST', `/api/requests/${id}/disputes`, { reason })
}

/** 이의 심사 — 시스템팀. 사유 필수 */
export async function reviewDispute(
  disputeId: number,
  decision: 'ACCEPTED' | 'REJECTED',
  comment: string,
): Promise<{ ok: true }> {
  return apiSend('PATCH', `/api/disputes/${disputeId}`, { decision, comment })
}
