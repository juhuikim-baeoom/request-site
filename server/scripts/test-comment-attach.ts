/**
 * 코멘트 첨부 링크 테스트 (P4-BE)
 * 1) POST /api/requests/:id/comments → { id } 반환 확인
 * 2) POST /api/requests/:id/attachments?comment_id=X → comment_id 저장
 * 3) GET /api/requests/:id/attachments → comment_id 포함 응답
 */
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { requests } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()
const sid = await loginAsDev(app)
const cookies = { sid }

// 테스트용 요청 생성
const [req] = await db.insert(requests).values({
  org: '공통', typeCode: 'error', title: '코멘트첨부링크테스트', visibility: 'dept',
  requesterId: (await app.inject({ method: 'GET', url: '/api/auth/me', cookies })).json().user.id,
}).returning()

// ──────────────────────────────────────────
// (1) POST comment → 응답에 id 포함
// ──────────────────────────────────────────
const commentRes = await app.inject({
  method: 'POST', url: `/api/requests/${req.id}/comments`, cookies,
  payload: { body: '링크 테스트 댓글', is_internal: false },
})
assert.equal(commentRes.statusCode, 201, `POST comment 201, got ${commentRes.statusCode}`)
const commentBody = commentRes.json()
// bigint 컬럼은 드라이버에서 문자열로 반환될 수 있으므로 string|number 모두 허용
assert.ok(commentBody.id !== undefined && commentBody.id !== null, `응답에 id 있어야 함, got: ${JSON.stringify(commentBody)}`)
const commentId = Number(commentBody.id)
console.log(`(1) POST comment → id=${commentId} 반환 OK`)

// ──────────────────────────────────────────
// (2) POST attachment with comment_id 필드
// ──────────────────────────────────────────
const boundary = '----ca'
const body = Buffer.concat([
  // comment_id 필드 먼저
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="comment_id"\r\n\r\n${commentId}`),
  Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="linked.txt"\r\nContent-Type: text/plain\r\n\r\n`),
  Buffer.from('linked-content'),
  Buffer.from(`\r\n--${boundary}--\r\n`),
])
const upRes = await app.inject({
  method: 'POST', url: `/api/requests/${req.id}/attachments`, cookies,
  headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  payload: body,
})
assert.equal(upRes.statusCode, 201, `POST attachment 201, got ${upRes.statusCode}: ${upRes.body}`)
const upBody = upRes.json()
assert.equal(Number(upBody.comment_id), commentId, `저장된 comment_id=${upBody.comment_id}, expected ${commentId}`)
const attId = upBody.id
console.log(`(2) POST attachment comment_id=${commentId} 저장 OK`)

// ──────────────────────────────────────────
// (3) GET attachments → comment_id 포함
// ──────────────────────────────────────────
const listRes = await app.inject({
  method: 'GET', url: `/api/requests/${req.id}/attachments`, cookies,
})
assert.equal(listRes.statusCode, 200)
const attachments = listRes.json()
const found = attachments.find((a: any) => a.id === attId)
assert.ok(found, '업로드한 첨부 목록에서 찾아야 함')
assert.equal(Number(found.comment_id), commentId, `GET 응답 comment_id=${found.comment_id}, expected ${commentId}`)
console.log(`(3) GET attachments comment_id=${commentId} 포함 OK`)

// ──────────────────────────────────────────
// (4) comment_id 없는 일반 업로드 → comment_id = null
// ──────────────────────────────────────────
const boundary2 = '----cb'
const body2 = Buffer.concat([
  Buffer.from(`--${boundary2}\r\nContent-Disposition: form-data; name="file"; filename="nolink.txt"\r\nContent-Type: text/plain\r\n\r\n`),
  Buffer.from('no-link'),
  Buffer.from(`\r\n--${boundary2}--\r\n`),
])
const upRes2 = await app.inject({
  method: 'POST', url: `/api/requests/${req.id}/attachments`, cookies,
  headers: { 'content-type': `multipart/form-data; boundary=${boundary2}` },
  payload: body2,
})
assert.equal(upRes2.statusCode, 201)
const upBody2 = upRes2.json()
assert.equal(upBody2.comment_id, null, `comment_id 미전송시 null이어야 함, got: ${upBody2.comment_id}`)
console.log('(4) comment_id 없는 업로드 → null OK')

// 정리 (요청 삭제 → 댓글·첨부 cascade)
await db.delete(requests).where(eq(requests.id, req.id))
await app.close()
await pool.end()
console.log('\ntest:comment-attach ALL PASSED')
