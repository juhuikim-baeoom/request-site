/**
 * intake_detail 검증 테스트
 * - 타입별 필수키 누락 → 400
 * - 정상 요청 → 201 + response_due_at 세팅
 */
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { requests } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()
const sid = await loginAsDev(app)
const cookies = { sid }

// ──────────────────────────────────────────
// (1) error 타입 — 필수키 누락 → 400
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'POST', url: '/api/requests', cookies,
    payload: {
      org: '공통', type_code: 'error', title: '오류테스트',
      intake_detail: { screen_url: 'https://example.com' }, // reproduce, occurred_at 누락
    },
  })
  assert.equal(res.statusCode, 400, `error 누락 → 400, got ${res.statusCode}`)
  const body = res.json()
  assert.equal(body.error, 'intake_detail_missing')
  assert.ok(body.missing.includes('reproduce'))
  assert.ok(body.missing.includes('occurred_at'))
  console.log('(1) error 타입 필수키 누락 400 OK')
}

// ──────────────────────────────────────────
// (2) feature 타입 — 필수키 누락 → 400
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'POST', url: '/api/requests', cookies,
    payload: {
      org: '공통', type_code: 'feature', title: '기능요청테스트',
      intake_detail: {}, // purpose, expected_effect 누락
    },
  })
  assert.equal(res.statusCode, 400, `feature 누락 → 400, got ${res.statusCode}`)
  console.log('(2) feature 타입 필수키 누락 400 OK')
}

// ──────────────────────────────────────────
// (3) data 타입 — 정상 → 201 + response_due_at 세팅
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'POST', url: '/api/requests', cookies,
    payload: {
      org: '공통', type_code: 'data', title: '데이터추출테스트',
      urgency: '높음',
      intake_detail: { items: '학생명단', period: '2026-01', format: 'xlsx' },
    },
  })
  assert.equal(res.statusCode, 201, `data 정상 → 201, got ${res.statusCode}: ${res.body}`)
  const created = res.json()
  assert.ok(created.id, 'id 있음')

  // response_due_at 세팅 확인
  const row = await db.query.requests.findFirst({ where: eq(requests.id, created.id) })
  assert.ok(row?.responseDueAt !== null && row?.responseDueAt !== undefined, 'response_due_at 세팅')
  console.log('(3) data 타입 정상 201 + response_due_at OK:', row?.responseDueAt)

  // urgency, intake_detail 저장 확인
  assert.equal(row?.urgency, '높음', 'urgency 저장')
  const detail = row?.intakeDetail as any
  assert.equal(detail.items, '학생명단', 'intake_detail.items 저장')

  await db.delete(requests).where(eq(requests.id, created.id))
}

// ──────────────────────────────────────────
// (4) file 타입 — 정상 → 201
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'POST', url: '/api/requests', cookies,
    payload: {
      org: '공통', type_code: 'file', title: '파일변경테스트',
      intake_detail: { target_file: '/config/app.json', change_detail: '설정값 수정' },
    },
  })
  assert.equal(res.statusCode, 201, `file 정상 → 201, got ${res.statusCode}`)
  const created = res.json()
  await db.delete(requests).where(eq(requests.id, created.id))
  console.log('(4) file 타입 정상 201 OK')
}

// ──────────────────────────────────────────
// (5) intake_detail 없이 error 타입 → 400 (빈 객체도 필수키 없으면 400)
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'POST', url: '/api/requests', cookies,
    payload: {
      org: '공통', type_code: 'error', title: '오류테스트2',
      // intake_detail 아예 없음
    },
  })
  assert.equal(res.statusCode, 400, `intake_detail 없음 → 400, got ${res.statusCode}`)
  console.log('(5) intake_detail 없음 → 400 OK')
}

// ──────────────────────────────────────────
// (6) intake_detail 필수키에 falsy-but-non-empty 값({}·[]·0·false) → 400
//     (issue 7 수정 검증)
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'POST', url: '/api/requests', cookies,
    payload: {
      org: '공통', type_code: 'error', title: '오류테스트3',
      // 모든 값이 string이 아닌 falsy-but-non-empty — 이전에는 통과했으나 지금은 400이어야 함
      intake_detail: { screen_url: {}, reproduce: [], occurred_at: 0 },
    },
  })
  assert.equal(res.statusCode, 400, `falsy non-string 값 → 400, got ${res.statusCode}: ${res.body}`)
  const body = res.json()
  assert.equal(body.error, 'intake_detail_missing')
  console.log('(6) falsy non-string intake_detail 값 → 400 OK')
}

await app.close()
await pool.end()
console.log('\ntest:intake ALL PASSED')
