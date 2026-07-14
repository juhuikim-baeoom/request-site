import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { canProcess } from '../authz.js'
import { FUNCTION_TARGETS } from '../http.js'

export async function metaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/api/request-types', async () => {
    const r = await db.execute(sql`
      select code, label, sort_order, active from request_types
      where active = true order by sort_order`)
    return r.rows
  })

  // org_directory.dept_function은 조직도 CSV import·계정 관리 PATCH 어느 쪽도 검증하지
  // 않는 자유 텍스트라, 화이트리스트(FUNCTION_TARGETS) 밖 값이 섞일 수 있다(오타·빈
  // 문자열·신규 팀명 등). 그런 값을 그대로 내보내면 접수 폼이 체크박스로 렌더하고,
  // 사용자가 선택 시 parseSharedTargets(services/sharing.ts)가 400으로 거부해 접수 전체가
  // 깨진다. 검증 불가능한 옵션은 여기서 걸러 애초에 화면에 뜨지 않게 한다(fail-safe).
  app.get('/api/dept-options', async () => {
    const r = await db.execute<{ org_affil: string; dept_function: string }>(sql`
      select distinct org_affil, dept_function from org_directory
      where dept_function is not null order by org_affil, dept_function`)
    const allowed = new Set<string>(FUNCTION_TARGETS)
    return r.rows.filter((row) => allowed.has(row.dept_function))
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
