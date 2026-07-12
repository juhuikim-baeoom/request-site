/**
 * 상태 전이 서비스 테스트
 * - 허용/금지 전이
 * - 완료 → 진행중 rework_count+1
 * - 보류 왕복
 */
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool, withUser } from '../src/db/client.js'
import { users, requests } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { changeStatus, TransitionError } from '../src/services/transition.js'
import { assignRequest } from '../src/services/assign.js'

const app = await buildApp()
await loginAsDev(app)

const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
const actorId = juhui!.id

/** 새로운 테스트용 요청 생성 (status='접수') */
async function makeRequest() {
  const [row] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '전이테스트',
    requesterId: actorId, visibility: 'dept',
  }).returning()
  return row
}

// ──────────────────────────────────────────
// (1) 접수 → 진행중 (허용)
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  const cur = await db.execute<any>(sql`select status from requests where id = ${req.id}`)
  assert.equal(cur.rows[0].status, '진행중', '접수 → 진행중 OK')
  console.log('(1) 접수 → 진행중 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (2) 접수 → 완료 (금지 — ILLEGAL_TRANSITION)
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  let threw = false
  try {
    await changeStatus({ reqId: req.id, to: '완료', actorId })
  } catch (e: any) {
    assert.ok(e instanceof TransitionError, 'TransitionError여야 함')
    assert.equal(e.code, 'ILLEGAL_TRANSITION', '코드 ILLEGAL_TRANSITION')
    threw = true
  }
  assert.ok(threw, '예외가 발생해야 함')
  console.log('(2) 접수 → 완료 금지 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (3) 완료 → 진행중 rework_count+1
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  // 접수 → 진행중 → 완료
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '완료', actorId })
  const before = await db.execute<any>(sql`select rework_count from requests where id = ${req.id}`)
  const rworkBefore = before.rows[0].rework_count

  // 완료 → 진행중 (재작업)
  await changeStatus({ reqId: req.id, to: '진행중', reason: '수정 필요', actorId })
  const after = await db.execute<any>(sql`select rework_count, rework_reason, status from requests where id = ${req.id}`)
  const r = after.rows[0]
  assert.equal(r.status, '진행중')
  assert.equal(r.rework_count, rworkBefore + 1, `rework_count ${rworkBefore} → ${r.rework_count}`)
  assert.equal(r.rework_reason, '수정 필요', 'rework_reason 저장')
  console.log('(3) 완료 → 진행중 rework_count+1 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (4) 보류 왕복 (진행중 → 보류 → 진행중)
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '보류', reason: '대기중', actorId })
  const held = await db.execute<any>(sql`select status, hold_reason from requests where id = ${req.id}`)
  assert.equal(held.rows[0].status, '보류')
  assert.equal(held.rows[0].hold_reason, '대기중', 'hold_reason 저장')

  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  const resumed = await db.execute<any>(sql`select status from requests where id = ${req.id}`)
  assert.equal(resumed.rows[0].status, '진행중')
  console.log('(4) 보류 왕복 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (5) 반려 상태에서 추가 전이 금지
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '반려', reason: '이유', actorId })
  let threw = false
  try {
    await changeStatus({ reqId: req.id, to: '진행중', actorId })
  } catch (e: any) {
    assert.equal(e.code, 'ILLEGAL_TRANSITION')
    threw = true
  }
  assert.ok(threw)
  console.log('(5) 반려 → 진행중 금지 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (6) 진행중 → 접수 되돌리기 — 배정 정보 초기화
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await assignRequest({ reqId: req.id, assigneeId: actorId, impact: '보통', actorId })
  const assigned = await db.execute<any>(
    sql`select status, assignee_id, assigned_at, priority_level from requests where id = ${req.id}`,
  )
  assert.equal(assigned.rows[0].status, '진행중')
  assert.ok(assigned.rows[0].assignee_id, '배정 후 assignee_id 존재')

  await changeStatus({ reqId: req.id, to: '접수', actorId })
  const back = await db.execute<any>(sql`
    select status, assignee_id, impact, priority_level, assigned_at, first_response_at,
           response_due_at, resolution_due_at, sla_policy_id, sla_response_breached
    from requests where id = ${req.id}
  `)
  const b = back.rows[0]
  assert.equal(b.status, '접수', '진행중 → 접수 전이')
  assert.equal(b.assignee_id, null, 'assignee_id 초기화')
  assert.equal(b.impact, null, 'impact 초기화')
  assert.equal(b.priority_level, null, 'priority_level 초기화')
  assert.equal(b.assigned_at, null, 'assigned_at 초기화')
  assert.equal(b.first_response_at, null, 'first_response_at 초기화')
  assert.equal(b.response_due_at, null, 'response_due_at 초기화')
  assert.equal(b.resolution_due_at, null, 'resolution_due_at 초기화')
  assert.equal(b.sla_policy_id, null, 'sla_policy_id 초기화')
  assert.equal(b.sla_response_breached, false, 'sla_response_breached 초기화')
  console.log('(6) 진행중 → 접수 되돌리기 + 배정 초기화 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

await app.close()
await pool.end()
console.log('\ntest:transition ALL PASSED')
