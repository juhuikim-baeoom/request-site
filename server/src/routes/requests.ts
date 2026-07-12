import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db, withUser } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { visibilityFilter, isSystem } from '../authz.js'
import { parseId, isOneOf, ORGS, TYPE_CODES, PRIORITIES, VISIBILITIES } from '../http.js'
import { changeStatus, TransitionError } from '../services/transition.js'
import { assignRequest, AssignError } from '../services/assign.js'
import { urgencyResponseLevel, addBusinessMinutes, type Urgency, type Impact } from '../sla.js'
import type { CompletionRoute } from '../services/inspection.js'

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

    // urgency 기반 response_due_at 계산
    const urgency: Urgency = isOneOf(PRIORITIES, b.urgency) ? b.urgency : '보통'
    const respLevel = urgencyResponseLevel(urgency)

    const holidayRows = await db.execute<{ holiday_on: string }>(sql`select holiday_on from holidays`)
    const holidaySet = new Set(holidayRows.rows.map((h: any) => h.holiday_on))

    const policyRes = await db.execute<{ response_minutes: number }>(
      sql`select response_minutes from sla_policy where priority_level = ${respLevel}`,
    )
    const respMin = policyRes.rows[0]?.response_minutes ?? null

    const responseDueAt = respMin != null
      ? addBusinessMinutes(new Date(), respMin, holidaySet)
      : null

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

    // 트리거·서버가 소유하는 계산 필드는 클라이언트 입력을 무시한다
    const BLOCKED_FIELDS = ['completed_at', 'first_resolved_at', 'final_resolved_at', 'rework_count', 'sla_resolution_breached', 'inspection_due_at', 'completion_route', 'completion_note']
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
      // status 변경과 내용 편집을 한 번에 허용하지 않아 stale-status 우회 방지.
      // 단 검수 승인(검수대기 → 완료)만은 CSAT를 함께 저장해야 하므로 예외로 둔다.
      const otherFields = ['title', 'body', 'urgency', 'visibility', 'desired_due', 'assignee_id']
      if (otherFields.some((k) => b[k] !== undefined)) {
        reply.code(400); return { error: 'status change and field edit must not be combined in one request' }
      }

      const isInspecting = row.status === '검수대기'
      const ownerCancel   = isOwner && row.status === '접수' && b.status === '철회'
      const ownerApprove  = isOwner && isInspecting && b.status === '완료'
      const ownerRework   = isOwner && isInspecting && b.status === '진행중'
      // isOwner 제외: 시스템팀 계정이 자기 자신의 요청을 검수 승인하는 경우는
      // "강제완료"가 아니라 통상적인 요청자 승인(REQUESTER)으로 취급해야 사유 필수 규칙이
      // 잘못 걸리지 않는다 (시드에 시스템팀 1명뿐이라 owner==system인 경우가 실재한다).
      const systemForce   = sys && !isOwner && isInspecting && b.status === '완료'

      if (!sys && !ownerCancel && !ownerApprove && !ownerRework) {
        reply.code(403); return { error: 'forbidden' }
      }

      // 사유 필수: 검수 반려, 시스템팀 강제완료
      if ((ownerRework || systemForce) && !b.reason) {
        reply.code(400); return { error: 'reason required' }
      }

      // CSAT는 요청자 승인일 때만 허용한다
      const hasCsat = b.csat_rating !== undefined || b.csat_comment !== undefined
      if (hasCsat && !ownerApprove) {
        reply.code(400); return { error: 'csat allowed only on requester approval' }
      }
      if (b.csat_rating !== undefined) {
        const n = Number(b.csat_rating)
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          reply.code(400); return { error: 'csat_rating must be an integer 1-5' }
        }
      }

      let completionRoute: CompletionRoute | undefined
      if (b.status === '완료') {
        completionRoute = ownerApprove ? 'REQUESTER' : 'SYSTEM_FORCED'
      }

      try {
        await changeStatus({ reqId: id, to: b.status, reason: b.reason, actorId: u.id, completionRoute })
      } catch (e: any) {
        if (e instanceof TransitionError) {
          if (e.code === 'NOT_FOUND') { reply.code(404); return { error: 'not found' } }
          reply.code(400); return { error: e.message, code: e.code }
        }
        throw e
      }

      // 승인 CSAT는 전이 성공 후 별도 UPDATE로 기록한다 (전이 실패 시 남지 않도록)
      if (ownerApprove && hasCsat) {
        await db.execute(sql`
          update requests
          set csat_rating = ${b.csat_rating ?? null}, csat_comment = ${b.csat_comment ?? null}
          where id = ${id}`)
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
}
