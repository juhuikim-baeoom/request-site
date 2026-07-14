import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db, withUser } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { canSeeRequest, canProcess, canSeeComment } from '../authz.js'
import { parseId } from '../http.js'
import type { CurrentUser } from '../types.js'
import { notify } from '../services/notify.js'

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
    // 내부메모는 시스템팀 또는 작성자에게만
    const filtered = r.rows.filter((c: any) =>
      canSeeComment(u, { isInternal: c.is_internal, authorId: c.author_id }),
    )
    return filtered
  })

  app.post<{ Params: { id: string }; Body: { body?: string; is_internal?: boolean } }>(
    '/api/requests/:id/comments',
    async (request, reply) => {
      const u = request.currentUser!
      const id = parseId(request.params.id)
      if (id === null) { reply.code(404).send({ error: 'not found' }); return }
      const { found, ok } = await loadForSee(u, id)
      if (!guard(reply, found, ok)) return
      const body = (request.body?.body ?? '').trim()
      if (!body) { reply.code(400).send({ error: 'empty' }); return }

      // is_internal: 시스템팀만 true 가능. staff가 true 요청하면 false로 강제
      const wantsInternal = request.body?.is_internal === true
      const isInternal = wantsInternal && canProcess(u)

      // reqMeta 조회를 withUser 트랜잭션 안에서 수행해 TOCTOU 방지
      // (INSERT 시점의 최신 assignee를 읽음)
      let reqRow: { requester_id: string | null; assignee_id: string | null; seq: string | null } | undefined
      const inserted = await withUser(u.id, async (tx) => {
        const reqMeta = await tx.execute<{ requester_id: string | null; assignee_id: string | null; seq: string | null }>(
          sql`select requester_id, assignee_id, seq from requests where id = ${id}`,
        )
        reqRow = reqMeta.rows[0]
        return tx.execute<any>(sql`
          insert into request_comments (request_id, author_id, body, is_internal)
          values (${id}, ${u.id}, ${body}, ${isInternal})
          returning id
        `)
      })

      // 공개 댓글인 경우에만 알림 발송
      if (!isInternal && reqRow) {
        const seq = reqRow.seq ?? String(id)
        const actorIsSystem = canProcess(u)
        // 행위자가 시스템/담당이면 requester에게, 행위자가 requester이면 assignee에게
        if (actorIsSystem || reqRow.assignee_id === u.id) {
          // 시스템팀 또는 담당자가 댓글 → requester에게 알림
          if (reqRow.requester_id && reqRow.requester_id !== u.id) {
            void notify(reqRow.requester_id, 'comment', id, `요청 ${seq}에 새 댓글이 등록되었습니다`)
          }
        } else if (reqRow.requester_id === u.id) {
          // requester가 댓글 → assignee에게 알림
          if (reqRow.assignee_id && reqRow.assignee_id !== u.id) {
            void notify(reqRow.assignee_id, 'comment', id, `요청 ${seq}에 새 댓글이 등록되었습니다`)
          }
        }
      }

      reply.code(201); return { id: inserted.rows[0].id }
    },
  )

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

  // 공유 범위 변경 이력 — "이 요청을 왜 저 팀이 보고 있지?"에 답하기 위한 것으로
  // 내부메모와 달리 민감 정보가 아니다. canSeeRequest를 통과하면(=loadForSee) 누구나 볼 수 있다.
  app.get<{ Params: { id: string } }>('/api/requests/:id/sharing-history', async (request, reply) => {
    const u = request.currentUser!
    const id = parseId(request.params.id)
    if (id === null) { reply.code(404).send({ error: 'not found' }); return }
    const { found, ok } = await loadForSee(u, id)
    if (!guard(reply, found, ok)) return
    const r = await db.execute<any>(sql`
      select h.id, h.changed_at, h.from_visibility, h.to_visibility, h.added, h.removed,
             json_build_object('name', a.name) as actor
      from request_sharing_history h left join users a on a.id = h.changed_by
      where h.request_id = ${id} order by h.changed_at asc`)
    return r.rows
  })

  app.get<{ Params: { id: string } }>('/api/requests/:id/attachments', async (request, reply) => {
    const u = request.currentUser!
    const id = parseId(request.params.id)
    if (id === null) { reply.code(404).send({ error: 'not found' }); return }
    const { found, ok } = await loadForSee(u, id)
    if (!guard(reply, found, ok)) return
    // 댓글에 딸린 첨부는 그 댓글의 내부메모 여부·작성자를 함께 읽어와
    // canSeeComment와 동일한 규칙으로 필터링한다(본문을 감추면서 첨부만 새는 것 방지)
    const r = await db.execute<any>(sql`
      select a.*, c.is_internal as _comment_is_internal, c.author_id as _comment_author_id
      from request_attachments a
      left join request_comments c on c.id = a.comment_id
      where a.request_id = ${id} order by a.created_at asc`)
    return r.rows
      .filter((row: any) => {
        // comment_id가 없는 일반(요청 본문) 첨부는 그대로 노출한다.
        if (row.comment_id == null) return true
        // comment_id는 있는데 조인된 댓글 행이 없다(예: 댓글 삭제로 comment_id가
        // set null되기 전 시점의 레이스, 또는 이후 댓글 삭제 기능이 생겼을 때) —
        // is_internal은 NOT NULL이므로 null이면 조인 실패를 의미한다. fail-open으로
        // "공개"라고 간주하지 않고 fail-closed로 목록에서 제외한다.
        if (row._comment_is_internal == null) return false
        return canSeeComment(u, { isInternal: row._comment_is_internal, authorId: row._comment_author_id ?? null })
      })
      .map(({ _comment_is_internal, _comment_author_id, ...att }: any) => att)
  })
}
