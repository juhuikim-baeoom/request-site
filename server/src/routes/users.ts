import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db, withUser } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { isSystem } from '../authz.js'
import { isOneOf, ORGS } from '../http.js'

const ROLES = ['staff', 'system', 'viewer'] as const

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/users — system 전용. users 전체 목록
  app.get('/api/users', async (request, reply) => {
    const u = request.currentUser!
    if (!isSystem(u)) {
      reply.code(403)
      return { error: 'forbidden' }
    }

    const result = await db.execute<{
      id: string
      email: string
      name: string | null
      dept: string | null
      org_affil: string | null
      dept_function: string | null
      role: string
    }>(sql`
      select id, email, name, dept, org_affil, dept_function, role
      from users
      order by created_at asc
    `)

    return result.rows
  })

  // PATCH /api/users/:id — system 전용. role/dept/org_affil/dept_function 부분 수정
  app.patch<{ Params: { id: string }; Body: any }>(
    '/api/users/:id',
    async (request, reply) => {
      const u = request.currentUser!
      if (!isSystem(u)) {
        reply.code(403)
        return { error: 'forbidden' }
      }

      const { id } = request.params
      const b: any = request.body ?? {}

      // 빈 요청 검사
      const allowed = ['role', 'dept', 'org_affil', 'dept_function']
      const keys = Object.keys(b).filter((k) => allowed.includes(k))
      if (keys.length === 0) {
        reply.code(400)
        return { error: 'no valid fields' }
      }

      // enum 검증
      if ('role' in b && !isOneOf(ROLES, b.role)) {
        reply.code(400)
        return { error: 'invalid role' }
      }
      if ('org_affil' in b && b.org_affil !== null && !isOneOf(ORGS, b.org_affil)) {
        reply.code(400)
        return { error: 'invalid org_affil' }
      }

      // 대상 사용자 존재 확인
      const existing = await db.execute<{ id: string }>(sql`
        select id from users where id = ${id}::uuid limit 1
      `)
      if (existing.rows.length === 0) {
        reply.code(404)
        return { error: 'user not found' }
      }

      // SET 절 동적 조립
      const setClauses: any[] = []
      if ('role' in b) {
        setClauses.push(sql`role = ${b.role}::user_role`)
      }
      if ('dept' in b) {
        setClauses.push(sql`dept = ${b.dept}`)
      }
      if ('org_affil' in b) {
        if (b.org_affil === null) {
          setClauses.push(sql`org_affil = null`)
        } else {
          setClauses.push(sql`org_affil = ${b.org_affil}::request_org`)
        }
      }
      if ('dept_function' in b) {
        setClauses.push(sql`dept_function = ${b.dept_function}`)
      }

      // SET 절 합치기
      let setExpr = setClauses[0]
      for (let i = 1; i < setClauses.length; i++) {
        setExpr = sql`${setExpr}, ${setClauses[i]}`
      }

      const updated = await db.execute<{
        id: string
        email: string
        name: string | null
        dept: string | null
        org_affil: string | null
        dept_function: string | null
        role: string
      }>(sql`
        update users
        set ${setExpr}
        where id = ${id}::uuid
        returning id, email, name, dept, org_affil, dept_function, role
      `)

      return updated.rows[0]
    },
  )

  // POST /api/org-directory/import — system 전용. org_directory 대량 upsert
  app.post<{ Body: any }>(
    '/api/org-directory/import',
    async (request, reply) => {
      const u = request.currentUser!
      if (!isSystem(u)) {
        reply.code(403)
        return { error: 'forbidden' }
      }

      const b: any = request.body ?? {}
      if (!Array.isArray(b.rows)) {
        reply.code(400)
        return { error: 'rows must be an array' }
      }

      let upserted = 0
      let skipped = 0
      const errors: { email: string; reason: string }[] = []

      for (const row of b.rows) {
        const email: string = row.email
        if (!email || typeof email !== 'string') {
          skipped++
          errors.push({ email: String(email ?? ''), reason: 'missing email' })
          continue
        }

        const name: string = row.name
        const dept: string = row.dept
        if (!name || typeof name !== 'string' || !dept || typeof dept !== 'string') {
          skipped++
          errors.push({ email, reason: 'missing name or dept' })
          continue
        }

        // org_affil 검증
        if (!isOneOf(ORGS, row.org_affil)) {
          skipped++
          errors.push({ email, reason: `invalid org_affil: ${row.org_affil}` })
          continue
        }

        // role 검증 (선택 필드, 기본값 'staff')
        const role = row.role ?? 'staff'
        if (!isOneOf(ROLES, role)) {
          skipped++
          errors.push({ email, reason: `invalid role: ${role}` })
          continue
        }

        const deptFunction: string | null = row.dept_function ?? null

        try {
          await db.execute(sql`
            insert into org_directory (email, name, dept, org_affil, dept_function, role, synced)
            values (
              ${email},
              ${name},
              ${dept},
              ${row.org_affil}::request_org,
              ${deptFunction},
              ${role}::user_role,
              true
            )
            on conflict (email) do update set
              name = excluded.name,
              dept = excluded.dept,
              org_affil = excluded.org_affil,
              dept_function = excluded.dept_function,
              role = excluded.role,
              synced = true
          `)
          upserted++
        } catch (err: any) {
          skipped++
          errors.push({ email, reason: err?.message ?? 'db error' })
        }
      }

      return { upserted, skipped, errors }
    },
  )
}
