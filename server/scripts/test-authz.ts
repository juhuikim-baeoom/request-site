import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { canSeeRequest } from '../src/authz.js'
import type { CurrentUser } from '../src/types.js'
import { db, pool } from '../src/db/client.js'
import { users, requests } from '../src/db/schema.js'
import { inArray, sql } from 'drizzle-orm'

const staff: CurrentUser = { id: 'u-staff', email: 's@baeoom.com', name: 'S', orgAffil: '배움', deptFunction: '교학팀', role: 'staff' }
const other: CurrentUser = { id: 'u-other', email: 'o@baeoom.com', name: 'O', orgAffil: '배론', deptFunction: '상담영업팀', role: 'staff' }
const system: CurrentUser = { ...staff, id: 'u-sys', role: 'system' }

const base = { requesterId: 'u-x', requesterOrg: '배움', requesterFunction: '교학팀' }

// system 은 전부 조회
assert.equal(canSeeRequest(system, { ...base, visibility: 'private' }, []), true)
// 본인 요청은 항상 조회
assert.equal(canSeeRequest(staff, { ...base, requesterId: 'u-staff', visibility: 'private' }, []), true)
// private 는 타인 조회 불가
assert.equal(canSeeRequest(other, { ...base, visibility: 'private' }, []), false)
// shared 는 전원
assert.equal(canSeeRequest(other, { ...base, visibility: 'shared' }, []), true)
// dept: 같은 기관·직무만
assert.equal(canSeeRequest(staff, { ...base, visibility: 'dept' }, []), true)
assert.equal(canSeeRequest(other, { ...base, visibility: 'dept' }, []), false)
// function: 같은 직무면 기관 무관
const sameFn: CurrentUser = { ...other, deptFunction: '교학팀' }
assert.equal(canSeeRequest(sameFn, { ...base, visibility: 'function' }, []), true)
// org: 같은 기관
assert.equal(canSeeRequest({ ...other, orgAffil: '배움' }, { ...base, visibility: 'org' }, []), true)
// 공유대상(function)
assert.equal(canSeeRequest(other, { ...base, visibility: 'private' }, [{ targetType: 'function', targetValue: '상담영업팀' }]), true)
// 공유대상(dept)
assert.equal(canSeeRequest(other, { ...base, visibility: 'private' }, [{ targetType: 'dept', targetValue: '배론|상담영업팀' }]), true)

console.log('AUTHZ TEST OK')

// ──────────────────────────────────────────
// 역할 × 능력 매트릭스 (6역할 + 폐기값 viewer)
// ──────────────────────────────────────────
{
  const { canProcess, canManageAccounts, canSeeDashboard, canSeeInternal, canSeeAllRequests } =
    await import('../src/authz.js')

  const mk = (role: string) => ({
    id: '00000000-0000-0000-0000-000000000000',
    email: 'x@baeoom.com',
    name: null,
    orgAffil: '공통',
    deptFunction: '교학팀',
    role,
  }) as any

  //                    process  accounts  dashboard  internal  allRequests
  const EXPECT: Record<string, [boolean, boolean, boolean, boolean, boolean]> = {
    staff:         [false, false, false, false, false],
    dept_monitor:  [false, false, false, false, false],
    org_monitor:   [false, false, false, false, false],
    system:        [true,  false, true,  true,  true ],
    exec:          [false, false, true,  false, true ],
    system_admin:  [true,  true,  true,  true,  true ],
    viewer:        [false, false, false, false, false], // 폐기값 → 최소 권한
  }

  for (const [role, [p, a, d, i, all]] of Object.entries(EXPECT)) {
    const u = mk(role)
    assert.equal(canProcess(u), p, `${role}.canProcess`)
    assert.equal(canManageAccounts(u), a, `${role}.canManageAccounts`)
    assert.equal(canSeeDashboard(u), d, `${role}.canSeeDashboard`)
    assert.equal(canSeeInternal(u), i, `${role}.canSeeInternal`)
    assert.equal(canSeeAllRequests(u), all, `${role}.canSeeAllRequests`)
  }
  console.log('역할 × 능력 매트릭스 35조합 OK')
}

// ──────────────────────────────────────────
// 모니터링 열람 범위
// ──────────────────────────────────────────
{
  const { visibilityFilter } = await import('../src/authz.js')

  // 테스트용 사용자 3인 — 배움·교학팀 / 배움·다른 직무 / 배론
  const [staffBaeumEdu] = await db.insert(users).values({
    email: `authz-baeum-edu-${randomBytes(4).toString('hex')}@baeoom.com`,
    name: '배움교학팀',
    orgAffil: '배움',
    deptFunction: '교학팀',
    role: 'staff',
  }).returning()
  const [staffBaeumOtherFn] = await db.insert(users).values({
    email: `authz-baeum-other-${randomBytes(4).toString('hex')}@baeoom.com`,
    name: '배움다른직무',
    orgAffil: '배움',
    deptFunction: '상담영업팀',
    role: 'staff',
  }).returning()
  const [staffBaeron] = await db.insert(users).values({
    email: `authz-baeron-${randomBytes(4).toString('hex')}@baeoom.com`,
    name: '배론직원',
    orgAffil: '배론',
    deptFunction: '교학팀',
    role: 'staff',
  }).returning()

  const staffBaeumEduId = staffBaeumEdu.id
  const staffBaeumOtherFnId = staffBaeumOtherFn.id
  const staffBaeronId = staffBaeron.id

  // 같은 기관(배움)·다른 직무 요청 1건, 다른 기관(배론) 요청 1건을 private으로 생성
  const [reqSameDept] = await db.insert(requests).values({
    org: '배움', typeCode: 'error', title: '같은부서', requesterId: staffBaeumEduId,
    visibility: 'private',
  }).returning()
  const [reqSameOrgOtherFn] = await db.insert(requests).values({
    org: '배움', typeCode: 'error', title: '같은기관다른직무', requesterId: staffBaeumOtherFnId,
    visibility: 'private',
  }).returning()
  const [reqOtherOrg] = await db.insert(requests).values({
    org: '배론', typeCode: 'error', title: '다른기관', requesterId: staffBaeronId,
    visibility: 'private',
  }).returning()

  const visibleTo = async (u: any) => {
    const rows = await db.execute<{ id: number }>(sql`
      select r.id from request_view r where ${visibilityFilter(u)}
    `)
    return new Set(rows.rows.map((x) => Number(x.id)))
  }

  // 실패 시에도 생성한 테스트 사용자·요청 행을 반드시 정리한다
  try {
    // 부서 모니터링(배움·교학팀): 같은 부서 건만
    // id는 실제 requester_id(uuid 컬럼)와 비교되므로 유효한 uuid 형식이어야 한다(존재하는 행일 필요는 없음).
    const dm = { id: randomUUID(), email: 'dm@baeoom.com', name: null, orgAffil: '배움', deptFunction: '교학팀', role: 'dept_monitor' } as any
    const dmSee = await visibleTo(dm)
    assert.ok(dmSee.has(reqSameDept.id), 'dept_monitor: 같은 부서 요청 보임')
    assert.ok(!dmSee.has(reqSameOrgOtherFn.id), 'dept_monitor: 같은 기관 다른 직무 요청 안 보임')
    assert.ok(!dmSee.has(reqOtherOrg.id), 'dept_monitor: 다른 기관 요청 안 보임')

    // 기관 모니터링(배움): 같은 기관 전부
    const om = { ...dm, role: 'org_monitor' } as any
    const omSee = await visibleTo(om)
    assert.ok(omSee.has(reqSameDept.id) && omSee.has(reqSameOrgOtherFn.id), 'org_monitor: 같은 기관 요청 보임')
    assert.ok(!omSee.has(reqOtherOrg.id), 'org_monitor: 다른 기관 요청 안 보임')

    // 소속 null인 모니터링 관리자: 추가 범위 없음
    const dmNull = { ...dm, orgAffil: null, deptFunction: null } as any
    const nullSee = await visibleTo(dmNull)
    assert.ok(!nullSee.has(reqSameDept.id), 'orgAffil null: 추가 범위 없음')

    // 비모니터(staff)는 모니터링 OR 분기의 수혜자가 아니다 — 같은 기관·다른 직무 private 요청은
    // visibilityFilter에 새 OR 분기가 추가되며 새면 기관 전체 유출로 이어지므로 반드시 부정 단언한다.
    const staffSee = await visibleTo(staffBaeumEdu)
    assert.ok(
      !staffSee.has(reqSameOrgOtherFn.id),
      'staff(배움·교학팀)는 같은 기관·다른 직무의 private 요청을 보면 안 됨 (모니터링 OR 분기 유출 방지)',
    )

    console.log('모니터링 열람 범위 OK')
  } finally {
    // 정리
    await db.delete(requests).where(inArray(requests.id, [reqSameDept.id, reqSameOrgOtherFn.id, reqOtherOrg.id]))
    await db.delete(users).where(inArray(users.id, [staffBaeumEduId, staffBaeumOtherFnId, staffBaeronId]))
  }
}

await pool.end()
console.log('\ntest:authz ALL PASSED')
