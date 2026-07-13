/**
 * 영향도 재조정 서비스 테스트
 * - 재산정: priority_level·resolution_due_at 갱신, assigned_at·first_response_at 보존
 * - 미배정 건 거부 (NOT_ASSIGNED)
 * - 종결 건 거부 (CLOSED)
 */
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, requests } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { assignRequest } from '../src/services/assign.js'
import { changeStatus } from '../src/services/transition.js'
import { changeImpact, ImpactError } from '../src/services/impact.js'

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

await app.close()
await pool.end()
console.log('\ntest:impact ALL PASSED')
