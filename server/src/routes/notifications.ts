import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { parseId } from '../http.js'

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/notifications — 최근 50개 + unreadCount
  app.get('/api/notifications', async (request, _reply) => {
    const u = request.currentUser!
    const items = await db.execute<{
      id: number
      type: string
      request_id: number | null
      message: string
      is_read: boolean
      created_at: string
    }>(sql`
      select id, type, request_id, message, is_read, created_at
      from notifications
      where user_id = ${u.id}
      order by created_at desc
      limit 50
    `)
    const unreadCount = await db.execute<{ count: string }>(sql`
      select count(*)::int as count
      from notifications
      where user_id = ${u.id} and is_read = false
    `)
    return {
      items: items.rows,
      unreadCount: Number(unreadCount.rows[0]?.count ?? 0),
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
