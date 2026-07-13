# 관리보드 접수 영역 분할 · 요청 상세 관리 패널 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리보드에서 접수 건이 정확히 한 곳(미배정 큐 또는 접수 컬럼)에만 표시되게 하고, 시스템팀이 요청 상세를 벗어나지 않고 담당자·상태·필드·영향도를 관리할 수 있게 한다.

**Architecture:** 서버는 `assign.ts`에 묻혀 있던 우선순위·SLA 기한 계산을 공용 함수로 추출해 배정과 신규 영향도 재조정(`changeImpact`)이 공유한다. 클라이언트는 보드의 접수 컬럼 필터를 좁히고 미배정 큐에 드롭 핸들러를 추가하며, 상세 화면에는 시스템팀 전용 `AdminPanel`을 새 컴포넌트로 붙인다. 라우트는 그대로 `/requests/:id`를 쓰고 역할로 분기한다.

**Tech Stack:** Fastify · Drizzle · PostgreSQL / React 18 · TanStack Query · Tailwind / 테스트는 `tsx` 스크립트(`server/scripts/test-*.ts`)

## Global Constraints

- 스펙 SSOT: `docs/superpowers/specs/2026-07-13-board-intake-split-and-admin-detail-panel-design.md`
- 상태·기관·긴급도 코드값은 레거시 한글 유지 (`접수`·`진행중`·`보류`·`완료`·`반려`·`철회`, 영향도·긴급도는 `높음`·`보통`·`낮음`). 신규 영문 코드값을 도입하지 않는다 (CLAUDE.md §2).
- DB 스키마 변경 없음. 마이그레이션 파일을 만들지 않는다.
- 상태 변경과 필드 편집을 한 PATCH에 섞지 않는다 — 서버가 400으로 거부한다 (`server/src/routes/requests.ts:144`).
- 전이 검증의 SSOT는 서버 `server/src/services/transition.ts`의 `ALLOWED` 맵. 클라이언트 `src/lib/constants.ts`의 `ALLOWED_TRANSITIONS`는 사본이며 두 곳이 항상 같아야 한다.
- 모든 상태 변경 서비스는 `SELECT … FOR UPDATE` 후 같은 트랜잭션에서 UPDATE 한다 (TOCTOU 방지).
- 문서 동기화: 사용자 노출 변경이므로 `docs/reference/requirements.md`와 `CHANGELOG.md`를 같은 작업 안에서 갱신한다 (CLAUDE.md §1). API 계약은 `requirements.md`에 있다.
- 테스트 실행 전 `server/.env` 필요 (`cp server/.env.example server/.env`), Docker Postgres(`request-site-db`)가 떠 있어야 한다.

---

### Task 1: SLA 계산 공용 함수 추출

배정(`assignRequest`)에 인라인으로 박혀 있는 우선순위·기한 계산을 함수로 뽑는다. 다음 태스크의 `changeImpact`가 같은 공식을 써야 하므로 먼저 한다. 동작 변경은 없다 — 순수 리팩토링이며 `test:assign`이 회귀를 잡는다.

**Files:**
- Create: `server/src/services/sla-fields.ts`
- Modify: `server/src/services/assign.ts:32-99`
- Test: 기존 `server/scripts/test-assign.ts` (회귀만 확인, 신규 테스트 없음)

**Interfaces:**
- Produces: `computeSlaFields({ tx, urgency, impact, createdAt, holidaySet }): Promise<SlaFields>` — 이후 Task 2의 `changeImpact`가 그대로 호출한다.
  ```ts
  export interface SlaFields {
    priorityLevel: PriorityLevel
    responseDueAt: Date | null
    resolutionDueAt: Date | null
    slaPolicyId: number | null
    responseBreached: boolean
  }
  ```
- Produces: `loadHolidaySet(): Promise<Set<string>>` — 트랜잭션 밖에서 holidays를 읽는다.

- [ ] **Step 1: 기존 배정 테스트가 통과하는지 먼저 확인 (리팩토링 기준선)**

```bash
cd server && npm run test:assign
```

Expected: PASS — `(1) 접수건 배정 OK, priority_level=P1 …` / `test:assign ALL PASSED`

- [ ] **Step 2: 공용 함수 파일 생성**

`server/src/services/sla-fields.ts`:

```ts
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  derivePriority,
  addBusinessMinutes,
  type Impact,
  type Urgency,
  type PriorityLevel,
} from '../sla.js'

/** 배정·영향도 재조정이 공유하는 우선순위·SLA 기한 계산 결과 */
export interface SlaFields {
  priorityLevel: PriorityLevel
  responseDueAt: Date | null
  resolutionDueAt: Date | null
  slaPolicyId: number | null
  responseBreached: boolean
}

/** holidays는 변경 빈도가 낮은 참조 데이터 — 트랜잭션 밖에서 읽는다 */
export async function loadHolidaySet(): Promise<Set<string>> {
  const rows = await db.execute<{ holiday_on: string }>(sql`select holiday_on from holidays`)
  return new Set(rows.rows.map((h) => h.holiday_on))
}

/**
 * urgency × impact → priority_level, sla_policy 기준 응답·해결 기한을 계산한다.
 * 기한 기준 시각은 요청 생성 시각(created_at)이므로 같은 요청에 같은 impact를 주면
 * 배정 시점과 재조정 시점의 결과가 동일하다.
 *
 * tx: 호출자의 트랜잭션 핸들 (sla_policy 조회를 같은 트랜잭션에서 수행)
 */
export async function computeSlaFields({
  tx,
  urgency,
  impact,
  createdAt,
  holidaySet,
}: {
  tx: { execute: typeof db.execute }
  urgency: Urgency
  impact: Impact
  createdAt: string
  holidaySet: Set<string>
}): Promise<SlaFields> {
  const priorityLevel = derivePriority(urgency, impact)

  const policyRes = await tx.execute<{
    id: number
    resolution_minutes: number | null
    response_minutes: number | null
  }>(
    sql`select id, resolution_minutes, response_minutes from sla_policy where priority_level = ${priorityLevel}`,
  )
  const policy = policyRes.rows[0]

  const created = new Date(createdAt)

  let resolutionDueAt: Date | null = null
  if (policy && policy.resolution_minutes != null) {
    resolutionDueAt = addBusinessMinutes(created, policy.resolution_minutes, holidaySet)
  }

  let responseDueAt: Date | null = null
  if (policy && policy.response_minutes != null) {
    responseDueAt = addBusinessMinutes(created, policy.response_minutes, holidaySet)
  }

  // sla_response_breached: 응답 기한을 이미 넘겼는지
  const responseBreached = responseDueAt != null && new Date() > responseDueAt

  return {
    priorityLevel,
    responseDueAt,
    resolutionDueAt,
    slaPolicyId: policy?.id ?? null,
    responseBreached,
  }
}
```

- [ ] **Step 3: `assignRequest`가 공용 함수를 쓰도록 교체**

`server/src/services/assign.ts` — import 교체:

```ts
import { sql } from 'drizzle-orm'
import { withUser } from '../db/client.js'
import { type Impact, type Urgency } from '../sla.js'
import { computeSlaFields, loadHolidaySet } from './sla-fields.js'
import { notify } from './notify.js'
```

`assignRequest` 본문에서 holidays 조회(기존 32-36행)를 다음으로 바꾼다:

```ts
  const holidaySet = await loadHolidaySet()
```

트랜잭션 안의 계산 블록(기존 53-81행: `derivePriority` ~ `responseBreached`)을 다음으로 바꾼다:

```ts
    const sla = await computeSlaFields({
      tx,
      urgency: row.urgency,
      impact,
      createdAt: row.created_at,
      holidaySet,
    })
```

UPDATE 문의 값 바인딩을 `sla.*`로 바꾼다:

```ts
    const upd = await tx.execute<{ id: number }>(sql`
      update requests
      set
        assignee_id           = ${assigneeId},
        impact                = ${impact},
        priority_level        = ${sla.priorityLevel},
        status                = '진행중',
        assigned_at           = now(),
        first_response_at     = now(),
        response_due_at       = ${sla.responseDueAt},
        resolution_due_at     = ${sla.resolutionDueAt},
        sla_policy_id         = ${sla.slaPolicyId},
        sla_response_breached = ${sla.responseBreached}
      where id = ${reqId} and status = '접수'
      returning id
    `)
```

- [ ] **Step 4: 타입체크 + 배정 회귀 테스트**

```bash
cd server && npm run typecheck && npm run test:assign
```

Expected: 타입 오류 없음. `test:assign ALL PASSED` — 특히 `(1) … priority_level=P1`과 `(2) P4 resolution_due_at null OK`가 Step 1과 동일해야 한다(계산식 불변 확인).

- [ ] **Step 5: 커밋**

```bash
git add server/src/services/sla-fields.ts server/src/services/assign.ts
git commit -m "refactor(server): SLA 우선순위·기한 계산을 sla-fields.ts로 추출

배정과 (신규) 영향도 재조정이 같은 공식을 공유하도록 computeSlaFields/loadHolidaySet 분리.
동작 변경 없음 — test:assign 회귀 통과.

docs sync: 스킵(내부 리팩토링, 외부 계약 불변)"
```

---

### Task 2: 영향도 재조정 API (`changeImpact` + 라우트)

**Files:**
- Create: `server/src/services/impact.ts`
- Create: `server/scripts/test-impact.ts`
- Modify: `server/src/routes/requests.ts` (라우트 추가 — 기존 `POST /api/requests/:id/assign` 핸들러 바로 아래)
- Modify: `server/package.json` (`test:impact` 스크립트 추가)

**Interfaces:**
- Consumes: Task 1의 `computeSlaFields`, `loadHolidaySet`
- Produces: `changeImpact({ reqId, impact, actorId }): Promise<{ priorityLevel: PriorityLevel }>` 및 `class ImpactError { code: 'NOT_FOUND' | 'NOT_ASSIGNED' | 'CLOSED' | 'CONCURRENT_MODIFICATION' }`
- Produces: `PATCH /api/requests/:id/impact` — body `{ impact: '높음'|'보통'|'낮음' }`, 200 `{ ok: true, priority_level }`. Task 4의 `useChangeImpact`가 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/scripts/test-impact.ts`:

```ts
/**
 * 영향도 재조정 서비스 테스트
 * - 재산정: priority_level·resolution_due_at 갱신, assigned_at·first_response_at 보존
 * - 미배정 건 거부 (NOT_ASSIGNED)
 * - 종결 건 거부 (CLOSED)
 */
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, requests } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { assignRequest } from '../src/services/assign.js'
import { changeStatus } from '../src/services/transition.js'
import { changeImpact, ImpactError } from '../src/services/impact.js'

const app = await buildApp()
await loginAsDev(app)

const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
const actorId = juhui!.id

/** urgency='보통' 인 테스트 요청 (보통×보통 = P3, 보통×높음 = P2) */
async function makeRequest() {
  const [row] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '영향도테스트',
    requesterId: actorId, visibility: 'dept', urgency: '보통',
  }).returning()
  return row
}

// ──────────────────────────────────────────
// (1) 재산정: 보통 → 높음 이면 P3 → P2, 배정 시각은 보존
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await assignRequest({ reqId: req.id, assigneeId: actorId, impact: '보통', actorId })
  const before = await db.execute<any>(sql`
    select priority_level, assigned_at, first_response_at, resolution_due_at
    from requests where id = ${req.id}
  `)
  const b = before.rows[0]
  assert.equal(b.priority_level, 'P3', '보통×보통 = P3')

  const res = await changeImpact({ reqId: req.id, impact: '높음', actorId })
  assert.equal(res.priorityLevel, 'P2', '보통×높음 = P2 반환')

  const after = await db.execute<any>(sql`
    select impact, priority_level, assigned_at, first_response_at, resolution_due_at, sla_policy_id, status
    from requests where id = ${req.id}
  `)
  const a = after.rows[0]
  assert.equal(a.impact, '높음', 'impact 갱신')
  assert.equal(a.priority_level, 'P2', 'priority_level 재산정')
  assert.equal(a.status, '진행중', 'status 불변')
  assert.equal(String(a.assigned_at), String(b.assigned_at), 'assigned_at 보존')
  assert.equal(String(a.first_response_at), String(b.first_response_at), 'first_response_at 보존')
  assert.notEqual(String(a.resolution_due_at), String(b.resolution_due_at), 'resolution_due_at 재산정')
  assert.ok(a.sla_policy_id, 'sla_policy_id 세팅')
  console.log('(1) 재산정 + 배정 시각 보존 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (2) 미배정 건 거부
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  let threw = false
  try {
    await changeImpact({ reqId: req.id, impact: '높음', actorId })
  } catch (e: any) {
    assert.ok(e instanceof ImpactError, 'ImpactError여야 함')
    assert.equal(e.code, 'NOT_ASSIGNED')
    threw = true
  }
  assert.ok(threw, '예외가 발생해야 함')
  console.log('(2) 미배정 건 거부 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (3) 종결 건 거부 (완료)
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await assignRequest({ reqId: req.id, assigneeId: actorId, impact: '보통', actorId })
  await changeStatus({ reqId: req.id, to: '완료', actorId })
  let threw = false
  try {
    await changeImpact({ reqId: req.id, impact: '높음', actorId })
  } catch (e: any) {
    assert.equal(e.code, 'CLOSED')
    threw = true
  }
  assert.ok(threw, '예외가 발생해야 함')
  console.log('(3) 종결 건 거부 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

await app.close()
await pool.end()
console.log('\ntest:impact ALL PASSED')
```

`server/package.json`의 `scripts`에 추가 (`"test:assign"` 줄 아래):

```json
    "test:impact": "tsx scripts/test-impact.ts",
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인**

```bash
cd server && npm run test:impact
```

Expected: FAIL — `Cannot find module '../src/services/impact.js'` (아직 서비스가 없다)

- [ ] **Step 3: `changeImpact` 서비스 구현**

`server/src/services/impact.ts`:

```ts
import { sql } from 'drizzle-orm'
import { withUser } from '../db/client.js'
import { type Impact, type Urgency, type PriorityLevel } from '../sla.js'
import { computeSlaFields, loadHolidaySet } from './sla-fields.js'
import { notify } from './notify.js'

/** 종결 상태 — 영향도를 소급 변경하지 않는다 */
const CLOSED = ['완료', '반려', '철회']

export class ImpactError extends Error {
  code: string
  constructor(msg: string, code: string) {
    super(msg)
    this.code = code
  }
}

/**
 * 배정된 요청의 영향도를 바꾸고 priority_level·SLA 기한을 재산정한다.
 * assigned_at / first_response_at / status 는 건드리지 않는다 (배정 이력 보존).
 *
 * TOCTOU 방지: SELECT … FOR UPDATE 와 UPDATE가 같은 트랜잭션 안에서 실행되고,
 * UPDATE WHERE 절에 AND impact is not null 을 포함해 동시 배정취소 레이스를 막는다.
 */
export async function changeImpact({
  reqId,
  impact,
  actorId,
}: {
  reqId: number
  impact: Impact
  actorId: string
}): Promise<{ priorityLevel: PriorityLevel }> {
  const holidaySet = await loadHolidaySet()

  let notifyInfo: { assigneeId: string; seq: string; priorityLevel: PriorityLevel } | null = null

  const result = await withUser(actorId, async (tx) => {
    const cur = await tx.execute<{
      status: string
      urgency: Urgency
      created_at: string
      assignee_id: string | null
      seq: string | null
    }>(
      sql`select status, urgency, created_at, assignee_id, seq from requests where id = ${reqId} for update`,
    )
    const row = cur.rows[0]
    if (!row) {
      throw new ImpactError('요청을 찾을 수 없습니다', 'NOT_FOUND')
    }
    if (!row.assignee_id) {
      throw new ImpactError('배정된 요청만 영향도를 조정할 수 있습니다', 'NOT_ASSIGNED')
    }
    if (CLOSED.includes(row.status)) {
      throw new ImpactError('종결된 요청은 영향도를 조정할 수 없습니다', 'CLOSED')
    }

    const sla = await computeSlaFields({
      tx,
      urgency: row.urgency,
      impact,
      createdAt: row.created_at,
      holidaySet,
    })

    // AND assignee_id is not null: 동시에 배정 취소된 경우 0행 → 레이스 차단
    const upd = await tx.execute<{ id: number }>(sql`
      update requests
      set
        impact                = ${impact},
        priority_level        = ${sla.priorityLevel},
        response_due_at       = ${sla.responseDueAt},
        resolution_due_at     = ${sla.resolutionDueAt},
        sla_policy_id         = ${sla.slaPolicyId},
        sla_response_breached = ${sla.responseBreached}
      where id = ${reqId} and assignee_id is not null
      returning id
    `)
    if (upd.rows.length === 0) {
      throw new ImpactError(
        '동시 변경으로 인해 영향도 조정에 실패했습니다',
        'CONCURRENT_MODIFICATION',
      )
    }

    if (row.assignee_id !== actorId) {
      notifyInfo = {
        assigneeId: row.assignee_id,
        seq: row.seq ?? String(reqId),
        priorityLevel: sla.priorityLevel,
      }
    }

    return { priorityLevel: sla.priorityLevel }
  })

  // 트랜잭션 커밋 후 best-effort 알림
  if (notifyInfo !== null) {
    const { assigneeId, seq, priorityLevel } = notifyInfo
    void notify(assigneeId, 'status', reqId, `요청 ${seq} 우선순위가 ${priorityLevel}로 변경되었습니다`)
  }

  return result
}
```

- [ ] **Step 4: 테스트를 돌려 통과 확인**

```bash
cd server && npm run test:impact
```

Expected: PASS — `(1) 재산정 + 배정 시각 보존 OK` / `(2) 미배정 건 거부 OK` / `(3) 종결 건 거부 OK` / `test:impact ALL PASSED`

- [ ] **Step 5: 라우트 추가**

`server/src/routes/requests.ts` — 상단 import에 추가:

```ts
import { changeImpact, ImpactError } from '../services/impact.js'
```

기존 `POST /api/requests/:id/assign` 핸들러 바로 아래에 추가한다 (`isSystem`·`isOneOf`·`PRIORITIES`는 이 파일에 이미 있다):

```ts
  // 영향도 재조정 — 시스템팀 전용. priority_level·SLA 기한 재산정.
  app.patch<{ Params: { id: string }; Body: { impact?: string } }>(
    '/api/requests/:id/impact',
    async (request, reply) => {
      const u = request.user
      if (!u) { reply.code(401); return { error: 'unauthorized' } }
      if (!isSystem(u)) { reply.code(403); return { error: 'forbidden' } }

      const id = Number(request.params.id)
      if (!Number.isInteger(id)) { reply.code(400); return { error: 'invalid id' } }

      const b = request.body ?? {}
      if (!isOneOf(PRIORITIES, b.impact as string)) {
        reply.code(400); return { error: 'impact(높음|보통|낮음) required' }
      }

      try {
        const { priorityLevel } = await changeImpact({
          reqId: id,
          impact: b.impact as Impact,
          actorId: u.id,
        })
        reply.code(200); return { ok: true, priority_level: priorityLevel }
      } catch (e: any) {
        if (e instanceof ImpactError) {
          if (e.code === 'NOT_FOUND') { reply.code(404); return { error: 'not found' } }
          reply.code(400); return { error: e.message, code: e.code }
        }
        throw e
      }
    },
  )
```

`Impact` 타입이 이 파일에 import 되어 있지 않다면 기존 `assign` 핸들러가 쓰는 import 줄에 추가한다 (`import { type Impact } from '../sla.js'`).

- [ ] **Step 6: 타입체크 + 전체 서버 테스트**

```bash
cd server && npm run typecheck && npm run test:impact && npm run test:assign && npm run test:transition && npm run db:smoke
```

Expected: 전부 PASS. 기존 테스트에 회귀 없음.

- [ ] **Step 7: 커밋**

```bash
git add server/src/services/impact.ts server/src/routes/requests.ts server/scripts/test-impact.ts server/package.json
git commit -m "feat(server): 영향도 재조정 API — PATCH /api/requests/:id/impact

배정 후에도 impact를 바꿔 priority_level·SLA 기한을 재산정한다. 시스템팀 전용.
미배정(NOT_ASSIGNED)·종결(CLOSED) 건은 거부하고, assigned_at·first_response_at·status는 보존한다.
계산은 Task 1의 computeSlaFields를 공유해 배정 경로와 공식이 갈라지지 않는다.

테스트: test:impact 3/3 신설"
```

---

### Task 3: 관리보드 접수 영역 분할

**Files:**
- Modify: `src/features/board/ManageBoard.tsx` — `byStatus` 계산(330-338행 부근), 미배정 큐 컨테이너(731행 부근), 하단 안내문(1067행 부근)

**Interfaces:**
- Consumes: 없음 (클라이언트 단독)
- Produces: 없음

- [ ] **Step 1: 접수 컬럼 필터를 "배정된 건"으로 좁힌다**

`src/features/board/ManageBoard.tsx`의 `byStatus` useMemo를 다음으로 교체한다:

```tsx
  // 접수 컬럼은 '배정된 접수 건'만 담는다.
  // 미배정 접수 건은 상단 미배정 큐가 담당한다 (두 영역은 배타적 — 중복 표시 방지).
  const byStatus = useMemo(() => {
    const m = new Map<RequestStatus, typeof filtered>()
    for (const s of BOARD_STATUSES) m.set(s, [])
    for (const r of filtered) {
      if (r.status === '접수' && !r.assignee_id) continue
      if (r.status && m.has(r.status as RequestStatus)) {
        m.get(r.status as RequestStatus)!.push(r)
      }
    }
    return m
  }, [filtered])
```

(기존 useMemo의 나머지 본문·의존성 배열은 그대로 둔다. `continue` 한 줄만 추가되는 형태다.)

- [ ] **Step 2: 미배정 큐를 드롭 대상으로 만든다**

미배정 큐 컨테이너(`{triageQueue.length > 0 && (` 로 시작하는 블록)의 바깥 `<div>`에 드롭 핸들러를 추가한다. 드롭 대상 상태는 `'접수'` 고정이다:

```tsx
      {triageQueue.length > 0 && (
        <div
          className={`rounded-xl border-2 border-dashed p-3 transition-colors ${
            dragOverStatus === '접수'
              ? 'border-brand bg-brand/5'
              : 'border-amber-300 bg-amber-50/60'
          }`}
          onDragOver={(e) => onDragOver(e, '접수')}
          onDragLeave={() => setDragOverStatus(null)}
          onDrop={(e) => onDrop(e, '접수')}
        >
```

(기존 컨테이너의 className이 amber 점선 스타일이면 위처럼 드래그 오버 시 brand 강조로 바뀌게 병합한다. 자식 요소는 그대로 둔다.)

`onDragOver`/`onDrop`은 이미 `ALLOWED_TRANSITIONS`로 선검증하므로(369-372행), 진행중→접수만 통과하고 나머지는 토스트로 거부된다. 추가 분기는 필요 없다.

- [ ] **Step 3: 하단 안내문을 새 규칙에 맞게 고친다**

```tsx
        칸반에서 카드를 드래그해 상태를 변경합니다. 미배정 큐에서 배정하면 진행중으로 이동하고,
        진행중 카드를 접수 컬럼이나 미배정 큐에 놓으면 배정이 취소되어 미배정 큐로 돌아갑니다.
        보드는 빈 공간을 마우스로 잡아 좌우로 끌 수 있습니다.
```

- [ ] **Step 4: 타입체크 + 브라우저 확인**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 오류 없음.

브라우저(`http://localhost:5173/board`)에서 담당자 필터를 **전체**로 두고 확인한다:
- 미배정 접수 건이 미배정 큐에만 보이고 접수 컬럼에는 없다 (이전에는 양쪽에 중복).
- 진행중 카드를 미배정 큐에 드롭하면 배정이 취소되고 큐에 안착한다.

- [ ] **Step 5: 커밋**

```bash
git add src/features/board/ManageBoard.tsx
git commit -m "feat(board): 미배정 큐/접수 컬럼 배타 분할 + 큐 드롭 지원

접수 컬럼을 '접수+배정' 건으로 좁혀 미배정 큐(접수+미배정)와의 중복 표시를 없앤다.
미배정 큐에 드롭 핸들러를 추가해 진행중 카드를 큐에 놓으면 배정 취소가 되도록 한다."
```

---

### Task 4: 요청 상세 관리 패널

**Files:**
- Create: `src/features/requests/AdminPanel.tsx`
- Modify: `src/features/requests/api.ts` — `useChangeImpact` 훅 추가
- Modify: `src/features/requests/RequestDetail.tsx` — `canEdit` 조건 확장(220행), 요약바 아래 `<AdminPanel>` 렌더

**Interfaces:**
- Consumes: Task 2의 `PATCH /api/requests/:id/impact`. 기존 `useChangeAssignee`(`api.ts:271`), `useChangeStatus`(`api.ts:243`), `useUsers`(`src/features/accounts/api.ts:37`), `ALLOWED_TRANSITIONS`(`src/lib/constants.ts`).
- Produces: `useChangeImpact(id)` 훅, `<AdminPanel requestId={number} view={RequestView} />` 컴포넌트.

- [ ] **Step 1: `useChangeImpact` 훅 추가**

`src/features/requests/api.ts` 하단(다른 mutation 훅들 옆)에 추가한다:

```ts
/** 영향도 재조정 (시스템팀 전용) — priority_level·SLA 기한이 서버에서 재산정된다 */
export function useChangeImpact(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { impact: ImpactLevel }) =>
      apiSend('PATCH', `/api/requests/${id}/impact`, { impact: vars.impact }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] })
    },
  })
}
```

(`ImpactLevel`은 `useAssignRequest`가 이미 쓰는 타입이다 — 같은 파일에서 재사용한다.)

- [ ] **Step 2: `AdminPanel` 컴포넌트 작성**

`src/features/requests/AdminPanel.tsx`:

```tsx
import { useState } from 'react'
import { useUsers } from '../accounts/api'
import { ALLOWED_TRANSITIONS, PRIORITY_LEVEL_BADGE } from '../../lib/constants'
import type { RequestStatus } from '../../types/database'
import { useChangeAssignee, useChangeStatus, useChangeImpact, type ImpactLevel } from './api'

const IMPACTS: ImpactLevel[] = ['높음', '보통', '낮음']

/** 사유 입력이 필요한 대상 상태 */
const NEEDS_REASON: RequestStatus[] = ['보류', '반려']

interface AdminPanelProps {
  requestId: number
  status: RequestStatus
  assigneeId: string | null
  impact: ImpactLevel | null
  priorityLevel: string | null
}

/**
 * 시스템팀 전용 관리 패널 — 담당자·상태·영향도를 상세 화면에서 바로 바꾼다.
 * 필드 편집(제목·본문·긴급도·희망완료일)은 RequestDetail의 기존 편집 폼이 담당한다.
 */
export function AdminPanel({
  requestId,
  status,
  assigneeId,
  impact,
  priorityLevel,
}: AdminPanelProps) {
  const { data: users } = useUsers()
  const changeAssignee = useChangeAssignee()
  const changeStatus = useChangeStatus()
  const changeImpact = useChangeImpact(requestId)

  const [error, setError] = useState<string | null>(null)
  const [reasonFor, setReasonFor] = useState<RequestStatus | null>(null)
  const [reason, setReason] = useState('')

  const allowed = ALLOWED_TRANSITIONS[status] ?? []

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : String(err))
  }

  function onAssignee(value: string) {
    setError(null)
    changeAssignee.mutate(
      { id: requestId, assignee_id: value || null },
      { onError: fail },
    )
  }

  function onStatus(to: RequestStatus) {
    setError(null)
    if (NEEDS_REASON.includes(to)) {
      setReasonFor(to)
      return
    }
    changeStatus.mutate({ id: requestId, status: to }, { onError: fail })
  }

  function submitReason() {
    if (!reasonFor) return
    changeStatus.mutate(
      { id: requestId, status: reasonFor, reason: reason.trim() || undefined },
      {
        onError: fail,
        onSuccess: () => {
          setReasonFor(null)
          setReason('')
        },
      },
    )
  }

  function onImpact(value: ImpactLevel) {
    setError(null)
    changeImpact.mutate({ impact: value }, { onError: fail })
  }

  const selectCls =
    'mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

  return (
    <section
      aria-label="관리 패널"
      className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4"
    >
      <h2 className="text-sm font-bold text-indigo-900">관리</h2>

      {error && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        {/* 담당자 */}
        <div>
          <label htmlFor="admin-assignee" className="block text-xs font-medium text-gray-700">
            담당자
          </label>
          <select
            id="admin-assignee"
            className={selectCls}
            value={assigneeId ?? ''}
            onChange={(e) => onAssignee(e.target.value)}
            disabled={changeAssignee.isPending}
          >
            <option value="">미배정</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </select>
        </div>

        {/* 상태 */}
        <div>
          <label htmlFor="admin-status" className="block text-xs font-medium text-gray-700">
            상태
          </label>
          <select
            id="admin-status"
            className={selectCls}
            value={status}
            onChange={(e) => onStatus(e.target.value as RequestStatus)}
            disabled={changeStatus.isPending}
          >
            <option value={status}>{status} (현재)</option>
            {(['접수', '진행중', '보류', '완료', '반려', '철회'] as RequestStatus[])
              .filter((s) => s !== status)
              .map((s) => (
                <option key={s} value={s} disabled={!allowed.includes(s)}>
                  {s}
                  {allowed.includes(s) ? '' : ' (불가)'}
                </option>
              ))}
          </select>
        </div>

        {/* 영향도 */}
        <div>
          <label htmlFor="admin-impact" className="block text-xs font-medium text-gray-700">
            영향도{' '}
            {priorityLevel && (
              <span
                className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${PRIORITY_LEVEL_BADGE[priorityLevel as keyof typeof PRIORITY_LEVEL_BADGE] ?? ''}`}
              >
                {priorityLevel}
              </span>
            )}
          </label>
          <select
            id="admin-impact"
            className={selectCls}
            value={impact ?? ''}
            onChange={(e) => onImpact(e.target.value as ImpactLevel)}
            disabled={changeImpact.isPending || !assigneeId}
          >
            <option value="" disabled>
              미정
            </option>
            {IMPACTS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          {!assigneeId && (
            <p className="mt-1 text-[11px] text-gray-500">배정 후 조정할 수 있습니다.</p>
          )}
        </div>
      </div>

      {/* 사유 입력 모달 (보류·반려) */}
      {reasonFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
            <h3 className="text-sm font-bold text-gray-900">{reasonFor} 사유</h3>
            <textarea
              className="mt-3 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label={`${reasonFor} 사유`}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setReasonFor(null)
                  setReason('')
                }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={submitReason}
                disabled={changeStatus.isPending}
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
```

`ImpactLevel` 타입이 `api.ts`에서 export 되어 있지 않다면 export 한다 (`useAssignRequest`가 이미 쓰는 타입).

- [ ] **Step 3: `RequestDetail`에 패널을 붙이고 편집 권한을 넓힌다**

`src/features/requests/RequestDetail.tsx` — import 추가:

```tsx
import { AdminPanel } from './AdminPanel'
```

`canEdit` 조건(220행)을 교체한다. 서버는 이미 시스템팀의 필드 편집을 허용한다(`server/src/routes/requests.ts:171`):

```tsx
  const canEdit = isSystemUser || (v.requester_id === profile?.id && v.status === '접수')
```

요약바 다음(타임라인 위)에 패널을 렌더한다:

```tsx
      {isSystemUser && (
        <AdminPanel
          requestId={id}
          status={v.status as RequestStatus}
          assigneeId={v.assignee_id ?? null}
          impact={(v.impact as ImpactLevel) ?? null}
          priorityLevel={v.priority_level ?? null}
        />
      )}
```

`RequestStatus`·`ImpactLevel` 타입 import를 파일 상단에 추가한다.

- [ ] **Step 4: 타입체크 + 브라우저 확인**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 오류 없음.

브라우저에서 시스템팀 계정으로 관리보드 카드를 클릭해 확인한다:
- 관리 패널이 보이고, 담당자·상태·영향도 select가 동작한다.
- 상태 select에서 불허 전이는 `(불가)`로 비활성이다.
- 보류·반려 선택 시 사유 모달이 뜬다.
- 영향도를 바꾸면 옆의 P뱃지가 재산정된 값으로 바뀐다.
- 미배정 건에서는 영향도 select가 비활성이고 안내문이 보인다.
- 요청자 계정으로 같은 요청을 열면 패널이 아예 없다.

- [ ] **Step 5: 커밋**

```bash
git add src/features/requests/AdminPanel.tsx src/features/requests/RequestDetail.tsx src/features/requests/api.ts
git commit -m "feat(requests): 요청 상세에 시스템팀 관리 패널 추가

담당자·상태·영향도를 상세 화면에서 바로 바꾼다. 보류·반려는 사유 모달을 거친다.
필드 편집 권한을 시스템팀으로 확장 (서버는 이미 허용하고 있었다).
RequestDetail이 커서 패널은 AdminPanel.tsx로 분리."
```

---

### Task 5: 문서 동기화

**Files:**
- Modify: `docs/reference/requirements.md` — 보드 구성(124-131행 부근)·상세 화면 권한·신규 엔드포인트, `last_updated`
- Modify: `CHANGELOG.md` — `Unreleased`

- [ ] **Step 1: `requirements.md` 갱신**

frontmatter의 `last_updated`를 `2026-07-13`으로 바꾼다.

보드 구성 절의 트리아지 존 항목을 다음으로 교체한다:

```markdown
- **트리아지 존(미배정 큐)**: `status='접수' && assignee 없음` 건을 보드 상단에 별도 표시. "배정" 버튼 클릭 시 담당자+영향도 선택 모달 → `POST /api/requests/:id/assign` 호출. 배정 완료 시 진행중으로 자동 전이. 진행중 카드를 큐에 드롭하면 배정 취소(→ 접수).
- **칸반 접수 컬럼**: `status='접수' && assignee 있음` 건만 표시. 미배정 큐와 배타적이므로 접수 건은 정확히 한 곳에만 나타난다. 배정 버튼은 배정과 동시에 진행중으로 보내므로 이 컬럼은 인라인·벌크로 담당자만 붙인 예외 건을 담는다.
```

요청 상세 절에 관리 패널 항목을 추가한다:

```markdown
- **관리 패널(시스템팀 전용)**: 상세 화면 요약바 아래에 담당자·상태·영향도 select 노출. 상태는 `ALLOWED_TRANSITIONS` 기준으로 불허 전이를 비활성 처리하고, 보류·반려는 사유 입력 모달을 거친다. 영향도는 배정된 건에서만 조정 가능하며 `priority_level`과 SLA 기한이 재산정된다. 필드 편집(제목·본문·긴급도·희망완료일)은 시스템팀 또는 (요청자 본인 && 접수)일 때 가능하다.
```

API 계약 절에 엔드포인트를 추가한다:

```markdown
- `PATCH /api/requests/:id/impact` — 영향도 재조정. 시스템팀 전용. body `{ impact: 높음|보통|낮음 }`. `priority_level`·`response_due_at`·`resolution_due_at`·`sla_policy_id`를 재산정한다. `assigned_at`·`first_response_at`·`status`는 보존. 미배정 건 400 `NOT_ASSIGNED`, 종결(완료·반려·철회) 건 400 `CLOSED`.
```

- [ ] **Step 2: `CHANGELOG.md`의 `Unreleased`에 추가**

```markdown
### Added
- **요청 상세 관리 패널** (`src/features/requests/AdminPanel.tsx`): 시스템팀 전용. 담당자·상태·영향도를 상세 화면에서 직접 변경. 불허 전이는 비활성, 보류·반려는 사유 모달. 필드 편집 권한을 시스템팀으로 확장.
- **영향도 재조정 API** (`server/src/services/impact.ts`, `PATCH /api/requests/:id/impact`): 배정 후에도 영향도를 바꿔 `priority_level`·SLA 기한을 재산정. 미배정·종결 건은 거부. 테스트 `test:impact` 3건 신설.

### Changed
- **관리보드 접수 영역 분할** (`src/features/board/ManageBoard.tsx`): 미배정 큐는 `접수+미배정`, 칸반 접수 컬럼은 `접수+배정`으로 배타 분할해 중복 표시 제거. 미배정 큐에 드롭 핸들러를 추가해 진행중 카드를 큐에 놓으면 배정 취소.
- **SLA 계산 공용화** (`server/src/services/sla-fields.ts`): 우선순위·기한 계산을 배정과 영향도 재조정이 공유. 동작 변경 없음.
```

- [ ] **Step 3: 전체 검증**

```bash
cd server && npm run typecheck && npm run test:impact && npm run test:assign && npm run test:transition && npm run db:smoke
cd .. && npx tsc -p tsconfig.app.json --noEmit
```

Expected: 전부 PASS.

- [ ] **Step 4: 커밋**

```bash
git add docs/reference/requirements.md CHANGELOG.md
git commit -m "docs: 접수 영역 분할·관리 패널·impact API 문서 동기화"
```

---

## 검증 요약

| 대상 | 명령 | 기대 |
|------|------|------|
| 영향도 재조정 | `cd server && npm run test:impact` | 3/3 PASS |
| 배정 회귀 (계산식 불변) | `cd server && npm run test:assign` | 3/3 PASS |
| 전이 회귀 (되돌리기 포함) | `cd server && npm run test:transition` | 6/6 PASS |
| 서버 타입 | `cd server && npm run typecheck` | 오류 없음 |
| 웹 타입 | `npx tsc -p tsconfig.app.json --noEmit` | 오류 없음 |
| 보드 분할 | 브라우저, 담당자 필터 전체 | 미배정 접수 건이 큐에만 표시 |
| 관리 패널 | 브라우저, 시스템팀/요청자 각각 | 시스템팀만 패널 노출 |
