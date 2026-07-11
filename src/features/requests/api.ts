import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
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

const ATTACHMENT_BUCKET = 'request-attachments'

/** 내가 볼 수 있는 요청 목록 (request_view, RLS로 공개범위 적용). 최신순 */
export function useRequestViews() {
  return useQuery({
    queryKey: ['requests', 'view'],
    queryFn: async (): Promise<RequestView[]> => {
      const { data, error } = await supabase
        .from('request_view')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/** 볼 수 있는 요청들의 추가 공유 대상 (뱃지 표시용). request_id → 목록 */
export function useVisibleSharedTargets() {
  return useQuery({
    queryKey: ['requests', 'shared_targets'],
    queryFn: async (): Promise<Map<number, RequestSharedTarget[]>> => {
      const { data, error } = await supabase.from('request_shared_targets').select('*')
      if (error) throw error
      const map = new Map<number, RequestSharedTarget[]>()
      for (const t of data ?? []) {
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
    queryFn: async (): Promise<RequestDetailData> => {
      const { data: view, error } = await supabase
        .from('request_view')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      const v = view as RequestView

      const ids = [v.requester_id, v.assignee_id].filter((x): x is string => !!x)
      const byId = new Map<string, PersonRef>()
      if (ids.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, name, email, dept_function, org_affil')
          .in('id', ids)
        for (const p of profs ?? []) byId.set(p.id, p as PersonRef)
      }

      const { data: shared } = await supabase
        .from('request_shared_targets')
        .select('*')
        .eq('request_id', id)

      return {
        view: v,
        requester: v.requester_id ? byId.get(v.requester_id) ?? null : null,
        assignee: v.assignee_id ? byId.get(v.assignee_id) ?? null : null,
        sharedTargets: shared ?? [],
      }
    },
  })
}

export interface CommentWithAuthor extends RequestComment {
  author: { name: string | null } | null
}

export function useRequestComments(id: number) {
  return useQuery({
    queryKey: ['requests', 'comments', id],
    enabled: Number.isFinite(id),
    queryFn: async (): Promise<CommentWithAuthor[]> => {
      const { data, error } = await supabase
        .from('request_comments')
        .select('*, author:profiles(name)')
        .eq('request_id', id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as CommentWithAuthor[]
    },
  })
}

export interface HistoryWithActor extends RequestStatusHistory {
  actor: { name: string | null } | null
}

export function useRequestHistory(id: number) {
  return useQuery({
    queryKey: ['requests', 'history', id],
    enabled: Number.isFinite(id),
    queryFn: async (): Promise<HistoryWithActor[]> => {
      const { data, error } = await supabase
        .from('request_status_history')
        .select('*, actor:profiles(name)')
        .eq('request_id', id)
        .order('changed_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as HistoryWithActor[]
    },
  })
}

export function useRequestAttachments(id: number) {
  return useQuery({
    queryKey: ['requests', 'attachments', id],
    enabled: Number.isFinite(id),
    queryFn: async (): Promise<RequestAttachment[]> => {
      const { data, error } = await supabase
        .from('request_attachments')
        .select('*')
        .eq('request_id', id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data ?? []
    },
  })
}

/** 첨부 다운로드용 서명 URL (비공개 버킷) */
export async function getAttachmentUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 60)
  return data?.signedUrl ?? null
}

export function useAddComment(requestId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('로그인이 필요합니다.')
      const { error } = await supabase.from('request_comments').insert({
        request_id: requestId,
        author_id: user.id,
        body: body.trim(),
      })
      if (error) throw error
    },
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
    mutationFn: async (patch: UpdateRequestInput) => {
      const { error } = await supabase.from('requests').update(patch).eq('id', id)
      if (error) throw error
    },
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
    mutationFn: async () => {
      const { error } = await supabase.from('requests').update({ status: '철회' }).eq('id', id)
      if (error) throw error
    },
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

/** 전체 프로필 (담당자 후보·이름 매핑용). prof_read 완화로 로그인 사용자 조회 가능 */
export function useAllProfiles() {
  return useQuery({
    queryKey: ['profiles', 'all'],
    queryFn: async (): Promise<BoardProfile[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email, role, org_affil, dept_function')
        .order('name')
      if (error) throw error
      return (data ?? []) as BoardProfile[]
    },
    staleTime: 5 * 60_000,
  })
}

/** 관리 보드용 상태/담당자 변경 (시스템팀). 상태 변경 시 이력·완료일은 트리거가 처리 */
export function useBoardUpdate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      id: number
      patch: { status?: RequestStatus; assignee_id?: string | null }
    }) => {
      const { error } = await supabase.from('requests').update(vars.patch).eq('id', vars.id)
      if (error) throw error
    },
    onSuccess: () => {
      // ['requests'] 하위(view/detail/history) 전부 무효화
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
  })
}

/** 요청 유형 목록 (활성 유형만, 정렬순) */
export function useRequestTypes() {
  return useQuery({
    queryKey: ['request_types'],
    queryFn: async (): Promise<RequestType[]> => {
      const { data, error } = await supabase
        .from('request_types')
        .select('*')
        .eq('active', true)
        .order('sort_order')
      if (error) throw error
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })
}

/** 세부부서 옵션 목록(기관×직무) — 추가 공유 UI용 */
export function useDeptOptions() {
  return useQuery({
    queryKey: ['dept_options'],
    queryFn: async (): Promise<DeptOption[]> => {
      const { data, error } = await supabase.rpc('list_dept_options')
      if (error) throw error
      return data ?? []
    },
    staleTime: 10 * 60_000,
  })
}

export interface SharedTargetInput {
  target_type: SharedTargetType
  target_value: string
}

export interface CreateRequestInput {
  org: RequestOrg
  type_code: RequestTypeCode
  priority: RequestPriority
  visibility: RequestVisibility
  title: string
  body: string
  desired_due: string // yyyy-mm-dd
  files: File[]
  sharedTargets: SharedTargetInput[]
}

/**
 * Storage key 는 ASCII(영문/숫자/하이픈/점)만 허용되므로 확장자만 안전하게 추출한다.
 * 원본 파일명(한글 포함)은 request_attachments.file_name 에 별도 저장한다.
 */
function safeExt(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return ''
  const ext = name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
  return ext ? `.${ext}` : ''
}

/** 요청ID/타임스탬프-랜덤UUID.확장자 형태의 ASCII 전용 Storage 경로 */
function buildStoragePath(requestId: number, fileName: string): string {
  return `${requestId}/${Date.now()}-${crypto.randomUUID()}${safeExt(fileName)}`
}

/** 요청 생성 → 접수번호 반환. 첨부가 있으면 Storage 업로드 후 메타 기록 */
export function useCreateRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateRequestInput): Promise<RequestRow> => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('로그인이 필요합니다.')

      // 1) requests insert (seq/스냅샷은 트리거가 채움) → 생성된 행 반환
      const { data: created, error: insertError } = await supabase
        .from('requests')
        .insert({
          org: input.org,
          type_code: input.type_code,
          priority: input.priority,
          visibility: input.visibility,
          title: input.title.trim(),
          body: input.body,
          desired_due: input.desired_due || null,
          requester_id: user.id,
        })
        .select('*')
        .single()

      if (insertError) throw insertError
      const request = created as RequestRow

      // 2) 추가 공유 대상(다중) 기록
      if (input.sharedTargets.length > 0) {
        const { error: sharedError } = await supabase.from('request_shared_targets').insert(
          input.sharedTargets.map((t) => ({
            request_id: request.id,
            target_type: t.target_type,
            target_value: t.target_value,
          })),
        )
        if (sharedError) throw sharedError
      }

      // 3) 첨부 업로드 → request_attachments 기록
      if (input.files.length > 0) {
        for (const file of input.files) {
          const path = buildStoragePath(request.id, file.name)
          const { error: uploadError } = await supabase.storage
            .from(ATTACHMENT_BUCKET)
            .upload(path, file, { upsert: false })
          if (uploadError) throw uploadError

          const { error: metaError } = await supabase.from('request_attachments').insert({
            request_id: request.id,
            storage_path: path,
            file_name: file.name, // 원본 파일명(한글 포함) 그대로 저장 → 화면 표시용
            file_size: file.size,
            mime_type: file.type || null,
            uploaded_by: user.id,
          })
          if (metaError) throw metaError
        }
      }

      return request
    },
    onSuccess: () => {
      // 목록 화면이 최신 데이터를 받도록 무효화
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
  })
}
