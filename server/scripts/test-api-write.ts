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
    shared_targets: [{ target_type: 'function', target_value: '교학팀' }],
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

// ──────────────────────────────────────────
// 미배정 건 긴급도 편집 → response_due_at만 재산정 (최종 리뷰 I-1)
// 요청자가 편집할 수 있는 유일한 창(status='접수', 대개 미배정)에서 긴급도를 바꾸면
// impact가 없어 priority_level·resolution_due_at은 정할 수 없지만, response_due_at은
// 생성부와 동일한 함수(computeResponseDueAtForUrgency)로 새 긴급도 기준으로 갱신되어야 한다.
// ──────────────────────────────────────────
{
  const create3 = await app.inject({
    method: 'POST', url: '/api/requests', cookies,
    payload: {
      org: '공통', type_code: 'error', urgency: '낮음', visibility: 'dept',
      title: '미배정긴급도재산정테스트',
      intake_detail: { screen_url: 'https://x', reproduce: '재현', occurred_at: '2026-01-01' },
    },
  })
  assert.equal(create3.statusCode, 201)
  const unassignedId = create3.json().id

  const before3 = await db.execute<any>(sql`
    select impact, priority_level, response_due_at, status from requests where id = ${unassignedId}`)
  const b3 = before3.rows[0]
  assert.equal(b3.impact, null, '미배정: impact null')
  assert.equal(b3.status, '접수', '미배정: status 접수')
  assert.ok(b3.response_due_at !== null, '생성 시 urgency=낮음 기준 response_due_at 세팅됨')

  const urgEdit3 = await app.inject({
    method: 'PATCH', url: `/api/requests/${unassignedId}`, cookies, payload: { urgency: '높음' },
  })
  assert.equal(urgEdit3.statusCode, 200, 'unassigned urgency edit ok')

  const after3 = await db.execute<any>(sql`
    select urgency, impact, priority_level, response_due_at, status from requests where id = ${unassignedId}`)
  const a3 = after3.rows[0]
  assert.equal(a3.urgency, '높음', 'urgency 갱신')
  assert.equal(a3.impact, null, 'impact는 여전히 null (미배정 유지)')
  assert.equal(a3.priority_level, null, 'priority_level은 미배정 상태이므로 여전히 미정')
  assert.equal(a3.status, '접수', 'status 보존')
  // 낮음(P4, 960분) → 높음(P2, 240분)로 올렸으므로 기한이 앞당겨져야 한다.
  // 단순 부등호(notEqual)만 검사하면 "값이 바뀌긴 했지만 반대 방향으로 재계산"하는
  // 회귀(예: 긴급도-분 매핑 역전)를 잡지 못하므로 방향까지 단언한다.
  assert.ok(
    new Date(a3.response_due_at).getTime() < new Date(b3.response_due_at).getTime(),
    `I-1 회귀: 미배정 건 긴급도를 낮음→높음으로 올리면 response_due_at이 더 이른 시각으로 재산정되어야 함 ` +
      `(before=${b3.response_due_at}, after=${a3.response_due_at})`,
  )
  console.log('unassigned urgency edit ok: response_due_at만 재산정, impact/priority_level 미배정 유지')

  await db.delete(requests).where(eq(requests.id, unassignedId))
}

await app.close(); await pool.end()
console.log('API WRITE TEST OK')
