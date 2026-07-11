import assert from 'node:assert/strict'
import { upsertUserFromEmail, DomainNotAllowedError } from '../src/auth/upsert.js'
import { db, pool } from '../src/db/client.js'
import { users } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'

// 1) 불허 도메인 차단
await assert.rejects(
  () => upsertUserFromEmail('someone@gmail.com', 'X', 'sub1'),
  DomainNotAllowedError,
)
console.log('domain block ok')

// 2) org_directory 사전등록 반영 (김주희는 seed 로 이미 users 에 있음 → 기존 반환)
const r1 = await upsertUserFromEmail('juhuikim@baeoom.com', '김주희', 'gsub-juhui')
assert.ok(r1.id)
const u = await db.query.users.findFirst({ where: eq(users.id, r1.id) })
assert.equal(u?.googleSub, 'gsub-juhui')  // googleSub 갱신됨
console.log('existing upsert + googleSub ok')

// 3) 신규 허용 도메인 유저 생성 후 정리
const r2 = await upsertUserFromEmail('tester-upsert@baeron.com', '테스터', 'gsub-t')
assert.ok(r2.id)
await db.delete(users).where(eq(users.id, r2.id))
console.log('new user create ok')

await pool.end()
console.log('UPSERT TEST OK')
