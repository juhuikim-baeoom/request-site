/**
 * 영향도 재조정 서비스 테스트
 * - 재산정: priority_level·resolution_due_at 갱신, assigned_at·first_response_at 보존
 * - 미배정 건 거부 (NOT_ASSIGNED)
 * - 종결 건 거부 (CLOSED)
 * - 담당자(≠행위자)에게 알림 발송
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, requests } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { assignRequest } from '../src/services/assign.js'
import { changeStatus } from '../src/services/transition.js'
import { changeImpact, ImpactError } from '../src/services/impact.js'

/** 비동기 알림 INSERT가 완료될 때까지 짧게 대기 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

const app = await buildApp()
await loginAsDev(app)

const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
const actorId = juhui!.id

/** urgency='보통' 인 테스트 요청 (보통×보통 = P3, 보통×높음 = P2) */
async function makeRequest() {
  const [row] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '영향도테스트',
    requesterId: actorId, visibility: 'dept', urgency: '보통',
  }).returning()
  return row
}

// ──────────────────────────────────────────
// (1) 재산정: 보통 → 높음 이면 P3 → P2, 배정 시각은 보존
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await assignRequest({ reqId: req.id, assigneeId: actorId, impact: '보통', actorId })
  const before = await db.execute<any>(sql`
    select priority_level, assigned_at, first_response_at, resolution_due_at
    from requests where id = ${req.id}
  `)
  const b = before.rows[0]
  assert.equal(b.priority_level, 'P3', '보통×보통 = P3')

  const res = await changeImpact({ reqId: req.id, impact: '높음', actorId })
  assert.equal(res.priorityLevel, 'P2', '보통×높음 = P2 반환')

  const after = await db.execute<any>(sql`
    select impact, priority_level, assigned_at, first_response_at, resolution_due_at, sla_policy_id, status
    from requests where id = ${req.id}
  `)
  const a = after.rows[0]
  assert.equal(a.impact, '높음', 'impact 갱신')
  assert.equal(a.priority_level, 'P2', 'priority_level 재산정')
  assert.equal(a.status, '진행중', 'status 불변')
  assert.equal(String(a.assigned_at), String(b.assigned_at), 'assigned_at 보존')
  assert.equal(String(a.first_response_at), String(b.first_response_at), 'first_response_at 보존')
  assert.notEqual(String(a.resolution_due_at), String(b.resolution_due_at), 'resolution_due_at 재산정')
  assert.ok(a.sla_policy_id, 'sla_policy_id 세팅')
  console.log('(1) 재산정 + 배정 시각 보존 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (2) 미배정 건 거부
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  let threw = false
  try {
    await changeImpact({ reqId: req.id, impact: '높음', actorId })
  } catch (e: any) {
    assert.ok(e instanceof ImpactError, 'ImpactError여야 함')
    assert.equal(e.code, 'NOT_ASSIGNED')
    threw = true
  }
  assert.ok(threw, '예외가 발생해야 함')
  console.log('(2) 미배정 건 거부 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (3) 종결 건 거부 (완료)
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await assignRequest({ reqId: req.id, assigneeId: actorId, impact: '보통', actorId })
  await changeStatus({ reqId: req.id, to: '완료', actorId })
  let threw = false
  try {
    await changeImpact({ reqId: req.id, impact: '높음', actorId })
  } catch (e: any) {
    assert.equal(e.code, 'CLOSED')
    threw = true
  }
  assert.ok(threw, '예외가 발생해야 함')
  console.log('(3) 종결 건 거부 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (4) 담당자(≠행위자)에게 영향도 변경 알림 발송
// ──────────────────────────────────────────
{
  // 행위자(actorId)와 다른 사용자를 담당자로 배정 — assignee_id !== actorId 분기 검증
  const [otherUser] = await db.insert(users).values({
    email: `impact-other-${randomBytes(4).toString('hex')}@baeoom.com`,
    name: '영향도알림테스트대상',
    orgAffil: '배움',
    deptFunction: '교학팀',
    role: 'staff',
  }).returning()

  const req = await makeRequest()
  await assignRequest({ reqId: req.id, assigneeId: otherUser.id, impact: '보통', actorId })
  await db.execute(sql`delete from notifications where user_id = ${otherUser.id}`)

  await changeImpact({ reqId: req.id, impact: '높음', actorId })
  await tick()

  const notifRows = await db.execute<{ user_id: string; type: string; request_id: number; message: string }>(sql`
    select user_id, type, request_id, message from notifications where request_id = ${req.id} and type = 'status'
  `)
  assert.equal(notifRows.rows.length, 1, '영향도 변경 알림 1개')
  assert.equal(notifRows.rows[0].user_id, otherUser.id, '담당자에게 알림')
  assert.ok(notifRows.rows[0].message.includes('P2'), '변경된 priority_level 메시지 포함')
  console.log('(4) 담당자(≠행위자) 영향도 변경 알림 OK:', notifRows.rows[0].message)

  await db.execute(sql`delete from notifications where user_id = ${otherUser.id}`)
  await db.delete(requests).where(eq(requests.id, req.id))
  await db.delete(users).where(eq(users.id, otherUser.id))
}

await app.close()
await pool.end()
console.log('\ntest:impact ALL PASSED')
