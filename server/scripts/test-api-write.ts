import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { requests, users } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()
const sid = await loginAsDev(app)
const cookies = { sid }

// 생성 (+공유대상)
const create = await app.inject({
  method: 'POST', url: '/api/requests', cookies,
  payload: {
    org: '공통', type_code: 'feature', priority: '보통', visibility: 'dept',
    title: 'write 테스트', body: '<p>본문</p>', desired_due: null,
    intake_detail: { purpose: '업무 효율화', expected_effect: '처리 속도 향상' },
    sharedTargets: [{ target_type: 'function', target_value: '교학팀' }],
  },
})
assert.equal(create.statusCode, 201)
const reqId = create.json().id
assert.match(create.json().seq, /^\d{6}-\d{2}$/)
console.log('create ok seq=', create.json().seq)

// 공유대상 기록 확인
const st = await db.execute<any>(sql`select count(*)::int as c from request_shared_targets where request_id = ${reqId}`)
assert.equal(st.rows[0].c, 1)
console.log('shared target saved ok')

// 보드 변경 (시스템팀 = 김주희)
const board = await app.inject({ method: 'PATCH', url: `/api/requests/${reqId}`, cookies, payload: { status: '진행중' } })
assert.equal(board.statusCode, 200)
const check = await db.execute<any>(sql`select status from requests where id = ${reqId}`)
assert.equal(check.rows[0].status, '진행중')
console.log('board update ok')

// 내용 수정
const edit = await app.inject({ method: 'PATCH', url: `/api/requests/${reqId}`, cookies, payload: { title: '수정됨' } })
assert.equal(edit.statusCode, 200)
console.log('edit ok')

// status 변경 + 필드 편집 동시 → 400 (stale-status bypass 방지)
const combined = await app.inject({
  method: 'PATCH', url: `/api/requests/${reqId}`, cookies,
  payload: { status: '보류', title: '악의적편집' },
})
assert.equal(combined.statusCode, 400, `status+field 동시 → 400, got ${combined.statusCode}`)
console.log('combined status+field → 400 ok')

// 정리
await db.delete(requests).where(eq(requests.id, reqId))

// ──────────────────────────────────────────
// 긴급도 편집 → priority_level·SLA 기한 재산정 (P7+P8 최종 리뷰 [5])
// 배정된(impact != null) 진행중 건에서 urgency를 바꾸면 derivePriority(urgency, impact)가
// 어긋나지 않도록 공용 computeSlaFields로 재산정되어야 한다.
// ──────────────────────────────────────────
{
  const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
  const actorId = juhui!.id

  const create2 = await app.inject({
    method: 'POST', url: '/api/requests', cookies,
    payload: {
      org: '공통', type_code: 'error', urgency: '보통', visibility: 'dept',
      title: '긴급도재산정테스트',
      intake_detail: { screen_url: 'https://x', reproduce: '재현', occurred_at: '2026-01-01' },
    },
  })
  assert.equal(create2.statusCode, 201)
  const urgId = create2.json().id

  const assign = await app.inject({
    method: 'POST', url: `/api/requests/${urgId}/assign`, cookies,
    payload: { assigneeId: actorId, impact: '보통' },
  })
  assert.equal(assign.statusCode, 200, 'assign ok')

  const before = await db.execute<any>(sql`
    select priority_level, resolution_due_at, response_due_at, assigned_at, first_response_at, status
    from requests where id = ${urgId}`)
  const b2 = before.rows[0]
  assert.equal(b2.priority_level, 'P3', '보통×보통 = P3 배정 직후')

  // 긴급도를 높음으로 편집 → 보통(impact)×높음(urgency) = P2 재산정
  const urgEdit = await app.inject({
    method: 'PATCH', url: `/api/requests/${urgId}`, cookies, payload: { urgency: '높음' },
  })
  assert.equal(urgEdit.statusCode, 200, 'urgency edit ok')

  const after = await db.execute<any>(sql`
    select urgency, priority_level, resolution_due_at, response_due_at, assigned_at, first_response_at, status
    from requests where id = ${urgId}`)
  const a2 = after.rows[0]
  assert.equal(a2.urgency, '높음', 'urgency 갱신')
  assert.equal(a2.priority_level, 'P2', '보통×높음 = P2로 재산정')
  assert.notEqual(String(a2.resolution_due_at), String(b2.resolution_due_at), 'resolution_due_at 재산정')
  assert.notEqual(String(a2.response_due_at), String(b2.response_due_at), 'response_due_at 재산정')
  assert.equal(String(a2.assigned_at), String(b2.assigned_at), 'assigned_at 보존')
  assert.equal(String(a2.first_response_at), String(b2.first_response_at), 'first_response_at 보존')
  assert.equal(a2.status, b2.status, 'status 보존')
  console.log('urgency edit recompute ok: P3 → P2, resolution/response_due_at 갱신, assigned_at/first_response_at/status 보존')

  // 같은 urgency 값으로 다시 PATCH → 실제로 안 바뀌었으므로 재산정 스킵 (priority_level 그대로)
  const noop = await app.inject({
    method: 'PATCH', url: `/api/requests/${urgId}`, cookies, payload: { urgency: '높음' },
  })
  assert.equal(noop.statusCode, 200, 'no-op urgency edit ok')
  const afterNoop = await db.execute<any>(sql`select priority_level from requests where id = ${urgId}`)
  assert.equal(afterNoop.rows[0].priority_level, 'P2', '동일 urgency 재전송 시 priority_level 불변')
  console.log('urgency no-op (same value) → 재산정 스킵 ok')

  await db.delete(requests).where(eq(requests.id, urgId))
}

await app.close(); await pool.end()
console.log('API WRITE TEST OK')
