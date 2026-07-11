/**
 * 배정 서비스 테스트
 * - 접수건 assign → status 진행중·priority_level·resolution_due_at·assigned_at 세팅
 * - 비접수건 assign 거부
 */
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, requests } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { assignRequest, AssignError } from '../src/services/assign.js'

const app = await buildApp()
await loginAsDev(app)

const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
const actorId = juhui!.id

// ──────────────────────────────────────────
// (1) 접수건 배정 → status·priority_level·resolution_due_at·assigned_at
// ──────────────────────────────────────────
{
  const [req] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '배정테스트', urgency: '높음',
    requesterId: actorId, visibility: 'dept',
  }).returning()

  await assignRequest({ reqId: req.id, assigneeId: actorId, impact: '높음', actorId })

  const cur = await db.execute<any>(sql`
    select status, priority_level, resolution_due_at, assigned_at, first_response_at, assignee_id
    from requests where id = ${req.id}`)
  const r = cur.rows[0]

  assert.equal(r.status, '진행중', 'status = 진행중')
  // urgency=높음, impact=높음 → P1
  assert.equal(r.priority_level, 'P1', 'priority_level = P1')
  assert.ok(r.assigned_at !== null, 'assigned_at 세팅')
  assert.ok(r.first_response_at !== null, 'first_response_at 세팅')
  assert.equal(r.assignee_id, actorId, 'assignee_id 세팅')
  // P1 resolution_minutes=480 → resolution_due_at 있어야 함
  assert.ok(r.resolution_due_at !== null, 'resolution_due_at 세팅')
  console.log('(1) 접수건 배정 OK, priority_level=P1, resolution_due_at:', r.resolution_due_at)

  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (2) P4 (resolution_minutes=null) → resolution_due_at null
// ──────────────────────────────────────────
{
  const [req] = await db.insert(requests).values({
    org: '공통', typeCode: 'feature', title: '배정P4테스트', urgency: '낮음',
    requesterId: actorId, visibility: 'dept',
  }).returning()

  await assignRequest({ reqId: req.id, assigneeId: actorId, impact: '낮음', actorId })

  const cur = await db.execute<any>(sql`select priority_level, resolution_due_at from requests where id = ${req.id}`)
  const r = cur.rows[0]
  assert.equal(r.priority_level, 'P4', 'P4')
  assert.equal(r.resolution_due_at, null, 'P4는 resolution_due_at null')
  console.log('(2) P4 resolution_due_at null OK')

  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (3) 비접수건 배정 거부 (ONLY_FROM_RECEIVED)
// ──────────────────────────────────────────
{
  const [req] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '비접수배정테스트', status: '진행중',
    requesterId: actorId, visibility: 'dept',
  }).returning()

  let threw = false
  try {
    await assignRequest({ reqId: req.id, assigneeId: actorId, impact: '보통', actorId })
  } catch (e: any) {
    assert.ok(e instanceof AssignError)
    assert.equal(e.code, 'ONLY_FROM_RECEIVED')
    threw = true
  }
  assert.ok(threw, '예외 발생해야 함')
  console.log('(3) 비접수건 배정 거부 OK')

  await db.delete(requests).where(eq(requests.id, req.id))
}

await app.close()
await pool.end()
console.log('\ntest:assign ALL PASSED')
