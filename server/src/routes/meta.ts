import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'

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

  app.get('/api/profiles', async () => {
    const r = await db.execute(sql`
      select id, name, email, role, org_affil, dept_function from users order by name`)
    return r.rows
  })
}
