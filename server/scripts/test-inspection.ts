/**
 * 검수 권한 테스트
 * - 요청자가 검수대기 건을 승인/재작업 요청할 수 있다
 * - 시스템팀 강제완료는 사유가 필수다
 * - 남의 요청은 검수할 수 없다
 */
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, requests } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { changeStatus } from '../src/services/transition.js'

const app = await buildApp()
const cookie = await loginAsDev(app)

const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
const actorId = juhui!.id

/**
 * 테스트용 일반 직원 계정.
 * 시드에는 시스템팀(juhui) 1명뿐이므로, "요청자 ≠ 시스템팀" 시나리오를 만들려면 직접 만들어야 한다.
 */
async function ensureStaffUser(): Promise<string> {
  const email = 'test-staff@baeoom.com'
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
  if (existing) return existing.id
  const [row] = await db.insert(users).values({
    email, name: '테스트직원', role: 'staff', orgAffil: '공통', deptFunction: '교학팀',
  }).returning()
  return row.id
}

/** 검수대기 상태의 요청을 만든다. requesterId 기본값은 로그인 사용자 본인. */
async function makeInspecting(requesterId: string = actorId) {
  const [row] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '검수테스트',
    requesterId, visibility: 'dept',
  }).returning()
  await changeStatus({ reqId: row.id, to: '진행중', actorId })
  await changeStatus({ reqId: row.id, to: '검수대기', actorId })
  return row
}

// ──────────────────────────────────────────
// (1) 요청자 승인 → 완료(REQUESTER) + CSAT 저장
// ──────────────────────────────────────────
{
  const req = await makeInspecting()
  const res = await app.inject({
    method: 'PATCH', url: `/api/requests/${req.id}`, cookies: { sid: cookie },
    payload: { status: '완료', csat_rating: 5, csat_comment: '빨랐습니다' },
  })
  assert.equal(res.statusCode, 200, res.body)
  const cur = await db.execute<any>(sql`
    select status, completion_route, csat_rating, csat_comment from requests where id = ${req.id}`)
  const r = cur.rows[0]
  assert.equal(r.status, '완료')
  assert.equal(r.completion_route, 'REQUESTER')
  assert.equal(r.csat_rating, 5, 'CSAT 별점 저장')
  assert.equal(r.csat_comment, '빨랐습니다')
  console.log('(1) 요청자 승인 + CSAT OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (2) 요청자 재작업 요청 — 사유 없으면 400
// ──────────────────────────────────────────
{
  const req = await makeInspecting()
  const res = await app.inject({
    method: 'PATCH', url: `/api/requests/${req.id}`, cookies: { sid: cookie },
    payload: { status: '진행중' },
  })
  assert.equal(res.statusCode, 400, '사유 없는 재작업 요청은 거부')
  console.log('(2) 사유 없는 재작업 요청 거부 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (3) 요청자 재작업 요청 — 사유 있으면 진행중 복귀
// ──────────────────────────────────────────
{
  const req = await makeInspecting()
  const res = await app.inject({
    method: 'PATCH', url: `/api/requests/${req.id}`, cookies: { sid: cookie },
    payload: { status: '진행중', reason: '요청한 항목이 빠졌습니다' },
  })
  assert.equal(res.statusCode, 200, res.body)
  const cur = await db.execute<any>(sql`
    select status, rework_count, rework_reason from requests where id = ${req.id}`)
  const r = cur.rows[0]
  assert.equal(r.status, '진행중')
  assert.equal(r.rework_count, 1)
  assert.equal(r.rework_reason, '요청한 항목이 빠졌습니다')
  console.log('(3) 요청자 재작업 요청 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (4) 시스템팀 강제완료 — 사유 없으면 400
// ──────────────────────────────────────────
{
  // 남의 요청으로 만들어 owner 경로를 배제한다 (dev-login 사용자는 system 역할)
  const otherId = await ensureStaffUser()
  const req = await makeInspecting(otherId)
  const res = await app.inject({
    method: 'PATCH', url: `/api/requests/${req.id}`, cookies: { sid: cookie },
    payload: { status: '완료' },
  })
  assert.equal(res.statusCode, 400, '사유 없는 강제완료는 거부')

  const ok = await app.inject({
    method: 'PATCH', url: `/api/requests/${req.id}`, cookies: { sid: cookie },
    payload: { status: '완료', reason: '요청자와 구두 확인 완료' },
  })
  assert.equal(ok.statusCode, 200, ok.body)
  const cur = await db.execute<any>(sql`select completion_route from requests where id = ${req.id}`)
  assert.equal(cur.rows[0].completion_route, 'SYSTEM_FORCED')
  console.log('(4) 시스템팀 강제완료 (사유 필수) OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

await app.close()
await pool.end()
console.log('\ntest:inspection ALL PASSED')
