/**
 * test:users — 계정 관리 API 테스트
 * - system GET /api/users 200
 * - staff GET /api/users 403
 * - system PATCH /api/users/:id 200
 * - system PATCH 잘못된 role → 400
 * - POST /api/org-directory/import upsert 검증
 * - 대문자 UUID로 PATCH해도 200 (마지막 관리자 가드의 대소문자 비교 회귀 방지)
 * - 폐기값 viewer 사용자를 정상 역할로 구제(role 변경) 가능
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, sessions, orgDirectory } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()

// system 사용자(김주희) 로그인
const sysSid = await loginAsDev(app)
const sysCookies = { sid: sysSid }

// staff 사용자 임시 생성
const [staffUser] = await db.insert(users).values({
  email: 'staff-test-users@baeoom.com',
  name: '테스트직원',
  orgAffil: '배움',
  deptFunction: '교학팀',
  role: 'staff',
}).returning()

// staff 세션 직접 생성
const staffToken = randomBytes(32).toString('hex')
await db.insert(sessions).values({
  id: staffToken,
  userId: staffUser.id,
  expiresAt: new Date(Date.now() + 60_000),
})
const staffSid = app.signCookie(staffToken)
const staffCookies = { sid: staffSid }

// ──────────────────────────────────────────
// (1) system → GET /api/users → 200, 배열 포함
// ──────────────────────────────────────────
{
  const res = await app.inject({ method: 'GET', url: '/api/users', cookies: sysCookies })
  assert.equal(res.statusCode, 200, `system GET 200, got ${res.statusCode}`)
  const list = res.json()
  assert.ok(Array.isArray(list), '배열이어야 함')
  assert.ok(list.some((u: any) => u.email === 'juhuikim@baeoom.com'), 'system 유저 포함')
  assert.ok(list.some((u: any) => u.email === staffUser.email), 'staff 유저 포함')
  // 반환 필드 확인
  const staffRow = list.find((u: any) => u.email === staffUser.email)
  assert.ok('id' in staffRow && 'email' in staffRow && 'name' in staffRow &&
    'dept' in staffRow && 'org_affil' in staffRow && 'dept_function' in staffRow &&
    'role' in staffRow, '필드 구조 확인')
  console.log('(1) system GET /api/users 200 OK')
}

// ──────────────────────────────────────────
// (2) staff → GET /api/users → 403
// ──────────────────────────────────────────
{
  const res = await app.inject({ method: 'GET', url: '/api/users', cookies: staffCookies })
  assert.equal(res.statusCode, 403, `staff GET 403, got ${res.statusCode}`)
  console.log('(2) staff GET /api/users 403 OK')
}

// ──────────────────────────────────────────
// (3) system → PATCH /api/users/:id → 200, 변경 반영
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/users/${staffUser.id}`,
    cookies: sysCookies,
    payload: { role: 'dept_monitor', dept: '테스트팀', org_affil: '배론', dept_function: '운영팀' },
  })
  assert.equal(res.statusCode, 200, `PATCH 200, got ${res.statusCode}: ${res.body}`)
  const updated = res.json()
  assert.equal(updated.role, 'dept_monitor', 'role 변경 확인')
  assert.equal(updated.dept, '테스트팀', 'dept 변경 확인')
  assert.equal(updated.org_affil, '배론', 'org_affil 변경 확인')
  assert.equal(updated.dept_function, '운영팀', 'dept_function 변경 확인')
  console.log('(3) system PATCH /api/users/:id 200 OK')
}

// ──────────────────────────────────────────
// (4) PATCH 잘못된 role → 400
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/users/${staffUser.id}`,
    cookies: sysCookies,
    payload: { role: 'admin' },  // 존재하지 않는 role
  })
  assert.equal(res.statusCode, 400, `잘못된 role → 400, got ${res.statusCode}`)
  console.log('(4) PATCH 잘못된 role → 400 OK')
}

// ──────────────────────────────────────────
// (5) staff → PATCH /api/users/:id → 403
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/users/${staffUser.id}`,
    cookies: staffCookies,
    payload: { role: 'system' },
  })
  assert.equal(res.statusCode, 403, `staff PATCH 403, got ${res.statusCode}`)
  console.log('(5) staff PATCH /api/users/:id 403 OK')
}

// ──────────────────────────────────────────
// (6) POST /api/org-directory/import — 정상 행 upsert
// ──────────────────────────────────────────
const importEmail1 = 'import-test-1@baeoom.com'
const importEmail2 = 'import-test-2@baeoom.com'
const importEmailBad = 'import-bad@baeoom.com'

// 사전 정리 (혹시 이전 실행에서 남아 있을 경우)
await db.execute(sql`delete from org_directory where email in (${importEmail1}, ${importEmail2})`)

{
  const res = await app.inject({
    method: 'POST',
    url: '/api/org-directory/import',
    cookies: sysCookies,
    payload: {
      rows: [
        { email: importEmail1, name: '임포트1', dept: '기획팀', org_affil: '배움', dept_function: '기획팀', role: 'staff' },
        { email: importEmail2, name: '임포트2', dept: '운영팀', org_affil: '허브' },
        // 잘못된 org_affil → 스킵
        { email: importEmailBad, name: '나쁜행', dept: 'X', org_affil: '없는조직' },
        // 잘못된 role → 스킵
        { email: 'import-bad-role@baeoom.com', name: '나쁜역할', dept: 'X', org_affil: '공통', role: 'superadmin' },
      ],
    },
  })
  assert.equal(res.statusCode, 200, `import 200, got ${res.statusCode}: ${res.body}`)
  const result = res.json()
  assert.equal(result.upserted, 2, `upserted=2, got ${result.upserted}`)
  assert.equal(result.skipped, 2, `skipped=2, got ${result.skipped}`)
  assert.ok(Array.isArray(result.errors), 'errors 배열')
  assert.equal(result.errors.length, 2, `errors.length=2, got ${result.errors.length}`)
  console.log('(6) org-directory import 정상/스킵 OK')
}

// ──────────────────────────────────────────
// (7) 동일 이메일로 재 upsert → 값 업데이트
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'POST',
    url: '/api/org-directory/import',
    cookies: sysCookies,
    payload: {
      rows: [
        { email: importEmail1, name: '임포트1수정', dept: '기획팀수정', org_affil: '배론', role: 'org_monitor' },
      ],
    },
  })
  assert.equal(res.statusCode, 200)
  const result = res.json()
  assert.equal(result.upserted, 1, `upsert 재실행 upserted=1, got ${result.upserted}`)

  // DB에서 직접 확인
  const rows = await db.execute<{ name: string; org_affil: string; role: string }>(sql`
    select name, org_affil, role from org_directory where email = ${importEmail1}
  `)
  assert.equal(rows.rows[0]?.name, '임포트1수정', '이름 업데이트 확인')
  assert.equal(rows.rows[0]?.org_affil, '배론', 'org_affil 업데이트 확인')
  assert.equal(rows.rows[0]?.role, 'org_monitor', 'role 업데이트 확인')
  console.log('(7) org-directory import upsert 업데이트 OK')
}

// ──────────────────────────────────────────
// (8) staff → POST /api/org-directory/import → 403
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'POST',
    url: '/api/org-directory/import',
    cookies: staffCookies,
    payload: { rows: [{ email: 'x@x.com', name: 'X', dept: 'X', org_affil: '배움' }] },
  })
  assert.equal(res.statusCode, 403, `staff import 403, got ${res.statusCode}`)
  console.log('(8) staff POST /api/org-directory/import 403 OK')
}

// ──────────────────────────────────────────
// (9) 대문자 UUID로 PATCH해도 정상 동작해야 함
//     회귀: 마지막 관리자 강등 방지 가드가 잠긴 행을 JS 문자열 비교(r.id === id)로 찾는데,
//     SQL은 대소문자 무관하게 매칭하지만 Postgres가 반환하는 id는 소문자 정규형이라
//     URL 원문이 대문자면 매칭에 실패해 잠겼는데도 404가 났다.
// ──────────────────────────────────────────
const [upperCaseTestUser] = await db.insert(users).values({
  email: 'uppercase-uuid-test@baeoom.com',
  name: '대문자UUID테스트',
  orgAffil: '배움',
  deptFunction: '교학팀',
  role: 'staff',
}).returning()

{
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/users/${upperCaseTestUser.id.toUpperCase()}`,
    cookies: sysCookies,
    payload: { dept: '대문자테스트팀' },
  })
  assert.equal(res.statusCode, 200, `대문자 UUID PATCH도 200이어야 함(404 회귀 확인), got ${res.statusCode}: ${res.body}`)
  assert.equal(res.json().dept, '대문자테스트팀', 'dept 변경 확인')
  console.log('(9) 대문자 UUID PATCH 200 OK (404 회귀 없음)')
}

await db.delete(users).where(eq(users.id, upperCaseTestUser.id))

// ──────────────────────────────────────────
// (10) 폐기값 viewer 사용자를 정상 역할로 구제(role 변경) 가능해야 함
//      계정 관리 화면의 존재 이유 — viewer로 남은 기존 행이 영영 고정되면 안 된다.
// ──────────────────────────────────────────
const [viewerTestUser] = await db.insert(users).values({
  email: 'viewer-rescue-test@baeoom.com',
  name: '뷰어구제테스트',
  orgAffil: '배움',
  deptFunction: '교학팀',
  role: 'viewer',
}).returning()

{
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/users/${viewerTestUser.id}`,
    cookies: sysCookies,
    payload: { role: 'staff' },
  })
  assert.equal(res.statusCode, 200, `viewer → staff 구제 PATCH는 200이어야 함, got ${res.statusCode}: ${res.body}`)
  assert.equal(res.json().role, 'staff', 'role이 staff로 바뀌어야 함')
  console.log('(10) 폐기값 viewer 사용자 역할 구제(viewer→staff) OK')
}

await db.delete(users).where(eq(users.id, viewerTestUser.id))

// ──────────────────────────────────────────
// 정리
// ──────────────────────────────────────────
await db.execute(sql`delete from org_directory where email in (${importEmail1}, ${importEmail2})`)
await db.execute(sql`delete from sessions where id = ${staffToken}`)
await db.delete(users).where(eq(users.id, staffUser.id))

await app.close()
await pool.end()
console.log('\ntest:users ALL PASSED')
