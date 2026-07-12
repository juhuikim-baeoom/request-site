import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { isSystem, canSeeRequest } from '../authz.js'
import { parseId } from '../http.js'
import { raiseDispute, reviewDispute, DisputeError } from '../services/disputes.js'

/** DisputeError 코드를 HTTP 상태로 매핑 */
function statusFor(code: string): number {
  switch (code) {
    case 'NOT_FOUND': return 404
    case 'ALREADY_OPEN': return 409
    default: return 400
  }
}

export async function disputeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate)

  // 이의 목록 — 해당 요청을 볼 수 있는 사람만
  app.get<{ Params: { id: string } }>('/api/requests/:id/disputes', async (request, reply) => {
    const u = request.currentUser!
    const id = parseId(request.params.id)
    if (id === null) { reply.code(404); return { error: 'not found' } }

    const cur = await db.execute<any>(sql`
      select requester_id, visibility, requester_org, requester_function
      from requests where id = ${id}`)
    const row = cur.rows[0]
    if (!row) { reply.code(404); return { error: 'not found' } }

    const shared = await db.execute<any>(sql`
      select target_type, target_value from request_shared_targets where request_id = ${id}`)
    const visible = canSeeRequest(
      u,
      {
        requesterId: row.requester_id,
        visibility: row.visibility,
        requesterOrg: row.requester_org,
        requesterFunction: row.requester_function,
      },
      shared.rows.map((s: any) => ({ targetType: s.target_type, targetValue: s.target_value })),
    )
    if (!visible) { reply.code(403); return { error: 'forbidden' } }

    const list = await db.execute<any>(sql`
      select d.id, d.reason, d.status_cd, d.review_comment, d.reviewed_at, d.created_at,
             ru.name as raised_by_name, vu.name as reviewed_by_name
      from request_disputes d
      left join users ru on ru.id = d.raised_by
      left join users vu on vu.id = d.reviewed_by
      where d.request_id = ${id}
      order by d.created_at desc`)
    return { disputes: list.rows }
  })

  // 이의제기 — 요청자 본인만
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/requests/:id/disputes',
    async (request, reply) => {
      const u = request.currentUser!
      const id = parseId(request.params.id)
      if (id === null) { reply.code(404); return { error: 'not found' } }

      const reason = request.body?.reason?.trim()
      if (!reason) { reply.code(400); return { error: 'reason required' } }

      const cur = await db.execute<{ requester_id: string | null }>(sql`
        select requester_id from requests where id = ${id}`)
      const row = cur.rows[0]
      if (!row) { reply.code(404); return { error: 'not found' } }
      if (row.requester_id !== u.id) {
        reply.code(403); return { error: 'forbidden: only the requester can dispute' }
      }

      try {
        const created = await raiseDispute({ reqId: id, raisedBy: u.id, reason })
        reply.code(201); return created
      } catch (e: any) {
        if (e instanceof DisputeError) {
          reply.code(statusFor(e.code)); return { error: e.message, code: e.code }
        }
        throw e
      }
    },
  )

  // 이의 심사 — 시스템팀만
  app.patch<{ Params: { id: string }; Body: { decision?: string; comment?: string } }>(
    '/api/disputes/:id',
    async (request, reply) => {
      const u = request.currentUser!
      if (!isSystem(u)) { reply.code(403); return { error: 'forbidden' } }

      const id = parseId(request.params.id)
      if (id === null) { reply.code(404); return { error: 'not found' } }

      const decision = request.body?.decision
      if (decision !== 'ACCEPTED' && decision !== 'REJECTED') {
        reply.code(400); return { error: 'decision must be ACCEPTED or REJECTED' }
      }
      const comment = request.body?.comment?.trim()
      if (!comment) { reply.code(400); return { error: 'comment required' } }

      try {
        await reviewDispute({ disputeId: id, decision, comment, actorId: u.id })
        reply.code(200); return { ok: true }
      } catch (e: any) {
        if (e instanceof DisputeError) {
          reply.code(statusFor(e.code)); return { error: e.message, code: e.code }
        }
        throw e
      }
    },
  )
}
