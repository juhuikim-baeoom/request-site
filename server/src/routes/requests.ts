import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db, withUser } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { visibilityFilter, isSystem } from '../authz.js'
import { parseId, isOneOf, ORGS, TYPE_CODES, PRIORITIES, VISIBILITIES, STATUSES } from '../http.js'

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
    // enum 화이트리스트 검증 (잘못된 값이 DB까지 내려가 500 나는 것 방지)
    if (
      !isOneOf(ORGS, b.org) || !isOneOf(TYPE_CODES, b.type_code) ||
      (b.urgency !== undefined && !isOneOf(PRIORITIES, b.urgency)) ||
      (b.visibility !== undefined && !isOneOf(VISIBILITIES, b.visibility))
    ) { reply.code(400); return { error: 'invalid enum' } }
    const created = await withUser(u.id, async (tx) => {
      const ins = await tx.execute<any>(sql`
        insert into requests (org, type_code, urgency, visibility, title, body, desired_due, requester_id)
        values (${b.org}, ${b.type_code}, ${b.urgency ?? '보통'}, ${b.visibility ?? 'dept'},
                ${b.title.trim()}, ${b.body ?? null}, ${b.desired_due || null}, ${u.id})
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
    // 수정 대상 enum 값 검증
    if (
      (b.urgency !== undefined && !isOneOf(PRIORITIES, b.urgency)) ||
      (b.visibility !== undefined && !isOneOf(VISIBILITIES, b.visibility)) ||
      (b.status !== undefined && !isOneOf(STATUSES, b.status))
    ) { reply.code(400); return { error: 'invalid enum' } }
    const cur = await db.execute<any>(sql`select requester_id, status from requests where id = ${id}`)
    const row = cur.rows[0]
    if (!row) { reply.code(404); return { error: 'not found' } }

    const isOwner = row.requester_id === u.id
    const sys = isSystem(u)

    // 보드 변경(status/assignee) — 시스템팀만. 단 소유자의 '접수→철회'는 허용.
    const wantsBoard = b.status !== undefined || b.assignee_id !== undefined
    const ownerCancel = isOwner && row.status === '접수' && b.status === '철회' && b.assignee_id === undefined
    if (wantsBoard && !sys && !ownerCancel) { reply.code(403); return { error: 'forbidden' } }

    // 내용 수정 — 시스템팀 또는 (본인 且 접수)
    const wantsEdit = ['title', 'body', 'urgency', 'visibility', 'desired_due'].some((k) => b[k] !== undefined)
    if (wantsEdit && !sys && !(isOwner && row.status === '접수')) { reply.code(403); return { error: 'forbidden' } }

    const sets: any[] = []
    for (const k of ['title', 'body', 'urgency', 'visibility', 'desired_due', 'status', 'assignee_id']) {
      if (b[k] !== undefined) sets.push(sql`${sql.raw(k)} = ${b[k]}`)
    }
    if (!sets.length) { reply.code(400); return { error: 'no fields' } }

    await withUser(u.id, (tx) =>
      tx.execute(sql`update requests set ${sql.join(sets, sql`, `)} where id = ${id}`))
    reply.code(200); return { ok: true }
  })
}
