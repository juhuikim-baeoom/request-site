/**
 * 공유 설정 사후 수정 테스트
 * - 권한: 요청자 본인(종결 건 포함) / 시스템팀 200, 무관한 staff 403
 * - 전체 교체: 한 번의 PUT으로 추가·제거가 반영된다
 * - 이력: added/removed가 정확히 기록되고, 변경이 없으면 행이 남지 않는다
 * - 열람 반영: 공유 대상을 추가하면 그 부서 사용자의 목록에 실제로 나타난다 (이 기능의 존재 이유)
 * - 회귀: visibility를 기존 PATCH로 바꾸려 하면 거부된다 (우회로 차단)
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, requests, sessions } from '../src/db/schema.js'
import { eq, inArray, sql } from 'drizzle-orm'

const app = await buildApp()
const suffix = randomBytes(4).toString('hex')
const created: { userIds: string[]; reqIds: number[] } = { userIds: [], reqIds: [] }

/** 사용자 생성 + 세션 쿠키 획득. test-role-boundaries.ts의 헬퍼와 같은 방식 */
let mkUserSeq = 0
async function mkUser(role: string, orgAffil: string, deptFunction: string | null) {
  // role만으로는 owner/outsider가 둘 다 'staff'라 이메일이 충돌한다 — 호출 순번을 섞어 유일성 보장.
  const email = `sharing-${role}-${suffix}-${mkUserSeq++}@baeoom.com`
  const [u] = await db.insert(users).values({
    email, name: `${role} 테스트`, role: role as any,
    orgAffil: orgAffil as any, deptFunction,
  }).returning()
  created.userIds.push(u.id)
  return u
}

/**
 * 주어진 사용자 id로 세션을 직접 만들고 서명 쿠키 문자열("sid=...")을 발급한다.
 * test-role-boundaries.ts의 makeUser 헬퍼와 동일한 방식(randomBytes 토큰 → sessions insert →
 * app.signCookie)이다. dev-login은 고정 계정만 로그인시키므로 임의 역할 테스트에는 쓸 수 없다.
 * 세션 행은 users FK의 onDelete: cascade로 사용자 삭제 시 함께 정리된다.
 */
async function sessionCookieFor(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await db.insert(sessions).values({ id: token, userId, expiresAt: new Date(Date.now() + 60_000) })
  return `sid=${app.signCookie(token)}`
}

try {
  const owner = await mkUser('staff', '배움', '교학팀')          // 요청자
  const outsider = await mkUser('staff', '배론', '상담영업팀')   // 무관한 직원
  const sysUser = await mkUser('system', '공통', '시스템팀')     // 시스템팀 담당자

  const cookie = (u: { id: string }) => sessionCookieFor(u.id)

  // 요청 생성: private (본인만 열람)
  const [req] = await db.insert(requests).values({
    org: '배움', typeCode: 'error', title: '공유테스트',
    requesterId: owner.id, visibility: 'private',
  }).returning()
  created.reqIds.push(req.id)

  // ── (1) 무관한 staff는 공유를 바꿀 수 없다
  {
    const res = await app.inject({
      method: 'PUT', url: `/api/requests/${req.id}/sharing`,
      headers: { cookie: await cookie(outsider) },
      payload: { visibility: 'private', shared_targets: [{ target_type: 'dept', target_value: '배론|상담영업팀' }] },
    })
    assert.equal(res.statusCode, 403, '무관한 staff는 403')
    console.log('(1) 무관한 staff 403 OK')
  }

  // ── (1b) canSeeRequest를 통과 못 하면(=private, 아직 공유 안 됨) 공유 이력도 404 —
  //     별도 게이트가 아니라 상세 열람 권한을 그대로 따른다는 것을 확인한다
  {
    const res = await app.inject({
      method: 'GET', url: `/api/requests/${req.id}/sharing-history`,
      headers: { cookie: await cookie(outsider) },
    })
    assert.equal(res.statusCode, 404, '요청을 볼 수 없으면 공유 이력도 404')
    console.log('(1b) 열람 불가 시 공유 이력도 404 OK')
  }

  // ── (2) 요청자 본인이 공유 대상을 추가한다 → 그 부서 사용자에게 실제로 보인다
  {
    const before = await app.inject({
      method: 'GET', url: '/api/requests', headers: { cookie: await cookie(outsider) },
    })
    const beforeIds = (before.json() as any[]).map((r) => Number(r.id))
    assert.ok(!beforeIds.includes(req.id), '공유 전에는 outsider에게 안 보인다')

    const res = await app.inject({
      method: 'PUT', url: `/api/requests/${req.id}/sharing`,
      headers: { cookie: await cookie(owner) },
      payload: { visibility: 'private', shared_targets: [{ target_type: 'dept', target_value: '배론|상담영업팀' }] },
    })
    assert.equal(res.statusCode, 200, '요청자 본인은 200')

    const after = await app.inject({
      method: 'GET', url: '/api/requests', headers: { cookie: await cookie(outsider) },
    })
    const afterIds = (after.json() as any[]).map((r) => Number(r.id))
    assert.ok(afterIds.includes(req.id), '공유 후에는 outsider에게 보인다')
    console.log('(2) 공유 추가 → 열람 반영 OK')
  }

  // ── (3) 이력: added가 기록된다
  {
    const h = await db.execute<any>(sql`
      select from_visibility, to_visibility, added, removed
      from request_sharing_history where request_id = ${req.id} order by id`)
    assert.equal(h.rows.length, 1, '이력 1건')
    assert.deepEqual(h.rows[0].added, [{ target_type: 'dept', target_value: '배론|상담영업팀' }], 'added 기록')
    assert.deepEqual(h.rows[0].removed, [], 'removed 없음')
    console.log('(3) 이력 added 기록 OK')
  }

  // ── (3b) 공유 이력이 상세 응답(타임라인용 엔드포인트)에 실제로 실린다 —
  //     타임라인에 표시되려면 응답에 담겨야 한다. 요청을 볼 수 있는 outsider(공유 대상으로
  //     막 추가됨)도 열람 가능해야 한다(내부메모와 달리 별도 게이트가 없어야 함).
  {
    const res = await app.inject({
      method: 'GET', url: `/api/requests/${req.id}/sharing-history`,
      headers: { cookie: await cookie(outsider) },
    })
    assert.equal(res.statusCode, 200, '공유 대상으로 추가된 outsider도 이력을 볼 수 있다')
    const rows = res.json() as any[]
    assert.equal(rows.length, 1, '이력 1건이 응답에 실린다')
    assert.equal(rows[0].actor.name, `${owner.name}`, '변경자 이름이 actor.name으로 붙는다')
    // visibility는 그대로(private→private)라 변경 없음으로 간주되어 null로 기록된다
    // (services/sharing.ts changeSharing: visibilityChanged일 때만 from/to를 채운다)
    assert.equal(rows[0].from_visibility, null)
    assert.equal(rows[0].to_visibility, null)
    assert.deepEqual(rows[0].added, [{ target_type: 'dept', target_value: '배론|상담영업팀' }])
    assert.deepEqual(rows[0].removed, [])
    console.log('(3b) GET .../sharing-history 응답에 이력 반영 OK')
  }

  // ── (4) 전체 교체: 기존 대상이 빠지고 새 대상이 들어간다
  {
    const res = await app.inject({
      method: 'PUT', url: `/api/requests/${req.id}/sharing`,
      headers: { cookie: await cookie(sysUser) },
      payload: { visibility: 'org', shared_targets: [{ target_type: 'function', target_value: '교학팀' }] },
    })
    assert.equal(res.statusCode, 200, '시스템팀은 200')

    const t = await db.execute<any>(sql`
      select target_type, target_value from request_shared_targets where request_id = ${req.id}`)
    assert.equal(t.rows.length, 1, '대상 1건으로 교체')
    assert.equal(t.rows[0].target_value, '교학팀', '새 대상')

    const h = await db.execute<any>(sql`
      select from_visibility, to_visibility, added, removed
      from request_sharing_history where request_id = ${req.id} order by id desc limit 1`)
    assert.equal(h.rows[0].from_visibility, 'private')
    assert.equal(h.rows[0].to_visibility, 'org')
    assert.deepEqual(h.rows[0].added, [{ target_type: 'function', target_value: '교학팀' }])
    assert.deepEqual(h.rows[0].removed, [{ target_type: 'dept', target_value: '배론|상담영업팀' }])
    console.log('(4) 전체 교체 + added/removed 기록 OK')
  }

  // ── (5) 변경이 없으면 이력을 남기지 않는다
  {
    const cntBefore = await db.execute<any>(sql`
      select count(*)::int n from request_sharing_history where request_id = ${req.id}`)
    const res = await app.inject({
      method: 'PUT', url: `/api/requests/${req.id}/sharing`,
      headers: { cookie: await cookie(owner) },
      payload: { visibility: 'org', shared_targets: [{ target_type: 'function', target_value: '교학팀' }] },
    })
    assert.equal(res.statusCode, 200)
    const cntAfter = await db.execute<any>(sql`
      select count(*)::int n from request_sharing_history where request_id = ${req.id}`)
    assert.equal(cntAfter.rows[0].n, cntBefore.rows[0].n, '변경 없으면 이력 없음')
    console.log('(5) 무변경 시 이력 없음 OK')
  }

  // ── (6) 종결 건도 요청자가 공유를 바꿀 수 있다
  {
    await db.update(requests).set({ status: '완료' }).where(eq(requests.id, req.id))
    const res = await app.inject({
      method: 'PUT', url: `/api/requests/${req.id}/sharing`,
      headers: { cookie: await cookie(owner) },
      payload: { visibility: 'shared', shared_targets: [] },
    })
    assert.equal(res.statusCode, 200, '종결 건도 200')
    console.log('(6) 종결 건 공유 변경 OK')
  }

  // ── (7) 회귀: visibility를 기존 PATCH로 바꾸려 하면 거부된다 (우회로 차단)
  {
    const res = await app.inject({
      method: 'PATCH', url: `/api/requests/${req.id}`,
      headers: { cookie: await cookie(sysUser) },
      payload: { visibility: 'private' },
    })
    assert.equal(res.statusCode, 400, 'PATCH로는 visibility를 못 바꾼다')
    console.log('(7) PATCH 우회로 차단 OK')
  }

  // ── (8) exec: 요청을 볼 수는 있으나(canSeeAllRequests) canProcess는 아니므로 403
  //     — "볼 수도 없는 staff"만 커버하던 (1)과 달리 가장 중요한 경계(열람 가능 vs 처리 가능)를 검증한다
  {
    const execUser = await mkUser('exec', '허브', '경영지원팀')
    const res = await app.inject({
      method: 'PUT', url: `/api/requests/${req.id}/sharing`,
      headers: { cookie: await cookie(execUser) },
      payload: { visibility: 'shared', shared_targets: [] },
    })
    assert.equal(res.statusCode, 403, 'exec는 볼 수 있어도 공유는 못 바꾼다 (403)')
    console.log('(8) exec(열람 가능·처리 불가) 403 OK')
  }

  // ── (9) 없는 요청 id → 404
  {
    const res = await app.inject({
      method: 'PUT', url: '/api/requests/999999999/sharing',
      headers: { cookie: await cookie(sysUser) },
      payload: { visibility: 'private', shared_targets: [] },
    })
    assert.equal(res.statusCode, 404, '없는 요청 id는 404')
    console.log('(9) 없는 요청 id 404 OK')
  }

  // ── (10) 잘못된 target_type / target_value / shared_targets 누락 → 각각 400
  {
    const badType = await app.inject({
      method: 'PUT', url: `/api/requests/${req.id}/sharing`,
      headers: { cookie: await cookie(sysUser) },
      payload: { visibility: 'private', shared_targets: [{ target_type: 'bogus', target_value: 'x' }] },
    })
    assert.equal(badType.statusCode, 400, '잘못된 target_type은 400')

    const badValue = await app.inject({
      method: 'PUT', url: `/api/requests/${req.id}/sharing`,
      headers: { cookie: await cookie(sysUser) },
      payload: { visibility: 'private', shared_targets: [{ target_type: 'function', target_value: '' }] },
    })
    assert.equal(badValue.statusCode, 400, '빈 target_value는 400')

    const missing = await app.inject({
      method: 'PUT', url: `/api/requests/${req.id}/sharing`,
      headers: { cookie: await cookie(sysUser) },
      payload: { visibility: 'private' },
    })
    assert.equal(missing.statusCode, 400, 'shared_targets 누락은 400')
    assert.equal(missing.json().code, 'INVALID_SHARED_TARGETS', '컨테이너 오류도 원소 오류와 같은 code 형태')
    console.log('(10) 잘못된 입력(target_type/target_value/누락) 각각 400 OK')
  }

  // ── (11) 중복 target: 이력(added)에 중복 없이 1건만 기록되고, 대상 테이블도 1행
  {
    const before = await db.execute<any>(sql`
      select count(*)::int n from request_sharing_history where request_id = ${req.id}`)
    const res = await app.inject({
      method: 'PUT', url: `/api/requests/${req.id}/sharing`,
      headers: { cookie: await cookie(sysUser) },
      payload: {
        visibility: 'org',
        shared_targets: [
          { target_type: 'function', target_value: '상품개발팀' },
          { target_type: 'function', target_value: '상품개발팀' },
        ],
      },
    })
    assert.equal(res.statusCode, 200)

    const t = await db.execute<any>(sql`
      select target_type, target_value from request_shared_targets where request_id = ${req.id}`)
    assert.equal(t.rows.length, 1, '중복 대상은 1행으로 저장')

    const h = await db.execute<any>(sql`
      select added from request_sharing_history where request_id = ${req.id} order by id desc limit 1`)
    assert.deepEqual(h.rows[0].added, [{ target_type: 'function', target_value: '상품개발팀' }], 'added는 중복 없이 1건')
    const after = await db.execute<any>(sql`
      select count(*)::int n from request_sharing_history where request_id = ${req.id}`)
    assert.equal(after.rows[0].n, before.rows[0].n + 1, '이력은 1건만 추가')
    console.log('(11) 중복 target dedupe OK')
  }

  // ── (12) visibility만 바뀌고 대상은 그대로면 대상 행을 재생성하지 않는다 (id·created_at 보존)
  {
    const targetBefore = await db.execute<any>(sql`
      select id, created_at from request_shared_targets where request_id = ${req.id}`)
    assert.equal(targetBefore.rows.length, 1)

    const res = await app.inject({
      method: 'PUT', url: `/api/requests/${req.id}/sharing`,
      headers: { cookie: await cookie(sysUser) },
      payload: {
        visibility: 'dept',
        shared_targets: [{ target_type: 'function', target_value: '상품개발팀' }],
      },
    })
    assert.equal(res.statusCode, 200)

    const targetAfter = await db.execute<any>(sql`
      select id, created_at from request_shared_targets where request_id = ${req.id}`)
    assert.equal(targetAfter.rows.length, 1)
    assert.equal(targetAfter.rows[0].id, targetBefore.rows[0].id, 'visibility만 바뀌면 대상 행 id가 보존된다')
    assert.deepEqual(targetAfter.rows[0].created_at, targetBefore.rows[0].created_at, 'created_at도 보존된다')
    console.log('(12) visibility만 변경 시 대상 행 보존 OK')
  }

  console.log('\ntest:sharing ALL PASSED')
} finally {
  if (created.reqIds.length) await db.delete(requests).where(inArray(requests.id, created.reqIds))
  if (created.userIds.length) await db.delete(users).where(inArray(users.id, created.userIds))
  await app.close()
  await pool.end()
}
