import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '../../lib/api'
import type { UserRole, RequestOrg } from '../../types/database'

export interface UserRow {
  id: string
  email: string
  name: string | null
  dept: string | null
  org_affil: RequestOrg | null
  dept_function: string | null
  role: UserRole
}

export interface UpdateUserInput {
  role?: UserRole
  dept?: string | null
  org_affil?: RequestOrg | null
  dept_function?: string | null
}

export interface OrgDirectoryRow {
  email: string
  name: string
  dept: string
  org_affil: string
  dept_function?: string
  role?: string
}

export interface ImportResult {
  upserted: number
  skipped: number
  errors: { email: string; reason: string }[]
}

export function useUsers() {
  return useQuery({
    queryKey: ['users', 'list'],
    queryFn: () => apiGet<UserRow[]>('/api/users'),
    staleTime: 30_000,
  })
}

export function useUpdateUser(userId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: UpdateUserInput) =>
      apiSend<UserRow>('PATCH', `/api/users/${userId}`, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users', 'list'] })
    },
  })
}

export function useImportOrgDirectory() {
  return useMutation({
    mutationFn: (rows: OrgDirectoryRow[]) =>
      apiSend<ImportResult>('POST', '/api/org-directory/import', { rows }),
  })
}
