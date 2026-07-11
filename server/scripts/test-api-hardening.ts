import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { pool } from '../src/db/client.js'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()
const sid = await loginAsDev(app)
const cookies = { sid }

// 1) 숫자 아닌 :id → 404 (NaN이 SQL로 새지 않음)
for (const bad of ['abc', '1.5', '-3', '0', 'NaN']) {
  const r = await app.inject({ method: 'GET', url: `/api/requests/${bad}`, cookies })
  assert.equal(r.statusCode, 404, `id=${bad} 는 404여야 함, got ${r.statusCode}`)
}
console.log('non-integer id → 404 ok')

// 2) 잘못된 enum → 400 (DB까지 안 내려감)
const badEnum = await app.inject({
  method: 'POST', url: '/api/requests', cookies,
  payload: { org: '없는기관', type_code: 'error', title: 'x' },
})
assert.equal(badEnum.statusCode, 400)
console.log('invalid enum → 400 ok')

// 3) 존재하지 않는 요청 상세 → 404 (권한 없음/없음 구분 안 함)
const missing = await app.inject({ method: 'GET', url: '/api/requests/999999', cookies })
assert.equal(missing.statusCode, 404)
console.log('missing request → 404 ok')

// 4) 다운로드 잘못된 attachment id → 404
const badAtt = await app.inject({ method: 'GET', url: '/api/attachments/abc/download', cookies })
assert.equal(badAtt.statusCode, 404)
console.log('bad attachment id → 404 ok')

await app.close()
await pool.end()
console.log('API HARDENING TEST OK')
