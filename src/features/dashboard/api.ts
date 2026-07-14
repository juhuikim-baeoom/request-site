import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../lib/api'

// ── Response shape from GET /api/dashboard/metrics ──

export interface DashboardKpis {
  open: number
  overdueImminent: number
  p1p2Open: number
  reworkRate: number | null
  csatPositivePct: number | null
  disputeRate: number | null
  disputeAcceptRate: number | null
  avgInspectionDays: number | null
  openDisputeCount: number
  completionRoutes: { REQUESTER: number; AUTO: number; SYSTEM_FORCED: number }
}

export interface DashboardLeadtime {
  medianFirstResponseHours: number | null
  medianResolutionHours: number | null
}

export interface AgingBucket {
  bucket: string
  count: number
}

export interface DashboardSla {
  responseCompliancePct: number | null
  resolutionCompliancePct: number | null
}

export interface DistributionEntry {
  status?: string
  org?: string
  type_code?: string
  label?: string
  count: number
}

export interface VolumeByTypeEntry {
  month: string
  type_code: string
  count: number
}

export interface AssigneeEntry {
  assignee_id: string
  name: string | null
  openCount: number
  resolvedCount: number
}

export interface DashboardMetrics {
  kpis: DashboardKpis
  leadtime: DashboardLeadtime
  aging: AgingBucket[]
  sla: DashboardSla
  distribution: {
    byStatus: Array<{ status: string; count: number }>
    byOrg: Array<{ org: string; count: number }>
    byType: Array<{ type_code: string; label: string; count: number }>
  }
  volumeByType: VolumeByTypeEntry[]
  byAssignee: AssigneeEntry[]
}

export function useDashboardMetrics(from?: string, to?: string) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const qs = params.toString()
  const url = `/api/dashboard/metrics${qs ? `?${qs}` : ''}`

  return useQuery({
    queryKey: ['dashboard', 'metrics', from ?? null, to ?? null],
    queryFn: () => apiGet<DashboardMetrics>(url),
    staleTime: 60_000,
  })
}
