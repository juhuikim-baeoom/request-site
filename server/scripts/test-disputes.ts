/**
 * 이의제기 테스트
 * - 완료 건에만, 14일 이내에만, 동시에 1건만
 * - 수락하면 진행중 복귀 + rework_count 증가 (한 트랜잭션)
 * - 기각하면 완료 유지 + 사유 기록
 */
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, requests, requestDisputes } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { changeStatus } from '../src/services/transition.js'

const app = await buildApp()
const cookie = await loginAsDev(app)

const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
const actorId = juhui!.id

/** 완료 상태의 요청을 만든다 */
async function makeCompleted() {
  const [row] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '이의테스트',
    requesterId: actorId, visibility: 'dept',
  }).returning()
  await changeStatus({ reqId: row.id, to: '진행중', actorId })
  await changeStatus({ reqId: row.id, to: '검수대기', actorId })
  await changeStatus({ reqId: row.id, to: '완료', actorId, completionRoute: 'REQUESTER' })
  return row
}

async function cleanup(reqId: number) {
  await db.delete(requestDisputes).where(eq(requestDisputes.requestId, reqId))
  await db.delete(requests).where(eq(requests.id, reqId))
}

// ──────────────────────────────────────────
// (1) 완료 건에 이의제기 → 201, request_view.has_open_dispute = true
// ──────────────────────────────────────────
{
  const req = await makeCompleted()
  const res = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { sid: cookie },
    payload: { reason: '요청한 기간이 아닙니다' },
  })
  assert.equal(res.statusCode, 201, res.body)

  const v = await db.execute<any>(sql`select has_open_dispute, status from request_view where id = ${req.id}`)
  assert.equal(v.rows[0].has_open_dispute, true, '열린 이의 플래그가 뷰에 뜬다')
  assert.equal(v.rows[0].status, '완료', '이의제기 중에도 상태는 완료로 남는다')
  console.log('(1) 이의제기 생성 OK')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (2) 같은 건에 두 번째 이의제기 → 409
// ──────────────────────────────────────────
{
  const req = await makeCompleted()
  await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { sid: cookie },
    payload: { reason: '첫 번째' },
  })
  const dup = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { sid: cookie },
    payload: { reason: '두 번째' },
  })
  assert.equal(dup.statusCode, 409, '동시에 열린 이의는 1건만')
  console.log('(2) 중복 이의제기 거부 OK')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (3) 완료가 아닌 건에 이의제기 → 400
// ──────────────────────────────────────────
{
  const [row] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '미완료건',
    requesterId: actorId, visibility: 'dept',
  }).returning()
  const res = await app.inject({
    method: 'POST', url: `/api/requests/${row.id}/disputes`, cookies: { sid: cookie },
    payload: { reason: '아직 완료 안 됨' },
  })
  assert.equal(res.statusCode, 400)
  console.log('(3) 미완료 건 이의제기 거부 OK')
  await cleanup(row.id)
}

// ──────────────────────────────────────────
// (4) 완료 후 14일이 지난 건 → 400
// ──────────────────────────────────────────
{
  const req = await makeCompleted()
  await db.execute(sql`
    update requests set completed_at = now() - interval '15 days' where id = ${req.id}`)
  const res = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { sid: cookie },
    payload: { reason: '늦게 발견' },
  })
  assert.equal(res.statusCode, 400, '이의제기 기간 만료')
  console.log('(4) 기간 만료 거부 OK')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (5) 이의 수락 → 진행중 복귀 + rework_count+1 + status_cd=ACCEPTED
// ──────────────────────────────────────────
{
  const req = await makeCompleted()
  const created = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { sid: cookie },
    payload: { reason: '데이터가 틀렸습니다' },
  })
  const disputeId = JSON.parse(created.body).id

  const res = await app.inject({
    method: 'PATCH', url: `/api/disputes/${disputeId}`, cookies: { sid: cookie },
    payload: { decision: 'ACCEPTED', comment: '확인했습니다. 다시 작업합니다' },
  })
  assert.equal(res.statusCode, 200, res.body)

  const r = await db.execute<any>(sql`
    select status, rework_count, rework_reason from requests where id = ${req.id}`)
  assert.equal(r.rows[0].status, '진행중', '수락하면 재작업으로 되돌아간다')
  assert.equal(r.rows[0].rework_count, 1)
  assert.equal(r.rows[0].rework_reason, '데이터가 틀렸습니다', '이의 사유가 재작업 사유로 넘어간다')

  const d = await db.execute<any>(sql`
    select status_cd, reviewed_by, reviewed_at, review_comment from request_disputes where id = ${disputeId}`)
  assert.equal(d.rows[0].status_cd, 'ACCEPTED')
  assert.equal(d.rows[0].reviewed_by, actorId)
  assert.ok(d.rows[0].reviewed_at !== null)
  assert.equal(d.rows[0].review_comment, '확인했습니다. 다시 작업합니다')
  console.log('(5) 이의 수락 → 재작업 OK')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (6) 이의 기각 → 완료 유지 + status_cd=REJECTED, 사유 필수
// ──────────────────────────────────────────
{
  const req = await makeCompleted()
  const created = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { sid: cookie },
    payload: { reason: '이것도 해주세요' },
  })
  const disputeId = JSON.parse(created.body).id

  const noComment = await app.inject({
    method: 'PATCH', url: `/api/disputes/${disputeId}`, cookies: { sid: cookie },
    payload: { decision: 'REJECTED' },
  })
  assert.equal(noComment.statusCode, 400, '기각에는 사유가 필수')

  const res = await app.inject({
    method: 'PATCH', url: `/api/disputes/${disputeId}`, cookies: { sid: cookie },
    payload: { decision: 'REJECTED', comment: '최초 요청 범위 밖입니다. 새 요청으로 접수해주세요' },
  })
  assert.equal(res.statusCode, 200, res.body)

  const r = await db.execute<any>(sql`select status, rework_count from requests where id = ${req.id}`)
  assert.equal(r.rows[0].status, '완료', '기각하면 완료 상태가 유지된다')
  assert.equal(r.rows[0].rework_count, 0, '기각은 재작업이 아니다')

  const v = await db.execute<any>(sql`select has_open_dispute from request_view where id = ${req.id}`)
  assert.equal(v.rows[0].has_open_dispute, false, '심사가 끝나면 열린 이의가 사라진다')
  console.log('(6) 이의 기각 OK')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (7) 이미 심사된 이의를 다시 심사 → 400
// ──────────────────────────────────────────
{
  const req = await makeCompleted()
  const created = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { sid: cookie },
    payload: { reason: '사유' },
  })
  const disputeId = JSON.parse(created.body).id
  await app.inject({
    method: 'PATCH', url: `/api/disputes/${disputeId}`, cookies: { sid: cookie },
    payload: { decision: 'REJECTED', comment: '범위 밖' },
  })
  const again = await app.inject({
    method: 'PATCH', url: `/api/disputes/${disputeId}`, cookies: { sid: cookie },
    payload: { decision: 'ACCEPTED', comment: '역시 맞네요' },
  })
  assert.equal(again.statusCode, 400, '이미 심사된 이의는 다시 심사할 수 없다')
  console.log('(7) 재심사 거부 OK')
  await cleanup(req.id)
}

await app.close()
await pool.end()
console.log('\ntest:disputes ALL PASSED')
