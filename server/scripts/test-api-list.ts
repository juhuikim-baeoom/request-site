import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { loginAsDev } from '../src/routes/helpers.js'
import { FUNCTION_TARGETS, ORGS } from '../src/http.js'

const app = await buildApp()

// 미인증 401
const anon = await app.inject({ method: 'GET', url: '/api/requests' })
assert.equal(anon.statusCode, 401)
console.log('unauth 401 ok')

const sid = await loginAsDev(app)
const cookies = { sid }

const types = await app.inject({ method: 'GET', url: '/api/request-types', cookies })
assert.equal(types.statusCode, 200)
assert.equal(types.json().length, 4)
console.log('request-types ok')

const profiles = await app.inject({ method: 'GET', url: '/api/profiles', cookies })
assert.ok(profiles.json().some((p: any) => p.email === 'juhuikim@baeoom.com'))
console.log('profiles ok')

const list = await app.inject({ method: 'GET', url: '/api/requests', cookies })
assert.equal(list.statusCode, 200)
assert.ok(Array.isArray(list.json()))
console.log('requests list ok')

const shared = await app.inject({ method: 'GET', url: '/api/requests/shared-targets', cookies })
assert.equal(shared.statusCode, 200)
console.log('shared-targets ok')

// GET /api/dept-options — org_directory.dept_function은 검증되지 않는 자유 텍스트라
// 화이트리스트(FUNCTION_TARGETS) 밖 값이 섞여도(오타·빈 문자열·신규 팀명) 응답에서
// 걸러져야 한다. 그러지 않으면 접수 폼이 그 값을 체크박스로 렌더하고, 사용자가 선택 시
// parseSharedTargets가 400으로 거부해 접수 전체가 깨진다(회귀 방지).
{
  const badEmail1 = 'zz-test-dept-options-bad@test.local'
  const badEmail2 = 'zz-test-dept-options-empty@test.local'
  const goodEmail = 'zz-test-dept-options-good@test.local'
  try {
    await db.execute(sql`
      insert into org_directory (email, name, dept, org_affil, dept_function, role)
      values (${badEmail1}, 'zz test', 'zz', ${ORGS[0]}, '없는팀', 'staff')
      on conflict (email) do update set dept_function = excluded.dept_function`)
    await db.execute(sql`
      insert into org_directory (email, name, dept, org_affil, dept_function, role)
      values (${badEmail2}, 'zz test', 'zz', ${ORGS[0]}, '', 'staff')
      on conflict (email) do update set dept_function = excluded.dept_function`)
    // 화이트리스트에 있는 정상 직무 행도 심어, 과잉 차단 검증이 로컬 DB의 기존 데이터
    // 유무에 의존하지 않도록 한다(빈 org_directory에서도 의미 있는 단언이 되게).
    await db.execute(sql`
      insert into org_directory (email, name, dept, org_affil, dept_function, role)
      values (${goodEmail}, 'zz test', 'zz', ${ORGS[0]}, ${FUNCTION_TARGETS[0]}, 'staff')
      on conflict (email) do update set dept_function = excluded.dept_function`)

    const opts = await app.inject({ method: 'GET', url: '/api/dept-options', cookies })
    assert.equal(opts.statusCode, 200)
    const values = opts.json().map((o: any) => o.dept_function)
    assert.ok(!values.includes('없는팀'), '화이트리스트 밖 값이 응답에 포함됨')
    assert.ok(!values.includes(''), '빈 문자열이 응답에 포함됨')
    // 과잉 차단 방지: 정상 직무는 여전히 나와야 한다
    assert.ok(values.includes(FUNCTION_TARGETS[0]), '정상 직무가 과잉 필터로 사라짐')
    console.log('dept-options whitelist filter ok')
  } finally {
    await db.execute(sql`delete from org_directory where email in (${badEmail1}, ${badEmail2}, ${goodEmail})`)
  }
}

await app.close()
await pool.end()
console.log('API LIST TEST OK')
