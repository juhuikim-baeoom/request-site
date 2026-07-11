import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type {
  RequestOrg,
  RequestPriority,
  RequestTypeCode,
  RequestType,
  RequestVisibility,
  RequestRow,
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

export interface CreateRequestInput {
  org: RequestOrg
  type_code: RequestTypeCode
  priority: RequestPriority
  visibility: RequestVisibility
  title: string
  body: string
  desired_due: string // yyyy-mm-dd
  files: File[]
}

/** 파일명에서 Storage 경로에 안전하지 않은 문자를 정리 */
function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const cleanBase = base.replace(/[^\w가-힣.-]+/g, '_').slice(0, 80)
  return `${cleanBase}${ext}`
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

      // 2) 첨부 업로드 → request_attachments 기록
      if (input.files.length > 0) {
        for (const file of input.files) {
          const path = `${user.id}/${request.id}/${Date.now()}_${safeFileName(file.name)}`
          const { error: uploadError } = await supabase.storage
            .from(ATTACHMENT_BUCKET)
            .upload(path, file, { upsert: false })
          if (uploadError) throw uploadError

          const { error: metaError } = await supabase.from('request_attachments').insert({
            request_id: request.id,
            storage_path: path,
            file_name: file.name,
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
