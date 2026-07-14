import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { pool } from '../src/db/client.js'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()

// 1) 쿠키 없으면 me.user == null
const anon = await app.inject({ method: 'GET', url: '/api/auth/me' })
assert.equal(anon.statusCode, 200)
assert.equal(anon.json().user, null)
console.log('anon me ok')

// 2) dev-login 세션 쿠키로 me.user 반환 (서버측 세션 저장소 조회)
const sid = await loginAsDev(app)
const authed = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { sid } })
assert.equal(authed.json().user.email, 'juhuikim@baeoom.com')
// juhuikim@baeoom.com은 역할 모델 도입 시 유일한 초기 관리자로 system_admin에 백필됨
// (src/db/backfill-roles.ts) — 세션이 실제 DB 역할을 정확히 반영하는지 확인
assert.equal(authed.json().user.role, 'system_admin')
console.log('authed me ok')

// 3) 위조: 존재하지 않는 랜덤 세션 토큰(정상 서명)은 거부됨
const forged = app.signCookie('deadbeef'.repeat(8))
const forgedRes = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { sid: forged } })
assert.equal(forgedRes.json().user, null)
console.log('forged token rejected ok')

// 4) logout 은 쿠키를 지우고, 서버측 세션도 무효화 → 같은 쿠키 재사용 불가
const out = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { sid } })
assert.match(out.headers['set-cookie'] as string, /sid=;/)
const afterLogout = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { sid } })
assert.equal(afterLogout.json().user, null, '로그아웃 후 기존 세션 쿠키가 여전히 유효하면 안 됨')
console.log('logout revokes session server-side ok')

await app.close()
await pool.end()
console.log('AUTH TEST OK')
