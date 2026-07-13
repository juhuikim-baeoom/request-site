# 공유 설정 사후 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 접수 후에도 요청의 공개범위와 공유 대상(직무·부서)을 바꿀 수 있게 한다 — 처리 중 다른 부서·기관이 봐야 한다는 사실이 드러났을 때 대응할 수 있어야 한다.

**Architecture:** 공유 설정 변경을 본문 편집에서 분리한다. 권한은 `canChangeSharing`(시스템팀 또는 요청자 본인, 상태 무관)이고, 전용 엔드포인트 `PUT /api/requests/:id/sharing`이 공개범위와 공유 대상을 한 번에 전체 교체한다. 변경 이력은 새 테이블 `request_sharing_history`에 남겨 요청 상세 타임라인에 노출한다. `visibility`는 기존 PATCH 경로에서 제거해 우회로를 없앤다.

**Tech Stack:** Fastify · Drizzle · PostgreSQL / React 18 · TanStack Query · Tailwind. 테스트는 `tsx` 스크립트(`server/scripts/test-*.ts`).

## Global Constraints

- 스펙 SSOT: `docs/superpowers/specs/2026-07-13-sharing-edit-design.md`
- 코드값은 레거시 한글 유지(상태·기관·긴급도). 공개범위 값은 영문 소문자 `private`·`dept`·`function`·`org`·`shared`(현행 유지). 역할 내부값은 영문 snake_case.
- 권한 경계는 **서버가 강제**한다. 클라이언트 게이팅은 편의일 뿐이다.
- 능력 함수는 화이트리스트다. 알 수 없는/폐기된 역할(`viewer`)은 모든 능력 false.
- 서버 `server/src/authz.ts`가 권한 판정의 SSOT이고 `src/lib/permissions.ts`는 그 사본이다. 두 곳이 항상 같아야 한다.
- 상태 변경(`status`)과 필드 편집을 한 PATCH에 섞으면 서버가 400으로 거부한다. 이 규칙을 우회하지 않는다.
- 마이그레이션은 forward-only. 이미 적용된 파일(0000~0006)은 편집 금지. 새 파일은 `server/drizzle/`에 만들고 `server/drizzle/meta/_journal.json`에 등록해야 실행된다(등록 누락은 과거 실제 사고 — 커밋 `ecdf254`).
- **`ALTER TYPE ... ADD VALUE`로 추가한 enum 값은 같은 트랜잭션에서 쓸 수 없다.** 이번 작업은 enum을 건드리지 않으므로 해당 없음.
- 신규 테이블은 `docs/standards/02-table-column-standards.md`를 따른다(감사 컬럼 필수).
- 접근성: 색만으로 정보 전달 금지, select·버튼·체크박스에 라벨/aria-label, 오류는 `role="alert"`.
- 상수는 `src/lib/constants.ts`가 단일 소스(`FUNCTION_TARGETS`·`VISIBILITY_OPTIONS`·`deptTargetValue`). 새로 정의하지 않는다.
- 테스트 전제: `server/.env` 존재, Docker Postgres(`request-site-db`) 실행 중. `cd server && npm run test:*`로 실행(전역 tsx 없음). 테스트 이메일은 `@baeoom.com`/`@baeron.com`만 허용되며 랜덤 접미사(`randomBytes(4)`)와 `try/finally` 정리를 쓴다.
- 문서 동기화: 사용자 노출 변경이므로 `docs/reference/db-schema.md`·`docs/reference/requirements.md`·`CHANGELOG.md`를 Task 5에서 갱신한다(CLAUDE.md §1).

---

### Task 1: 공유 변경 이력 테이블

**Files:**
- Create: `server/drizzle/0007_request_sharing_history.sql`
- Modify: `server/drizzle/meta/_journal.json`
- Modify: `server/src/db/schema.ts` (테이블 정의 추가)

**Interfaces:**
- Produces: `request_sharing_history` 테이블 — Task 2의 `changeSharing` 서비스가 INSERT하고, Task 4의 타임라인이 조회한다.
- Produces: Drizzle 정의 `requestSharingHistory` (`server/src/db/schema.ts`)

- [ ] **Step 1: 마이그레이션 작성**

`server/drizzle/0007_request_sharing_history.sql`:

```sql
-- 공유 설정 변경 이력.
-- 공유 변경은 열람 권한의 변경이므로 "누가 언제 무엇을 열었는가"를 추적할 수 있어야 한다.
-- request_status_history는 상태 전이 전용이라 재사용하지 않는다.
-- changed_at 이름은 request_status_history의 기존 관례를 따른다.

create table if not exists request_sharing_history (
  id              bigint generated always as identity primary key,
  request_id      bigint not null references requests(id) on delete cascade,
  changed_by      uuid references users(id),
  changed_at      timestamptz not null default now(),
  from_visibility text,
  to_visibility   text,
  added           jsonb not null default '[]'::jsonb,
  removed         jsonb not null default '[]'::jsonb
);

create index if not exists idx_sharing_history_request on request_sharing_history(request_id);
```

- [ ] **Step 2: journal에 등록**

`server/drizzle/meta/_journal.json`의 `entries` 배열 끝(기존 마지막 항목 `idx: 6` 뒤)에 추가한다:

```json
    {
      "idx": 7,
      "version": "7",
      "when": 1784000000030,
      "tag": "0007_request_sharing_history",
      "breakpoints": true
    }
```

- [ ] **Step 3: Drizzle 스키마 정의 추가**

`server/src/db/schema.ts` — 기존 `requestSharedTargets` 정의 아래에 추가한다. import에 `jsonb`가 없으면 추가한다:

```ts
export const requestSharingHistory = pgTable('request_sharing_history', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  requestId: bigint('request_id', { mode: 'number' })
    .notNull()
    .references(() => requests.id, { onDelete: 'cascade' }),
  changedBy: uuid('changed_by').references(() => users.id),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  fromVisibility: text('from_visibility'),
  toVisibility: text('to_visibility'),
  added: jsonb('added').notNull().default(sql`'[]'::jsonb`),
  removed: jsonb('removed').notNull().default(sql`'[]'::jsonb`),
}, (t) => ({
  requestIdx: index('idx_sharing_history_request').on(t.requestId),
}))
```

- [ ] **Step 4: 마이그레이션 실행 및 확인**

```bash
cd server && npm run db:migrate
```

Expected: `migrations applied`

테이블이 실제로 생겼는지 확인한다:

```bash
docker exec request-site-db psql -U request -d request_site -c "\d request_sharing_history"
```

Expected: 컬럼 8개(`id`·`request_id`·`changed_by`·`changed_at`·`from_visibility`·`to_visibility`·`added`·`removed`)와 인덱스 `idx_sharing_history_request`가 보인다.

- [ ] **Step 5: 타입체크 + 커밋**

```bash
cd server && npm run typecheck
```

Expected: 오류 없음.

```bash
git add server/drizzle server/src/db/schema.ts
git commit -m "feat(db): 공유 변경 이력 테이블 request_sharing_history

공유 설정 변경은 열람 권한 변경이므로 누가 언제 무엇을 열었는지 추적 가능해야 한다.
added/removed는 서버가 기존 목록과 비교해 계산하며 클라이언트 값을 믿지 않는다.

docs sync: 스킵(Task 5에서 일괄 처리)"
```

---

### Task 2: 권한 판정 + 공유 변경 서비스 + API

**Files:**
- Modify: `server/src/authz.ts` (`canChangeSharing` 추가)
- Create: `server/src/services/sharing.ts`
- Modify: `server/src/routes/requests.ts` (신규 라우트 추가, 기존 PATCH에서 `visibility` 제거)
- Create: `server/scripts/test-sharing.ts`
- Modify: `server/package.json` (`test:sharing` 스크립트)

**Interfaces:**
- Consumes: Task 1의 `request_sharing_history` 테이블
- Produces: `canChangeSharing(u: CurrentUser, requesterId: string | null): boolean` (`server/src/authz.ts`) — Task 3의 클라이언트 사본이 같은 규칙을 따른다.
- Produces: `changeSharing({ reqId, visibility, targets, actorId }): Promise<void>` 및 `class SharingError { code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID' }` (`server/src/services/sharing.ts`)
- Produces: `PUT /api/requests/:id/sharing` — body `{ visibility, shared_targets: Array<{target_type, target_value}> }`, 성공 시 200 `{ ok: true }`. Task 3의 `useChangeSharing`이 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/scripts/test-sharing.ts`. 기존 `server/scripts/test-role-boundaries.ts`의 관례(세션 직접 insert 로그인, `randomBytes(4)` 이메일, `try/finally` 정리)를 먼저 읽고 그대로 따를 것:

```ts
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
import { users, requests } from '../src/db/schema.js'
import { eq, inArray, sql } from 'drizzle-orm'

const app = await buildApp()
const suffix = randomBytes(4).toString('hex')
const created: { userIds: string[]; reqIds: number[] } = { userIds: [], reqIds: [] }

/** 사용자 생성 + 세션 쿠키 획득. test-role-boundaries.ts의 헬퍼와 같은 방식 */
async function mkUser(role: string, orgAffil: string, deptFunction: string | null) {
  const email = `sharing-${role}-${suffix}@baeoom.com`
  const [u] = await db.insert(users).values({
    email, name: `${role} 테스트`, role: role as any,
    orgAffil: orgAffil as any, deptFunction,
  }).returning()
  created.userIds.push(u.id)
  return u
}

try {
  const owner = await mkUser('staff', '배움', '교학팀')          // 요청자
  const outsider = await mkUser('staff', '배론', '상담영업팀')   // 무관한 직원
  const sysUser = await mkUser('system', '공통', '시스템팀')     // 시스템팀 담당자

  const cookie = (u: { id: string }) => sessionCookieFor(u.id)   // ← 아래 Step에서 관례대로 구현

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
      headers: { cookie: cookie(outsider) },
      payload: { visibility: 'private', shared_targets: [{ target_type: 'dept', target_value: '배론|상담영업팀' }] },
    })
    assert.equal(res.statusCode, 403, '무관한 staff는 403')
    console.log('(1) 무관한 staff 403 OK')
  }

  // ── (2) 요청자 본인이 공유 대상을 추가한다 → 그 부서 사용자에게 실제로 보인다
  {
    const before = await app.inject({
      method: 'GET', url: '/api/requests', headers: { cookie: cookie(outsider) },
    })
    const beforeIds = (before.json() as any[]).map((r) => Number(r.id))
    assert.ok(!beforeIds.includes(req.id), '공유 전에는 outsider에게 안 보인다')

    const res = await app.inject({
      method: 'PUT', url: `/api/requests/${req.id}/sharing`,
      headers: { cookie: cookie(owner) },
      payload: { visibility: 'private', shared_targets: [{ target_type: 'dept', target_value: '배론|상담영업팀' }] },
    })
    assert.equal(res.statusCode, 200, '요청자 본인은 200')

    const after = await app.inject({
      method: 'GET', url: '/api/requests', headers: { cookie: cookie(outsider) },
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

  // ── (4) 전체 교체: 기존 대상이 빠지고 새 대상이 들어간다
  {
    const res = await app.inject({
      method: 'PUT', url: `/api/requests/${req.id}/sharing`,
      headers: { cookie: cookie(sysUser) },
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
      headers: { cookie: cookie(owner) },
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
      headers: { cookie: cookie(owner) },
      payload: { visibility: 'shared', shared_targets: [] },
    })
    assert.equal(res.statusCode, 200, '종결 건도 200')
    console.log('(6) 종결 건 공유 변경 OK')
  }

  // ── (7) 회귀: visibility를 기존 PATCH로 바꾸려 하면 거부된다 (우회로 차단)
  {
    const res = await app.inject({
      method: 'PATCH', url: `/api/requests/${req.id}`,
      headers: { cookie: cookie(sysUser) },
      payload: { visibility: 'private' },
    })
    assert.equal(res.statusCode, 400, 'PATCH로는 visibility를 못 바꾼다')
    console.log('(7) PATCH 우회로 차단 OK')
  }

  console.log('\ntest:sharing ALL PASSED')
} finally {
  if (created.reqIds.length) await db.delete(requests).where(inArray(requests.id, created.reqIds))
  if (created.userIds.length) await db.delete(users).where(inArray(users.id, created.userIds))
  await app.close()
  await pool.end()
}
```

`sessionCookieFor(userId)`는 `server/scripts/test-role-boundaries.ts`가 세션을 만들어 쿠키 문자열을 얻는 방식과 동일하게 구현한다(그 파일의 헬퍼를 읽고 같은 방식으로 작성). `dev-login`은 고정 계정만 로그인시키므로 쓸 수 없다.

`server/package.json`의 `scripts`에 추가:

```json
    "test:sharing": "tsx scripts/test-sharing.ts",
```

- [ ] **Step 2: 테스트를 돌려 실패 확인**

```bash
cd server && npm run test:sharing
```

Expected: FAIL — `PUT /api/requests/:id/sharing` 라우트가 없어 404(또는 405)가 나온다.

- [ ] **Step 3: 권한 판정 함수 추가**

`server/src/authz.ts` — 기존 능력 함수들 아래에 추가한다:

```ts
/**
 * 공유 설정(공개범위 + 공유 대상) 변경 권한.
 * 본문 편집(canProcess 또는 요청자 본인 && 접수)과 규칙이 다르다:
 * 요청자 본인은 상태와 무관하게(종결 후에도) 공유를 바꿀 수 있다.
 * 공유는 처리 내용을 바꾸지 않고 "누가 볼 수 있는가"만 바꾸므로 더 넓게 열어도 안전하다.
 */
export function canChangeSharing(u: CurrentUser, requesterId: string | null): boolean {
  return canProcess(u) || (requesterId != null && requesterId === u.id)
}
```

- [ ] **Step 4: 공유 변경 서비스 구현**

`server/src/services/sharing.ts`:

```ts
import { sql } from 'drizzle-orm'
import { withUser } from '../db/client.js'

export type Visibility = 'private' | 'dept' | 'function' | 'org' | 'shared'
export interface SharedTarget {
  target_type: 'function' | 'dept'
  target_value: string
}

export class SharingError extends Error {
  code: string
  constructor(msg: string, code: string) {
    super(msg)
    this.code = code
  }
}

/** 목록 비교용 키 */
const key = (t: SharedTarget) => `${t.target_type}|${t.target_value}`

/**
 * 공유 설정을 전체 교체한다. 넘긴 targets가 곧 최종 상태이므로 추가·제거가 한 번에 처리된다.
 * added/removed는 서버가 기존 목록과 비교해 계산한다 — 클라이언트가 보낸 값을 믿지 않는다.
 *
 * TOCTOU 방지: SELECT … FOR UPDATE로 요청 행을 잠근 뒤 같은 트랜잭션에서 교체·이력 기록.
 */
export async function changeSharing({
  reqId,
  visibility,
  targets,
  actorId,
}: {
  reqId: number
  visibility: Visibility
  targets: SharedTarget[]
  actorId: string
}): Promise<void> {
  await withUser(actorId, async (tx) => {
    const cur = await tx.execute<{ visibility: string }>(
      sql`select visibility from requests where id = ${reqId} for update`,
    )
    const row = cur.rows[0]
    if (!row) throw new SharingError('요청을 찾을 수 없습니다', 'NOT_FOUND')

    const prevRes = await tx.execute<SharedTarget>(sql`
      select target_type, target_value from request_shared_targets where request_id = ${reqId}`)
    const prev = prevRes.rows

    const prevKeys = new Set(prev.map(key))
    const nextKeys = new Set(targets.map(key))
    const added = targets.filter((t) => !prevKeys.has(key(t)))
    const removed = prev.filter((t) => !nextKeys.has(key(t)))
    const visibilityChanged = row.visibility !== visibility

    // 공개범위·공유대상이 둘 다 그대로면 아무것도 하지 않는다 (무의미한 이력 방지)
    if (!visibilityChanged && added.length === 0 && removed.length === 0) return

    if (visibilityChanged) {
      await tx.execute(sql`update requests set visibility = ${visibility} where id = ${reqId}`)
    }

    // 공유 대상 전체 교체
    await tx.execute(sql`delete from request_shared_targets where request_id = ${reqId}`)
    for (const t of targets) {
      await tx.execute(sql`
        insert into request_shared_targets (request_id, target_type, target_value)
        values (${reqId}, ${t.target_type}, ${t.target_value})
        on conflict do nothing`)
    }

    await tx.execute(sql`
      insert into request_sharing_history
        (request_id, changed_by, from_visibility, to_visibility, added, removed)
      values (
        ${reqId}, ${actorId},
        ${visibilityChanged ? row.visibility : null},
        ${visibilityChanged ? visibility : null},
        ${JSON.stringify(added)}::jsonb,
        ${JSON.stringify(removed)}::jsonb
      )`)
  })
}
```

- [ ] **Step 5: 라우트 추가 + 기존 PATCH에서 visibility 제거**

`server/src/routes/requests.ts` — import에 추가한다:

```ts
import { canChangeSharing } from '../authz.js'
import { changeSharing, SharingError, type Visibility, type SharedTarget } from '../services/sharing.js'
```

`PATCH /api/requests/:id` 핸들러에서 **`visibility`를 편집 가능 필드 목록에서 제거**한다. 두 곳이다(현재 `['title', 'body', 'urgency', 'visibility', 'desired_due', 'assignee_id']`):

```ts
      const otherFields = ['title', 'body', 'urgency', 'desired_due', 'assignee_id']
```

```ts
    for (const k of ['title', 'body', 'urgency', 'desired_due', 'assignee_id']) {
```

그리고 `visibility`가 들어오면 명시적으로 거부한다(조용히 무시하면 클라이언트가 성공한 줄 안다). 기존 enum 검증 블록 근처에 추가한다:

```ts
    // visibility는 PUT /api/requests/:id/sharing 에서만 바꾼다 (권한 규칙이 다르다)
    if (b.visibility !== undefined) {
      reply.code(400)
      return { error: 'visibility는 PUT /api/requests/:id/sharing 으로 변경하세요', code: 'USE_SHARING_ENDPOINT' }
    }
```

신규 라우트를 추가한다(기존 `PATCH /api/requests/:id/impact` 핸들러 아래):

```ts
  // 공유 설정 변경 — 시스템팀 또는 요청자 본인(상태 무관, 종결 후에도).
  // 공개범위와 공유 대상을 한 번에 전체 교체한다.
  app.put<{ Params: { id: string }; Body: { visibility?: string; shared_targets?: unknown } }>(
    '/api/requests/:id/sharing',
    async (request, reply) => {
      const u = request.currentUser!
      const id = parseId(request.params.id)
      if (id == null) { reply.code(404); return { error: 'not found' } }

      const b = request.body ?? {}
      if (!isOneOf(VISIBILITIES, b.visibility as string)) {
        reply.code(400); return { error: 'invalid visibility' }
      }
      const rawTargets = Array.isArray(b.shared_targets) ? b.shared_targets : null
      if (rawTargets == null) {
        reply.code(400); return { error: 'shared_targets required' }
      }
      const targets: SharedTarget[] = []
      for (const t of rawTargets as any[]) {
        if (t?.target_type !== 'function' && t?.target_type !== 'dept') {
          reply.code(400); return { error: 'invalid target_type' }
        }
        if (typeof t.target_value !== 'string' || t.target_value.length === 0) {
          reply.code(400); return { error: 'invalid target_value' }
        }
        targets.push({ target_type: t.target_type, target_value: t.target_value })
      }

      // 권한 판정에 요청자 id가 필요하다
      const cur = await db.execute<{ requester_id: string | null }>(
        sql`select requester_id from requests where id = ${id}`,
      )
      const row = cur.rows[0]
      if (!row) { reply.code(404); return { error: 'not found' } }
      if (!canChangeSharing(u, row.requester_id)) { reply.code(403); return { error: 'forbidden' } }

      try {
        await changeSharing({
          reqId: id,
          visibility: b.visibility as Visibility,
          targets,
          actorId: u.id,
        })
      } catch (e: any) {
        if (e instanceof SharingError) {
          if (e.code === 'NOT_FOUND') { reply.code(404); return { error: 'not found' } }
          reply.code(400); return { error: e.message, code: e.code }
        }
        throw e
      }

      reply.code(200); return { ok: true }
    },
  )
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd server && npm run test:sharing
```

Expected: PASS — (1)~(7) 전부. 특히 **(2) 공유 추가 → 열람 반영**과 **(7) PATCH 우회로 차단**이 통과해야 한다.

- [ ] **Step 7: 회귀 확인**

```bash
cd server && npm run typecheck && npm run test:api && npm run test:api-write && npm run test:authz && npm run test:roles && npm run db:smoke
```

Expected: 전부 PASS.

**주의**: `visibility`를 PATCH에서 뺐으므로 기존 테스트가 그 필드를 PATCH로 바꾸고 있으면 실패한다. 실패하면 그 테스트를 새 엔드포인트를 쓰도록 고친다(테스트가 옛 계약을 검증하고 있던 것이므로 정상적인 갱신이다). 클라이언트 `src/features/requests/api.ts`의 `useUpdateRequest`가 `visibility`를 보내고 있으면 Task 3에서 고친다 — 이 태스크에서는 서버만 다룬다.

- [ ] **Step 8: 커밋**

```bash
git add server/src/authz.ts server/src/services/sharing.ts server/src/routes/requests.ts server/scripts/test-sharing.ts server/package.json
git commit -m "feat(server): 공유 설정 사후 수정 — PUT /api/requests/:id/sharing

공개범위와 공유 대상을 한 번에 전체 교체한다. 권한은 canChangeSharing
(시스템팀 또는 요청자 본인 — 상태 무관, 종결 후에도)으로 본문 편집과 분리했다.
added/removed는 서버가 기존 목록과 비교해 계산하고 request_sharing_history에 남긴다.
visibility는 기존 PATCH에서 제거해 권한 우회로를 없앴다(400 USE_SHARING_ENDPOINT).

테스트: test:sharing 7건 신설 — 권한·전체교체·이력·열람반영·우회로 차단

docs sync: 스킵(Task 5에서 일괄 처리)"
```

---

### Task 3: 공유 대상 선택 컴포넌트 추출 + 상세 화면 수정 UI

**Files:**
- Create: `src/features/requests/SharingEditor.tsx`
- Modify: `src/features/requests/RequestForm.tsx` (공유 대상 선택 UI를 추출한 컴포넌트로 교체)
- Modify: `src/features/requests/RequestDetail.tsx` ("공유 범위 수정" 버튼·패널)
- Modify: `src/features/requests/api.ts` (`useChangeSharing` 훅, `useUpdateRequest`에서 `visibility` 제거)
- Modify: `src/lib/permissions.ts` (`canChangeSharing` 사본)

**Interfaces:**
- Consumes: Task 2의 `PUT /api/requests/:id/sharing`, `canChangeSharing` 규칙
- Produces: `<SharingEditor value={...} onChange={...} />` — 접수 폼과 상세 화면이 공유하는 선택 UI
- Produces: `useChangeSharing(id)` 훅

- [ ] **Step 1: 클라이언트 권한 헬퍼 추가**

`src/lib/permissions.ts` — 기존 능력 함수들 아래에 추가한다:

```ts
/**
 * 공유 설정 변경 권한 — 서버 server/src/authz.ts의 canChangeSharing과 동일한 규칙이어야 한다.
 * 시스템팀 또는 요청자 본인(상태 무관, 종결 후에도).
 */
export function canChangeSharing(role: Role, requesterId: string | null, myId: string | null | undefined): boolean {
  return canProcess(role) || (requesterId != null && myId != null && requesterId === myId)
}
```

- [ ] **Step 2: 공유 대상 선택 컴포넌트 추출**

`src/features/requests/SharingEditor.tsx`. 접수 폼(`src/features/requests/RequestForm.tsx`)의 공유 대상 선택 UI(공개범위 select + 직무 체크박스 + 세부부서 체크박스)를 **그대로 옮긴다.** 선택 규칙이 두 벌이 되면 접수와 수정의 동작이 갈라지므로, 접수 폼은 이 컴포넌트를 쓰도록 바꾼다.

먼저 `RequestForm.tsx`의 해당 부분(`fnTargets`·`deptTargets` 상태와 `useDeptOptions()`로 만드는 `deptGroups`, 그리고 렌더 부분)을 읽고, 다음 계약으로 옮긴다:

```tsx
import { VISIBILITY_OPTIONS, FUNCTION_TARGETS, deptTargetValue, deptTargetLabel } from '../../lib/constants'
import { useDeptOptions } from './api'
import type { RequestVisibility } from '../../types/database'

export interface SharingValue {
  visibility: RequestVisibility
  fnTargets: Set<string>    // 직무 단위 — FUNCTION_TARGETS 값
  deptTargets: Set<string>  // 세부부서 단위 — deptTargetValue(기관, 직무) 값
}

interface SharingEditorProps {
  value: SharingValue
  onChange: (next: SharingValue) => void
  disabled?: boolean
}

/**
 * 공개범위 + 공유 대상 선택 UI.
 * 접수 폼과 요청 상세의 공유 범위 수정이 이 컴포넌트를 공유한다 —
 * 선택 규칙이 두 벌이 되면 접수와 수정의 동작이 갈라진다.
 */
export function SharingEditor({ value, onChange, disabled }: SharingEditorProps) {
  // (RequestForm.tsx의 공개범위 select + 직무/세부부서 체크박스 렌더를 그대로 옮긴다.
  //  상태는 props로 받고, 토글 시 onChange로 새 SharingValue를 올린다.)
}
```

`RequestForm.tsx`는 자체 `fnTargets`/`deptTargets`/`visibility` 상태를 유지하되, 렌더를 `<SharingEditor value={{visibility, fnTargets, deptTargets}} onChange={...} />`로 교체한다. 제출 시 서버로 보내는 형식(`[...fnTargets].map(v => ({target_type:'function', target_value:v}))` 등)은 그대로다.

접근성 유지: 체크박스에 라벨, 접힘 패널의 `aria-expanded`·`aria-controls`, 선택 수 뱃지.

- [ ] **Step 3: `useChangeSharing` 훅 + `useUpdateRequest`에서 visibility 제거**

`src/features/requests/api.ts`:

```ts
/** 공유 설정 변경 (시스템팀 또는 요청자 본인) — 공개범위 + 공유 대상 전체 교체 */
export function useChangeSharing(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { visibility: RequestVisibility; shared_targets: SharedTargetInput[] }) =>
      apiSend('PUT', `/api/requests/${id}/sharing`, {
        visibility: vars.visibility,
        shared_targets: vars.shared_targets,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
  })
}
```

`useUpdateRequest`가 `visibility`를 보내고 있으면 **제거**한다. 서버가 이제 400 `USE_SHARING_ENDPOINT`로 거부하므로, 보내면 편집 저장이 통째로 실패한다.

- [ ] **Step 4: 요청 상세에 "공유 범위 수정" 붙이기**

`src/features/requests/RequestDetail.tsx`:

1. import 추가:

```tsx
import { SharingEditor, type SharingValue } from './SharingEditor'
import { canChangeSharing } from '../../lib/permissions'
import { useChangeSharing } from './api'
```

2. 권한 판정과 상태:

```tsx
  const canEditSharing = canChangeSharing(profile?.role, v.requester_id ?? null, profile?.id)
  const changeSharing = useChangeSharing(id)
  const [sharingOpen, setSharingOpen] = useState(false)
  const [sharingDraft, setSharingDraft] = useState<SharingValue | null>(null)
  const [sharingError, setSharingError] = useState<string | null>(null)
```

3. 공개범위 뱃지 옆에 버튼을 둔다. `canEditSharing`일 때만 렌더한다:

```tsx
        {canEditSharing && (
          <button
            type="button"
            onClick={() => {
              // 현재 값으로 초안 초기화 — sharedTargets는 상세 응답에 이미 들어 있다
              setSharingDraft({
                visibility: (v.visibility as RequestVisibility) ?? 'dept',
                fnTargets: new Set(
                  sharedTargets.filter((t) => t.target_type === 'function').map((t) => t.target_value),
                ),
                deptTargets: new Set(
                  sharedTargets.filter((t) => t.target_type === 'dept').map((t) => t.target_value),
                ),
              })
              setSharingError(null)
              setSharingOpen(true)
            }}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            공유 범위 수정
          </button>
        )}
```

4. 패널을 렌더한다(본문 편집 폼과 **합치지 않는다** — 권한 조건이 다르다):

```tsx
      {sharingOpen && sharingDraft && (
        <section aria-label="공유 범위 수정" className="rounded-xl border border-gray-200 bg-white p-4">
          {sharingError && (
            <p role="alert" className="mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {sharingError}
            </p>
          )}
          <SharingEditor
            value={sharingDraft}
            onChange={setSharingDraft}
            disabled={changeSharing.isPending}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSharingOpen(false)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="button"
              disabled={changeSharing.isPending}
              onClick={() => {
                setSharingError(null)
                changeSharing.mutate(
                  {
                    visibility: sharingDraft.visibility,
                    shared_targets: [
                      ...[...sharingDraft.fnTargets].map((tv) => ({
                        target_type: 'function' as const, target_value: tv,
                      })),
                      ...[...sharingDraft.deptTargets].map((tv) => ({
                        target_type: 'dept' as const, target_value: tv,
                      })),
                    ],
                  },
                  {
                    onSuccess: () => setSharingOpen(false),
                    onError: (err) =>
                      setSharingError(err instanceof Error ? err.message : String(err)),
                  },
                )
              }}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </section>
      )}
```

5. 본문 편집 폼의 공개범위 select는 **제거**한다. 이제 공유 범위 수정에서만 바꾼다(서버도 PATCH의 `visibility`를 거부한다).

- [ ] **Step 5: 타입체크**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 오류 없음.

- [ ] **Step 6: 코드 근거 확인 (브라우저 접근 불가 시)**

보고서에 다음을 코드로 짚어 적는다:
- 요청자 본인에게 진행중·완료 상태에서도 "공유 범위 수정" 버튼이 보이는 근거
- 무관한 staff에게는 안 보이는 근거
- 본문 편집 폼에서 공개범위 select가 사라졌고, `useUpdateRequest`가 더 이상 `visibility`를 보내지 않는 근거
- 접수 폼과 상세 화면이 같은 `SharingEditor`를 쓰는 근거

- [ ] **Step 7: 커밋**

```bash
git add src/features/requests/SharingEditor.tsx src/features/requests/RequestForm.tsx src/features/requests/RequestDetail.tsx src/features/requests/api.ts src/lib/permissions.ts
git commit -m "feat(web): 요청 상세에 공유 범위 수정 UI

공유 대상 선택 UI를 SharingEditor로 추출해 접수 폼과 상세 화면이 공유한다.
요청자 본인은 종결 후에도 공유를 바꿀 수 있으므로 본문 편집 폼과 분리했다.
본문 편집에서 공개범위 select를 제거하고 useUpdateRequest도 visibility를 보내지 않는다
(서버가 400 USE_SHARING_ENDPOINT로 거부한다).

docs sync: 스킵(Task 5에서 일괄 처리)"
```

---

### Task 4: 활동 타임라인에 공유 변경 표시

**Files:**
- Modify: `server/src/routes/request-detail.ts` (공유 이력 조회·응답 포함)
- Modify: `src/features/requests/api.ts` (상세 응답 타입에 `sharingHistory` 추가)
- Modify: `src/features/requests/RequestDetail.tsx` (타임라인에 `sharing` 종류 추가)

**Interfaces:**
- Consumes: Task 1의 `request_sharing_history`, Task 2가 기록한 이력
- Produces: 상세 응답의 `sharingHistory: Array<{ id, changed_at, actor, from_visibility, to_visibility, added, removed }>`

- [ ] **Step 1: 서버 — 상세 응답에 공유 이력 포함**

`server/src/routes/request-detail.ts` — 기존 이력·댓글·첨부를 모으는 곳에 공유 이력 조회를 추가한다. 작성자 이름을 함께 가져온다(기존 상태 이력이 actor를 붙이는 방식을 그대로 따를 것):

기존 상태 이력 조회가 `select h.*, json_build_object('name', a.name) as actor` 형태로 작성자를 붙인다(`server/src/routes/request-detail.ts:138`). **같은 관례를 따른다** — 응답 형태가 두 벌이 되면 클라이언트가 이력 종류마다 다른 접근을 해야 한다:

```ts
  const sh = await db.execute<any>(sql`
    select h.id, h.changed_at, h.from_visibility, h.to_visibility, h.added, h.removed,
           json_build_object('name', a.name) as actor
    from request_sharing_history h
    left join users a on a.id = h.changed_by
    where h.request_id = ${id}
    order by h.changed_at asc`)
```

응답 객체에 추가한다:

```ts
      sharingHistory: sh.rows,
```

**권한**: 이 라우트는 이미 `canSeeRequest`로 게이팅된다. 공유 이력은 요청을 볼 수 있는 사람이면 볼 수 있다 — 내부메모와 달리 민감 정보가 아니고, "왜 우리 팀이 이걸 보고 있는가"를 설명해 주는 정보다.

- [ ] **Step 2: 클라이언트 타입 추가**

`src/features/requests/api.ts` — 상세 응답 타입에 추가한다:

```ts
export interface SharingHistoryRow {
  id: number
  changed_at: string
  from_visibility: string | null
  to_visibility: string | null
  added: Array<{ target_type: string; target_value: string }>
  removed: Array<{ target_type: string; target_value: string }>
  actor: { name: string | null } | null   // 상태 이력과 같은 형태 (json_build_object)
}
```

상세 응답 인터페이스에 `sharingHistory: SharingHistoryRow[]`를 추가한다.

- [ ] **Step 3: 타임라인에 sharing 종류 추가**

`src/features/requests/RequestDetail.tsx`:

`TimelineKind`에 `'sharing'`을 추가한다:

```tsx
type TimelineKind = 'history' | 'comment' | 'attachment' | 'sharing'
```

`TimelineItem`에 필드를 추가한다:

```tsx
  // sharing
  fromVisibility?: string | null
  toVisibility?: string | null
  added?: Array<{ target_type: string; target_value: string }>
  removed?: Array<{ target_type: string; target_value: string }>
```

타임라인 병합부에 공유 이력을 넣는다(기존 history·comment·attachment를 넣는 곳과 같은 방식):

```tsx
  if (data.sharingHistory) {
    for (const s of data.sharingHistory) {
      timeline.push({
        kind: 'sharing',
        id: s.id,
        at: s.changed_at,
        actorName: s.actor?.name ?? null,
        isSystem: false,
        fromVisibility: s.from_visibility,
        toVisibility: s.to_visibility,
        added: s.added,
        removed: s.removed,
      })
    }
  }
```

렌더에서 `kind === 'sharing'`인 행을 한 줄로 요약한다. 기존 타임라인이 한 행 = 한 줄(`유형 뱃지 · 내용 · 작성자 · 시각`) 구조이므로 그것을 따른다:

```tsx
          {item.kind === 'sharing' && (
            <>
              <Badge className="bg-purple-100 text-purple-700">공유변경</Badge>
              <span className="text-sm text-gray-700">
                {[
                  item.fromVisibility && item.toVisibility
                    ? `공개범위 ${visibilityLabel(item.fromVisibility)} → ${visibilityLabel(item.toVisibility)}`
                    : null,
                  item.added?.length
                    ? `추가: ${item.added.map((t) => targetLabel(t)).join(', ')}`
                    : null,
                  item.removed?.length
                    ? `제거: ${item.removed.map((t) => targetLabel(t)).join(', ')}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </>
          )}
```

`visibilityLabel`·`targetLabel`은 이 파일 안에 작은 헬퍼로 둔다. 라벨은 `src/lib/constants.ts`의 `VISIBILITY_OPTIONS`와 `deptTargetLabel`을 재사용한다(새 라벨 정의를 만들지 않는다):

```tsx
function visibilityLabel(v: string): string {
  return VISIBILITY_OPTIONS.find((o) => o.value === v)?.label ?? v
}

function targetLabel(t: { target_type: string; target_value: string }): string {
  // dept 값은 '배움|교학팀' 형식 — deptTargetLabel이 '배움_교학팀'으로 표시한다
  if (t.target_type === 'dept') {
    const [org, fn] = t.target_value.split('|')
    return deptTargetLabel(org, fn)
  }
  return t.target_value
}
```

접근성: 뱃지는 색만으로 전달하지 않고 "공유변경" 텍스트를 함께 쓴다(기존 타임라인 뱃지 관례와 동일).

- [ ] **Step 4: 타입체크 + 서버 테스트**

```bash
npx tsc -p tsconfig.app.json --noEmit
cd server && npm run typecheck && npm run test:sharing && npm run test:api-detail
```

Expected: 전부 통과. `test:api-detail`이 상세 응답 형태를 단언하고 있으면 `sharingHistory` 추가로 깨질 수 있다 — 깨지면 새 필드를 반영해 고친다.

- [ ] **Step 5: 커밋**

```bash
git add server/src/routes/request-detail.ts src/features/requests/api.ts src/features/requests/RequestDetail.tsx
git commit -m "feat(web): 활동 타임라인에 공유 변경 이력 표시

누가 언제 공유 범위를 바꿨는지 상태 변경·코멘트와 시간순으로 함께 보여준다.
'이 요청을 왜 저 팀이 보고 있지?'를 추적할 수 있어야 한다.

docs sync: 스킵(Task 5에서 일괄 처리)"
```

---

### Task 5: 문서 동기화

**Files:**
- Modify: `docs/reference/db-schema.md` (신규 테이블 `request_sharing_history`, 마이그레이션 0007, 신규 엔드포인트)
- Modify: `docs/reference/requirements.md` (공유 설정 권한·화면·타임라인)
- Modify: `CHANGELOG.md` (`Unreleased`)

- [ ] **Step 1: `db-schema.md` 갱신**

`request_sharing_history` 테이블(컬럼·인덱스·FK)을 테이블 목록에 추가한다. 마이그레이션 목록에 `0007_request_sharing_history`를 추가한다. API 계약 절이 있으면 `PUT /api/requests/:id/sharing`을 추가한다. frontmatter의 `last_updated`를 `2026-07-13`으로.

`added`/`removed`가 jsonb 배열이며 **서버가 기존 목록과 비교해 계산**한다는 점(클라이언트 값을 믿지 않는다)을 한 줄 남긴다.

- [ ] **Step 2: `requirements.md` 갱신**

다음을 반영한다. frontmatter의 `last_updated`를 `2026-07-13`으로.

```markdown
- **공유 설정 사후 수정**: 요청 상세의 공개범위 뱃지 옆 "공유 범위 수정" 버튼. 시스템팀(`canProcess`) 또는 **요청자 본인**(상태 무관 — 진행중·보류·종결 후에도)에게 노출된다. 공개범위와 공유 대상(직무·세부부서)을 한 번에 전체 교체한다(`PUT /api/requests/:id/sharing`). 본문 편집(제목·본문·긴급도·희망완료일)과는 권한 규칙이 다르므로 폼을 분리했다 — 본문 편집은 시스템팀 또는 (요청자 본인 && 접수)만 가능하다.
- **공개범위는 `PATCH /api/requests/:id`로 변경할 수 없다.** 시도하면 400 `USE_SHARING_ENDPOINT`. 권한 규칙이 다른 두 경로가 같은 컬럼을 쓰면 낮은 쪽이 우회로가 되기 때문이다.
- **공유 변경 이력**: 누가 언제 공개범위를 바꾸고 어떤 대상을 추가·제거했는지 `request_sharing_history`에 남아 요청 상세의 활동 타임라인에 상태 변경·코멘트와 시간순으로 표시된다. 공개범위와 공유 대상이 둘 다 그대로면 이력을 남기지 않는다.
- **새로 공유된 사람들에게 알림은 보내지 않는다.** 공유 대상은 직무·부서 단위라 한 번 추가하면 수십 명에게 알림이 가기 때문이다.
```

- [ ] **Step 3: `CHANGELOG.md`의 `Unreleased`에 추가**

```markdown
### Added
- **공유 설정 사후 수정** (`server/src/services/sharing.ts`, `PUT /api/requests/:id/sharing`, `src/features/requests/SharingEditor.tsx`): 접수 후에도 공개범위와 공유 대상(직무·세부부서)을 바꿀 수 있다. 처리 중 다른 부서·기관이 봐야 한다는 사실이 드러났을 때 대응할 수 있게 하기 위함이다.
  - 권한 `canChangeSharing`: 시스템팀(`canProcess`) 또는 요청자 본인(상태 무관, 종결 후에도). 공유는 처리 내용을 바꾸지 않고 "누가 볼 수 있는가"만 바꾸므로 본문 편집보다 넓게 열었다.
  - 공유 대상은 **전체 교체** — 넘긴 목록이 곧 최종 상태이므로 추가·제거가 한 번의 호출로 처리된다.
  - 공유 대상 선택 UI를 `SharingEditor`로 추출해 접수 폼과 상세 화면이 공유한다.
  - 변경 이력(`request_sharing_history`, 마이그레이션 `0007`)을 남겨 활동 타임라인에 표시한다. added/removed는 서버가 기존 목록과 비교해 계산한다.
  - 테스트 `test:sharing` 7건 신설: 권한(무관한 staff 403 · 요청자 본인 · 시스템팀) · 전체 교체 · 이력 기록 · 무변경 시 이력 없음 · 종결 건 변경 · **공유 추가 후 해당 부서 사용자 목록에 실제로 나타나는지** · PATCH 우회로 차단.

### Changed
- **`visibility`를 `PATCH /api/requests/:id`에서 제거** (`server/src/routes/requests.ts`): 공개범위는 `PUT /api/requests/:id/sharing`으로만 바꾼다. 권한 규칙이 다른 두 경로가 같은 컬럼을 쓰면 낮은 쪽이 우회로가 되므로, 기존 PATCH는 400 `USE_SHARING_ENDPOINT`로 거부한다.
```

- [ ] **Step 4: 전체 검증**

```bash
cd server && npm run typecheck && npm run test:sharing && npm run test:api && npm run test:api-write && npm run test:api-detail && npm run test:authz && npm run test:roles && npm run db:smoke
cd .. && npx tsc -p tsconfig.app.json --noEmit
```

Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add docs/reference/db-schema.md docs/reference/requirements.md CHANGELOG.md
git commit -m "docs: 공유 설정 사후 수정 문서 동기화"
```

---

## 검증 요약

| 대상 | 명령 | 기대 |
|------|------|------|
| 공유 변경 | `cd server && npm run test:sharing` | 7건 PASS (열람 반영·우회로 차단 포함) |
| 기존 회귀 | `cd server && npm run test:api && npm run test:api-write && npm run test:api-detail && npm run test:authz && npm run test:roles && npm run db:smoke` | 전부 PASS |
| 서버 타입 | `cd server && npm run typecheck` | 오류 없음 |
| 웹 타입 | `npx tsc -p tsconfig.app.json --noEmit` | 오류 없음 |
| 마이그레이션 | `cd server && npm run db:migrate` | `migrations applied`, `request_sharing_history` 생성 |
