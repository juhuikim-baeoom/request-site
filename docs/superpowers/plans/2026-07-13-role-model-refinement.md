# 역할 모델 정교화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 역할을 `staff`/`system`/`viewer` 3개에서 6개로 나누고, 권한을 열람범위·처리·관리 세 축으로 분리해 처리 담당자가 계정·역할을 관리하지 못하게 한다.

**Architecture:** DB `user_role` enum에 4개 값을 추가하고(마이그레이션 2개 — enum 값 추가와 데이터 이전을 분리), 서버 `authz.ts`를 역할 이름 검사(`isSystem`/`isViewerUp`)에서 능력 함수(`canProcess`·`canManageAccounts`·`canSeeDashboard`·`canSeeInternal`·`canSeeAllRequests`)로 바꾼다. 클라이언트는 같은 능력 규칙의 사본(`src/lib/permissions.ts`)으로 메뉴·화면을 게이팅하되, 실제 권한 경계는 서버가 강제한다.

**Tech Stack:** PostgreSQL(native enum) · Drizzle 마이그레이션 · Fastify / React 18 · TanStack Query. 테스트는 `tsx` 스크립트(`server/scripts/test-*.ts`).

## Global Constraints

- 스펙 SSOT: `docs/superpowers/specs/2026-07-13-role-model-refinement-design.md`
- 역할 내부값은 **영문 소문자 snake_case**: `staff` · `dept_monitor` · `org_monitor` · `system` · `exec` · `system_admin`. 기존 값(`staff`·`system`)의 의미를 바꾸지 않는다.
- **`viewer` enum 값을 삭제하지 않는다.** Postgres는 enum 값 제거를 지원하지 않고 이 프로젝트는 forward-only 마이그레이션 원칙을 따른다(CLAUDE.md §2). 코드에서 더 이상 부여하지 않는 것으로 폐기한다.
- **`ALTER TYPE ... ADD VALUE`로 추가한 enum 값은 같은 트랜잭션에서 사용할 수 없다.** Drizzle 마이그레이터는 파일마다 트랜잭션을 걸므로, enum 값 추가(0005)와 그 값을 쓰는 데이터 이전(0006)을 **반드시 다른 파일로** 나눈다.
- 마이그레이션 파일은 `server/drizzle/`에 두고 `server/drizzle/meta/_journal.json`에 등록해야 실행된다(등록 누락은 과거에 실제로 발생한 사고다 — `ecdf254` 참조).
- 권한 경계는 **서버가 강제**한다. 화면 숨김은 편의일 뿐이다. 클라이언트 게이팅을 추가했다고 서버 검사를 빼지 않는다.
- 알 수 없는/폐기된 역할(`viewer` 등)은 모든 능력 함수가 false를 반환해 최소 권한으로 동작해야 한다. 화이트리스트 방식으로 작성한다.
- 이미 적용된 마이그레이션 파일(0000~0004)은 편집 금지.
- 테스트 전제: `server/.env` 존재, Docker Postgres(`request-site-db`) 실행 중. `cd server && npm run test:*` 로 실행(전역 tsx 없음).
- 문서 동기화: 사용자 노출 변경이므로 `docs/reference/db-schema.md`·`docs/reference/requirements.md`·`CHANGELOG.md`를 Task 6에서 갱신한다(CLAUDE.md §1).

---

### Task 1: DB 역할 값 추가 · 데이터 이전 · 타입 확장

**Files:**
- Create: `server/drizzle/0005_role_model_add_values.sql`
- Create: `server/drizzle/0006_role_model_migrate_users.sql`
- Modify: `server/drizzle/meta/_journal.json` (0005·0006 등록)
- Modify: `server/src/db/schema.ts:7` (`userRole` enum)
- Modify: `server/src/types.ts:8` (`CurrentUser.role`)
- Modify: `src/types/supabase.ts:582` (`user_role` 유니언)
- Modify: `src/lib/constants.ts` (역할 한국어 라벨 맵 추가)

**Interfaces:**
- Produces: 타입 `UserRoleValue = 'staff' | 'dept_monitor' | 'org_monitor' | 'system' | 'exec' | 'system_admin' | 'viewer'` — 서버 `CurrentUser.role`과 클라이언트 `UserRole`이 같은 값 집합을 갖는다. `viewer`는 폐기값이지만 기존 행에 남아 있을 수 있어 타입에는 유지한다.
- Produces: `ROLE_LABEL: Record<string, string>` (`src/lib/constants.ts`) — Task 4·5의 화면이 쓴다.

- [ ] **Step 1: enum 값 추가 마이그레이션 작성**

`server/drizzle/0005_role_model_add_values.sql`:

```sql
-- 역할 모델 정교화: user_role enum에 4개 값 추가.
-- ALTER TYPE ... ADD VALUE 로 추가한 값은 같은 트랜잭션에서 사용할 수 없으므로,
-- 이 값을 쓰는 데이터 이전은 다음 마이그레이션(0006)에서 수행한다.
-- 기존 'viewer'는 제거하지 않는다 (Postgres 미지원 + forward-only 원칙).

alter type user_role add value if not exists 'dept_monitor';
alter type user_role add value if not exists 'org_monitor';
alter type user_role add value if not exists 'exec';
alter type user_role add value if not exists 'system_admin';
```

- [ ] **Step 2: 데이터 이전 마이그레이션 작성**

`server/drizzle/0006_role_model_migrate_users.sql`:

```sql
-- 역할 모델 정교화: 기존 사용자 이전.
--  ① viewer → exec (전체 열람 + 통계, 쓰기 없음 — 성격이 동일)
--  ② juhuikim@baeoom.com → system_admin (유일한 초기 관리자)
-- 나머지 system 사용자는 '시스템팀 담당자'로 그대로 둔다.
-- 이후 역할 변경은 계정 관리 화면에서 한다.

update users set role = 'exec' where role = 'viewer';
update org_directory set role = 'exec' where role = 'viewer';

update users set role = 'system_admin' where email = 'juhuikim@baeoom.com';
update org_directory set role = 'system_admin' where email = 'juhuikim@baeoom.com';
```

- [ ] **Step 3: journal에 등록**

`server/drizzle/meta/_journal.json`의 `entries` 배열 끝에 두 항목을 추가한다(기존 마지막 항목 `idx: 4` 뒤). `when` 값은 임의의 증가하는 epoch ms면 된다:

```json
    {
      "idx": 5,
      "version": "7",
      "when": 1783900000000,
      "tag": "0005_role_model_add_values",
      "breakpoints": true
    },
    {
      "idx": 6,
      "version": "7",
      "when": 1783900001000,
      "tag": "0006_role_model_migrate_users",
      "breakpoints": true
    }
```

- [ ] **Step 4: 마이그레이션 실행 및 결과 확인**

```bash
cd server && npm run db:migrate
```

Expected: `migrations applied`

이어서 실제 반영을 확인한다:

```bash
cd server && npx tsx -e "
import { db, pool } from './src/db/client.js'
import { sql } from 'drizzle-orm'
const vals = await db.execute(sql\`select unnest(enum_range(null::user_role))::text as v\`)
console.log('enum:', vals.rows.map(r => r.v).join(','))
const roles = await db.execute(sql\`select role, count(*)::int as n from users group by role order by role\`)
console.log('users:', roles.rows)
await pool.end()
"
```

Expected: enum에 `staff,system,viewer,dept_monitor,org_monitor,exec,system_admin`이 모두 있고, `users`에 `viewer`가 0건이며 `system_admin`이 1건(juhuikim)이다.

- [ ] **Step 5: 서버 타입 확장**

`server/src/db/schema.ts:7`:

```ts
export const userRole = pgEnum('user_role', [
  'staff',
  'system',
  'viewer', // 폐기 — 신규 부여 금지. 기존 행 호환을 위해 값만 유지한다.
  'dept_monitor',
  'org_monitor',
  'exec',
  'system_admin',
])
```

`server/src/types.ts` — `CurrentUser.role` 타입 교체:

```ts
export type UserRoleValue =
  | 'staff'
  | 'dept_monitor'
  | 'org_monitor'
  | 'system'
  | 'exec'
  | 'system_admin'
  | 'viewer' // 폐기값 — 최소 권한으로 동작한다

export interface CurrentUser {
  id: string
  email: string
  name: string | null
  orgAffil: string | null
  deptFunction: string | null
  role: UserRoleValue
}
```

- [ ] **Step 6: 클라이언트 타입·라벨 추가**

`src/types/supabase.ts:582`:

```ts
      user_role: 'staff' | 'system' | 'viewer' | 'dept_monitor' | 'org_monitor' | 'exec' | 'system_admin'
```

`src/lib/constants.ts` — 역할 한국어 라벨(화면 전반이 쓴다):

```ts
// 역할 한국어 라벨 — 계정 관리·상단 메뉴가 공유한다.
// 내부값은 서버 user_role enum과 동일해야 한다.
export const ROLE_LABEL: Record<string, string> = {
  staff: '요청자',
  dept_monitor: '부서 모니터링 관리자',
  org_monitor: '기관 모니터링 관리자',
  system: '시스템팀 담당자',
  exec: '경영진',
  system_admin: '시스템팀 관리자',
  viewer: '(폐기) 뷰어',
}

// 계정 관리 역할 select에 노출할 역할 (폐기값 viewer 제외)
export const ASSIGNABLE_ROLES = [
  'staff',
  'dept_monitor',
  'org_monitor',
  'system',
  'exec',
  'system_admin',
] as const
```

- [ ] **Step 7: 타입체크**

```bash
cd server && npm run typecheck
cd .. && npx tsc -p tsconfig.app.json --noEmit
```

Expected: 양쪽 다 오류 없음. (이 시점에는 `authz.ts`가 아직 옛 역할만 알지만, `viewer`가 타입에 남아 있으므로 컴파일은 통과한다.)

- [ ] **Step 8: 커밋**

```bash
git add server/drizzle server/src/db/schema.ts server/src/types.ts src/types/supabase.ts src/lib/constants.ts
git commit -m "feat(db): user_role에 4개 역할 추가 + 기존 사용자 이전

dept_monitor·org_monitor·exec·system_admin 추가. viewer→exec 이전,
juhuikim@baeoom.com만 system_admin으로 승격(나머지 system은 담당자 유지).
ALTER TYPE ADD VALUE는 같은 트랜잭션에서 사용 불가하므로 0005(값 추가)와
0006(데이터 이전)을 분리했다. viewer 값 자체는 forward-only 원칙상 남긴다."
```

---

### Task 2: 능력 기반 권한 판정 (authz 재구성)

**Files:**
- Modify: `server/src/authz.ts` (전면 — `isSystem`/`isViewerUp` 제거, 능력 함수 추가, `visibilityFilter` 범위 확장)
- Modify: `server/src/routes/requests.ts`, `server/src/routes/request-detail.ts`, `server/src/routes/users.ts`, `server/src/routes/dashboard.ts`, `server/src/routes/attachments.ts` (호출부 교체)
- Test: `server/scripts/test-authz.ts` (확장)

**Interfaces:**
- Consumes: Task 1의 `UserRoleValue`, `CurrentUser`
- Produces: `canProcess(u)` · `canManageAccounts(u)` · `canSeeDashboard(u)` · `canSeeInternal(u)` · `canSeeAllRequests(u)` — 전부 `(u: CurrentUser) => boolean`. Task 4의 클라이언트 사본이 같은 규칙을 따른다.
- Produces: `visibilityFilter(u): SQL` — 시그니처 불변. 내부 규칙만 확장.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/scripts/test-authz.ts` 하단(기존 케이스 뒤, `await app.close()` 앞)에 추가한다. 기존 파일의 import·헬퍼 관례를 먼저 읽고 따를 것:

```ts
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
```

- [ ] **Step 2: 테스트를 돌려 실패 확인**

```bash
cd server && npm run test:authz
```

Expected: FAIL — `canProcess is not a function` (아직 authz에 없다)

- [ ] **Step 3: 능력 함수 구현**

`server/src/authz.ts` — 파일 상단의 `isSystem`·`isViewerUp`을 다음으로 **교체**한다(두 함수는 제거):

```ts
import { sql, type SQL } from 'drizzle-orm'
import type { CurrentUser } from './types.js'

/**
 * 능력(capability) 기반 권한 판정.
 * 라우트는 역할 이름 대신 능력을 묻는다 — 역할이 늘어도 호출부를 고치지 않기 위함이다.
 * 모든 함수는 화이트리스트다: 알 수 없는/폐기된 역할(viewer 등)은 false → 최소 권한.
 */

/** 요청 처리 — 배정·상태 전이·영향도 조정·필드 편집·내부메모 작성 */
export function canProcess(u: CurrentUser): boolean {
  return u.role === 'system' || u.role === 'system_admin'
}

/** 계정·역할 관리 — /api/users, 조직도 import */
export function canManageAccounts(u: CurrentUser): boolean {
  return u.role === 'system_admin'
}

/** 통계 대시보드 열람 */
export function canSeeDashboard(u: CurrentUser): boolean {
  return u.role === 'system' || u.role === 'system_admin' || u.role === 'exec'
}

/** 내부메모 열람 — 시스템팀 전용. 경영진·모니터링 관리자에게도 감춘다. */
export function canSeeInternal(u: CurrentUser): boolean {
  return u.role === 'system' || u.role === 'system_admin'
}

/** 공개범위와 무관하게 전 요청 열람 */
export function canSeeAllRequests(u: CurrentUser): boolean {
  return u.role === 'system' || u.role === 'system_admin' || u.role === 'exec'
}

/** 부서 모니터링 관리자 — 자기 부서(기관+직무) 요청을 추가로 본다 */
function isDeptMonitor(u: CurrentUser): boolean {
  return u.role === 'dept_monitor'
}

/** 기관 모니터링 관리자 — 자기 기관 요청을 추가로 본다 */
function isOrgMonitor(u: CurrentUser): boolean {
  return u.role === 'org_monitor'
}
```

`canSeeComment`의 `isSystem(u)` 호출을 `canSeeInternal(u)`로 바꾼다(동작 동일, 의미 명확화).

`canSeeRequest`의 `isViewerUp(u)` 호출을 `canSeeAllRequests(u)`로 바꾸고, 모니터링 범위를 추가한다. 기존 반환문들 사이, `req.visibility === 'shared'` 검사 **앞**에 넣는다:

```ts
export function canSeeRequest(u: CurrentUser, req: ReqRef, shared: SharedRef[]): boolean {
  if (canSeeAllRequests(u)) return true
  if (req.requesterId && req.requesterId === u.id) return true

  // 모니터링 범위 — 본인 소속에서 도출. 소속이 null이면 추가 범위 없음.
  if (
    isOrgMonitor(u) && u.orgAffil != null &&
    req.requesterOrg != null && req.requesterOrg === u.orgAffil
  ) return true
  if (
    isDeptMonitor(u) && u.orgAffil != null && u.deptFunction != null &&
    req.requesterOrg != null && req.requesterFunction != null &&
    req.requesterOrg === u.orgAffil && req.requesterFunction === u.deptFunction
  ) return true

  if (req.visibility === 'shared') return true
  // …(이하 기존 공개범위 검사 그대로)
}
```

- [ ] **Step 4: `visibilityFilter` 범위 확장**

같은 파일의 `visibilityFilter`를 다음으로 바꾼다. `isViewerUp` → `canSeeAllRequests`로 교체하고, 모니터링 조건을 OR로 추가한다:

```ts
/**
 * 목록 조회용 WHERE 필터. `r` 별칭(requests 또는 request_view) 기준.
 * 전체 열람(system·system_admin·exec)은 true.
 * 모니터링 관리자는 본인 소속 범위를 추가로 본다. 소속이 null이면 추가 범위 없음.
 */
export function visibilityFilter(u: CurrentUser): SQL {
  if (canSeeAllRequests(u)) return sql`true`
  const uid = u.id
  const org = u.orgAffil
  const fn = u.deptFunction
  const deptTarget = org != null && fn != null ? `${org}|${fn}` : null

  // 모니터링 범위: 해당 역할이 아니거나 소속이 null이면 null 바인딩 → SQL에서 항상 거짓
  const orgMonitorOrg = isOrgMonitor(u) ? org : null
  const deptMonitorOrg = isDeptMonitor(u) && fn != null ? org : null
  const deptMonitorFn = isDeptMonitor(u) && org != null ? fn : null

  return sql`(
    r.requester_id = ${uid}
    or (r.requester_org is not null and r.requester_org::text = ${orgMonitorOrg})
    or (r.requester_org is not null and r.requester_function is not null
        and r.requester_org::text = ${deptMonitorOrg} and r.requester_function = ${deptMonitorFn})
    or r.visibility = 'shared'
    or (r.visibility = 'org' and r.requester_org is not null and r.requester_org::text = ${org})
    or (r.visibility = 'function' and r.requester_function is not null and r.requester_function = ${fn})
    or (r.visibility = 'dept' and r.requester_org is not null and r.requester_function is not null
        and r.requester_org::text = ${org} and r.requester_function = ${fn})
    or exists (
      select 1 from request_shared_targets st
      where st.request_id = r.id and (
        (st.target_type = 'function' and st.target_value = ${fn})
        or (st.target_type = 'dept' and st.target_value = ${deptTarget})
      )
    )
  )`
}
```

- [ ] **Step 5: 라우트 호출부 교체**

`isSystem`/`isViewerUp`을 쓰는 곳을 전부 능력 함수로 바꾼다. 정확한 위치는 다음으로 찾는다:

```bash
cd server && grep -rn "isSystem\|isViewerUp" src/
```

교체 규칙:

| 기존 | 새 함수 | 위치 |
|---|---|---|
| `isSystem(u)` — 배정·상태·영향도·필드 편집 | `canProcess(u)` | `routes/requests.ts` (`sys` 변수 포함), `routes/request-detail.ts`의 재작업·CSAT 등 |
| `isSystem(u)` — 내부메모 작성/열람 | `canSeeInternal(u)` | `routes/request-detail.ts:92,112` |
| `isSystem(u)` — `GET /api/users` (담당자 후보 목록) | `canProcess(u)` | `routes/users.ts:16` |
| `isSystem(u)` — `PATCH /api/users/:id`, 조직도 import | `canManageAccounts(u)` | `routes/users.ts:43,127` |
| `isViewerUp(u)` — 대시보드 | `canSeeDashboard(u)` | `routes/dashboard.ts:19` |
| `isViewerUp(u)` — 첨부 다운로드 전체 허용 | `canSeeAllRequests(u)` | `routes/attachments.ts:63` |

`routes/requests.ts`의 `const sys = isSystem(u)`는 `const sys = canProcess(u)`로 바꾼다. 이 변수는 상태 변경·필드 편집·담당자 변경 권한 판정에 쓰이므로 "처리 능력"이 맞다.

**중요 — `GET /api/users`는 관리자 전용으로 막지 말 것.** `src/features/requests/AdminPanel.tsx:40`의 담당자 select가 `useUsers()`(→ `GET /api/users`)로 담당자 후보 목록을 가져온다. 이 GET을 `canManageAccounts`로 막으면 담당자 배정이 깨진다. 따라서:

- `GET /api/users` → `canProcess` (담당자 후보 목록이 필요한 처리자에게 열어둔다)
- `PATCH /api/users/:id`, `POST /api/org-directory/import` → `canManageAccounts`

이 구분의 이유를 `routes/users.ts`의 GET 핸들러에 주석으로 남긴다: 목록 조회는 담당자 배정을 위해 처리자에게 필요하고, 역할·소속 **변경**만 관리자로 제한한다.

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd server && npm run test:authz
```

Expected: PASS — `역할 × 능력 매트릭스 35조합 OK`

- [ ] **Step 7: 열람 범위 회귀 테스트 추가**

`server/scripts/test-authz.ts`에 이어서 추가한다. 실제 DB에 사용자·요청을 만들어 `visibilityFilter`가 적용된 목록 조회로 검증한다. 기존 파일의 사용자/요청 생성 헬퍼를 재사용하되, 없으면 `server/scripts/test-notifications.ts`의 관례를 따른다:

```ts
// ──────────────────────────────────────────
// 모니터링 열람 범위
// ──────────────────────────────────────────
{
  const { visibilityFilter } = await import('../src/authz.js')
  const { db } = await import('../src/db/client.js')
  const { sql } = await import('drizzle-orm')

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

  // 부서 모니터링(배움·교학팀): 같은 부서 건만
  const dm = { id: 'x', email: 'dm@baeoom.com', name: null, orgAffil: '배움', deptFunction: '교학팀', role: 'dept_monitor' } as any
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

  console.log('모니터링 열람 범위 OK')
  await db.delete(requests).where(inArray(requests.id, [reqSameDept.id, reqSameOrgOtherFn.id, reqOtherOrg.id]))
}
```

위 코드의 `staffBaeumEduId`(배움·교학팀) · `staffBaeumOtherFnId`(배움·다른 직무) · `staffBaeronId`(배론)는 이 블록 앞에서 `users`에 insert해 만들고, 블록 끝에서 정리한다. `inArray`는 `drizzle-orm`에서 import한다.

- [ ] **Step 8: 전체 서버 테스트**

```bash
cd server && npm run typecheck && npm run test:authz && npm run test:api && npm run test:dashboard && npm run test:comment-internal && npm run test:attach-authz && npm run db:smoke
```

Expected: 전부 PASS. `isSystem`/`isViewerUp` 제거로 인한 회귀가 없어야 한다.

- [ ] **Step 9: 커밋**

```bash
git add server/src/authz.ts server/src/routes server/scripts/test-authz.ts
git commit -m "feat(server): 능력 기반 권한 판정 — isSystem/isViewerUp 제거

canProcess·canManageAccounts·canSeeDashboard·canSeeInternal·canSeeAllRequests로
분리. 처리 담당자(system)가 계정·역할을 관리하지 못하도록 users 라우트를
canManageAccounts로 격상. 모니터링 관리자의 부서·기관 열람 범위를
visibilityFilter에 추가(소속 null이면 추가 범위 없음).

테스트: 역할 × 능력 35조합 + 모니터링 열람 범위."
```

---

### Task 3: 권한 경계 회귀 테스트 (API 레벨)

능력 함수 단위 테스트만으로는 "실제 엔드포인트가 정말 막히는가"를 보장하지 못한다. 이번 변경의 핵심 회귀(담당자가 계정 관리 불가)를 HTTP 레벨에서 잡는다.

**Files:**
- Create: `server/scripts/test-role-boundaries.ts`
- Modify: `server/package.json` (`test:roles` 스크립트 추가)

**Interfaces:**
- Consumes: Task 2의 능력 함수가 적용된 라우트
- Produces: 없음 (테스트만)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/scripts/test-role-boundaries.ts`. 기존 `server/scripts/test-api-hardening.ts`의 `app.inject()` 관례를 먼저 읽고 따를 것(로그인 쿠키 획득 방식 포함):

```ts
/**
 * 역할별 API 권한 경계 테스트 (HTTP 레벨)
 * - 담당자(system)는 계정·역할 관리 불가 ← 이번 변경의 핵심
 * - 경영진(exec)·모니터링 관리자는 처리 API 불가
 * - staff·모니터링 관리자는 대시보드 불가
 */
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'

const app = await buildApp()

/** 주어진 역할의 사용자를 만들고 dev-login 쿠키를 얻는다 */
async function loginAs(role: string, email: string) {
  await db.insert(users).values({
    email, name: `${role} 테스트`, role: role as any,
    orgAffil: '배움', deptFunction: '교학팀',
  }).onConflictDoUpdate({ target: users.email, set: { role: role as any } })

  const res = await app.inject({
    method: 'POST', url: '/api/auth/dev-login',
    payload: { email },
  })
  assert.equal(res.statusCode, 200, `${role} dev-login`)
  return res.headers['set-cookie'] as string
}

const cases: Array<{ role: string; email: string }> = [
  { role: 'system', email: 'role-system@baeoom.com' },
  { role: 'exec', email: 'role-exec@baeoom.com' },
  { role: 'dept_monitor', email: 'role-dm@baeoom.com' },
  { role: 'staff', email: 'role-staff@baeoom.com' },
]
const cookie: Record<string, string> = {}
for (const c of cases) cookie[c.role] = await loginAs(c.role, c.email)

const call = (role: string, method: any, url: string, payload?: any) =>
  app.inject({ method, url, payload, headers: { cookie: cookie[role] } })

// ① 계정·역할 관리 — system_admin만
{
  const someUser = await db.query.users.findFirst({ where: eq(users.email, 'role-staff@baeoom.com') })
  const r = await call('system', 'PATCH', `/api/users/${someUser!.id}`, { role: 'system_admin' })
  assert.equal(r.statusCode, 403, '담당자(system)는 역할 변경 불가')
  console.log('(1) 담당자는 계정·역할 관리 불가 OK')
}

// ② 처리 API — exec·모니터링 관리자는 불가
{
  const r1 = await call('exec', 'POST', '/api/requests/1/assign', { assigneeId: 'x', impact: '보통' })
  assert.equal(r1.statusCode, 403, 'exec는 배정 불가')
  const r2 = await call('dept_monitor', 'PATCH', '/api/requests/1', { status: '진행중' })
  assert.equal(r2.statusCode, 403, 'dept_monitor는 상태 변경 불가')
  console.log('(2) 경영진·모니터링 관리자는 처리 불가 OK')
}

// ③ 대시보드 — staff·모니터링 관리자는 불가, exec는 가능
{
  const r1 = await call('staff', 'GET', '/api/dashboard/metrics')
  assert.equal(r1.statusCode, 403, 'staff는 대시보드 불가')
  const r2 = await call('dept_monitor', 'GET', '/api/dashboard/metrics')
  assert.equal(r2.statusCode, 403, 'dept_monitor는 대시보드 불가')
  const r3 = await call('exec', 'GET', '/api/dashboard/metrics')
  assert.equal(r3.statusCode, 200, 'exec는 대시보드 가능')
  console.log('(3) 대시보드 접근 경계 OK')
}

// 정리
for (const c of cases) await db.delete(users).where(eq(users.email, c.email))
await app.close()
await pool.end()
console.log('\ntest:roles ALL PASSED')
```

`server/package.json`의 `scripts`에 추가:

```json
    "test:roles": "tsx scripts/test-role-boundaries.ts",
```

- [ ] **Step 2: 테스트 실행**

```bash
cd server && npm run test:roles
```

Expected: PASS — `(1) 담당자는 계정·역할 관리 불가 OK` / `(2) …` / `(3) …` / `test:roles ALL PASSED`

**만약 ①이 실패(403이 아니라 200)한다면** Task 2의 `routes/users.ts` 교체가 빠진 것이다. `canManageAccounts`로 막혀 있는지 확인하고 고친 뒤 다시 돌린다.

`assign`/`PATCH` 호출이 404를 반환하면(요청 id 1이 없어서) 권한 검사가 id 검증보다 뒤에 있다는 뜻이다. 그 경우 **권한 검사를 id 파싱보다 앞으로** 옮기거나(권장 — 존재 여부를 권한 없는 사용자에게 흘리지 않는다), 테스트가 실제 존재하는 요청 id를 만들어 쓰도록 고친다. 어느 쪽을 택했는지 보고서에 남긴다.

- [ ] **Step 3: 커밋**

```bash
git add server/scripts/test-role-boundaries.ts server/package.json
git commit -m "test(server): 역할별 API 권한 경계 회귀 테스트

담당자(system)의 계정·역할 관리 차단, 경영진·모니터링 관리자의 처리 API 차단,
대시보드 접근 경계를 HTTP 레벨에서 검증한다."
```

---

### Task 4: 클라이언트 권한 헬퍼 · 메뉴 · 계정 관리

**Files:**
- Create: `src/lib/permissions.ts`
- Modify: `src/components/TopNav.tsx:9-17` (메뉴 roles)
- Modify: `src/features/accounts/Accounts.tsx` (관리자 전용 + 역할 select 6개)
- Modify: `src/routes.tsx` (계정 관리 라우트 가드 — 기존 가드 방식이 있으면 그것을 따른다)

**Interfaces:**
- Consumes: Task 1의 `ROLE_LABEL`·`ASSIGNABLE_ROLES`(`src/lib/constants.ts`), Task 2의 서버 능력 규칙
- Produces: `src/lib/permissions.ts` — `canProcess(role)` · `canManageAccounts(role)` · `canSeeDashboard(role)` · `canSeeInternal(role)` · `canSeeAllRequests(role)`. 인자는 **역할 문자열**(`UserRole | null | undefined`)이며, Task 5의 화면이 쓴다.

- [ ] **Step 1: 클라이언트 권한 헬퍼 작성**

`src/lib/permissions.ts`:

```ts
import type { UserRole } from '../types/database'

/**
 * 클라이언트 권한 헬퍼 — 서버 server/src/authz.ts의 능력 함수와 동일한 규칙이어야 한다.
 * 화면 노출을 정리하기 위한 편의일 뿐, 권한 경계는 서버가 강제한다.
 * 알 수 없는/폐기된 역할(viewer 등)은 전부 false → 최소 권한.
 */
type Role = UserRole | null | undefined

/** 요청 처리 — 배정·상태 전이·영향도·필드 편집·내부메모 */
export function canProcess(role: Role): boolean {
  return role === 'system' || role === 'system_admin'
}

/** 계정·역할 관리 */
export function canManageAccounts(role: Role): boolean {
  return role === 'system_admin'
}

/** 통계 대시보드 */
export function canSeeDashboard(role: Role): boolean {
  return role === 'system' || role === 'system_admin' || role === 'exec'
}

/** 내부메모 열람·작성 */
export function canSeeInternal(role: Role): boolean {
  return role === 'system' || role === 'system_admin'
}

/** 전 요청 열람 */
export function canSeeAllRequests(role: Role): boolean {
  return role === 'system' || role === 'system_admin' || role === 'exec'
}
```

- [ ] **Step 2: 상단 메뉴 갱신**

`src/components/TopNav.tsx` — 메뉴의 `roles` 배열을 새 역할로 바꾼다. 기존 파일은 `roles: UserRole[]` 형태의 배열을 쓰므로 그 구조를 유지한다:

```tsx
const MENUS: MenuItem[] = [
  { to: '/requests/new', label: '요청 접수', roles: ['staff', 'dept_monitor', 'org_monitor', 'system', 'exec', 'system_admin'] },
  { to: '/requests/mine', label: '내 요청', roles: ['staff', 'dept_monitor', 'org_monitor', 'system', 'exec', 'system_admin'] },
  { to: '/board', label: '관리 보드', roles: ['system', 'system_admin'] },
  { to: '/dashboard', label: '통계', roles: ['system', 'system_admin', 'exec'] },
  { to: '/accounts', label: '계정 관리', roles: ['system_admin'] },
]
```

역할 뱃지 라벨(현재 `system: '시스템팀'` 같은 맵)은 `src/lib/constants.ts`의 `ROLE_LABEL`을 import해 쓰도록 바꾼다. 라벨 정의가 두 벌이 되면 안 된다.

- [ ] **Step 3: 계정 관리 화면 갱신**

`src/features/accounts/Accounts.tsx`:

1. 화면 진입 가드 — `canManageAccounts(profile?.role)`가 거짓이면 목록을 부르지 말고 안내를 띄운다:

```tsx
  if (!canManageAccounts(profile?.role)) {
    return (
      <div className="p-8 text-center text-gray-500" role="status">
        계정 관리 권한이 없습니다.
      </div>
    )
  }
```

2. 역할 select의 옵션을 `ASSIGNABLE_ROLES` + `ROLE_LABEL`로 렌더한다(폐기값 `viewer`는 목록에 없다). 기존에 하드코딩된 역할 옵션이 있으면 제거한다:

```tsx
  <select
    aria-label="역할"
    value={editRole}
    onChange={(e) => setEditRole(e.target.value as UserRole)}
    className={fieldCls}
  >
    {ASSIGNABLE_ROLES.map((r) => (
      <option key={r} value={r}>
        {ROLE_LABEL[r]}
      </option>
    ))}
  </select>
```

3. 목록 표의 역할 표시도 `ROLE_LABEL[u.role] ?? u.role`로 바꾼다. 기존 행에 `viewer`가 남아 있으면 "(폐기) 뷰어"로 보인다.

- [ ] **Step 4: 타입체크**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/permissions.ts src/components/TopNav.tsx src/features/accounts/Accounts.tsx src/routes.tsx
git commit -m "feat(web): 클라이언트 권한 헬퍼 + 메뉴·계정 관리 역할 게이팅

permissions.ts에 서버 authz와 동일한 능력 규칙 사본을 세우고, 상단 메뉴와
계정 관리 화면을 새 역할로 게이팅. 계정 관리는 system_admin 전용이며 역할
select에 6개 역할을 한국어 라벨로 노출한다."
```

---

### Task 5: 목록 탭 라벨 · 요청 상세 게이팅

**Files:**
- Modify: `src/features/requests/MyRequests.tsx:176` (두 번째 탭 라벨)
- Modify: `src/features/requests/RequestDetail.tsx` (AdminPanel·내부메모 폼 게이팅)
- Modify: `src/features/requests/CommentComposer.tsx` (내부메모 폼 노출 조건)

**Interfaces:**
- Consumes: Task 4의 `src/lib/permissions.ts`

- [ ] **Step 1: 목록 탭 라벨을 역할에 맞게**

`src/features/requests/MyRequests.tsx` — 두 번째 탭은 서버 `visibilityFilter`가 돌려주는 "내가 볼 수 있으나 내가 낸 건 아닌 요청"이다. 역할별로 의미가 달라지므로 라벨만 바꾼다(목록 로직·쿼리는 그대로):

```tsx
  // 두 번째 탭의 의미는 역할에 따라 달라진다 — 서버 visibilityFilter가 범위를 정한다.
  const othersLabel = canSeeAllRequests(profile?.role)
    ? '전체 요청'
    : profile?.role === 'org_monitor'
      ? '우리 기관 요청'
      : profile?.role === 'dept_monitor'
        ? '우리 부서 요청'
        : '부서·공유 요청'
```

그리고 렌더부의 `{tabBtn('others', '부서·공유 요청')}`를 `{tabBtn('others', othersLabel)}`로 바꾼다. `profile`은 `useAuth()`에서 가져온다(이 파일에 이미 있으면 재사용).

- [ ] **Step 2: 요청 상세 게이팅을 능력 기준으로**

`src/features/requests/RequestDetail.tsx` — 현재 `isSystemUser`(= `profile?.role === 'system'`)로 관리 패널·재작업·내부메모를 게이팅한다. 이 변수를 능력 기준으로 바꾼다:

```tsx
import { canProcess, canSeeInternal } from '../../lib/permissions'

  // 처리 능력(배정·상태·영향도·필드 편집·재작업)과 내부메모 열람을 분리해서 판정한다.
  const canProcessRequest = canProcess(profile?.role)
  const canViewInternal = canSeeInternal(profile?.role)
```

기존 `isSystemUser` 사용처를 다음 규칙으로 교체한다:

| 용도 | 새 변수 |
|---|---|
| 관리 패널(`<AdminPanel>`) 렌더 | `canProcessRequest` |
| 필드 편집 권한(`canEdit`) | `canProcessRequest` |
| 재작업 버튼(`canRework`) | `canProcessRequest` |
| 내부메모 열람·작성 | `canViewInternal` |

`canEdit`은 다음 형태가 된다(요청자 본인의 접수 상태 편집은 그대로 유지):

```tsx
  const canEdit = canProcessRequest || (v.requester_id === profile?.id && v.status === '접수')
```

- [ ] **Step 3: 내부메모 작성 폼 노출 조건**

`src/features/requests/CommentComposer.tsx` — 내부 메모 폼은 시스템팀에게만 보인다. 현재 `role === 'system'` 같은 조건이 있으면 `canSeeInternal(profile?.role)`로 바꾼다. 공개 코멘트 폼은 모든 역할에게 보인다(경영진·모니터링 관리자도 코멘트는 달 수 있다).

- [ ] **Step 4: 타입체크**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 오류 없음.

- [ ] **Step 5: 브라우저 확인 (구현자는 코드 근거로 대체)**

브라우저 접근이 불가하면 다음을 코드로 짚어 보고서에 적는다:
- `exec`·`dept_monitor`에게 `<AdminPanel>`이 렌더되지 않는 근거
- `exec`·`dept_monitor`에게 내부메모 작성 폼이 렌더되지 않는 근거
- `dept_monitor`의 두 번째 탭 라벨이 "우리 부서 요청"이 되는 근거

- [ ] **Step 6: 커밋**

```bash
git add src/features/requests/MyRequests.tsx src/features/requests/RequestDetail.tsx src/features/requests/CommentComposer.tsx
git commit -m "feat(web): 목록 탭 라벨·상세 게이팅을 능력 기준으로 전환

내 요청의 두 번째 탭 라벨을 역할에 맞게(우리 부서/우리 기관/전체) 표기.
요청 상세의 관리 패널·필드 편집·재작업은 canProcess, 내부메모는 canSeeInternal로
게이팅해 경영진·모니터링 관리자에게 처리 UI와 내부메모가 노출되지 않게 한다."
```

---

### Task 6: 문서 동기화

**Files:**
- Modify: `docs/reference/db-schema.md` (`user_role` enum · 역할별 권한)
- Modify: `docs/reference/requirements.md` (역할·권한 매트릭스 · 화면 노출 · 목록 탭)
- Modify: `CHANGELOG.md` (`Unreleased`)

- [ ] **Step 1: `db-schema.md` 갱신**

`user_role` enum 값을 7개로 갱신하고(폐기값 `viewer` 포함), 역할별 의미를 표로 적는다. `viewer`는 "폐기 — 신규 부여 금지, 기존 행 호환용"이라고 명시한다. 마이그레이션 `0005`·`0006`을 마이그레이션 목록에 추가한다. frontmatter의 `last_updated`를 `2026-07-13`으로.

- [ ] **Step 2: `requirements.md` 갱신**

스펙의 권한 매트릭스(§2)와 열람 범위 규칙(§3)을 그대로 옮긴다. 화면 노출(§6)도 반영한다 — 계정 관리는 `system_admin` 전용, 통계는 시스템팀·경영진, 관리 보드는 시스템팀. "내 요청"의 두 번째 탭 라벨이 역할에 따라 달라진다는 점도 적는다. frontmatter의 `last_updated`를 `2026-07-13`으로.

- [ ] **Step 3: `CHANGELOG.md`의 `Unreleased`에 추가**

```markdown
### Changed
- **역할 모델 정교화 — 3역할 → 6역할** (`server/src/authz.ts`, `server/drizzle/0005_*.sql`, `0006_*.sql`, `src/lib/permissions.ts`): `staff`·`system`·`viewer`를 요청자(`staff`)·부서 모니터링 관리자(`dept_monitor`)·기관 모니터링 관리자(`org_monitor`)·시스템팀 담당자(`system`)·경영진(`exec`)·시스템팀 관리자(`system_admin`)로 분리.
  - 권한을 열람범위·처리·관리 세 축으로 나누고, 라우트가 역할 이름 대신 능력(`canProcess`·`canManageAccounts`·`canSeeDashboard`·`canSeeInternal`·`canSeeAllRequests`)을 묻도록 `authz.ts` 재구성. `isSystem`·`isViewerUp` 제거.
  - **처리 담당자(`system`)는 더 이상 계정·역할을 관리할 수 없다**(`system_admin` 전용). 이전에는 `system`이면 누구나 남의 역할을 바꿀 수 있었다.
  - 모니터링 관리자는 본인 소속에서 도출한 범위(부서 = 기관+직무 / 기관)의 요청을 추가로 열람한다. 소속이 null이면 추가 범위가 없다. 쓰기는 공개 코멘트만 가능하고, 내부 메모는 시스템팀에게만 보인다.
  - 이전: 기존 `viewer` 사용자는 `exec`로, `juhuikim@baeoom.com`은 `system_admin`으로 승격. 나머지 `system` 사용자는 담당자로 유지. `viewer` enum 값 자체는 forward-only 원칙상 남기되 신규 부여하지 않는다.
  - 화면: 계정 관리는 `system_admin` 전용(역할 select에 6개 역할 노출), 통계는 시스템팀·경영진, 관리 보드는 시스템팀. "내 요청"의 두 번째 탭 라벨이 역할에 따라 우리 부서 / 우리 기관 / 전체 요청으로 바뀐다.
  - 테스트: `test:authz`(역할 × 능력 35조합 + 모니터링 열람 범위), `test:roles`(API 레벨 권한 경계) 신설.
```

- [ ] **Step 4: 전체 검증**

```bash
cd server && npm run typecheck && npm run test:authz && npm run test:roles && npm run test:api && npm run test:dashboard && npm run db:smoke
cd .. && npx tsc -p tsconfig.app.json --noEmit
```

Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add docs/reference/db-schema.md docs/reference/requirements.md CHANGELOG.md
git commit -m "docs: 역할 모델 정교화 문서 동기화"
```

---

## 검증 요약

| 대상 | 명령 | 기대 |
|---|---|---|
| 능력 매트릭스 | `cd server && npm run test:authz` | 35조합 + 모니터링 범위 PASS |
| API 권한 경계 | `cd server && npm run test:roles` | 3케이스 PASS (담당자 계정관리 차단 포함) |
| 기존 회귀 | `cd server && npm run test:api && npm run test:dashboard && npm run test:comment-internal && npm run test:attach-authz && npm run db:smoke` | 전부 PASS |
| 서버 타입 | `cd server && npm run typecheck` | 오류 없음 |
| 웹 타입 | `npx tsc -p tsconfig.app.json --noEmit` | 오류 없음 |
| 마이그레이션 | `cd server && npm run db:migrate` | `migrations applied`, users에 viewer 0건 · system_admin 1건 |
