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
import { users, sessions, requests, requestDisputes } from '../src/db/schema.js'
import { eq, inArray } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { changeStatus } from '../src/services/transition.js'

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
// req4/req5 created_at 기준: 5시간 전 (response=3h 후, final=4h 후로 양수 리드타임 보장)
const fixCreatedAt = new Date(fixNow.getTime() - 5 * 60 * 60 * 1000)  // 5시간 전
const fixResponseAt = new Date(fixNow.getTime() - 2 * 60 * 60 * 1000) // 2시간 전 (창조 후 3시간)
const fixFinalAt = new Date(fixNow.getTime() - 1 * 60 * 60 * 1000)    // 1시간 전 (창조 후 4시간)

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

// req4: 완료 건, rework_count=1, csat=5(1-5점 척도, 4점 이상=긍정), SLA 준수
// created_at을 5시간 전으로 UPDATE → firstResponseAt(2h전)·finalResolvedAt(1h전) 이 created_at 보다 뒤임
const [req4] = await db.insert(requests).values({
  org: '배움', typeCode: 'error', title: '대시보드테스트-완료rework',
  requesterId: actorId, visibility: 'shared', status: '완료',
  reworkCount: 1,
  csatRating: 5,
  assigneeId: actorId, assignedAt: fixCreatedAt,
  firstResponseAt: fixResponseAt,
  responseDueAt: new Date(fixNow.getTime() + 60 * 60 * 1000),   // due=+1h → 응답은 created_at+3h이므로 준수
  finalResolvedAt: fixFinalAt,
  resolutionDueAt: new Date(fixNow.getTime() + 2 * 60 * 60 * 1000), // due=+2h → 완료는 created_at+4h이므로 준수
}).returning()
await db.execute(sql`update requests set created_at = ${fixCreatedAt} where id = ${req4.id}`)

// req5: 완료 건, rework=0, csat=1(1-5점 척도의 최저점=부정)
const [req5] = await db.insert(requests).values({
  org: '배론', typeCode: 'feature', title: '대시보드테스트-완료noRework',
  requesterId: actorId, visibility: 'shared', status: '완료',
  reworkCount: 0,
  csatRating: 1,
  assigneeId: actorId, assignedAt: fixCreatedAt,
  firstResponseAt: fixResponseAt,
  responseDueAt: new Date(fixNow.getTime() + 60 * 60 * 1000),
  finalResolvedAt: fixFinalAt,
  resolutionDueAt: new Date(fixNow.getTime() + 2 * 60 * 60 * 1000),
}).returning()
await db.execute(sql`update requests set created_at = ${fixCreatedAt} where id = ${req5.id}`)

// req6: 반려 건
const [req6] = await db.insert(requests).values({
  org: '허브', typeCode: 'file', title: '대시보드테스트-반려',
  requesterId: actorId, visibility: 'shared', status: '반려',
}).returning()

const fixIds = [req1.id, req2.id, req3.id, req4.id, req5.id, req6.id]

// ── dispute_rate / dispute_accept_rate 픽스처 ──
// 회귀 재현 목적: dispute_rate의 옛 버그는 분자가 "전체기간 uncorrelated 서브쿼리"였다.
// 좁은 기간 창(완료 건 2개)에 전체기간 이의 건수(4개)를 나누면 4/2=2.0처럼 1.0을 초과했다.
//
// from/to는 날짜(day) 단위로만 필터링되고(시각 단위 아님), 이 DB는 다른 테스트·수동 조작으로
// 생긴 완료 건이 "오늘" 날짜에 이미 많이 섞여 있어 상대적 오프셋(예: fixNow±1일)으로는
// 결정적인 분모를 보장할 수 없다. 그래서 임의의 고정 과거 날짜를 "창"으로 쓰고, 그 날짜에
// 기존 데이터가 전혀 없음을 먼저 검증한 뒤에만 정확한 비율(0.5 / 1.0)을 단언한다.
const disputeTitlePrefix = '대시보드테스트-이의'
const disputeWindowFrom = '2021-06-15' // 임의의 고정 과거 날짜 — 창 안(reqNew1/reqNew2)
const disputeWindowTo = '2021-06-15'
const disputeWindowAnchor = new Date('2021-06-15T12:00:00Z')
const disputeOldAnchor = new Date('2019-01-01T12:00:00Z') // 창 밖(reqOldA/B/C) — 위 날짜와 겹치지 않음

const anchorPre = await db.execute<{ cnt: string }>(sql`
  select count(*)::text as cnt from requests
  where status = '완료'
    and created_at >= ${disputeWindowFrom}::timestamptz
    and created_at < (${disputeWindowTo}::date + interval '1 day')
`)
assert.equal(
  anchorPre.rows[0].cnt, '0',
  `앵커 날짜(${disputeWindowFrom})에 기존 완료 데이터가 없어야 결정적 테스트가 성립한다, got ${anchorPre.rows[0].cnt}`,
)

async function makeCompletedRequest(title: string, createdAt: Date): Promise<number> {
  const [r] = await db.insert(requests).values({
    org: '배움', typeCode: 'error', title,
    requesterId: actorId, visibility: 'shared',
  }).returning()
  await changeStatus({ reqId: r.id, to: '진행중', actorId })
  await changeStatus({ reqId: r.id, to: '검수대기', actorId })
  await changeStatus({ reqId: r.id, to: '완료', actorId, completionRoute: 'REQUESTER' })
  // changeStatus 경로는 created_at을 now()로 남기므로, 결정적 창 배치를 위해 명시적으로 되돌린다
  await db.execute(sql`update requests set created_at = ${createdAt} where id = ${r.id}`)
  return r.id
}

async function addDispute(reqId: number, decision?: 'ACCEPTED' | 'REJECTED'): Promise<number> {
  const [d] = await db.insert(requestDisputes).values({
    requestId: reqId,
    raisedBy: actorId,
    reason: '대시보드테스트 이의 사유',
    ...(decision
      ? { statusCd: decision, reviewedBy: actorId, reviewComment: '테스트 심사', reviewedAt: new Date() }
      : {}),
  }).returning()
  return d.id
}

const reqOldA = await makeCompletedRequest(`${disputeTitlePrefix}-오래됨A`, disputeOldAnchor)
const reqOldB = await makeCompletedRequest(`${disputeTitlePrefix}-오래됨B`, disputeOldAnchor)
const reqOldC = await makeCompletedRequest(`${disputeTitlePrefix}-오래됨C`, disputeOldAnchor)
const reqNew1 = await makeCompletedRequest(`${disputeTitlePrefix}-최근1`, disputeWindowAnchor)
const reqNew2 = await makeCompletedRequest(`${disputeTitlePrefix}-최근2`, disputeWindowAnchor)
const disputeReqIds = [reqOldA, reqOldB, reqOldC, reqNew1, reqNew2]

const disputeIds: number[] = []
disputeIds.push(await addDispute(reqOldA, 'REJECTED'))
disputeIds.push(await addDispute(reqOldB, 'ACCEPTED'))
disputeIds.push(await addDispute(reqOldC)) // OPEN, 창 밖 — 옛 버그의 전체기간 분자를 부풀리던 소스
disputeIds.push(await addDispute(reqNew1, 'ACCEPTED')) // 창 안, 유일하게 카운트되어야 함
// reqNew2: 이의 없음

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
// req4/req5에 firstResponseAt이 있으므로 중앙값은 null이 아니어야 하고 양수여야 함
assert.ok(body.leadtime.medianFirstResponseHours !== null, 'medianFirstResponseHours not null')
assert.ok(
  body.leadtime.medianFirstResponseHours > 0,
  `medianFirstResponseHours > 0 기대, got ${body.leadtime.medianFirstResponseHours}`,
)
assert.ok(
  body.leadtime.medianResolutionHours !== null && body.leadtime.medianResolutionHours > 0,
  `medianResolutionHours > 0 기대, got ${body.leadtime.medianResolutionHours}`,
)
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

// ── 13. 검수·이의 지표 필드 검증 ──
assert.ok('disputeRate' in kpis, 'disputeRate 필드 존재')
assert.ok('disputeAcceptRate' in kpis, 'disputeAcceptRate 필드 존재')
assert.ok('avgInspectionDays' in kpis, 'avgInspectionDays 필드 존재')
assert.ok('openDisputeCount' in kpis, 'openDisputeCount 필드 존재')
assert.equal(typeof kpis.openDisputeCount, 'number', 'openDisputeCount는 숫자')

assert.ok(kpis.completionRoutes != null, 'completionRoutes 필드 존재')
for (const route of ['REQUESTER', 'AUTO', 'SYSTEM_FORCED']) {
  assert.equal(typeof kpis.completionRoutes[route], 'number', `completionRoutes.${route}는 숫자`)
}
console.log('(13) 검수·이의 지표 필드 OK', JSON.stringify({
  disputeRate: kpis.disputeRate,
  disputeAcceptRate: kpis.disputeAcceptRate,
  avgInspectionDays: kpis.avgInspectionDays,
  openDisputeCount: kpis.openDisputeCount,
  completionRoutes: kpis.completionRoutes,
}))

// ── 14. dispute_rate가 1.0을 넘지 않고, dispute_accept_rate가 기간 필터를 반영하는지 검증 ──
// 이 창(disputeWindowFrom~disputeWindowTo)에는 완료 건이 reqNew1/reqNew2 2개뿐이고,
// 그중 이의가 있는 건은 reqNew1 1개뿐이다 → 올바른 dispute_rate = 0.5
// 옛(uncorrelated) 버그였다면 분자가 전체기간 이의 건수(reqOldA/B/C + reqNew1 = 4)였으므로
// 4 / 2(창 안 완료 건) = 2.0 처럼 1.0을 초과했을 것이다.
const disputeFiltered = await app.inject({
  method: 'GET',
  url: `/api/dashboard/metrics?from=${disputeWindowFrom}&to=${disputeWindowTo}`,
  cookies: { sid: sysSid },
})
assert.equal(
  disputeFiltered.statusCode, 200,
  `dispute 기간 필터 200 기대, got ${disputeFiltered.statusCode}: ${disputeFiltered.body}`,
)
const disputeKpis = disputeFiltered.json().kpis

assert.ok(
  disputeKpis.disputeRate !== null && disputeKpis.disputeRate >= 0 && disputeKpis.disputeRate <= 1,
  `disputeRate는 0..1 범위의 float이어야 함(0..1 계약), got ${disputeKpis.disputeRate}`,
)
// 창 안 완료건 2개(reqNew1, reqNew2) 중 1개만 이의 있음 → 정확히 0.5
assert.equal(
  disputeKpis.disputeRate, 0.5,
  `disputeRate = 0.5 기대(창 안 완료 2건 중 1건 이의), got ${disputeKpis.disputeRate}`,
)

// disputeAcceptRate: 창 안에는 reqNew1의 ACCEPTED 이의 1건만 심사 완료 → 1.0
// (창 밖의 reqOldA REJECTED·reqOldB ACCEPTED가 섞이면 2/3≈0.667이 나와 버그가 재현된다)
assert.equal(
  disputeKpis.disputeAcceptRate, 1,
  `disputeAcceptRate가 창 안 이의만 반영해야 함(1.0 기대), got ${disputeKpis.disputeAcceptRate}`,
)
console.log('(14) dispute 기간 필터 검증 OK', JSON.stringify({
  disputeRate: disputeKpis.disputeRate,
  disputeAcceptRate: disputeKpis.disputeAcceptRate,
}))

// ── 15. csat_positive_pct 검증 (1-5점 척도, 4점 이상=긍정) ──
// 회귀 재현 목적: 구(舊) thumbs 모델에서는 csat_rating = 1이 👍(긍정)이었다.
// 1-5점 척도로 전환된 지금 csat_rating = 1은 최저점(부정)이므로, 필터가 여전히
// "= 1"이면 최악의 리뷰를 긍정으로 집계하는 정반대 결과가 나온다.
// 다른 테스트/수동 조작으로 이미 존재하는 완료 건과 섞이지 않도록, dispute_rate 검증과
// 동일한 방식으로 결정적 고정 과거 날짜를 창으로 쓰고, 그 창에 기존 평점 데이터가
// 전혀 없음을 먼저 검증한 뒤에만 정확한 비율을 단언한다.
const csatTitlePrefix = '대시보드테스트-CSAT'
const csatWindowFrom = '2021-06-17' // dispute 창(2021-06-15)과 겹치지 않는 별도의 고정 과거 날짜
const csatWindowTo = '2021-06-17'
const csatWindowAnchor = new Date('2021-06-17T12:00:00Z')

const csatAnchorPre = await db.execute<{ cnt: string }>(sql`
  select count(*)::text as cnt from requests
  where csat_rating is not null
    and created_at >= ${csatWindowFrom}::timestamptz
    and created_at < (${csatWindowTo}::date + interval '1 day')
`)
assert.equal(
  csatAnchorPre.rows[0].cnt, '0',
  `앵커 날짜(${csatWindowFrom})에 기존 csat 평점 데이터가 없어야 결정적 테스트가 성립한다, got ${csatAnchorPre.rows[0].cnt}`,
)

const csatReq5 = await makeCompletedRequest(`${csatTitlePrefix}-별점5`, csatWindowAnchor)
const csatReq4 = await makeCompletedRequest(`${csatTitlePrefix}-별점4`, csatWindowAnchor)
const csatReq2 = await makeCompletedRequest(`${csatTitlePrefix}-별점2`, csatWindowAnchor)
const csatReq1 = await makeCompletedRequest(`${csatTitlePrefix}-별점1`, csatWindowAnchor)
const csatReqIds = [csatReq5, csatReq4, csatReq2, csatReq1]

// 별점 5,4 = 긍정(4점 이상) / 별점 2,1 = 부정 → 4건 중 2건 긍정 = 0.5
await db.execute(sql`update requests set csat_rating = 5 where id = ${csatReq5}`)
await db.execute(sql`update requests set csat_rating = 4 where id = ${csatReq4}`)
await db.execute(sql`update requests set csat_rating = 2 where id = ${csatReq2}`)
await db.execute(sql`update requests set csat_rating = 1 where id = ${csatReq1}`)

const csatFiltered = await app.inject({
  method: 'GET',
  url: `/api/dashboard/metrics?from=${csatWindowFrom}&to=${csatWindowTo}`,
  cookies: { sid: sysSid },
})
assert.equal(
  csatFiltered.statusCode, 200,
  `csat 기간 필터 200 기대, got ${csatFiltered.statusCode}: ${csatFiltered.body}`,
)
const csatKpis = csatFiltered.json().kpis
assert.equal(
  csatKpis.csatPositivePct, 0.5,
  `csatPositivePct = 0.5 기대(4건 중 별점 5·4 두 건만 긍정), got ${csatKpis.csatPositivePct}`,
)
console.log('(15) csat_positive_pct 검증 OK', JSON.stringify({ csatPositivePct: csatKpis.csatPositivePct }))

// ── 16. resolution_compliance가 first_resolved_at(팀 종료) 기준이어야 함 ──
// 배경: first_resolved_at은 검수대기 진입 시점(팀이 작업을 끝낸 시점)=해결-SLA 기준,
// final_resolved_at은 최종 완료 시점(요청자가 승인한 시점)=리드타임 기준이다.
// 팀이 SLA 안에 끝냈어도(first_resolved_at <= resolution_due_at) 요청자가 검수를
// 늦게 하면(final_resolved_at > resolution_due_at), 옛 코드(final_resolved_at 기준)는
// 이를 SLA 위반으로 잘못 집계했다. 다른 창과 겹치지 않는 별도의 고정 과거 날짜를 써서
// 이 건 하나만 분모/분자에 들어가도록 격리한 뒤 정확히 1.0(준수)이어야 함을 단언한다.
const slaBasisTitlePrefix = '대시보드테스트-SLA기준'
const slaBasisWindowFrom = '2021-06-19' // dispute(06-15)·csat(06-17) 창과 겹치지 않는 날짜
const slaBasisWindowTo = '2021-06-19'
const slaBasisAnchor = new Date('2021-06-19T12:00:00Z')

const slaBasisAnchorPre = await db.execute<{ cnt: string }>(sql`
  select count(*)::text as cnt from requests
  where status = '완료' and resolution_due_at is not null
    and created_at >= ${slaBasisWindowFrom}::timestamptz
    and created_at < (${slaBasisWindowTo}::date + interval '1 day')
`)
assert.equal(
  slaBasisAnchorPre.rows[0].cnt, '0',
  `앵커 날짜(${slaBasisWindowFrom})에 기존 완료+기한 데이터가 없어야 결정적 테스트가 성립한다, got ${slaBasisAnchorPre.rows[0].cnt}`,
)

const slaBasisReqId = await makeCompletedRequest(`${slaBasisTitlePrefix}-온타임해결지연검수`, slaBasisAnchor)
// 팀은 기한 안에 끝냈다(first_resolved_at 13:00 <= resolution_due_at 14:00),
// 요청자는 늦게 검수했다(final_resolved_at 20:00 > resolution_due_at 14:00).
await db.execute(sql`
  update requests set
    first_resolved_at = '2021-06-19T13:00:00Z'::timestamptz,
    resolution_due_at = '2021-06-19T14:00:00Z'::timestamptz,
    final_resolved_at = '2021-06-19T20:00:00Z'::timestamptz
  where id = ${slaBasisReqId}
`)

const slaBasisFiltered = await app.inject({
  method: 'GET',
  url: `/api/dashboard/metrics?from=${slaBasisWindowFrom}&to=${slaBasisWindowTo}`,
  cookies: { sid: sysSid },
})
assert.equal(
  slaBasisFiltered.statusCode, 200,
  `SLA 기준 기간 필터 200 기대, got ${slaBasisFiltered.statusCode}: ${slaBasisFiltered.body}`,
)
const slaBasisKpis = slaBasisFiltered.json()
assert.equal(
  slaBasisKpis.sla.resolutionCompliancePct, 1,
  `팀이 기한 안에 끝냈으면(요청자 검수가 늦어도) resolutionCompliancePct = 1.0(준수) 기대, ` +
  `got ${slaBasisKpis.sla.resolutionCompliancePct} — final_resolved_at 기준으로 회귀했다면 0이 나온다`,
)
console.log('(16) resolution_compliance가 first_resolved_at 기준 OK', JSON.stringify({
  resolutionCompliancePct: slaBasisKpis.sla.resolutionCompliancePct,
}))

// ── 정리 ──
await db.delete(requestDisputes).where(inArray(requestDisputes.id, disputeIds))
await db.delete(requests).where(inArray(requests.id, disputeReqIds))
await db.delete(requests).where(inArray(requests.id, csatReqIds))
await db.delete(requests).where(eq(requests.id, slaBasisReqId))
await db.delete(requests).where(inArray(requests.id, fixIds))
await db.delete(sessions).where(eq(sessions.id, staffToken))
await db.delete(users).where(eq(users.id, staffUser.id))
await app.close()
await pool.end()

console.log('\ntest:dashboard ALL PASSED')
