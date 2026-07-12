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
// (2) 접수 → 완료 (금지 — completionRoute를 줘도 전이 자체가 불법이어야 함)
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  let threw = false
  try {
    await changeStatus({ reqId: req.id, to: '완료', actorId, completionRoute: 'SYSTEM_FORCED' })
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
// (3) 완료 → 진행중 rework_count+1 (완료에 도달하려면 검수대기를 거친다)
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  // 접수 → 진행중 → 검수대기 → 완료
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '검수대기', actorId })
  await changeStatus({ reqId: req.id, to: '완료', actorId, completionRoute: 'SYSTEM_FORCED' })
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
// (6) 진행중 → 완료 직행 금지 (검수대기를 반드시 거친다)
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  let threw = false
  try {
    await changeStatus({ reqId: req.id, to: '완료', actorId, completionRoute: 'SYSTEM_FORCED' })
  } catch (e: any) {
    assert.equal(e.code, 'ILLEGAL_TRANSITION')
    threw = true
  }
  assert.ok(threw, '진행중 → 완료 직행은 막혀야 함')
  console.log('(6) 진행중 → 완료 직행 금지 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (7) 진행중 → 검수대기: first_resolved_at·inspection_due_at 세팅
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '검수대기', actorId })
  const cur = await db.execute<any>(sql`
    select status, first_resolved_at, inspection_due_at, completed_at
    from requests where id = ${req.id}`)
  const r = cur.rows[0]
  assert.equal(r.status, '검수대기')
  assert.ok(r.first_resolved_at !== null, 'first_resolved_at 세팅됨')
  assert.ok(r.inspection_due_at !== null, 'inspection_due_at 세팅됨')
  assert.equal(r.completed_at, null, '아직 완료가 아니므로 completed_at은 null')
  const days = (new Date(r.inspection_due_at).getTime() - Date.now()) / 86_400_000
  assert.ok(days > 6.9 && days < 7.1, `inspection_due_at은 약 7일 뒤여야 함 (실제 ${days})`)
  console.log('(7) 진행중 → 검수대기 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (8) 검수대기 → 완료: completion_route 기록
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '검수대기', actorId })
  await changeStatus({ reqId: req.id, to: '완료', actorId, completionRoute: 'REQUESTER' })
  const cur = await db.execute<any>(sql`
    select status, completion_route, completed_at, final_resolved_at, inspection_due_at
    from requests where id = ${req.id}`)
  const r = cur.rows[0]
  assert.equal(r.status, '완료')
  assert.equal(r.completion_route, 'REQUESTER')
  assert.ok(r.completed_at !== null, 'completed_at 세팅됨')
  assert.ok(r.final_resolved_at !== null, 'final_resolved_at 세팅됨')
  assert.equal(r.inspection_due_at, null, '완료되면 inspection_due_at은 비워짐')
  console.log('(8) 검수대기 → 완료 (REQUESTER) OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (9) 검수대기 → 진행중 (검수 반려): rework_count+1
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '검수대기', actorId })
  await changeStatus({ reqId: req.id, to: '진행중', reason: '엉뚱한 데이터가 나왔습니다', actorId })
  const cur = await db.execute<any>(sql`
    select status, rework_count, rework_reason, inspection_due_at
    from requests where id = ${req.id}`)
  const r = cur.rows[0]
  assert.equal(r.status, '진행중')
  assert.equal(r.rework_count, 1, '검수 반려도 rework_count에 잡혀야 함')
  assert.equal(r.rework_reason, '엉뚱한 데이터가 나왔습니다')
  assert.equal(r.inspection_due_at, null, '진행중으로 돌아가면 inspection_due_at은 비워짐')
  console.log('(9) 검수대기 → 진행중 rework_count+1 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (10) 완료 전이에 completionRoute 누락 시 거부
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '검수대기', actorId })
  let threw = false
  try {
    await changeStatus({ reqId: req.id, to: '완료', actorId })
  } catch (e: any) {
    assert.equal(e.code, 'MISSING_COMPLETION_ROUTE')
    threw = true
  }
  assert.ok(threw, 'completionRoute 없이 완료 전이는 거부되어야 함')
  console.log('(10) completionRoute 누락 거부 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

await app.close()
await pool.end()
console.log('\ntest:transition ALL PASSED')
