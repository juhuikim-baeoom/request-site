import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { setSession } from './session.js'

const DEV_EMAIL = 'juhuikim@baeoom.com'

export async function devLoginRoutes(app: FastifyInstance) {
  // APP_ENV=local 일 때만 이 함수가 등록됨(app.ts 에서 게이트)
  app.post('/api/auth/dev-login', async (_request, reply) => {
    const u = await db.query.users.findFirst({ where: eq(users.email, DEV_EMAIL) })
    if (!u) {
      reply.code(500).send({ error: 'dev 유저 없음 — npm run db:seed 실행 필요' })
      return
    }
    await setSession(reply, u.id)
    return {
      user: {
        id: u.id, email: u.email, name: u.name,
        orgAffil: u.orgAffil, deptFunction: u.deptFunction, role: u.role,
      },
    }
  })
}
