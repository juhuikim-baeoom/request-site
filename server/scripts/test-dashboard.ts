/**
 * 대시보드 집계 API 테스트
 * - 픽스처 삽입 후 /api/dashboard/metrics 호출해 주요 수치 검증
 * - staff 접근 시 403 검증
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, sessions, requests } from '../src/db/schema.js'
import { eq, inArray } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()

// system 세션 (김주희)
const sysSid = await loginAsDev(app)
const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
const actorId = juhui!.id

// staff 유저 + 세션 생성
const [staffUser] = await db.insert(users).values({
  email: 'dashboard-staff@baeoom.com', name: '스태프테스터', orgAffil: '배움', deptFunction: '교학팀', role: 'staff',
}).returning()
const staffToken = randomBytes(32).toString('hex')
await db.insert(sessions).values({ id: staffToken, userId: staffUser.id, expiresAt: new Date(Date.now() + 60000) })
const staffSid = app.signCookie(staffToken)

// ── 픽스처 삽입 ──
const fixNow = new Date()
const fixOld = new Date(fixNow.getTime() - 20 * 24 * 60 * 60 * 1000) // 20일 전
const fixResponseAt = new Date(fixNow.getTime() - 3 * 60 * 60 * 1000) // 3시간 전
const fixFinalAt = new Date(fixNow.getTime() - 1 * 60 * 60 * 1000)    // 1시간 전

// req1: 열린 건, P1
const [req1] = await db.insert(requests).values({
  org: '배움', typeCode: 'error', title: '대시보드테스트-열린P1',
  requesterId: actorId, visibility: 'shared', status: '진행중',
  priorityLevelCol: 'P1',
  assigneeId: actorId, assignedAt: fixNow,
  responseDueAt: new Date(fixNow.getTime() + 60 * 60 * 1000),
}).returning()

// req2: 열린 건, P2, 보류
const [req2] = await db.insert(requests).values({
  org: '배론', typeCode: 'feature', title: '대시보드테스트-열린P2',
  requesterId: actorId, visibility: 'shared', status: '보류',
  priorityLevelCol: 'P2',
}).returning()

// req3: 열린 건, P3, 오래된 건 → created_at을 20일 전으로 수동 설정
const [req3] = await db.insert(requests).values({
  org: '공통', typeCode: 'data', title: '대시보드테스트-열린P3오래됨',
  requesterId: actorId, visibility: 'shared', status: '접수',
  priorityLevelCol: 'P3',
}).returning()
await db.execute(sql`update requests set created_at = ${fixOld} where id = ${req3.id}`)

// req4: 완료 건, rework_count=1, csat=1(긍정), SLA 준수
const [req4] = await db.insert(requests).values({
  org: '배움', typeCode: 'error', title: '대시보드테스트-완료rework',
  requesterId: actorId, visibility: 'shared', status: '완료',
  reworkCount: 1,
  csatRating: 1,
  assigneeId: actorId, assignedAt: fixNow,
  firstResponseAt: fixResponseAt,
  responseDueAt: new Date(fixNow.getTime() + 60 * 60 * 1000),   // due=+1h → 응답은 -3h이므로 준수
  finalResolvedAt: fixFinalAt,
  resolutionDueAt: new Date(fixNow.getTime() + 2 * 60 * 60 * 1000), // due=+2h → 완료는 -1h이므로 준수
}).returning()

// req5: 완료 건, rework=0, csat=-1(부정)
const [req5] = await db.insert(requests).values({
  org: '배론', typeCode: 'feature', title: '대시보드테스트-완료noRework',
  requesterId: actorId, visibility: 'shared', status: '완료',
  reworkCount: 0,
  csatRating: -1,
  assigneeId: actorId, assignedAt: fixNow,
  firstResponseAt: fixResponseAt,
  responseDueAt: new Date(fixNow.getTime() + 60 * 60 * 1000),
  finalResolvedAt: fixFinalAt,
  resolutionDueAt: new Date(fixNow.getTime() + 2 * 60 * 60 * 1000),
}).returning()

// req6: 반려 건
const [req6] = await db.insert(requests).values({
  org: '허브', typeCode: 'file', title: '대시보드테스트-반려',
  requesterId: actorId, visibility: 'shared', status: '반려',
}).returning()

const fixIds = [req1.id, req2.id, req3.id, req4.id, req5.id, req6.id]

// ── 1. staff → 403 ──
const forbid = await app.inject({ method: 'GET', url: '/api/dashboard/metrics', cookies: { sid: staffSid } })
assert.equal(forbid.statusCode, 403, `staff 접근 403 기대, got ${forbid.statusCode}`)
console.log('(1) staff 403 OK')

// ── 2. 미인증 → 401 ──
const anon = await app.inject({ method: 'GET', url: '/api/dashboard/metrics' })
assert.equal(anon.statusCode, 401, `미인증 401 기대, got ${anon.statusCode}`)
console.log('(2) 미인증 401 OK')

// ── 3. system 접근 → 200 ──
const resp = await app.inject({ method: 'GET', url: '/api/dashboard/metrics', cookies: { sid: sysSid } })
assert.equal(resp.statusCode, 200, `system 접근 200 기대, got ${resp.statusCode}: ${resp.body}`)
const body = resp.json()
console.log('(3) system 200 OK')

// ── 4. KPIs 검증 ──
const { kpis } = body
// open: 픽스처에서 열린 건 3개 + 기존 데이터 포함
assert.ok(kpis.open >= 3, `open >= 3 기대, got ${kpis.open}`)
// p1p2Open: P1+P2 열린 건은 최소 2개
assert.ok(kpis.p1p2Open >= 2, `p1p2Open >= 2 기대, got ${kpis.p1p2Open}`)
assert.ok(kpis.reworkRate !== undefined, 'reworkRate 필드 존재')
assert.ok(kpis.csatPositivePct !== undefined, 'csatPositivePct 필드 존재')
console.log('(4) KPIs 검증 OK', JSON.stringify(kpis))

// ── 5. leadtime 필드 존재 ──
assert.ok('medianFirstResponseHours' in body.leadtime, 'medianFirstResponseHours 필드')
assert.ok('medianResolutionHours' in body.leadtime, 'medianResolutionHours 필드')
// req4/req5에 firstResponseAt이 있으므로 중앙값은 null이 아니어야 함
assert.ok(body.leadtime.medianFirstResponseHours !== null, 'medianFirstResponseHours not null')
console.log('(5) leadtime OK', JSON.stringify(body.leadtime))

// ── 6. aging 구조 검증 ──
const { aging } = body
assert.ok(Array.isArray(aging), 'aging 배열')
const buckets = (aging as Array<{ bucket: string; count: number }>).map((a) => a.bucket)
for (const b of ['<3d', '3-7d', '7-14d', '>14d']) {
  assert.ok(buckets.includes(b), `aging bucket ${b} 존재`)
}
// 오래된 req3 (>14d 버킷)에 최소 1건 포함
const gt14 = (aging as Array<{ bucket: string; count: number }>).find((a) => a.bucket === '>14d')
assert.ok(gt14 && gt14.count >= 1, `>14d bucket count >= 1, got ${gt14?.count}`)
console.log('(6) aging OK', JSON.stringify(aging))

// ── 7. SLA 필드 존재 ──
assert.ok('responseCompliancePct' in body.sla, 'responseCompliancePct 필드')
assert.ok('resolutionCompliancePct' in body.sla, 'resolutionCompliancePct 필드')
// req4/req5는 response_due_at 있고, first_response_at <= response_due_at이므로 compliance = 1.0
assert.ok(body.sla.responseCompliancePct !== null, 'responseCompliancePct not null')
assert.ok(body.sla.resolutionCompliancePct !== null, 'resolutionCompliancePct not null')
console.log('(7) SLA OK', JSON.stringify(body.sla))

// ── 8. distribution 구조 검증 ──
const { distribution } = body
assert.ok(Array.isArray(distribution.byStatus), 'byStatus 배열')
assert.ok(Array.isArray(distribution.byOrg), 'byOrg 배열')
assert.ok(Array.isArray(distribution.byType), 'byType 배열')
const statuses = (distribution.byStatus as Array<{ status: string }>).map((s) => s.status)
assert.ok(statuses.includes('완료'), '완료 status 포함')
assert.ok(statuses.includes('반려'), '반려 status 포함')
console.log('(8) distribution OK')

// ── 9. volumeByType 구조 검증 ──
const { volumeByType } = body
assert.ok(Array.isArray(volumeByType), 'volumeByType 배열')
if (volumeByType.length > 0) {
  const v = volumeByType[0] as Record<string, unknown>
  assert.ok('month' in v && 'type_code' in v && 'count' in v, 'volumeByType 항목 구조')
}
console.log('(9) volumeByType OK')

// ── 10. byAssignee 구조 검증 ──
const { byAssignee } = body
assert.ok(Array.isArray(byAssignee), 'byAssignee 배열')
if (byAssignee.length > 0) {
  const a = byAssignee[0] as Record<string, unknown>
  assert.ok('assignee_id' in a && 'openCount' in a && 'resolvedCount' in a, 'byAssignee 항목 구조')
}
console.log('(10) byAssignee OK')

// ── 11. 기간 필터 검증 (to=어제 → 오늘 생성 픽스처 제외) ──
const yesterday = new Date(fixNow.getTime() - 86400000).toISOString().slice(0, 10)
const filtered = await app.inject({
  method: 'GET',
  url: `/api/dashboard/metrics?from=2000-01-01&to=${yesterday}`,
  cookies: { sid: sysSid },
})
assert.equal(filtered.statusCode, 200, `기간 필터 200 기대, got ${filtered.statusCode}`)
const filteredBody = filtered.json()
// 오늘 생성한 req1/req2/req4/req5/req6은 제외되고 req3(20일 전)은 포함
assert.ok(
  filteredBody.kpis.open < kpis.open,
  `기간 필터 적용 시 open 감소: ${filteredBody.kpis.open} < ${kpis.open}`,
)
console.log('(11) 기간 필터 OK')

// ── 12. 잘못된 날짜 형식 → 400 ──
const badDate = await app.inject({ method: 'GET', url: '/api/dashboard/metrics?from=notadate', cookies: { sid: sysSid } })
assert.equal(badDate.statusCode, 400)
console.log('(12) 잘못된 날짜 400 OK')

// ── 정리 ──
await db.delete(requests).where(inArray(requests.id, fixIds))
await db.delete(sessions).where(eq(sessions.id, staffToken))
await db.delete(users).where(eq(users.id, staffUser.id))
await app.close()
await pool.end()

console.log('\ntest:dashboard ALL PASSED')
