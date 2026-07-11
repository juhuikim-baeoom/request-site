import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'

const app = await buildApp()

// 1) 쿠키 없으면 me.user == null
const anon = await app.inject({ method: 'GET', url: '/api/auth/me' })
assert.equal(anon.statusCode, 200)
assert.equal(anon.json().user, null)
console.log('anon me ok')

// 2) 서명 쿠키를 심으면 me.user 반환
const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
assert.ok(juhui, 'seed 필요')
const signed = app.signCookie(juhui.id)
const authed = await app.inject({
  method: 'GET', url: '/api/auth/me', cookies: { sid: signed },
})
assert.equal(authed.json().user.email, 'juhuikim@baeoom.com')
assert.equal(authed.json().user.role, 'system')
console.log('authed me ok')

// 3) logout 은 쿠키 삭제 헤더를 보냄
const out = await app.inject({ method: 'POST', url: '/api/auth/logout' })
assert.match(out.headers['set-cookie'] as string, /sid=;/)
console.log('logout ok')

await app.close()
await pool.end()
console.log('AUTH TEST OK')
