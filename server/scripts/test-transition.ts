/**
 * 상태 전이 서비스 테스트
 * - 허용/금지 전이
 * - 완료 → 진행중 rework_count+1
 * - 보류 왕복
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { db, pool, withUser } from '../src/db/client.js'
import { users, requests, notifications } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { changeStatus, TransitionError } from '../src/services/transition.js'
import { notify } from '../src/services/notify.js'
import { assignRequest } from '../src/services/assign.js'

/** 비동기(fire-and-forget) 알림 INSERT가 완료될 때까지 짧게 대기 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100))
}

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

/** requesterId가 actorId와 다른 요청 생성 — 알림 발생 조건(requesterId !== actorId)을 만족시키기 위함 */
async function makeRequestFor(requesterId: string) {
  const [row] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '전이테스트(알림)',
    requesterId, visibility: 'dept',
  }).returning()
  return row
}

// 알림 테스트용 — actorId와 다른 요청자
const [otherRequester] = await db.insert(users).values({
  email: `transition-notif-${randomBytes(4).toString('hex')}@baeoom.com`,
  name: '전이알림테스트요청자',
  orgAffil: '공통',
  role: 'staff',
}).returning()

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

// ──────────────────────────────────────────
// (11) SYSTEM_FORCED 강제 완료 — reason이 completion_note에 저장됨
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '검수대기', actorId })
  await changeStatus({
    reqId: req.id, to: '완료', actorId,
    completionRoute: 'SYSTEM_FORCED', reason: '요청자와 구두 확인 완료',
  })
  const cur = await db.execute<any>(sql`select completion_note from requests where id = ${req.id}`)
  assert.equal(cur.rows[0].completion_note, '요청자와 구두 확인 완료', 'completion_note에 강제 완료 사유가 저장되어야 함')
  console.log('(11) SYSTEM_FORCED 강제 완료 사유 → completion_note 저장 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (12) 접수 → 완료 (completionRoute 없음) — ILLEGAL_TRANSITION이 MISSING_COMPLETION_ROUTE보다 우선
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  let code = ''
  try {
    await changeStatus({ reqId: req.id, to: '완료', actorId })
  } catch (e: any) {
    assert.ok(e instanceof TransitionError, 'TransitionError여야 함')
    code = e.code
  }
  assert.equal(code, 'ILLEGAL_TRANSITION', '전이 자체가 불법이면 필드 누락보다 ILLEGAL_TRANSITION이 보고되어야 함')
  console.log('(12) 접수 → 완료(completionRoute 없음) → ILLEGAL_TRANSITION 우선 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (13) tx 경로 — changeStatus는 스스로 알림을 보내지 않고 호출자에게 미룬다
// ──────────────────────────────────────────
{
  const req = await makeRequestFor(otherRequester.id)
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '검수대기', actorId })
  await changeStatus({ reqId: req.id, to: '완료', actorId, completionRoute: 'REQUESTER' })
  // 위 세 전이는 tx 없이 호출됐으므로 각각 fire-and-forget notify()가 발생한다 — 정착될 때까지 대기
  await tick()

  const before = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from notifications where request_id = ${req.id}`,
  )
  const countBefore = before.rows[0].n
  // 위 3건(진행중/검수대기/완료)의 비-tx 전이는 requesterId !== actorId이므로 각각 자동 발송된다 —
  // 이 값이 흔들리면(예: 리뷰어가 non-tx 경로의 notify() 호출을 삭제) 아래 카운트 비교만으로는
  // "0건과 0건이 같다"는 식으로 통과해버릴 수 있으므로 기대값을 명시적으로 고정한다.
  assert.equal(countBefore, 3, '비-tx 전이 3건은 각각 알림을 자동 발송해야 함')

  let pending: { userId: string; type: string; requestId: number; message: string } | undefined
  await withUser(actorId, async (tx) => {
    const result = await changeStatus({
      reqId: req.id, to: '진행중', reason: '이의 수락', actorId, tx,
    })
    pending = result.notification
    // 아직 커밋 전 — changeStatus가 스스로 알림을 보냈다면 여기서 이미 행이 늘어 있을 것
    const mid = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from notifications where request_id = ${req.id}`,
    )
    assert.equal(mid.rows[0].n, countBefore, 'tx 커밋 전에는 알림이 발송되지 않아야 함')
  })

  assert.ok(pending, 'tx 경로는 notification 정보를 반환해야 함')

  const afterCommit = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from notifications where request_id = ${req.id}`,
  )
  assert.equal(afterCommit.rows[0].n, countBefore, '커밋 후에도 changeStatus 스스로는 알림을 보내지 않아야 함')

  // 호출자가 커밋 후 직접 발송해야 하는 계약
  await notify(pending!.userId, pending!.type as 'status', pending!.requestId, pending!.message)
  const afterNotify = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from notifications where request_id = ${req.id}`,
  )
  assert.equal(afterNotify.rows[0].n, countBefore + 1, '호출자가 notify()를 호출하면 알림이 1건 늘어야 함')

  console.log('(13) tx 경로 — changeStatus는 알림을 미루고 호출자가 발송 OK')
  await db.delete(notifications).where(eq(notifications.requestId, req.id))
  await db.delete(requests).where(eq(requests.id, req.id))
}
await db.delete(users).where(eq(users.id, otherRequester.id))

// ──────────────────────────────────────────
// (14) SYSTEM_FORCED 강제 완료 사유가 재작업 후 재완료 시 지워져야 함
// (completion_note는 강제완료 감사 추적 컬럼 — 새 completionRoute로 재완료되면서
//  reason을 주지 않으면, 이전 강제완료 사유가 남아있으면 감사 기록이 오염된다)
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '검수대기', actorId })
  await changeStatus({
    reqId: req.id, to: '완료', actorId,
    completionRoute: 'SYSTEM_FORCED', reason: '요청자와 구두 확인 완료',
  })
  const forced = await db.execute<any>(sql`select completion_note, completion_route from requests where id = ${req.id}`)
  assert.equal(forced.rows[0].completion_note, '요청자와 구두 확인 완료', '강제 완료 사유가 저장되어야 함')
  assert.equal(forced.rows[0].completion_route, 'SYSTEM_FORCED')

  // 이의 수락 등으로 재작업 → 검수대기 → 다시 완료 (이번엔 REQUESTER, reason 없음)
  await changeStatus({ reqId: req.id, to: '진행중', reason: '이의 수락', actorId })
  await changeStatus({ reqId: req.id, to: '검수대기', actorId })
  await changeStatus({ reqId: req.id, to: '완료', actorId, completionRoute: 'REQUESTER' })

  const recompleted = await db.execute<any>(sql`select completion_note, completion_route from requests where id = ${req.id}`)
  assert.equal(recompleted.rows[0].completion_route, 'REQUESTER', 'completion_route가 REQUESTER로 갱신되어야 함')
  assert.equal(recompleted.rows[0].completion_note, null, '이전 강제 완료 사유가 새 완료에서는 지워져야 함')
  console.log('(14) 재작업 후 재완료 시 이전 completion_note가 지워짐 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (15) 진행중 → 접수 되돌리기 — 배정 정보 초기화
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
  console.log('(15) 진행중 → 접수 되돌리기 + 배정 초기화 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

await app.close()
await pool.end()
console.log('\ntest:transition ALL PASSED')
