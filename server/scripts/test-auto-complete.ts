/**
 * 자동완료 배치 테스트
 * - 검수 기한이 지난 건은 AUTO 경로로 완료된다
 * - 기한 전인 건은 건드리지 않는다
 * - 리마인더는 건당 1회만 나간다
 */
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, requests, notifications } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { changeStatus } from '../src/services/transition.js'
import { runAutoComplete } from '../src/jobs/auto-complete.js'

const app = await buildApp()
await loginAsDev(app)

const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
const actorId = juhui!.id

/** 비동기(fire-and-forget) 알림 INSERT가 완료될 때까지 짧게 대기 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100))
}

/**
 * 테스트용 일반 직원 계정.
 * 시드에는 시스템팀(juhui) 1명뿐인데, 배치가 요청자에게 알림을 보내는지 보려면
 * 요청자가 배치 액터(시스템팀)와 달라야 한다.
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

const requesterId = await ensureStaffUser()

async function makeInspecting() {
  const [row] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '자동완료테스트',
    requesterId, visibility: 'dept',
  }).returning()
  await changeStatus({ reqId: row.id, to: '진행중', actorId })
  await changeStatus({ reqId: row.id, to: '검수대기', actorId })
  return row
}

async function cleanup(reqId: number) {
  await db.delete(notifications).where(eq(notifications.requestId, reqId))
  await db.delete(requests).where(eq(requests.id, reqId))
}

// ──────────────────────────────────────────
// (1) 기한이 지난 건 → AUTO 완료
// ──────────────────────────────────────────
{
  const req = await makeInspecting()
  await db.execute(sql`
    update requests set inspection_due_at = now() - interval '1 hour' where id = ${req.id}`)

  // makeInspecting() 자체가 (진행중, 검수대기) 전이로 알림 2건을 미리 만들어두므로,
  // 자동완료가 "추가로" 몇 건을 보내는지 보려면 배치 실행 전 개수를 기준선으로 잡아야 한다.
  await tick()
  const before = await db.execute<any>(sql`
    select count(*)::int as c from notifications where request_id = ${req.id} and user_id = ${requesterId}`)
  const baseline = before.rows[0].c

  const result = await runAutoComplete()
  assert.ok(result.completed >= 1, `최소 1건은 자동완료돼야 함 (실제 ${result.completed})`)

  const cur = await db.execute<any>(sql`
    select status, completion_route, completed_at from requests where id = ${req.id}`)
  const r = cur.rows[0]
  assert.equal(r.status, '완료')
  assert.equal(r.completion_route, 'AUTO')
  assert.ok(r.completed_at !== null)

  // changeStatus가 tx 경로에서 자체 발송하는 일반 알림("상태가 완료로 변경되었습니다")과
  // 배치가 보내는 전용 알림("자동 완료되었습니다")이 중복 발송되지 않는지 확인 —
  // 이번 자동완료 1건에 대해 요청자는 정확히 알림 1개만 새로 받아야 한다.
  await tick()
  const after = await db.execute<any>(sql`
    select message from notifications where request_id = ${req.id} and user_id = ${requesterId} order by created_at`)
  const newNotifs = after.rows.slice(baseline)
  assert.equal(newNotifs.length, 1, `자동완료로 새로 생긴 알림은 1건만 가야 함 (실제 ${newNotifs.length}건: ${JSON.stringify(newNotifs.map((n: any) => n.message))})`)
  assert.match(newNotifs[0].message, /자동 완료/, '배치 전용 메시지만 남아야 함')

  console.log('(1) 기한 만료 → AUTO 완료 OK (신규 알림 1건)')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (2) 기한 전인 건은 건드리지 않는다
// ──────────────────────────────────────────
{
  const req = await makeInspecting()   // inspection_due_at = now() + 7d
  await runAutoComplete()
  const cur = await db.execute<any>(sql`select status from requests where id = ${req.id}`)
  assert.equal(cur.rows[0].status, '검수대기', '기한 전이면 그대로 둔다')
  console.log('(2) 기한 전 건 유지 OK')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (3) 리마인더는 건당 1회만
// ──────────────────────────────────────────
{
  const req = await makeInspecting()
  // 검수대기 진입 후 4일 지난 상황 (리마인더 기준 3일 초과, 자동완료 기한 전)
  await db.execute(sql`
    update requests
    set inspection_due_at = now() + interval '3 days'
    where id = ${req.id}`)

  const first = await runAutoComplete()
  assert.ok(first.reminded >= 1, `리마인더가 나가야 함 (실제 ${first.reminded})`)

  const sent = await db.execute<any>(sql`
    select inspection_reminder_sent_at from requests where id = ${req.id}`)
  assert.ok(sent.rows[0].inspection_reminder_sent_at !== null, '발송 시각이 기록된다')

  const n1 = await db.execute<any>(sql`
    select count(*)::int as c from notifications where request_id = ${req.id}`)

  // 두 번째 실행에서는 다시 보내지 않는다
  await runAutoComplete()
  const n2 = await db.execute<any>(sql`
    select count(*)::int as c from notifications where request_id = ${req.id}`)
  assert.equal(n2.rows[0].c, n1.rows[0].c, '리마인더는 두 번 나가지 않는다')

  const cur = await db.execute<any>(sql`select status from requests where id = ${req.id}`)
  assert.equal(cur.rows[0].status, '검수대기', '리마인더만 나가고 완료되지는 않는다')
  console.log('(3) 리마인더 1회 발송 OK')
  await cleanup(req.id)
}

await app.close()
await pool.end()
console.log('\ntest:auto-complete ALL PASSED')
