import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { requests } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()
const sid = await loginAsDev(app)
const cookies = { sid }

// 현재 사용자(김주희) id 확보 후 픽스처 생성
const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies })
const uid = me.json().user.id
const [req] = await db.insert(requests).values({
  org: '공통', typeCode: 'error', title: 'attach 테스트', requesterId: uid, visibility: 'dept',
}).returning()

// multipart 업로드 (한글 파일명)
const boundary = '----t'
const body = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="한글.txt"\r\nContent-Type: text/plain\r\n\r\n`),
  Buffer.from('hello-첨부'),
  Buffer.from(`\r\n--${boundary}--\r\n`),
])
const up = await app.inject({
  method: 'POST', url: `/api/requests/${req.id}/attachments`, cookies,
  headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
})
assert.equal(up.statusCode, 201)
assert.equal(up.json().file_name, '한글.txt')
const attId = up.json().id
console.log('upload ok path=', up.json().storage_path)

// 다운로드
const dl = await app.inject({ method: 'GET', url: `/api/attachments/${attId}/download`, cookies })
assert.equal(dl.statusCode, 200)
assert.ok(dl.rawPayload.toString().includes('hello-첨부'))
console.log('download ok')

// 정리 (요청 삭제 → 첨부 cascade)
await db.delete(requests).where(eq(requests.id, req.id))
await app.close(); await pool.end()
console.log('API ATTACH TEST OK')
