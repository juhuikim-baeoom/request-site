import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '../../lib/api'

export interface NotificationItem {
  id: number
  type: string
  request_id: number | null
  message: string
  is_read: boolean
  created_at: string
}

export interface NotificationsResponse {
  items: NotificationItem[]
  unreadCount: number
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiGet<NotificationsResponse>('/api/notifications'),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiSend<{ ok: boolean }>('POST', `/api/notifications/${id}/read`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useMarkAllRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiSend<{ ok: boolean }>('POST', '/api/notifications/read-all'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}
