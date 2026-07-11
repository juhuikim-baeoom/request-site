import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { parseId } from '../http.js'

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/notifications — 최근 50개 + unreadCount
  // 단일 CTE로 items·unreadCount를 원자적으로 조회 (두 쿼리 사이 알림 변경에 의한 불일치 방지)
  app.get('/api/notifications', async (request, _reply) => {
    const u = request.currentUser!
    const result = await db.execute<{
      id: number
      type: string
      request_id: number | null
      message: string
      is_read: boolean
      created_at: string
      unread_count: number
    }>(sql`
      with unread_cnt as (
        select count(*)::int as cnt
        from notifications
        where user_id = ${u.id} and is_read = false
      )
      select n.id, n.type, n.request_id, n.message, n.is_read, n.created_at,
             uc.cnt as unread_count
      from notifications n
      cross join unread_cnt uc
      where n.user_id = ${u.id}
      order by n.created_at desc
      limit 50
    `)
    const rows = result.rows
    return {
      items: rows.map(({ unread_count: _uc, ...rest }) => rest),
      unreadCount: Number(rows[0]?.unread_count ?? 0),
    }
  })

  // POST /api/notifications/:id/read — 단건 읽음 처리
  app.post<{ Params: { id: string } }>(
    '/api/notifications/:id/read',
    async (request, reply) => {
      const u = request.currentUser!
      const id = parseId(request.params.id)
      if (id === null) { reply.code(404).send({ error: 'not found' }); return }

      const upd = await db.execute<{ id: number }>(sql`
        update notifications
        set is_read = true
        where id = ${id} and user_id = ${u.id}
        returning id
      `)
      if (upd.rows.length === 0) {
        reply.code(404).send({ error: 'not found' }); return
      }
      return { ok: true }
    },
  )

  // POST /api/notifications/read-all — 전체 읽음 처리
  app.post('/api/notifications/read-all', async (request, _reply) => {
    const u = request.currentUser!
    await db.execute(sql`
      update notifications
      set is_read = true
      where user_id = ${u.id} and is_read = false
    `)
    return { ok: true }
  })
}
