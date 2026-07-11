import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { canSeeRequest } from '../authz.js'
import { parseId } from '../http.js'
import type { CurrentUser } from '../types.js'

/** 요청 존재 여부와 열람 권한을 함께 판정 */
async function loadForSee(u: CurrentUser, id: number): Promise<{ found: boolean; ok: boolean }> {
  const r = await db.execute<any>(sql`
    select id, requester_id, visibility, requester_org, requester_function
    from requests where id = ${id}`)
  const req = r.rows[0]
  if (!req) return { found: false, ok: false }
  const st = await db.execute<any>(sql`
    select target_type, target_value from request_shared_targets where request_id = ${id}`)
  const ok = canSeeRequest(
    u,
    { requesterId: req.requester_id, visibility: req.visibility, requesterOrg: req.requester_org, requesterFunction: req.requester_function },
    st.rows.map((x: any) => ({ targetType: x.target_type, targetValue: x.target_value })),
  )
  return { found: true, ok }
}

// 존재하지 않음/권한 없음을 구분하지 않고 404로 통일 (요청 존재 여부 열거 방지)
function guard(reply: any, found: boolean, ok: boolean): boolean {
  if (!found || !ok) { reply.code(404).send({ error: 'not found' }); return false }
  return true
}

export async function requestDetailRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get<{ Params: { id: string } }>('/api/requests/:id', async (request, reply) => {
    const u = request.currentUser!
    const id = parseId(request.params.id)
    if (id === null) { reply.code(404).send({ error: 'not found' }); return }
    const { found, ok } = await loadForSee(u, id)
    if (!guard(reply, found, ok)) return

    const viewRes = await db.execute<any>(sql`select * from request_view where id = ${id}`)
    const view = viewRes.rows[0]
    const ids = [view.requester_id, view.assignee_id].filter(Boolean)
    let byId: Record<string, any> = {}
    if (ids.length) {
      const p = await db.execute<any>(sql`
        select id, name, email, dept_function, org_affil from users
        where id in (${sql.join(ids.map((i: string) => sql`${i}`), sql`, `)})`)
      byId = Object.fromEntries(p.rows.map((r: any) => [r.id, r]))
    }
    const st = await db.execute<any>(sql`select * from request_shared_targets where request_id = ${id}`)
    return {
      view,
      requester: view.requester_id ? byId[view.requester_id] ?? null : null,
      assignee: view.assignee_id ? byId[view.assignee_id] ?? null : null,
      sharedTargets: st.rows,
    }
  })

  app.get<{ Params: { id: string } }>('/api/requests/:id/comments', async (request, reply) => {
    const u = request.currentUser!
    const id = parseId(request.params.id)
    if (id === null) { reply.code(404).send({ error: 'not found' }); return }
    const { found, ok } = await loadForSee(u, id)
    if (!guard(reply, found, ok)) return
    const r = await db.execute<any>(sql`
      select c.*, json_build_object('name', a.name) as author
      from request_comments c left join users a on a.id = c.author_id
      where c.request_id = ${id} order by c.created_at asc`)
    return r.rows
  })

  app.post<{ Params: { id: string }; Body: { body?: string } }>('/api/requests/:id/comments', async (request, reply) => {
    const u = request.currentUser!
    const id = parseId(request.params.id)
    if (id === null) { reply.code(404).send({ error: 'not found' }); return }
    const { found, ok } = await loadForSee(u, id)
    if (!guard(reply, found, ok)) return
    const body = (request.body?.body ?? '').trim()
    if (!body) { reply.code(400).send({ error: 'empty' }); return }
    await db.execute(sql`
      insert into request_comments (request_id, author_id, body)
      values (${id}, ${u.id}, ${body})`)
    reply.code(201); return { ok: true }
  })

  app.get<{ Params: { id: string } }>('/api/requests/:id/history', async (request, reply) => {
    const u = request.currentUser!
    const id = parseId(request.params.id)
    if (id === null) { reply.code(404).send({ error: 'not found' }); return }
    const { found, ok } = await loadForSee(u, id)
    if (!guard(reply, found, ok)) return
    const r = await db.execute<any>(sql`
      select h.*, json_build_object('name', a.name) as actor
      from request_status_history h left join users a on a.id = h.changed_by
      where h.request_id = ${id} order by h.changed_at asc`)
    return r.rows
  })

  app.get<{ Params: { id: string } }>('/api/requests/:id/attachments', async (request, reply) => {
    const u = request.currentUser!
    const id = parseId(request.params.id)
    if (id === null) { reply.code(404).send({ error: 'not found' }); return }
    const { found, ok } = await loadForSee(u, id)
    if (!guard(reply, found, ok)) return
    const r = await db.execute<any>(sql`
      select * from request_attachments where request_id = ${id} order by created_at asc`)
    return r.rows
  })
}
