import assert from 'node:assert/strict'
import { canSeeRequest, isSystem, isViewerUp } from '../src/authz.js'
import type { CurrentUser } from '../src/types.js'

const staff: CurrentUser = { id: 'u-staff', email: 's@baeoom.com', name: 'S', orgAffil: '배움', deptFunction: '교학팀', role: 'staff' }
const other: CurrentUser = { id: 'u-other', email: 'o@baeoom.com', name: 'O', orgAffil: '배론', deptFunction: '상담영업팀', role: 'staff' }
const system: CurrentUser = { ...staff, id: 'u-sys', role: 'system' }

const base = { requesterId: 'u-x', requesterOrg: '배움', requesterFunction: '교학팀' }

// system 은 전부 조회
assert.equal(canSeeRequest(system, { ...base, visibility: 'private' }, []), true)
assert.ok(isSystem(system) && isViewerUp(system))
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
