/**
 * test:notifications — 인앱 알림 테스트
 *
 * (1) 배정 시 assignee 알림 생성 + 행위자(actorId=assigneeId)는 알림 없음
 * (2) 상태 변경 시 requester 알림 생성 + 행위자=requester면 스킵
 * (3) 공개 댓글 — 시스템이 댓글 → requester 알림
 * (4) 공개 댓글 — requester가 댓글 → assignee 알림
 * (5) 내부 메모 — 알림 없음
 * (6) GET /api/notifications → items + unreadCount
 * (7) POST /api/notifications/:id/read → is_read=true
 * (8) POST /api/notifications/read-all → 전체 읽음
 * (9) 타인 알림 격리 — 다른 사용자가 read 시도 → 404
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, sessions, requests, notifications } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { assignRequest } from '../src/services/assign.js'
import { changeStatus } from '../src/services/transition.js'

/** 비동기 알림 INSERT가 완료될 때까지 짧게 대기 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

const app = await buildApp()

// ── 사용자 준비 ──
// system 사용자(juhuikim) — actor/assignee
const sysSid = await loginAsDev(app)
const sysCookies = { sid: sysSid }

const sysUser = await db.execute<{ id: string }>(sql`
  select id from users where email = 'juhuikim@baeoom.com'
`)
const sysId = sysUser.rows[0]!.id

// staff 사용자 — requester
const [staffUser] = await db.insert(users).values({
  email: `notif-staff-${randomBytes(4).toString('hex')}@baeoom.com`,
  name: '알림테스트직원',
  orgAffil: '배움',
  deptFunction: '교학팀',
  role: 'staff',
}).returning()

// staff 세션 생성
const staffToken = randomBytes(32).toString('hex')
await db.insert(sessions).values({
  id: staffToken,
  userId: staffUser.id,
  expiresAt: new Date(Date.now() + 60_000),
})
const staffSid = app.signCookie(staffToken)
const staffCookies = { sid: staffSid }

// 제3자 사용자 — 격리 테스트용
const [otherUser] = await db.insert(users).values({
  email: `notif-other-${randomBytes(4).toString('hex')}@baeoom.com`,
  name: '제3자',
  orgAffil: '배움',
  deptFunction: '교학팀',
  role: 'staff',
}).returning()
const otherToken = randomBytes(32).toString('hex')
await db.insert(sessions).values({
  id: otherToken,
  userId: otherUser.id,
  expiresAt: new Date(Date.now() + 60_000),
})
const otherSid = app.signCookie(otherToken)
const otherCookies = { sid: otherSid }

// ── 테스트 요청 생성 ──
const [req] = await db.insert(requests).values({
  org: '배움',
  typeCode: 'error',
  title: '알림테스트요청',
  visibility: 'shared',
  requesterId: staffUser.id,
  requesterName: staffUser.name,
  requesterEmail: staffUser.email,
}).returning()
const reqId = req.id

// 정리 헬퍼
async function clearNotifs(): Promise<void> {
  await db.execute(sql`delete from notifications where user_id in (${sysId}, ${staffUser.id}, ${otherUser.id})`)
}

// ──────────────────────────────────────────
// (1) 배정 시 assignee 알림 + actorId=assigneeId면 알림 없음
// ──────────────────────────────────────────
{
  await clearNotifs()

  // actorId !== assigneeId: sysId가 staffUser를 assignee로 배정 → staffUser에게 알림 없음 (staff는 assignee 아님)
  // staffUser가 assignee이고 actorId=sysId인 경우: staffUser에게 알림이 가야 함

  // 현재 req는 접수 상태, staffUser를 assignee로 배정 (actorId=sysId)
  await assignRequest({ reqId, assigneeId: staffUser.id, impact: '보통', actorId: sysId })
  await tick()

  const notifRows = await db.execute<{ user_id: string; type: string; message: string }>(sql`
    select user_id, type, message from notifications where request_id = ${reqId} and type = 'assigned'
  `)
  assert.equal(notifRows.rows.length, 1, '배정 알림 1개')
  assert.equal(notifRows.rows[0].user_id, staffUser.id, 'assignee에게 알림')
  assert.ok(notifRows.rows[0].message.includes('담당자로 배정'), '배정 메시지 확인')
  console.log('(1) 배정 알림 생성 OK:', notifRows.rows[0].message)
}

// ──────────────────────────────────────────
// (2) actorId=assigneeId 배정 → 본인 알림 없음
// ──────────────────────────────────────────
{
  await clearNotifs()

  // 새 요청 생성 (접수 상태)
  const [req2] = await db.insert(requests).values({
    org: '배움', typeCode: 'error', title: '자기배정테스트',
    visibility: 'shared', requesterId: staffUser.id,
  }).returning()

  // actorId === assigneeId: sysId가 본인을 배정
  await assignRequest({ reqId: req2.id, assigneeId: sysId, impact: '보통', actorId: sysId })
  await tick()

  const notifRows = await db.execute<{ id: number }>(sql`
    select id from notifications where request_id = ${req2.id} and type = 'assigned'
  `)
  assert.equal(notifRows.rows.length, 0, '자기 배정은 알림 없음')
  console.log('(2) 자기 배정 알림 없음 OK')

  await db.delete(requests).where(eq(requests.id, req2.id))
}

// ──────────────────────────────────────────
// (3) 상태 변경 → requester 알림 + 행위자=requester면 스킵
// ──────────────────────────────────────────
{
  await clearNotifs()

  // req 현재 상태: 진행중 (배정 후). sysId가 완료로 변경 → staffUser(requester)에게 알림
  await changeStatus({ reqId, to: '완료', actorId: sysId })
  await tick()

  const notifRows = await db.execute<{ user_id: string; type: string; message: string }>(sql`
    select user_id, type, message from notifications where request_id = ${reqId} and type = 'status'
  `)
  assert.equal(notifRows.rows.length, 1, '상태 변경 알림 1개')
  assert.equal(notifRows.rows[0].user_id, staffUser.id, 'requester에게 알림')
  assert.ok(notifRows.rows[0].message.includes('완료'), '상태 메시지 포함')
  console.log('(3) 상태 변경 알림 OK:', notifRows.rows[0].message)
}

// ──────────────────────────────────────────
// (4) 상태 변경 행위자=requester → 알림 없음
// ──────────────────────────────────────────
{
  await clearNotifs()

  // 완료→진행중 (재작업): staffUser(requester)가 actorId → 자신에게 알림 없음
  await changeStatus({ reqId, to: '진행중', reason: '재작업', actorId: staffUser.id })
  await tick()

  const notifRows = await db.execute<{ id: number }>(sql`
    select id from notifications where request_id = ${reqId} and type = 'status'
  `)
  assert.equal(notifRows.rows.length, 0, '행위자=requester면 상태 알림 없음')
  console.log('(4) 행위자=requester 상태 변경 알림 없음 OK')
}

// ──────────────────────────────────────────
// (5) 공개 댓글 — 시스템(sysId)이 댓글 → requester(staffUser) 알림
// ──────────────────────────────────────────
{
  await clearNotifs()

  // 현재 req: 진행중, assignee=staffUser, requester=staffUser
  // 시나리오: 새 요청 생성 후 시스템이 공개 댓글 → requester에게 알림
  const [req3] = await db.insert(requests).values({
    org: '배움', typeCode: 'error', title: '댓글알림테스트',
    visibility: 'shared', requesterId: staffUser.id, assigneeId: sysId,
  }).returning()

  const res = await app.inject({
    method: 'POST',
    url: `/api/requests/${req3.id}/comments`,
    cookies: sysCookies,
    payload: { body: '시스템 공개 댓글', is_internal: false },
  })
  assert.equal(res.statusCode, 201, `댓글 삽입 201, got ${res.statusCode}: ${res.body}`)
  await tick()

  const notifRows = await db.execute<{ user_id: string; type: string }>(sql`
    select user_id, type from notifications where request_id = ${req3.id} and type = 'comment'
  `)
  assert.equal(notifRows.rows.length, 1, '댓글 알림 1개')
  assert.equal(notifRows.rows[0].user_id, staffUser.id, 'requester에게 댓글 알림')
  console.log('(5) 시스템 공개 댓글 → requester 알림 OK')

  await db.delete(requests).where(eq(requests.id, req3.id))
}

// ──────────────────────────────────────────
// (6) 공개 댓글 — requester(staffUser)가 댓글 → assignee(sysId) 알림
// ──────────────────────────────────────────
{
  await clearNotifs()

  const [req4] = await db.insert(requests).values({
    org: '배움', typeCode: 'error', title: '요청자댓글테스트',
    visibility: 'shared', requesterId: staffUser.id, assigneeId: sysId,
  }).returning()

  const res = await app.inject({
    method: 'POST',
    url: `/api/requests/${req4.id}/comments`,
    cookies: staffCookies,
    payload: { body: '요청자 공개 댓글', is_internal: false },
  })
  assert.equal(res.statusCode, 201, `댓글 삽입 201, got ${res.statusCode}: ${res.body}`)
  await tick()

  const notifRows = await db.execute<{ user_id: string; type: string }>(sql`
    select user_id, type from notifications where request_id = ${req4.id} and type = 'comment'
  `)
  assert.equal(notifRows.rows.length, 1, '댓글 알림 1개')
  assert.equal(notifRows.rows[0].user_id, sysId, 'assignee에게 댓글 알림')
  console.log('(6) requester 공개 댓글 → assignee 알림 OK')

  await db.delete(requests).where(eq(requests.id, req4.id))
}

// ──────────────────────────────────────────
// (7) 내부 메모 → 알림 없음
// ──────────────────────────────────────────
{
  await clearNotifs()

  const [req5] = await db.insert(requests).values({
    org: '배움', typeCode: 'error', title: '내부메모테스트',
    visibility: 'shared', requesterId: staffUser.id, assigneeId: sysId,
  }).returning()

  const res = await app.inject({
    method: 'POST',
    url: `/api/requests/${req5.id}/comments`,
    cookies: sysCookies,
    payload: { body: '내부 메모입니다', is_internal: true },
  })
  assert.equal(res.statusCode, 201, `내부메모 삽입 201`)
  await tick()

  const notifRows = await db.execute<{ id: number }>(sql`
    select id from notifications where request_id = ${req5.id}
  `)
  assert.equal(notifRows.rows.length, 0, '내부 메모는 알림 없음')
  console.log('(7) 내부 메모 알림 없음 OK')

  await db.delete(requests).where(eq(requests.id, req5.id))
}

// ──────────────────────────────────────────
// (8) GET /api/notifications → items + unreadCount
// ──────────────────────────────────────────
{
  await clearNotifs()

  // staffUser에게 알림 2개 삽입
  await db.execute(sql`
    insert into notifications (user_id, type, request_id, message)
    values
      (${staffUser.id}, 'status', ${reqId}, '테스트 상태 알림1'),
      (${staffUser.id}, 'comment', ${reqId}, '테스트 댓글 알림2')
  `)

  const res = await app.inject({ method: 'GET', url: '/api/notifications', cookies: staffCookies })
  assert.equal(res.statusCode, 200, `GET /api/notifications 200, got ${res.statusCode}`)
  const data = res.json()
  assert.ok(Array.isArray(data.items), 'items 배열')
  assert.ok(data.items.length >= 2, `items.length >= 2, got ${data.items.length}`)
  assert.equal(data.unreadCount, 2, `unreadCount=2, got ${data.unreadCount}`)
  // 각 항목 필드 확인
  const item = data.items[0]
  assert.ok('id' in item && 'type' in item && 'request_id' in item &&
    'message' in item && 'is_read' in item && 'created_at' in item, '필드 구조 확인')
  console.log('(8) GET /api/notifications OK, unreadCount:', data.unreadCount)
}

// ──────────────────────────────────────────
// (9) POST /api/notifications/:id/read → is_read=true, unreadCount 감소
// ──────────────────────────────────────────
{
  // 현재 staffUser 알림 2개 unread 상태
  const listRes = await app.inject({ method: 'GET', url: '/api/notifications', cookies: staffCookies })
  const listData = listRes.json()
  const firstId = listData.items[listData.items.length - 1].id  // 가장 오래된 것

  const readRes = await app.inject({
    method: 'POST',
    url: `/api/notifications/${firstId}/read`,
    cookies: staffCookies,
  })
  assert.equal(readRes.statusCode, 200, `단건 read 200, got ${readRes.statusCode}`)
  assert.deepEqual(readRes.json(), { ok: true })

  // unreadCount 확인
  const afterRes = await app.inject({ method: 'GET', url: '/api/notifications', cookies: staffCookies })
  const afterData = afterRes.json()
  assert.equal(afterData.unreadCount, 1, `unreadCount 1로 감소, got ${afterData.unreadCount}`)
  console.log('(9) POST /api/notifications/:id/read OK')
}

// ──────────────────────────────────────────
// (10) POST /api/notifications/read-all → 전체 읽음
// ──────────────────────────────────────────
{
  const res = await app.inject({
    method: 'POST',
    url: '/api/notifications/read-all',
    cookies: staffCookies,
  })
  assert.equal(res.statusCode, 200, `read-all 200, got ${res.statusCode}`)

  const afterRes = await app.inject({ method: 'GET', url: '/api/notifications', cookies: staffCookies })
  const afterData = afterRes.json()
  assert.equal(afterData.unreadCount, 0, `read-all 후 unreadCount=0, got ${afterData.unreadCount}`)
  console.log('(10) POST /api/notifications/read-all OK')
}

// ──────────────────────────────────────────
// (11) 타인 알림 격리 — 다른 사용자가 staffUser 알림 read 시도 → 404
// ──────────────────────────────────────────
{
  // staffUser 알림 중 하나의 ID 조회
  const listRes = await app.inject({ method: 'GET', url: '/api/notifications', cookies: staffCookies })
  const listData = listRes.json()
  const staffNotifId = listData.items[0]?.id
  assert.ok(staffNotifId, 'staffUser 알림이 있어야 함')

  // otherUser가 staffUser의 알림을 read 시도
  const res = await app.inject({
    method: 'POST',
    url: `/api/notifications/${staffNotifId}/read`,
    cookies: otherCookies,
  })
  assert.equal(res.statusCode, 404, `타인 알림 read 404, got ${res.statusCode}`)
  console.log('(11) 타인 알림 격리 OK')
}

// ──────────────────────────────────────────
// 정리
// ──────────────────────────────────────────
await clearNotifs()
await db.delete(requests).where(eq(requests.id, reqId))
await db.execute(sql`delete from sessions where id in (${staffToken}, ${otherToken})`)
await db.delete(users).where(eq(users.id, staffUser.id))
await db.delete(users).where(eq(users.id, otherUser.id))

await app.close()
await pool.end()
console.log('\ntest:notifications ALL PASSED')
