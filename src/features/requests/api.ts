import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type {
  RequestOrg,
  RequestPriority,
  RequestTypeCode,
  RequestType,
  RequestVisibility,
  RequestRow,
  DeptOption,
  SharedTargetType,
} from '../../types/database'

const ATTACHMENT_BUCKET = 'request-attachments'

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
