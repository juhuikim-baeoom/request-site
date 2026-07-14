/**
 * 역할별 API 권한 경계 회귀 테스트 (HTTP 레벨)
 *
 * 능력 함수(src/authz.ts) 단위 테스트(test:authz)만으로는 "실제 엔드포인트가 정말
 * 막히는가"를 보장하지 못한다 — 라우트가 능력 함수를 호출하는 걸 잊으면 유닛 테스트는
 * 여전히 통과한다. 이 스크립트는 app.inject()로 실제 라우트를 태워 권한 경계를 검증한다.
 *
 * 검증 대상:
 * - 계정·역할 관리(PATCH /api/users/:id) — system_admin만 가능.
 *   이번 변경의 핵심 회귀: 이전에는 system(담당자)이면 누구나 남의 역할을 바꿀 수 있었다.
 * - 처리 API(assign·상태 전이) — system·system_admin만 가능.
 * - 대시보드(GET /api/dashboard/metrics) — system·system_admin·exec만 가능.
 * - 폐기값 viewer 는 위 전부에서 최소 권한(항상 차단)이어야 한다.
 *
 * 각 부정 케이스 옆에는 동일 엔드포인트에 대한 긍정 케이스(정당한 역할은 실제로 통과하는가)를
 * 둔다 — 그래야 "권한 체크가 실수로 전원을 막아버린" 경우도 잡아낼 수 있다.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, sessions, requests } from '../src/db/schema.js'
import { eq, inArray, sql } from 'drizzle-orm'

const app = await buildApp()

type Role = 'staff' | 'system' | 'viewer' | 'dept_monitor' | 'org_monitor' | 'exec' | 'system_admin'

const userIds: string[] = []
const sessionTokens: string[] = []
const requestIds: number[] = []

/**
 * 주어진 역할의 사용자를 만들고 세션 쿠키(sid)를 발급한다.
 * dev-login(/api/auth/dev-login)은 고정 시스템 계정(김주희)만 로그인시키므로 역할별 사용자를
 * 얻을 수 없다 — test-users.ts/test-dashboard.ts 관례를 따라 세션을 직접 만든다.
 */
type OrgAffil = '배움' | '배론' | '허브' | '공통'

async function makeUser(
  role: Role,
  label: string,
  affil?: { orgAffil: OrgAffil; deptFunction: string },
): Promise<{ id: string; sid: string }> {
  const email = `role-boundary-${label}-${randomBytes(4).toString('hex')}@baeoom.com`
  const [u] = await db.insert(users).values({
    email, name: `${label} 테스트`,
    orgAffil: affil?.orgAffil ?? '배움', deptFunction: affil?.deptFunction ?? '교학팀', role,
  }).returning()
  userIds.push(u.id)

  const token = randomBytes(32).toString('hex')
  await db.insert(sessions).values({ id: token, userId: u.id, expiresAt: new Date(Date.now() + 60_000) })
  sessionTokens.push(token)

  return { id: u.id, sid: app.signCookie(token) }
}

async function makeRequest(
  requesterId: string,
  title: string,
  visibility: 'private' | 'dept' | 'function' | 'org' | 'shared' = 'shared',
): Promise<number> {
  const [r] = await db.insert(requests).values({
    org: '배움', typeCode: 'error', title, requesterId, visibility,
  }).returning()
  requestIds.push(r.id)
  return r.id
}

const call = (sid: string, method: any, url: string, payload?: any) =>
  app.inject({ method, url, payload, cookies: { sid } })

try {
  const system = await makeUser('system', 'system')
  const systemAdmin = await makeUser('system_admin', 'sysadmin')
  const exec = await makeUser('exec', 'exec')
  const deptMonitor = await makeUser('dept_monitor', 'dm')
  const orgMonitor = await makeUser('org_monitor', 'om')
  const staff = await makeUser('staff', 'staff')
  const viewer = await makeUser('viewer', 'viewer')
  const targetStaff = await makeUser('staff', 'target') // 역할 변경 대상(피해자 역)

  // ──────────────────────────────────────────
  // (1) 계정·역할 관리 — system_admin만 (핵심 회귀 지점)
  // ──────────────────────────────────────────
  {
    const r1 = await call(system.sid, 'PATCH', `/api/users/${targetStaff.id}`, { role: 'system_admin' })
    assert.equal(r1.statusCode, 403, `담당자(system)는 역할 변경 불가, got ${r1.statusCode}: ${r1.body}`)

    const r2 = await call(viewer.sid, 'PATCH', `/api/users/${targetStaff.id}`, { dept: 'x' })
    assert.equal(r2.statusCode, 403, `viewer(폐기값)는 계정 관리 불가, got ${r2.statusCode}`)

    const r3 = await call(exec.sid, 'PATCH', `/api/users/${targetStaff.id}`, { dept: 'x' })
    assert.equal(r3.statusCode, 403, `exec는 계정 관리 불가, got ${r3.statusCode}`)

    // positive control: system_admin은 실제로 가능해야 한다(항상-403 오탐 방지).
    const r4 = await call(systemAdmin.sid, 'PATCH', `/api/users/${targetStaff.id}`, { dept: '변경됨' })
    assert.equal(r4.statusCode, 200, `system_admin은 계정 관리 가능해야 함, got ${r4.statusCode}: ${r4.body}`)
    assert.equal(r4.json().dept, '변경됨', 'dept 변경 반영 확인')

    console.log('(1) 계정·역할 관리 경계 OK — 담당자(system) 차단(핵심 회귀)·viewer 차단·exec 차단, system_admin 허용')
  }

  // ──────────────────────────────────────────
  // (1b) routes/users.ts의 ROLES 화이트리스트 — 신규 4역할을 실제로 부여할 수 있어야 한다.
  //      이전에는 ['staff','system','viewer']만 허용해 새 역할 부여가 전부 400
  //      'invalid role'로 막혀 6역할 모델이 사실상 무용지물이었다(핵심 회귀 지점).
  // ──────────────────────────────────────────
  {
    for (const role of ['dept_monitor', 'org_monitor', 'exec', 'system_admin'] as const) {
      const r = await call(systemAdmin.sid, 'PATCH', `/api/users/${targetStaff.id}`, { role })
      assert.equal(r.statusCode, 200, `system_admin은 ${role} 부여 가능해야 함, got ${r.statusCode}: ${r.body}`)
      assert.equal(r.json().role, role, `역할이 ${role}로 반영되어야 함`)
    }
    // 되돌리기 — 이후 블록에서 targetStaff를 staff로 다시 쓰는 가정이 있으면 깨지므로 원복
    const rReset = await call(systemAdmin.sid, 'PATCH', `/api/users/${targetStaff.id}`, { role: 'staff' })
    assert.equal(rReset.statusCode, 200, `원복 PATCH 200, got ${rReset.statusCode}: ${rReset.body}`)

    // 폐기값 viewer는 여전히 신규 부여 금지 → 400
    const rViewer = await call(systemAdmin.sid, 'PATCH', `/api/users/${targetStaff.id}`, { role: 'viewer' })
    assert.equal(rViewer.statusCode, 400, `viewer는 신규 부여 금지 → 400, got ${rViewer.statusCode}`)

    console.log('(1b) 신규 역할 화이트리스트 OK — dept_monitor·org_monitor·exec·system_admin 부여 가능, viewer 신규 부여는 400')
  }

  // ──────────────────────────────────────────
  // (1c) 마지막 system_admin 자기/타인 강등 방지 가드 (동시성 포함)
  //      개발 DB에는 backfill-roles.ts가 최초 1회 승격한 실제 관리자(김주희)가 이미
  //      system_admin으로 존재할 수 있어 "관리자 1명"이라는 전제가 그냥은 성립하지 않는다.
  //      이 블록 동안만 systemAdmin 이외의 기존 관리자를 API가 아닌 DB 직접 갱신으로
  //      잠시 비관리자로 내려 시나리오를 통제하고, 블록이 끝나면(단언 실패로 인한 중도
  //      이탈 포함) try/finally로 반드시 원복한다 — 그래야 테스트 실패가 개발 DB의 실제
  //      관리자 권한을 영구히 망가뜨리지 않는다.
  // ──────────────────────────────────────────
  {
    const preExisting = await db.execute<{ id: string }>(
      sql`select id from users where role = 'system_admin' and id <> ${systemAdmin.id}`,
    )
    const otherAdminIds = preExisting.rows.map((r) => r.id)
    if (otherAdminIds.length) {
      await db.update(users).set({ role: 'staff' }).where(inArray(users.id, otherAdminIds))
    }

    try {
      // 이 시점에 system_admin은 systemAdmin 단 1명. 유일한 관리자를 강등하려 하면 거부되어야 한다.
      const rSelfDemote = await call(systemAdmin.sid, 'PATCH', `/api/users/${systemAdmin.id}`, { role: 'staff' })
      assert.equal(rSelfDemote.statusCode, 400, `마지막 관리자 자기 강등은 400, got ${rSelfDemote.statusCode}: ${rSelfDemote.body}`)
      assert.equal(rSelfDemote.json().code, 'LAST_ADMIN', '오류 코드 LAST_ADMIN 확인')

      // 관리자가 2명이면 한 명은 강등 가능해야 한다.
      const secondAdmin = await makeUser('system_admin', 'sysadmin2')
      const rDemoteOk = await call(systemAdmin.sid, 'PATCH', `/api/users/${secondAdmin.id}`, { role: 'staff' })
      assert.equal(rDemoteOk.statusCode, 200, `관리자 2명 중 1명 강등은 허용되어야 함, got ${rDemoteOk.statusCode}: ${rDemoteOk.body}`)
      assert.equal(rDemoteOk.json().role, 'staff', '강등 반영 확인')

      // 다시 관리자가 1명(systemAdmin)뿐인 상태로 복귀했으니 재차 강등 시도는 거부되어야 한다.
      const rSelfDemoteAgain = await call(systemAdmin.sid, 'PATCH', `/api/users/${systemAdmin.id}`, { role: 'system' })
      assert.equal(rSelfDemoteAgain.statusCode, 400, `마지막 관리자 강등(재시도)도 400, got ${rSelfDemoteAgain.statusCode}`)

      // 동시성: 관리자가 정확히 2명일 때 서로를 동시에 강등하려는 레이스 — 하나만 성공하고
      // 최소 1명은 system_admin으로 남아야 한다(둘 다 성공하면 관리자 0명 = 버그).
      // 공유 픽스처 systemAdmin은 이후 블록((4) 대시보드 등)이 system_admin 역할을 계속
      // 전제하므로 레이스에 끌어들이지 않는다 — 대신 레이스 전용 관리자 2명만 새로 만들고,
      // "이 두 명이 전체에서 유일한 system_admin"이 되도록 systemAdmin을 잠시 내렸다가
      // 레이스 검증 직후(단언 실패 포함) 반드시 원복한다.
      await db.update(users).set({ role: 'staff' }).where(eq(users.id, systemAdmin.id))
      try {
        const raceAdminX = await makeUser('system_admin', 'racex')
        const raceAdminY = await makeUser('system_admin', 'racey')
        const [raceA, raceB] = await Promise.all([
          call(raceAdminX.sid, 'PATCH', `/api/users/${raceAdminY.id}`, { role: 'staff' }),
          call(raceAdminY.sid, 'PATCH', `/api/users/${raceAdminX.id}`, { role: 'staff' }),
        ])
        // 거부되는 쪽이 400(트랜잭션 내부 LAST_ADMIN 가드)인지 403(자신도 상대 요청에
        // 의해 이미 강등되어 canManageAccounts 자체가 재검사에서 실패)인지는 두 요청의
        // 실제 I/O 인터리빙 순서에 따라 달라진다 — authenticate()의 역할 조회는 FOR
        // UPDATE로 잠그지 않으므로, 한쪽 트랜잭션이 완전히 커밋된 뒤에야 다른 쪽이
        // authenticate 단계에 도달하면 자기 자신이 이미 강등된 상태로 재검사되어 403이
        // 될 수 있다. 어느 경로든 "관리자 0명" 이라는 안전하지 않은 결과는 만들지
        // 않는다는 것이 핵심이므로, 정확히 하나만 성공(200)하고 나머지는 거부(400/403)임을
        // 확인한 뒤 최종 진실은 DB 직접 조회로 검증한다.
        const codes = [raceA.statusCode, raceB.statusCode]
        const successCount = codes.filter((c) => c === 200).length
        assert.equal(
          successCount, 1,
          `동시 상호 강등은 정확히 하나만 성공해야 함, got ${JSON.stringify(codes)}: ${raceA.body} / ${raceB.body}`,
        )
        assert.ok(
          codes.every((c) => c === 200 || c === 400 || c === 403),
          `실패한 요청은 400(LAST_ADMIN) 또는 403(권한 재검사 실패)이어야 함, got ${JSON.stringify(codes)}`,
        )
        const remainingAdmins = await db.execute<{ count: string }>(
          sql`select count(*)::text as count from users where role = 'system_admin' and id in (${raceAdminX.id}, ${raceAdminY.id})`,
        )
        assert.equal(remainingAdmins.rows[0]?.count, '1', '레이스 이후에도 이 둘 중 system_admin이 정확히 1명 남아야 함')
      } finally {
        // 원복 — 이후 블록들이 systemAdmin=system_admin을 전제한다.
        await db.update(users).set({ role: 'system_admin' }).where(eq(users.id, systemAdmin.id))
      }

      console.log('(1c) 마지막 관리자 강등 방지 가드 OK — 단독 관리자 자기강등 거부, 2명 중 1명 강등 허용, 동시 상호강등 레이스는 한쪽만 성공')
    } finally {
      if (otherAdminIds.length) {
        await db.update(users).set({ role: 'system_admin' }).where(inArray(users.id, otherAdminIds))
      }
    }
  }

  // ──────────────────────────────────────────
  // (2) 처리 API(배정) — canProcess(system·system_admin)만
  // ──────────────────────────────────────────
  {
    const reqNeg = await makeRequest(staff.id, '권한테스트-배정거부용')

    const r1 = await call(exec.sid, 'POST', `/api/requests/${reqNeg}/assign`, { assigneeId: system.id, impact: '보통' })
    assert.equal(r1.statusCode, 403, `exec는 배정 불가, got ${r1.statusCode}`)

    const r2 = await call(deptMonitor.sid, 'POST', `/api/requests/${reqNeg}/assign`, { assigneeId: system.id, impact: '보통' })
    assert.equal(r2.statusCode, 403, `dept_monitor는 배정 불가, got ${r2.statusCode}`)

    const r3 = await call(orgMonitor.sid, 'POST', `/api/requests/${reqNeg}/assign`, { assigneeId: system.id, impact: '보통' })
    assert.equal(r3.statusCode, 403, `org_monitor는 배정 불가, got ${r3.statusCode}`)

    const r4 = await call(viewer.sid, 'POST', `/api/requests/${reqNeg}/assign`, { assigneeId: system.id, impact: '보통' })
    assert.equal(r4.statusCode, 403, `viewer(폐기값)는 배정 불가, got ${r4.statusCode}`)

    // 위 4건은 전부 권한에서 막혀야 하므로 요청 상태가 그대로 '접수'여야 한다(부수효과 없음 확인)
    const stillReceived = await db.execute<{ status: string }>(
      sql`select status from requests where id = ${reqNeg}`,
    )
    assert.equal(stillReceived.rows[0]?.status, '접수', '권한 거부된 배정 시도는 상태를 바꾸지 않아야 함')

    // positive control: system은 실제로 배정 가능해야 한다
    const reqPos = await makeRequest(staff.id, '권한테스트-배정허용용')
    const r5 = await call(system.sid, 'POST', `/api/requests/${reqPos}/assign`, { assigneeId: system.id, impact: '보통' })
    assert.equal(r5.statusCode, 200, `system은 배정 가능해야 함, got ${r5.statusCode}: ${r5.body}`)

    console.log('(2) 처리 API(배정) 경계 OK — exec·dept_monitor·org_monitor·viewer 차단, system 허용')
  }

  // ──────────────────────────────────────────
  // (3) 처리 API(상태 전이 PATCH) — canProcess(system·system_admin)만
  //     (본인 소유 '접수' 건의 '철회'만 예외 — 이번 테스트 대상 아님)
  // ──────────────────────────────────────────
  {
    const reqStatus = await makeRequest(staff.id, '권한테스트-상태변경거부용')

    const r1 = await call(deptMonitor.sid, 'PATCH', `/api/requests/${reqStatus}`, { status: '진행중' })
    assert.equal(r1.statusCode, 403, `dept_monitor는 상태 변경 불가, got ${r1.statusCode}`)

    const r2 = await call(orgMonitor.sid, 'PATCH', `/api/requests/${reqStatus}`, { status: '진행중' })
    assert.equal(r2.statusCode, 403, `org_monitor는 상태 변경 불가, got ${r2.statusCode}`)

    const r3 = await call(exec.sid, 'PATCH', `/api/requests/${reqStatus}`, { status: '진행중' })
    assert.equal(r3.statusCode, 403, `exec는 상태 변경 불가, got ${r3.statusCode}`)

    const r4 = await call(viewer.sid, 'PATCH', `/api/requests/${reqStatus}`, { status: '진행중' })
    assert.equal(r4.statusCode, 403, `viewer(폐기값)는 상태 변경 불가, got ${r4.statusCode}`)

    // positive control: system은 실제로 상태 변경 가능해야 한다
    const r5 = await call(system.sid, 'PATCH', `/api/requests/${reqStatus}`, { status: '진행중' })
    assert.equal(r5.statusCode, 200, `system은 상태 변경 가능해야 함, got ${r5.statusCode}: ${r5.body}`)

    console.log('(3) 처리 API(상태 전이) 경계 OK — dept_monitor·org_monitor·exec·viewer 차단, system 허용')
  }

  // ──────────────────────────────────────────
  // (4) 대시보드 — canSeeDashboard(system·system_admin·exec)만
  // ──────────────────────────────────────────
  {
    const r1 = await call(staff.sid, 'GET', '/api/dashboard/metrics')
    assert.equal(r1.statusCode, 403, `staff는 대시보드 불가, got ${r1.statusCode}`)

    const r2 = await call(deptMonitor.sid, 'GET', '/api/dashboard/metrics')
    assert.equal(r2.statusCode, 403, `dept_monitor는 대시보드 불가, got ${r2.statusCode}`)

    const r3 = await call(orgMonitor.sid, 'GET', '/api/dashboard/metrics')
    assert.equal(r3.statusCode, 403, `org_monitor는 대시보드 불가, got ${r3.statusCode}`)

    const r4 = await call(viewer.sid, 'GET', '/api/dashboard/metrics')
    assert.equal(r4.statusCode, 403, `viewer(폐기값)는 대시보드 불가, got ${r4.statusCode}`)

    // positive controls
    const r5 = await call(exec.sid, 'GET', '/api/dashboard/metrics')
    assert.equal(r5.statusCode, 200, `exec는 대시보드 가능해야 함, got ${r5.statusCode}`)

    const r6 = await call(system.sid, 'GET', '/api/dashboard/metrics')
    assert.equal(r6.statusCode, 200, `system은 대시보드 가능해야 함, got ${r6.statusCode}`)

    const r7 = await call(systemAdmin.sid, 'GET', '/api/dashboard/metrics')
    assert.equal(r7.statusCode, 200, `system_admin은 대시보드 가능해야 함, got ${r7.statusCode}`)

    console.log('(4) 대시보드 접근 경계 OK — staff·dept_monitor·org_monitor·viewer 차단, exec·system·system_admin 허용')
  }

  // ──────────────────────────────────────────
  // (5) GET /api/users — canProcess(system·system_admin)만 (canManageAccounts 아님, 의도적 경계)
  //     routes/users.ts 주석대로 이 API는 요청 처리 화면/AdminPanel.tsx의 담당자 select가 후보
  //     목록을 가져오는 데 쓴다. 누군가 "계정 API니까"라며 canManageAccounts로 좁히면
  //     담당자 배정 UI가 조용히 깨지는데 기존 테스트는 이를 잡지 못했다(리뷰 공백 1).
  // ──────────────────────────────────────────
  {
    const r1 = await call(system.sid, 'GET', '/api/users')
    assert.equal(
      r1.statusCode, 200,
      `system(담당자)은 /api/users 조회 가능해야 함(AdminPanel 담당자 select 의존), got ${r1.statusCode}: ${r1.body}`,
    )
    assert.ok(Array.isArray(r1.json()), '/api/users 응답은 배열이어야 함')

    const r2 = await call(systemAdmin.sid, 'GET', '/api/users')
    assert.equal(r2.statusCode, 200, `system_admin은 /api/users 조회 가능해야 함, got ${r2.statusCode}: ${r2.body}`)

    const r3 = await call(staff.sid, 'GET', '/api/users')
    assert.equal(r3.statusCode, 403, `staff는 /api/users 조회 불가(canProcess 없음), got ${r3.statusCode}`)

    const r4 = await call(exec.sid, 'GET', '/api/users')
    assert.equal(r4.statusCode, 403, `exec는 /api/users 조회 불가(canProcess 없음), got ${r4.statusCode}`)

    const r5 = await call(deptMonitor.sid, 'GET', '/api/users')
    assert.equal(r5.statusCode, 403, `dept_monitor는 /api/users 조회 불가(canProcess 없음), got ${r5.statusCode}`)

    console.log('(5) GET /api/users 경계 OK — system·system_admin 허용(담당자 select 의존), staff·exec·dept_monitor 차단')
  }

  // ──────────────────────────────────────────
  // (6) 내부메모(canSeeInternal) + 전체열람(canSeeAllRequests) — 신규 역할 조합 HTTP 검증
  //     test-comment-internal.ts는 staff/system 두 역할만 다룬다. exec·dept_monitor 조합이
  //     HTTP 레벨에서 검증되지 않던 공백(리뷰 공백 2)을 메운다.
  // ──────────────────────────────────────────
  {
    // requester = staff(org_affil='배움', dept_function='교학팀', makeUser 기본값)
    // → deptMonitor(같은 기본 소속)의 모니터링 범위에 걸려 visibility='private'이어도
    //   요청 자체는 보이되, canSeeInternal이 없으니 내부메모는 걸러져야 한다.
    const reqInternal = await makeRequest(staff.id, '권한테스트-내부메모경계용', 'private')

    // system(canProcess)이 내부메모 작성
    const postInternal = await call(system.sid, 'POST', `/api/requests/${reqInternal}/comments`, {
      body: '민감한내부메모', is_internal: true,
    })
    assert.equal(postInternal.statusCode, 201, `내부메모 작성 201, got ${postInternal.statusCode}: ${postInternal.body}`)

    // positive control: system(canSeeInternal=true) — 내부메모가 보여야 함
    const rSys = await call(system.sid, 'GET', `/api/requests/${reqInternal}/comments`)
    assert.equal(rSys.statusCode, 200, `system은 댓글 목록 조회 가능해야 함, got ${rSys.statusCode}`)
    assert.ok(
      rSys.json().some((c: any) => c.body === '민감한내부메모'),
      'system(canSeeInternal)에게는 내부메모가 보여야 함(positive control)',
    )

    // exec: canSeeAllRequests=true → 요청·댓글 목록 접근은 가능(200)하되 canSeeInternal=false → 내부메모 제외
    const rExec = await call(exec.sid, 'GET', `/api/requests/${reqInternal}/comments`)
    assert.equal(
      rExec.statusCode, 200,
      `exec는 canSeeAllRequests이므로 댓글 목록 접근 가능해야 함, got ${rExec.statusCode}: ${rExec.body}`,
    )
    assert.ok(
      !rExec.json().some((c: any) => c.body === '민감한내부메모'),
      'exec에게는 내부메모 본문이 보이면 안 됨',
    )

    // dept_monitor: 모니터링 범위(같은 소속)로 요청 접근은 가능(200)하되 내부메모는 제외
    const rDm = await call(deptMonitor.sid, 'GET', `/api/requests/${reqInternal}/comments`)
    assert.equal(
      rDm.statusCode, 200,
      `dept_monitor는 같은 소속 요청의 댓글 목록에 접근 가능해야 함, got ${rDm.statusCode}: ${rDm.body}`,
    )
    assert.ok(
      !rDm.json().some((c: any) => c.body === '민감한내부메모'),
      'dept_monitor에게는 내부메모 본문이 보이면 안 됨',
    )

    // exec가 타인의 private 요청을 상세 조회할 수 있는지 — canSeeAllRequests=true이므로 200
    const rExecDetail = await call(exec.sid, 'GET', `/api/requests/${reqInternal}`)
    assert.equal(
      rExecDetail.statusCode, 200,
      `exec는 canSeeAllRequests이므로 타인의 private 요청도 상세 조회 가능해야 함, got ${rExecDetail.statusCode}: ${rExecDetail.body}`,
    )

    // staff(무관한 부서)는 같은 요청에서 막히는지 — canSeeRequest 실패는 404로 통일(존재 여부 비노출,
    // request-detail.ts의 guard()). 요청자와 소속이 다른 별도 staff를 만들어 "무관함"을 실제로 반영한다.
    const unrelatedStaff = await makeUser('staff', 'unrelated', { orgAffil: '배론', deptFunction: '다른팀' })
    const rUnrelated = await call(unrelatedStaff.sid, 'GET', `/api/requests/${reqInternal}`)
    assert.equal(
      rUnrelated.statusCode, 404,
      `무관한 부서 staff는 타인의 private 요청을 조회할 수 없어야 함(404), got ${rUnrelated.statusCode}`,
    )

    console.log(
      '(6) 내부메모(canSeeInternal)·전체열람(canSeeAllRequests) 경계 OK — ' +
      'system은 내부메모 보임, exec·dept_monitor는 요청은 보되 내부메모 제외, ' +
      'exec는 타인 private 상세 열람 가능, 무관 부서 staff는 404',
    )
  }

  // ──────────────────────────────────────────
  // (7) GET /api/profiles — canProcess(system·system_admin)만 (I1 회귀)
  //     이전에는 authenticate만 걸려 있어 staff를 포함한 전 로그인 사용자에게
  //     전 계정(id·name·email·role·소속)이 무방비로 노출됐다 — GET /api/users를
  //     canProcess로 좁힌 경계가 이쪽으로 우회 가능해 무효화되던 지점.
  // ──────────────────────────────────────────
  {
    const r1 = await call(staff.sid, 'GET', '/api/profiles')
    assert.equal(r1.statusCode, 403, `staff는 /api/profiles 조회 불가, got ${r1.statusCode}`)

    const r2 = await call(exec.sid, 'GET', '/api/profiles')
    assert.equal(r2.statusCode, 403, `exec는 /api/profiles 조회 불가, got ${r2.statusCode}`)

    // positive controls — 요청 처리 화면(useAllProfiles)의 유일한 소비자가 canProcess 전용 화면이므로
    const r3 = await call(system.sid, 'GET', '/api/profiles')
    assert.equal(r3.statusCode, 200, `system은 /api/profiles 조회 가능해야 함, got ${r3.statusCode}`)
    assert.ok(Array.isArray(r3.json()), '/api/profiles 응답은 배열이어야 함')

    const r4 = await call(systemAdmin.sid, 'GET', '/api/profiles')
    assert.equal(r4.statusCode, 200, `system_admin은 /api/profiles 조회 가능해야 함, got ${r4.statusCode}`)

    console.log('(7) GET /api/profiles 경계 OK — staff·exec 차단, system·system_admin 허용')
  }

  console.log('\ntest:roles ALL PASSED')
} finally {
  // 정리 — 단언 실패에도 반드시 실행(다음 실행이 unique 위반으로 죽는 것 방지)
  if (requestIds.length) await db.delete(requests).where(inArray(requests.id, requestIds))
  if (sessionTokens.length) await db.delete(sessions).where(inArray(sessions.id, sessionTokens))
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
  await app.close()
  await pool.end()
}
