import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { pool } from '../src/db/client.js'

const app = await buildApp()

// dev-login → Set-Cookie + 김주희 반환
const res = await app.inject({ method: 'POST', url: '/api/auth/dev-login' })
assert.equal(res.statusCode, 200)
assert.equal(res.json().user.email, 'juhuikim@baeoom.com')
const setCookie = res.headers['set-cookie'] as string
assert.match(setCookie, /sid=/)
console.log('dev-login issues session ok')

// 발급된 쿠키로 me 호출 시 김주희
const sid = decodeURIComponent(setCookie.split('sid=')[1].split(';')[0])
const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { sid } })
assert.equal(me.json().user.email, 'juhuikim@baeoom.com')
console.log('session round-trip ok')

await app.close()
await pool.end()
console.log('DEVLOGIN TEST OK')
