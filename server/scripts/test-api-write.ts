import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { requests } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()
const sid = await loginAsDev(app)
const cookies = { sid }

// 생성 (+공유대상)
const create = await app.inject({
  method: 'POST', url: '/api/requests', cookies,
  payload: {
    org: '공통', type_code: 'feature', priority: '보통', visibility: 'dept',
    title: 'write 테스트', body: '<p>본문</p>', desired_due: null,
    sharedTargets: [{ target_type: 'function', target_value: '교학팀' }],
  },
})
assert.equal(create.statusCode, 201)
const reqId = create.json().id
assert.match(create.json().seq, /^\d{6}-\d{2}$/)
console.log('create ok seq=', create.json().seq)

// 공유대상 기록 확인
const st = await db.execute<any>(sql`select count(*)::int as c from request_shared_targets where request_id = ${reqId}`)
assert.equal(st.rows[0].c, 1)
console.log('shared target saved ok')

// 보드 변경 (시스템팀 = 김주희)
const board = await app.inject({ method: 'PATCH', url: `/api/requests/${reqId}`, cookies, payload: { status: '진행중' } })
assert.equal(board.statusCode, 200)
const check = await db.execute<any>(sql`select status from requests where id = ${reqId}`)
assert.equal(check.rows[0].status, '진행중')
console.log('board update ok')

// 내용 수정
const edit = await app.inject({ method: 'PATCH', url: `/api/requests/${reqId}`, cookies, payload: { title: '수정됨' } })
assert.equal(edit.statusCode, 200)
console.log('edit ok')

// 정리
await db.delete(requests).where(eq(requests.id, reqId))
await app.close(); await pool.end()
console.log('API WRITE TEST OK')
