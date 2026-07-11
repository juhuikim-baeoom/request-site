import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool, withUser } from '../src/db/client.js'
import { users, requests } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()
const sid = await loginAsDev(app)
const cookies = { sid }
const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })

// 픽스처 요청 생성
const [req] = await db.insert(requests).values({
  org: '공통', typeCode: 'error', title: 'detail 테스트',
  requesterId: juhui!.id, visibility: 'dept',
}).returning()

// 상세
const detail = await app.inject({ method: 'GET', url: `/api/requests/${req.id}`, cookies })
assert.equal(detail.statusCode, 200)
assert.equal(detail.json().view.title, 'detail 테스트')
assert.equal(detail.json().requester.email, 'juhuikim@baeoom.com')
console.log('detail ok')

// 코멘트 작성 → 조회
const add = await app.inject({ method: 'POST', url: `/api/requests/${req.id}/comments`, cookies, payload: { body: '테스트 코멘트' } })
assert.equal(add.statusCode, 201)
const comments = await app.inject({ method: 'GET', url: `/api/requests/${req.id}/comments`, cookies })
assert.equal(comments.json()[0].body, '테스트 코멘트')
assert.equal(comments.json()[0].author.name, '김주희')
console.log('comments ok')

// 상태변경 후 이력
await withUser(juhui!.id, (tx) => tx.update(requests).set({ status: '진행중' }).where(eq(requests.id, req.id)))
const hist = await app.inject({ method: 'GET', url: `/api/requests/${req.id}/history`, cookies })
assert.ok(hist.json().some((h: any) => h.to_status === '진행중' && h.actor.name === '김주희'))
console.log('history ok')

// 첨부목록(빈 배열)
const att = await app.inject({ method: 'GET', url: `/api/requests/${req.id}/attachments`, cookies })
assert.deepEqual(att.json(), [])
console.log('attachments ok')

// 정리
await db.delete(requests).where(eq(requests.id, req.id))
await app.close(); await pool.end()
console.log('API DETAIL TEST OK')
