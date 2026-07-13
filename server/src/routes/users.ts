import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db, withUser } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { canProcess, canManageAccounts } from '../authz.js'
import { isOneOf, ORGS } from '../http.js'

// 신규 부여 가능한 6역할. 폐기값 'viewer'는 제외 — 기존 행에 남은 값은 유지하되
// PATCH/조직도 import를 통한 신규 부여는 막는다(canManageAccounts와 별개의 값 검증).
const ROLES = ['staff', 'dept_monitor', 'org_monitor', 'system', 'exec', 'system_admin'] as const

/** PATCH /api/users/:id 트랜잭션 내부에서 던지는 타입 오류 — routes/requests.ts의
 * AssignError/TransitionError와 동일한 (message, code) 관례를 따른다. */
class UserPatchError extends Error {
  code: string
  constructor(msg: string, code: string) {
    super(msg)
    this.code = code
  }
}

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // GET /api/users — 처리 능력자(canProcess)에게 연다. 관리자 전용(canManageAccounts)으로
  // 막지 않는 이유: src/features/requests/AdminPanel.tsx의 담당자 select가 이 API로 담당자
  // 후보 목록을 가져온다 — 목록 조회는 배정을 위해 처리자에게 필요하고, 역할·소속 "변경"만
  // 아래 PATCH/조직도 import에서 관리자로 제한한다.
  app.get('/api/users', async (request, reply) => {
    const u = request.currentUser!
    if (!canProcess(u)) {
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

  // PATCH /api/users/:id — 관리자(canManageAccounts) 전용. role/dept/org_affil/dept_function 부분 수정
  app.patch<{ Params: { id: string }; Body: any }>(
    '/api/users/:id',
    async (request, reply) => {
      const u = request.currentUser!
      if (!canManageAccounts(u)) {
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

      try {
        const updatedRow = await withUser(u.id, async (tx) => {
          // 대상 사용자 행 + (role 변경 시) 현재 system_admin 전원을 id 오름차순으로 같은
          // 트랜잭션에서 FOR UPDATE 잠근다. 잠금 순서가 항상 id 오름차순으로 고정되므로
          // 두 관리자가 동시에 서로를 강등해도 데드락 없이 순차 처리되고, 마지막
          // system_admin이 사라지는 갱신은 원자적으로 막을 수 있다(TOCTOU 방지,
          // services/assign.ts·transition.ts와 동일 관례).
          const lockRows = 'role' in b
            ? await tx.execute<{ id: string; role: string }>(sql`
                select id, role from users
                where id = ${id}::uuid or role = 'system_admin'
                order by id
                for update
              `)
            : await tx.execute<{ id: string; role: string }>(sql`
                select id, role from users where id = ${id}::uuid for update
              `)

          const target = lockRows.rows.find((r) => r.id === id)
          if (!target) {
            throw new UserPatchError('user not found', 'NOT_FOUND')
          }

          if ('role' in b && target.role === 'system_admin' && b.role !== 'system_admin') {
            const adminCount = lockRows.rows.filter((r) => r.role === 'system_admin').length
            if (adminCount <= 1) {
              throw new UserPatchError(
                '마지막 시스템팀 관리자는 다른 역할로 변경할 수 없습니다',
                'LAST_ADMIN',
              )
            }
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

          const updated = await tx.execute<{
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
        })

        return updatedRow
      } catch (e: any) {
        if (e instanceof UserPatchError) {
          if (e.code === 'NOT_FOUND') {
            reply.code(404)
            return { error: 'user not found' }
          }
          reply.code(400)
          return { error: e.message, code: e.code }
        }
        throw e
      }
    },
  )

  // POST /api/org-directory/import — 관리자(canManageAccounts) 전용. org_directory 대량 upsert
  app.post<{ Body: any }>(
    '/api/org-directory/import',
    async (request, reply) => {
      const u = request.currentUser!
      if (!canManageAccounts(u)) {
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
