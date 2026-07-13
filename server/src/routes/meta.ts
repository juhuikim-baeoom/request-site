import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { canProcess } from '../authz.js'

export async function metaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/api/request-types', async () => {
    const r = await db.execute(sql`
      select code, label, sort_order, active from request_types
      where active = true order by sort_order`)
    return r.rows
  })

  app.get('/api/dept-options', async () => {
    const r = await db.execute(sql`
      select distinct org_affil, dept_function from org_directory
      where dept_function is not null order by org_affil, dept_function`)
    return r.rows
  })

  // 계정 디렉터리(id·name·email·role·소속) 전체 열람 — GET /api/users와 동일한 능력
  // 경계(canProcess)를 적용한다. 유일한 소비자는 관리 보드(useAllProfiles, canProcess
  // 전용 화면)의 담당자 후보 필터. 이 게이트가 없으면 GET /api/users를 canProcess로
  // 좁힌 의미가 없어진다(같은 계정 디렉터리가 이쪽으로 무방비 노출 — staff도 누가
  // 관리자인지 열거 가능).
  app.get('/api/profiles', async (request, reply) => {
    const u = request.currentUser!
    if (!canProcess(u)) { reply.code(403).send({ error: 'forbidden' }); return }
    const r = await db.execute(sql`
      select id, name, email, role, org_affil, dept_function from users order by name`)
    return r.rows
  })
}
