/**
 * 내부메모 테스트
 * - 시스템 내부메모 작성 → 요청자 GET에 안 보이고 시스템 GET에 보임
 * - staff가 is_internal=true 요청 → false로 강제
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, requests, sessions } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()

// 시스템 사용자(김주희) 로그인
const sysSid = await loginAsDev(app)
const sysCookies = { sid: sysSid }

const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })

// 요청자(staff) 사용자 임시 생성
const [staffUser] = await db.insert(users).values({
  email: 'staff-test-internal@baeoom.com',
  name: '테스트직원',
  orgAffil: '공통',
  deptFunction: '교학팀',
  role: 'staff',
}).returning()

// staff 세션 직접 생성 (app.signCookie 사용)
const staffToken = randomBytes(32).toString('hex')
await db.insert(sessions).values({
  id: staffToken,
  userId: staffUser.id,
  expiresAt: new Date(Date.now() + 60000),
})
const staffSid = app.signCookie(staffToken)
const staffCookies = { sid: staffSid }

// 테스트용 요청 생성 (요청자=staffUser, visibility=private → 본인+시스템만)
const [req] = await db.insert(requests).values({
  org: '공통', typeCode: 'error', title: '내부메모테스트',
  requesterId: staffUser.id, visibility: 'private',
}).returning()

// ──────────────────────────────────────────
// (1) 시스템이 공개 댓글 작성
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/comments`, cookies: sysCookies,
    payload: { body: '공개댓글입니다', is_internal: false },
  })
  assert.equal(res.statusCode, 201, `공개댓글 201, got ${res.statusCode}`)
  console.log('(1) 시스템 공개댓글 작성 OK')
}

// ──────────────────────────────────────────
// (2) 시스템이 내부메모 작성
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/comments`, cookies: sysCookies,
    payload: { body: '내부메모입니다', is_internal: true },
  })
  assert.equal(res.statusCode, 201, `내부메모 201, got ${res.statusCode}`)
  console.log('(2) 시스템 내부메모 작성 OK')
}

// ──────────────────────────────────────────
// (3) 시스템이 조회 → 두 댓글 모두 보임
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'GET', url: `/api/requests/${req.id}/comments`, cookies: sysCookies,
  })
  assert.equal(res.statusCode, 200)
  const comments = res.json()
  assert.equal(comments.length, 2, `시스템은 2개 모두 봐야 함, got ${comments.length}`)
  const internal = comments.find((c: any) => c.is_internal === true)
  assert.ok(internal, '내부메모 포함')
  console.log('(3) 시스템 GET → 2개 모두 보임 OK')
}

// ──────────────────────────────────────────
// (4) staff(요청자) 조회 → 내부메모 안 보임
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'GET', url: `/api/requests/${req.id}/comments`, cookies: staffCookies,
  })
  assert.equal(res.statusCode, 200, `staff GET 200, got ${res.statusCode}: ${res.body}`)
  const comments = res.json()
  const hasInternal = comments.some((c: any) => c.is_internal === true)
  assert.equal(hasInternal, false, '요청자에게는 내부메모가 보이면 안 됨')
  assert.equal(comments.length, 1, `공개댓글 1개만 보여야 함, got ${comments.length}`)
  console.log('(4) 요청자 GET → 내부메모 안 보임, 공개댓글 1개만 OK')
}

// ──────────────────────────────────────────
// (5) staff가 is_internal=true 요청 → false로 강제 저장
// ──────────────────────────────────────────
{
  const post = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/comments`, cookies: staffCookies,
    payload: { body: 'staff내부시도', is_internal: true },
  })
  assert.equal(post.statusCode, 201)

  // DB에서 직접 확인
  const check = await db.execute<any>(sql`
    select is_internal from request_comments
    where request_id = ${req.id} and body = 'staff내부시도'`)
  assert.equal(check.rows[0]?.is_internal, false, 'staff is_internal은 false로 강제')
  console.log('(5) staff is_internal=true → false 강제 OK')
}

// 정리
await db.execute(sql`delete from request_comments where request_id = ${req.id}`)
await db.delete(requests).where(eq(requests.id, req.id))
await db.execute(sql`delete from sessions where id = ${staffToken}`)
await db.delete(users).where(eq(users.id, staffUser.id))

await app.close()
await pool.end()
console.log('\ntest:comment-internal ALL PASSED')
