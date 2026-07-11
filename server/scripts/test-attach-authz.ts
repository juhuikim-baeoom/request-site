import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, sessions, requests } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()

// 김주희(system) 세션
const sysSid = await loginAsDev(app)
const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })

// staff 유저 + 세션 직접 생성
const [staff] = await db.insert(users).values({
  email: 'attach-staff@baeoom.com', name: '스태프', orgAffil: '배움', deptFunction: '교학팀', role: 'staff',
}).returning()
const token = randomBytes(32).toString('hex')
await db.insert(sessions).values({ id: token, userId: staff.id, expiresAt: new Date(Date.now() + 60000) })
const staffSid = app.signCookie(token)

// 김주희가 shared 요청 + 첨부 생성
const [req] = await db.insert(requests).values({
  org: '공통', typeCode: 'error', title: 'attach-authz', requesterId: juhui!.id, visibility: 'shared',
}).returning()
const boundary = '----t'
const body = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="secret.txt"\r\nContent-Type: text/plain\r\n\r\n`),
  Buffer.from('SECRET'),
  Buffer.from(`\r\n--${boundary}--\r\n`),
])
const up = await app.inject({
  method: 'POST', url: `/api/requests/${req.id}/attachments`, cookies: { sid: sysSid },
  headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
})
assert.equal(up.statusCode, 201)
const attId = up.json().id

// staff는 shared 요청이라 첨부 '목록'은 볼 수 있다
const list = await app.inject({ method: 'GET', url: `/api/requests/${req.id}/attachments`, cookies: { sid: staffSid } })
assert.equal(list.statusCode, 200)
assert.equal(list.json().length, 1)
console.log('staff sees attachment metadata ok')

// 그러나 실제 '다운로드'는 불가 (업로더도 시스템/열람자도 아님) → 404
const staffDl = await app.inject({ method: 'GET', url: `/api/attachments/${attId}/download`, cookies: { sid: staffSid } })
assert.equal(staffDl.statusCode, 404, 'staff가 타인 첨부를 다운로드하면 안 됨')
console.log('staff download blocked (404) ok')

// 김주희(system)는 다운로드 가능
const sysDl = await app.inject({ method: 'GET', url: `/api/attachments/${attId}/download`, cookies: { sid: sysSid } })
assert.equal(sysDl.statusCode, 200)
assert.ok(sysDl.rawPayload.toString().includes('SECRET'))
console.log('system download allowed ok')

// 정리
await db.delete(requests).where(eq(requests.id, req.id))
await db.delete(users).where(eq(users.id, staff.id))
await app.close(); await pool.end()
console.log('ATTACH AUTHZ TEST OK')
