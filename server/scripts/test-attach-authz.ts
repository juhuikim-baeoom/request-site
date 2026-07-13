import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, sessions, requests, requestAttachments } from '../src/db/schema.js'
import { eq, inArray, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()
const suffix = randomBytes(4).toString('hex')

// 김주희(system) 세션
const sysSid = await loginAsDev(app)
const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })

const userIds: string[] = []
const sessionTokens: string[] = []
const requestIds: number[] = []

try {
  // staff 유저 + 세션 직접 생성
  const [staff] = await db.insert(users).values({
    email: `attach-staff-${suffix}@baeoom.com`, name: '스태프', orgAffil: '배움', deptFunction: '교학팀', role: 'staff',
  }).returning()
  userIds.push(staff.id)
  const token = randomBytes(32).toString('hex')
  await db.insert(sessions).values({ id: token, userId: staff.id, expiresAt: new Date(Date.now() + 60000) })
  sessionTokens.push(token)
  const staffSid = app.signCookie(token)

  // 김주희가 shared 요청 + 첨부 생성
  const [req] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: 'attach-authz', requesterId: juhui!.id, visibility: 'shared',
  }).returning()
  requestIds.push(req.id)
  const boundary = '----t'
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="secret.txt"\r\nContent-Type: text/plain\r\n\r\n`),
    Buffer.from('SECRET'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const up = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/attachments`, cookies: { sid: sysSid },
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
  })
  assert.equal(up.statusCode, 201)
  const attId = up.json().id

  // staff는 shared 요청이라 첨부 '목록'은 볼 수 있다
  const list = await app.inject({ method: 'GET', url: `/api/requests/${req.id}/attachments`, cookies: { sid: staffSid } })
  assert.equal(list.statusCode, 200)
  assert.equal(list.json().length, 1)
  console.log('staff sees attachment metadata ok')

  // staff는 요청을 열람할 수 있으므로 (visibility=shared) 첨부 다운로드도 가능 → 200
  // (수정 이전: 404. 수정 후: 시스템팀이 올린 산출물도 요청자/staff가 다운로드 가능)
  const staffDl = await app.inject({ method: 'GET', url: `/api/attachments/${attId}/download`, cookies: { sid: staffSid } })
  assert.equal(staffDl.statusCode, 200, 'staff가 열람 가능한 요청의 첨부를 다운로드할 수 있어야 함')
  console.log('staff download allowed (canSeeRequest=true) ok')

  // 김주희(system_admin)는 다운로드 가능
  const sysDl = await app.inject({ method: 'GET', url: `/api/attachments/${attId}/download`, cookies: { sid: sysSid } })
  assert.equal(sysDl.statusCode, 200)
  assert.ok(sysDl.rawPayload.toString().includes('SECRET'))
  console.log('system download allowed ok')

  // ──────────────────────────────────────────
  // 내부메모 첨부 — canSeeComment와 동일한 규칙으로 목록·다운로드 모두 차단되어야 함
  // (Important 1 회귀 테스트: 내부메모 본문은 감췄지만 첨부가 그대로 새던 구멍)
  // req는 visibility=shared라서 exec(canSeeAllRequests)·dept_monitor(visibility=shared 경로) 모두
  // "요청 자체"는 열람 가능 — 수정 전에는 이 때문에 내부메모 첨부까지 목록·다운로드가 됐다.
  // ──────────────────────────────────────────

  // 시스템(김주희)이 내부메모 작성 후 그 메모에 첨부 업로드
  const internalComment = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/comments`, cookies: { sid: sysSid },
    payload: { body: '내부메모', is_internal: true },
  })
  assert.equal(internalComment.statusCode, 201)
  const internalCommentId = internalComment.json().id

  const boundary2 = '----i'
  const body2 = Buffer.concat([
    Buffer.from(`--${boundary2}\r\nContent-Disposition: form-data; name="comment_id"\r\n\r\n${internalCommentId}`),
    Buffer.from(`\r\n--${boundary2}\r\nContent-Disposition: form-data; name="file"; filename="internal.txt"\r\nContent-Type: text/plain\r\n\r\n`),
    Buffer.from('INTERNAL-SECRET'),
    Buffer.from(`\r\n--${boundary2}--\r\n`),
  ])
  const upInternal = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/attachments`, cookies: { sid: sysSid },
    headers: { 'content-type': `multipart/form-data; boundary=${boundary2}` }, payload: body2,
  })
  assert.equal(upInternal.statusCode, 201)
  const internalAttId = upInternal.json().id

  // exec·dept_monitor 유저 + 세션 생성
  const [exec] = await db.insert(users).values({
    email: `attach-exec-${suffix}@baeoom.com`, name: '경영진', orgAffil: '배움', deptFunction: '교학팀', role: 'exec',
  }).returning()
  userIds.push(exec.id)
  const execToken = randomBytes(32).toString('hex')
  await db.insert(sessions).values({ id: execToken, userId: exec.id, expiresAt: new Date(Date.now() + 60000) })
  sessionTokens.push(execToken)
  const execSid = app.signCookie(execToken)

  const [deptMonitor] = await db.insert(users).values({
    email: `attach-dept-monitor-${suffix}@baeoom.com`, name: '부서모니터', orgAffil: '배움', deptFunction: '교학팀', role: 'dept_monitor',
  }).returning()
  userIds.push(deptMonitor.id)
  const dmToken = randomBytes(32).toString('hex')
  await db.insert(sessions).values({ id: dmToken, userId: deptMonitor.id, expiresAt: new Date(Date.now() + 60000) })
  sessionTokens.push(dmToken)
  const dmSid = app.signCookie(dmToken)

  for (const [label, sid] of [['exec', execSid], ['dept_monitor', dmSid]] as const) {
    const listRes = await app.inject({ method: 'GET', url: `/api/requests/${req.id}/attachments`, cookies: { sid } })
    assert.equal(listRes.statusCode, 200)
    const ids = listRes.json().map((a: any) => Number(a.id))
    assert.ok(ids.includes(Number(attId)), `${label}: 일반 첨부는 목록에 보여야 함`)
    assert.ok(!ids.includes(Number(internalAttId)), `${label}: 내부메모 첨부는 목록에서 제외되어야 함`)
    console.log(`${label} excluded from internal-comment attachment list ok`)

    // 존재 여부/권한 없음을 구분하지 않는 프로젝트 컨벤션(404 통일, request-detail.ts guard()와 동일)을 따른다
    const dlRes = await app.inject({ method: 'GET', url: `/api/attachments/${internalAttId}/download`, cookies: { sid } })
    assert.equal(dlRes.statusCode, 404, `${label}: 내부메모 첨부 다운로드는 거부되어야 함`)
    console.log(`${label} blocked from internal-comment attachment download ok`)
  }

  // 시스템(작성자·canSeeInternal)은 내부메모 첨부도 목록·다운로드 가능해야 함
  const sysListAfter = await app.inject({ method: 'GET', url: `/api/requests/${req.id}/attachments`, cookies: { sid: sysSid } })
  assert.ok(
    sysListAfter.json().map((a: any) => Number(a.id)).includes(Number(internalAttId)),
    'system: 내부메모 첨부도 목록에 보여야 함',
  )
  const sysDlInternal = await app.inject({ method: 'GET', url: `/api/attachments/${internalAttId}/download`, cookies: { sid: sysSid } })
  assert.equal(sysDlInternal.statusCode, 200)
  assert.ok(sysDlInternal.rawPayload.toString().includes('INTERNAL-SECRET'))
  console.log('system sees & downloads internal-comment attachment ok')

  // ──────────────────────────────────────────
  // I2 회귀: comment_id가 non-null인데 참조된 댓글 행을 찾지 못하는 경우 —
  // fail-closed(목록 제외·다운로드 거부)여야 한다. 현재는 댓글 삭제 엔드포인트가 없어
  // FK(onDelete: 'set null')를 통한 자연 발생 경로는 없으므로, DB 트리거를 세션 내에서만
  // 잠깐 끄고(SET LOCAL session_replication_role = replica — 트랜잭션 종료 시 자동 원복)
  // FK 검증을 우회한 채 존재하지 않는 comment_id를 가리키는 첨부를 직접 삽입해 그 상태를
  // 재현한다. system(canSeeInternal)을 포함해 전원에게 감춰져야 한다 — "내부메모인지
  // 아닌지 확인 불가"는 가장 보수적으로(=내부메모로) 취급해야 하기 때문이다.
  // ──────────────────────────────────────────
  const bogusCommentId = 999_999_999
  const [orphanAtt] = await db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`)
    return tx.insert(requestAttachments).values({
      requestId: req.id,
      commentId: bogusCommentId,
      storagePath: 'orphan-test-path.txt',
      fileName: 'orphan.txt',
      fileSize: 4,
      mimeType: 'text/plain',
      uploadedBy: juhui!.id,
    }).returning()
  })

  for (const [label, sid] of [['system', sysSid], ['exec', execSid], ['dept_monitor', dmSid], ['staff', staffSid]] as const) {
    const listRes = await app.inject({ method: 'GET', url: `/api/requests/${req.id}/attachments`, cookies: { sid } })
    assert.equal(listRes.statusCode, 200)
    const ids = listRes.json().map((a: any) => Number(a.id))
    assert.ok(!ids.includes(Number(orphanAtt.id)), `${label}: 댓글을 찾을 수 없는 첨부는 목록에서 제외(fail-closed)되어야 함`)

    const dlRes = await app.inject({ method: 'GET', url: `/api/attachments/${orphanAtt.id}/download`, cookies: { sid } })
    assert.equal(dlRes.statusCode, 404, `${label}: 댓글을 찾을 수 없는 첨부 다운로드는 거부(fail-closed)되어야 함`)
  }
  console.log('orphaned comment_id (comment row missing) fail-closed on list & download for all roles ok')

  // comment_id가 애초에 null인 일반 첨부(attId)는 여전히 정상 노출되어야 한다(과잉 차단 아님 확인)
  const staffListAfterOrphan = await app.inject({ method: 'GET', url: `/api/requests/${req.id}/attachments`, cookies: { sid: staffSid } })
  assert.ok(
    staffListAfterOrphan.json().map((a: any) => Number(a.id)).includes(Number(attId)),
    'comment_id가 null인 일반 첨부는 orphan 테스트 이후에도 여전히 보여야 함(과잉 차단 방지)',
  )
  console.log('plain (comment_id=null) attachment still visible after fail-closed fix ok')

  console.log('ATTACH AUTHZ TEST OK')
} finally {
  // 정리 — 단언 실패에도 반드시 실행(다음 실행이 unique 위반으로 죽는 것 방지)
  if (requestIds.length) await db.delete(requests).where(inArray(requests.id, requestIds))
  if (sessionTokens.length) await db.delete(sessions).where(inArray(sessions.id, sessionTokens))
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
  await app.close(); await pool.end()
}
