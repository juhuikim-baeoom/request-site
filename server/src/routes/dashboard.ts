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
      // 이의(request_disputes) 서브쿼리용 — 이의가 걸린 요청(rq)의 created_at 기준으로 같은 창을 적용
      const disputeFromCond = from ? sql`and rq.created_at >= ${from}::timestamptz` : sql``
      const disputeToCond = to ? sql`and rq.created_at < (${to}::date + interval '1 day')` : sql``

      // ── KPIs ──
      const kpiRows = await db.execute<{
        open: string
        overdue_imminent: string
        p1p2_open: string
        rework_rate: string | null
        csat_positive_pct: string | null
        dispute_rate: string | null
        dispute_accept_rate: string | null
        avg_inspection_days: string | null
        route_requester: string
        route_auto: string
        route_system_forced: string
        open_dispute_count: string
      }>(sql`
        select
          count(*) filter (
            where r.status not in ('완료','반려','철회')
          )::text as open,
          count(*) filter (
            where r.status not in ('완료','반려','철회')
              and r.due_status in ('기한초과','임박')
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
          -- CSAT 긍정 비율: 5점 만점 중 4점 이상 = 긍정 (top-two-box)
          case
            when count(*) filter (where r.csat_rating is not null) = 0 then null
            else (
              count(*) filter (where r.csat_rating >= 4)::numeric /
              count(*) filter (where r.csat_rating is not null)
            )::text
          end as csat_positive_pct,

          -- 이의제기율: 완료 건(창 내) 대비 이의가 제기된 건의 비율 — 분자는 분모의 부분집합이 되도록
          -- r에 대한 filter로 표현한다 (요청 1건에 이의가 여러 건이어도 1건으로만 카운트)
          case
            when count(*) filter (where r.status = '완료') = 0 then null
            else (
              count(*) filter (where r.status = '완료'
                and exists (select 1 from request_disputes d where d.request_id = r.id))::numeric
              / count(*) filter (where r.status = '완료')
            )::text
          end as dispute_rate,

          -- 이의 수락률: 심사가 끝난 이의 중 수락 비율 — 이의가 걸린 요청(rq)의 created_at을
          -- 같은 기간 창으로 제한한다 (이의 row 자체는 r에 대한 filter로 표현할 수 없어 서브쿼리 유지)
          (
            select case
              when count(*) filter (where d.status_cd in ('ACCEPTED','REJECTED')) = 0 then null
              else count(*) filter (where d.status_cd = 'ACCEPTED')::numeric
                   / count(*) filter (where d.status_cd in ('ACCEPTED','REJECTED'))
            end
            from request_disputes d
            join requests rq on rq.id = d.request_id
            where true ${disputeFromCond} ${disputeToCond}
          )::text as dispute_accept_rate,

          -- 평균 검수 소요일: 팀이 손 뗀 시점(first_resolved_at) → 최종 완료
          avg(
            case when r.final_resolved_at is not null and r.first_resolved_at is not null
                 then extract(epoch from (r.final_resolved_at - r.first_resolved_at)) / 86400
            end
          )::text as avg_inspection_days,

          count(*) filter (where r.completion_route = 'REQUESTER')::text     as route_requester,
          count(*) filter (where r.completion_route = 'AUTO')::text          as route_auto,
          count(*) filter (where r.completion_route = 'SYSTEM_FORCED')::text as route_system_forced,

          (select count(*) from request_disputes where status_cd = 'OPEN')::text as open_dispute_count
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
        disputeRate: kpiRow.dispute_rate != null ? parseFloat(kpiRow.dispute_rate) : null,
        disputeAcceptRate: kpiRow.dispute_accept_rate != null ? parseFloat(kpiRow.dispute_accept_rate) : null,
        avgInspectionDays: kpiRow.avg_inspection_days != null ? parseFloat(kpiRow.avg_inspection_days) : null,
        openDisputeCount: Number(kpiRow.open_dispute_count ?? 0),
        completionRoutes: {
          REQUESTER: Number(kpiRow.route_requester ?? 0),
          AUTO: Number(kpiRow.route_auto ?? 0),
          SYSTEM_FORCED: Number(kpiRow.route_system_forced ?? 0),
        },
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
                  and r.first_resolved_at is not null
                  and r.first_resolved_at <= r.resolution_due_at
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
