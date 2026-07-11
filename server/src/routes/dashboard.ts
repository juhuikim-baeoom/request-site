import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { isViewerUp } from '../authz.js'

/** YYYY-MM-DD 형식 검증 */
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/dashboard/metrics',
    async (request, reply) => {
      const u = request.currentUser!
      if (!isViewerUp(u)) {
        reply.code(403)
        return { error: 'forbidden' }
      }

      const { from, to } = request.query
      if (from && !isValidDate(from)) { reply.code(400); return { error: 'invalid from' } }
      if (to && !isValidDate(to)) { reply.code(400); return { error: 'invalid to' } }

      // 기간 필터 조건 (created_at 기준)
      const fromCond = from ? sql`and r.created_at >= ${from}::timestamptz` : sql``
      const toCond = to ? sql`and r.created_at < (${to}::date + interval '1 day')` : sql``

      // ── KPIs ──
      const kpiRows = await db.execute<{
        open: string
        overdue_imminent: string
        p1p2_open: string
        rework_rate: string | null
        csat_positive_pct: string | null
      }>(sql`
        select
          count(*) filter (
            where r.status not in ('완료','반려','철회')
          )::text as open,
          count(*) filter (
            where r.status not in ('완료','반려','철회')
              and r.due_status in ('초과','임박')
          )::text as overdue_imminent,
          count(*) filter (
            where r.status not in ('완료','반려','철회')
              and r.priority_level in ('P1','P2')
          )::text as p1p2_open,
          case
            when count(*) filter (where r.status = '완료') = 0 then null
            else (
              count(*) filter (where r.status = '완료' and r.rework_count > 0)::numeric /
              count(*) filter (where r.status = '완료')
            )::text
          end as rework_rate,
          case
            when count(*) filter (where r.csat_rating is not null) = 0 then null
            else (
              count(*) filter (where r.csat_rating = 1)::numeric /
              count(*) filter (where r.csat_rating is not null)
            )::text
          end as csat_positive_pct
        from request_view r
        where true ${fromCond} ${toCond}
      `)

      const kpiRow = kpiRows.rows[0]
      const kpis = {
        open: parseInt(kpiRow.open ?? '0', 10),
        overdueImminent: parseInt(kpiRow.overdue_imminent ?? '0', 10),
        p1p2Open: parseInt(kpiRow.p1p2_open ?? '0', 10),
        reworkRate: kpiRow.rework_rate != null ? parseFloat(kpiRow.rework_rate) : null,
        csatPositivePct: kpiRow.csat_positive_pct != null ? parseFloat(kpiRow.csat_positive_pct) : null,
      }

      // ── Leadtime (중앙값) ──
      const leadRows = await db.execute<{
        median_first_response_hours: string | null
        median_resolution_hours: string | null
      }>(sql`
        select
          percentile_cont(0.5) within group (
            order by extract(epoch from (r.first_response_at - r.created_at)) / 3600
          ) filter (where r.first_response_at is not null)::text as median_first_response_hours,
          percentile_cont(0.5) within group (
            order by extract(epoch from (r.final_resolved_at - r.created_at)) / 3600
          ) filter (where r.final_resolved_at is not null)::text as median_resolution_hours
        from request_view r
        where true ${fromCond} ${toCond}
      `)

      const leadRow = leadRows.rows[0]
      const leadtime = {
        medianFirstResponseHours: leadRow.median_first_response_hours != null
          ? parseFloat(leadRow.median_first_response_hours) : null,
        medianResolutionHours: leadRow.median_resolution_hours != null
          ? parseFloat(leadRow.median_resolution_hours) : null,
      }

      // ── Aging (미완료/열린 건) ──
      const agingRows = await db.execute<{ bucket: string; count: string }>(sql`
        select
          case
            when extract(epoch from (now() - r.created_at)) / 86400 < 3 then '<3d'
            when extract(epoch from (now() - r.created_at)) / 86400 < 7 then '3-7d'
            when extract(epoch from (now() - r.created_at)) / 86400 < 14 then '7-14d'
            else '>14d'
          end as bucket,
          count(*)::text as count
        from request_view r
        where r.status not in ('완료','반려','철회')
          ${fromCond} ${toCond}
        group by 1
      `)

      const bucketOrder = ['<3d', '3-7d', '7-14d', '>14d']
      const agingMap = new Map<string, number>()
      for (const row of agingRows.rows) {
        agingMap.set(row.bucket, parseInt(row.count, 10))
      }
      const aging = bucketOrder.map((bucket) => ({ bucket, count: agingMap.get(bucket) ?? 0 }))

      // ── SLA ──
      const slaRows = await db.execute<{
        response_compliance: string | null
        resolution_compliance: string | null
      }>(sql`
        select
          case
            when count(*) filter (
              where r.assigned_at is not null and r.response_due_at is not null
            ) = 0 then null
            else (
              count(*) filter (
                where r.assigned_at is not null
                  and r.response_due_at is not null
                  and r.first_response_at is not null
                  and r.first_response_at <= r.response_due_at
              )::numeric /
              count(*) filter (
                where r.assigned_at is not null and r.response_due_at is not null
              )
            )::text
          end as response_compliance,
          case
            when count(*) filter (
              where r.status = '완료' and r.resolution_due_at is not null
            ) = 0 then null
            else (
              count(*) filter (
                where r.status = '완료'
                  and r.resolution_due_at is not null
                  and r.final_resolved_at is not null
                  and r.final_resolved_at <= r.resolution_due_at
              )::numeric /
              count(*) filter (
                where r.status = '완료' and r.resolution_due_at is not null
              )
            )::text
          end as resolution_compliance
        from request_view r
        where true ${fromCond} ${toCond}
      `)

      const slaRow = slaRows.rows[0]
      const sla = {
        responseCompliancePct: slaRow.response_compliance != null
          ? parseFloat(slaRow.response_compliance) : null,
        resolutionCompliancePct: slaRow.resolution_compliance != null
          ? parseFloat(slaRow.resolution_compliance) : null,
      }

      // ── Distribution ──
      const [byStatusRows, byOrgRows, byTypeRows] = await Promise.all([
        db.execute<{ status: string; count: string }>(sql`
          select r.status, count(*)::text as count
          from request_view r
          where true ${fromCond} ${toCond}
          group by r.status
          order by count(*) desc
        `),
        db.execute<{ org: string; count: string }>(sql`
          select r.org, count(*)::text as count
          from request_view r
          where true ${fromCond} ${toCond}
          group by r.org
          order by count(*) desc
        `),
        db.execute<{ type_code: string; label: string; count: string }>(sql`
          select r.type_code, coalesce(rt.label, r.type_code) as label, count(*)::text as count
          from request_view r
          left join request_types rt on rt.code = r.type_code
          where true ${fromCond} ${toCond}
          group by r.type_code, rt.label
          order by count(*) desc
        `),
      ])

      const distribution = {
        byStatus: byStatusRows.rows.map((row) => ({ status: row.status, count: parseInt(row.count, 10) })),
        byOrg: byOrgRows.rows.map((row) => ({ org: row.org, count: parseInt(row.count, 10) })),
        byType: byTypeRows.rows.map((row) => ({ type_code: row.type_code, label: row.label, count: parseInt(row.count, 10) })),
      }

      // ── Volume by type (월별 x 유형) ──
      const volumeRows = await db.execute<{ month: string; type_code: string; count: string }>(sql`
        select
          to_char(r.created_at, 'YYYY-MM') as month,
          r.type_code,
          count(*)::text as count
        from request_view r
        where true ${fromCond} ${toCond}
        group by 1, 2
        order by 1, 2
      `)

      const volumeByType = volumeRows.rows.map((row) => ({
        month: row.month,
        type_code: row.type_code,
        count: parseInt(row.count, 10),
      }))

      // ── By assignee ──
      const assigneeRows = await db.execute<{
        assignee_id: string
        name: string | null
        open_count: string
        resolved_count: string
      }>(sql`
        select
          r.assignee_id,
          u.name,
          count(*) filter (where r.status not in ('완료','반려','철회'))::text as open_count,
          count(*) filter (where r.status = '완료')::text as resolved_count
        from request_view r
        left join users u on u.id = r.assignee_id
        where r.assignee_id is not null
          ${fromCond} ${toCond}
        group by r.assignee_id, u.name
        order by count(*) filter (where r.status not in ('완료','반려','철회')) desc
      `)

      const byAssignee = assigneeRows.rows.map((row) => ({
        assignee_id: row.assignee_id,
        name: row.name,
        openCount: parseInt(row.open_count, 10),
        resolvedCount: parseInt(row.resolved_count, 10),
      }))

      return {
        kpis,
        leadtime,
        aging,
        sla,
        distribution,
        volumeByType,
        byAssignee,
      }
    },
  )
}
