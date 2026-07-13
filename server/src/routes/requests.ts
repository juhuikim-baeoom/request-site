import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db, withUser } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { visibilityFilter, isSystem } from '../authz.js'
import { parseId, isOneOf, ORGS, TYPE_CODES, PRIORITIES, VISIBILITIES } from '../http.js'
import { changeStatus, TransitionError } from '../services/transition.js'
import { assignRequest, AssignError } from '../services/assign.js'
import { changeImpact, ImpactError, CLOSED } from '../services/impact.js'
import { computeSlaFields, computeResponseDueAtForUrgency, loadHolidaySet } from '../services/sla-fields.js'
import { type Urgency, type Impact } from '../sla.js'

// intake_detail 필수키 맵
const INTAKE_REQUIRED: Record<string, string[]> = {
  error:   ['screen_url', 'reproduce', 'occurred_at'],
  feature: ['purpose', 'expected_effect'],
  data:    ['items', 'period', 'format'],
  file:    ['target_file', 'change_detail'],
}

export async function requestRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // 내가 볼 수 있는 요청 목록 (request_view + visibilityFilter). 최신순
  app.get('/api/requests', async (request) => {
    const u = request.currentUser!
    const filter = visibilityFilter(u)
    const r = await db.execute(sql`
      select r.* from request_view r
      where ${filter}
      order by r.created_at desc`)
    return r.rows
  })

  // 볼 수 있는 요청들의 추가 공유 대상 (뱃지 표시용)
  app.get('/api/requests/shared-targets', async (request) => {
    const u = request.currentUser!
    const filter = visibilityFilter(u)
    const r = await db.execute(sql`
      select st.* from request_shared_targets st
      where st.request_id in (select r.id from request_view r where ${filter})`)
    return r.rows
  })

  // 요청 생성 (seq/스냅샷은 트리거가 채움)
  app.post<{ Body: any }>('/api/requests', async (request, reply) => {
    const u = request.currentUser!
    const b: any = request.body ?? {}
    if (!b.org || !b.type_code || !b.title?.trim()) { reply.code(400); return { error: 'invalid' } }
    // enum 화이트리스트 검증
    if (
      !isOneOf(ORGS, b.org) || !isOneOf(TYPE_CODES, b.type_code) ||
      (b.urgency !== undefined && !isOneOf(PRIORITIES, b.urgency)) ||
      (b.visibility !== undefined && !isOneOf(VISIBILITIES, b.visibility))
    ) { reply.code(400); return { error: 'invalid enum' } }

    // intake_detail 필수키 검증
    const typeCode: string = b.type_code
    const required = INTAKE_REQUIRED[typeCode]
    if (required) {
      const detail: Record<string, unknown> = (typeof b.intake_detail === 'object' && b.intake_detail !== null)
        ? b.intake_detail
        : {}
      const missing = required.filter((k) => {
        if (!(k in detail)) return true
        const v = detail[k]
        if (v === undefined || v === null) return true
        // 타입별 구체적 검증: 문자열은 비어있으면 안 되고, 비문자열(객체·배열·숫자 등)은 허용하지 않음
        if (typeof v !== 'string') return true
        if (v.trim() === '') return true
        return false
      })
      if (missing.length > 0) {
        reply.code(400)
        return { error: 'intake_detail_missing', missing }
      }
    }

    // urgency 기반 response_due_at 계산 (미배정 긴급도 편집 재산정 분기와 동일 함수 공유)
    const urgency: Urgency = isOneOf(PRIORITIES, b.urgency) ? b.urgency : '보통'
    const holidaySet = await loadHolidaySet()
    const responseDueAt = await computeResponseDueAtForUrgency({
      tx: db,
      urgency,
      from: new Date(),
      holidaySet,
    })

    const created = await withUser(u.id, async (tx) => {
      const ins = await tx.execute<any>(sql`
        insert into requests (org, type_code, urgency, visibility, title, body, desired_due, requester_id, intake_detail, response_due_at)
        values (
          ${b.org}, ${b.type_code}, ${urgency}, ${b.visibility ?? 'dept'},
          ${b.title.trim()}, ${b.body ?? null}, ${b.desired_due || null}, ${u.id},
          ${b.intake_detail ? JSON.stringify(b.intake_detail) : '{}'}::jsonb,
          ${responseDueAt}
        )
        returning *`)
      const row = ins.rows[0]
      const targets = Array.isArray(b.sharedTargets) ? b.sharedTargets : []
      for (const t of targets) {
        await tx.execute(sql`
          insert into request_shared_targets (request_id, target_type, target_value)
          values (${row.id}, ${t.target_type}, ${t.target_value})
          on conflict do nothing`)
      }
      return row
    })
    reply.code(201); return created
  })

  // 수정/철회/보드 변경 통합
  app.patch<{ Params: { id: string }; Body: any }>('/api/requests/:id', async (request, reply) => {
    const u = request.currentUser!
    const id = parseId(request.params.id)
    if (id === null) { reply.code(404); return { error: 'not found' } }
    const b: any = request.body ?? {}

    // completed_at 등 계산 필드는 클라이언트에서 무시
    const BLOCKED_FIELDS = ['completed_at', 'first_resolved_at', 'final_resolved_at', 'rework_count', 'sla_resolution_breached']
    for (const f of BLOCKED_FIELDS) { delete b[f] }

    // 수정 대상 enum 값 검증 (status가 있으면 changeStatus에서 검증하므로 여기서는 기본 형식만)
    if (
      (b.urgency !== undefined && !isOneOf(PRIORITIES, b.urgency)) ||
      (b.visibility !== undefined && !isOneOf(VISIBILITIES, b.visibility))
    ) { reply.code(400); return { error: 'invalid enum' } }

    const cur = await db.execute<any>(sql`select requester_id, status from requests where id = ${id}`)
    const row = cur.rows[0]
    if (!row) { reply.code(404); return { error: 'not found' } }

    const isOwner = row.requester_id === u.id
    const sys = isSystem(u)

    // 상태 변경은 changeStatus()를 통해서만
    if (b.status !== undefined) {
      // status 변경과 내용 편집을 한 번에 허용하지 않아 stale-status 우회 방지 (issues 2, 4, 5, 6)
      const otherFields = ['title', 'body', 'urgency', 'visibility', 'desired_due', 'assignee_id']
      if (otherFields.some((k) => b[k] !== undefined)) {
        reply.code(400); return { error: 'status change and field edit must not be combined in one request' }
      }

      const ownerCancel = isOwner && row.status === '접수' && b.status === '철회'
      if (!sys && !ownerCancel) { reply.code(403); return { error: 'forbidden' } }

      try {
        await changeStatus({ reqId: id, to: b.status, reason: b.reason, actorId: u.id })
      } catch (e: any) {
        if (e instanceof TransitionError) {
          if (e.code === 'NOT_FOUND') { reply.code(404); return { error: 'not found' } }
          reply.code(400); return { error: e.message, code: e.code }
        }
        throw e
      }

      reply.code(200); return { ok: true }
    }

    // 보드 변경(assignee) — 시스템팀만
    const wantsBoard = b.assignee_id !== undefined
    if (wantsBoard && !sys) { reply.code(403); return { error: 'forbidden' } }

    // 내용 수정 — 시스템팀 또는 (본인 且 접수)
    // row.status는 status 변경이 없는 경우에만 이 분기에 도달하므로 stale 문제 없음
    const wantsEdit = ['title', 'body', 'urgency', 'visibility', 'desired_due'].some((k) => b[k] !== undefined)
    if (wantsEdit && !sys && !(isOwner && row.status === '접수')) { reply.code(403); return { error: 'forbidden' } }

    const sets: any[] = []
    for (const k of ['title', 'body', 'urgency', 'visibility', 'desired_due', 'assignee_id']) {
      if (b[k] !== undefined) sets.push(sql`${sql.raw(k)} = ${b[k]}`)
    }
    if (!sets.length) { reply.code(400); return { error: 'no fields' } }

    // 긴급도 편집은 priority_level = derivePriority(urgency, impact)를 어긋나게 만들 수 있다.
    // urgency가 실제로 바뀌고 종결 상태가 아니면:
    //  - impact가 있으면(=배정된 건): 공용 computeSlaFields로 priority_level·SLA 기한 전체를
    //    재산정한다 (assigned_at·first_response_at·status는 보존).
    //  - impact가 없으면(=미배정 건, 요청자가 편집 가능한 유일한 창): 요청 생성부와 동일한
    //    computeResponseDueAtForUrgency로 response_due_at만 재산정한다. priority_level 등은
    //    아직 impact가 없어 정할 수 없으므로 건드리지 않는다.
    // TOCTOU 방지: SELECT … FOR UPDATE와 재산정 UPDATE를 같은 트랜잭션에서 수행한다 (assign.ts/impact.ts와 동일 관례).
    if (b.urgency !== undefined) {
      const holidaySet = await loadHolidaySet()
      await withUser(u.id, async (tx) => {
        const cur2 = await tx.execute<{
          urgency: Urgency
          impact: Impact | null
          status: string
          created_at: string
          first_response_at: string | null
        }>(sql`select urgency, impact, status, created_at, first_response_at from requests where id = ${id} for update`)
        const r2 = cur2.rows[0]
        if (r2 && !CLOSED.includes(r2.status) && b.urgency !== r2.urgency) {
          if (r2.impact != null) {
            // assign.ts는 assignee_id·first_response_at을 함께 세팅하지만, 인라인 담당자 지정
            // (PATCH /api/requests/:id { assignee_id })은 assignee_id만 UPDATE하고 first_response_at은
            // 건드리지 않는다 — 그 경로를 거치면 impact != null && first_response_at = null인 행이
            // 실제로 생긴다. 이 널가드는 그 경로에서 실제로 도달한다: null이면 아직 미응답 건으로 보고
            // 현재 시각을 기준으로 breach를 판정한다(대시보드 응답 SLA 준수율 정의와 일치).
            const firstResponseAt = r2.first_response_at != null ? new Date(r2.first_response_at) : null
            const sla = await computeSlaFields({
              tx,
              urgency: b.urgency as Urgency,
              impact: r2.impact,
              createdAt: r2.created_at,
              holidaySet,
              firstResponseAt,
            })
            sets.push(
              sql`priority_level = ${sla.priorityLevel}`,
              sql`response_due_at = ${sla.responseDueAt}`,
              sql`resolution_due_at = ${sla.resolutionDueAt}`,
              sql`sla_policy_id = ${sla.slaPolicyId}`,
              sql`sla_response_breached = ${sla.responseBreached}`,
            )
          } else {
            const responseDueAt = await computeResponseDueAtForUrgency({
              tx,
              urgency: b.urgency as Urgency,
              from: new Date(r2.created_at),
              holidaySet,
            })
            sets.push(sql`response_due_at = ${responseDueAt}`)
          }
        }
        await tx.execute(sql`update requests set ${sql.join(sets, sql`, `)} where id = ${id}`)
      })
      reply.code(200); return { ok: true }
    }

    await withUser(u.id, (tx) =>
      tx.execute(sql`update requests set ${sql.join(sets, sql`, `)} where id = ${id}`))
    reply.code(200); return { ok: true }
  })

  // 미배정 건 배정 (system 전용)
  app.post<{ Params: { id: string }; Body: any }>('/api/requests/:id/assign', async (request, reply) => {
    const u = request.currentUser!
    if (!isSystem(u)) { reply.code(403); return { error: 'forbidden' } }

    const id = parseId(request.params.id)
    if (id === null) { reply.code(404); return { error: 'not found' } }

    const b: any = request.body ?? {}
    if (!b.assigneeId || !isOneOf(PRIORITIES, b.impact as string)) {
      reply.code(400); return { error: 'assigneeId and impact(높음|보통|낮음) required' }
    }

    try {
      await assignRequest({ reqId: id, assigneeId: b.assigneeId, impact: b.impact as Impact, actorId: u.id })
    } catch (e: any) {
      if (e instanceof AssignError) {
        if (e.code === 'NOT_FOUND') { reply.code(404); return { error: 'not found' } }
        reply.code(400); return { error: e.message, code: e.code }
      }
      throw e
    }

    reply.code(200); return { ok: true }
  })

  // 영향도 재조정 — 시스템팀 전용. priority_level·SLA 기한 재산정.
  app.patch<{ Params: { id: string }; Body: { impact?: string } }>(
    '/api/requests/:id/impact',
    async (request, reply) => {
      const u = request.currentUser!
      if (!isSystem(u)) { reply.code(403); return { error: 'forbidden' } }

      const id = parseId(request.params.id)
      if (id === null) { reply.code(404); return { error: 'not found' } }

      const b = request.body ?? {}
      if (!isOneOf(PRIORITIES, b.impact as string)) {
        reply.code(400); return { error: 'impact(높음|보통|낮음) required' }
      }

      try {
        const { priorityLevel } = await changeImpact({
          reqId: id,
          impact: b.impact as Impact,
          actorId: u.id,
        })
        reply.code(200); return { ok: true, priority_level: priorityLevel }
      } catch (e: any) {
        if (e instanceof ImpactError) {
          if (e.code === 'NOT_FOUND') { reply.code(404); return { error: 'not found' } }
          reply.code(400); return { error: e.message, code: e.code }
        }
        throw e
      }
    },
  )
}
