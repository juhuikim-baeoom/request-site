# 완료 검수 단계와 이의제기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 완료 처리된 요청을 요청자가 검수하고, 잘못 처리됐다면 이의를 제기해 재작업으로 되돌릴 수 있게 한다.

**Architecture:** `검수대기` 상태를 추가해 `진행중 → 완료` 직행을 막고, 완료로 가는 경로를 요청자 확인 · 7일 자동완료 · 시스템팀 강제완료 셋으로 나눠 `completion_route`에 기록한다. 최종 완료 후의 이의제기는 상태값이 아니라 `request_disputes` 테이블에 쌓고, 시스템팀이 수락할 때만 기존 `완료 → 진행중` 전이를 재사용해 재작업으로 되돌린다.

**Tech Stack:** Fastify 5 · drizzle-orm · Postgres 16 · React 18 · TanStack Query · Tailwind

**Spec:** `docs/superpowers/specs/2026-07-12-completion-inspection-and-dispute-design.md`

## Global Constraints

- **테스트 방식**: 이 프로젝트에는 테스트 프레임워크가 없다. `server/scripts/test-*.ts`에 `node:assert/strict` 기반 스크립트를 쓰고 `server/package.json`에 `test:*` npm script를 등록해 `npm run test:<name>`으로 실행한다. 기존 `server/scripts/test-transition.ts`가 참고 패턴이다. 테스트는 자기가 만든 행을 끝에서 지운다.
- **DB는 Docker Postgres 16**. 테스트 전에 `docker compose up -d`와 `cd server && npm run db:migrate`가 되어 있어야 한다.
- **RLS 없음**. 권한은 앱 계층 `server/src/authz.ts`(`isSystem`, `canSeeRequest`)에서 강제한다. `withUser(userId, fn)`이 세팅하는 `app.user_id`는 RLS가 아니라 `on_status_change` 트리거의 변경자 기록용이다.
- **마이그레이션은 forward-only**. 이미 적용된 파일(`0000`~`0004`)은 편집 금지. 새 파일을 만들면 `server/drizzle/meta/_journal.json`에 항목을 반드시 추가한다 (`0004`에서 누락된 전례가 있다).
- **Postgres enum 제약**: `ALTER TYPE ... ADD VALUE`로 추가한 값은 같은 트랜잭션에서 사용할 수 없다. drizzle 마이그레이터는 파일 하나를 한 트랜잭션으로 실행하므로 enum 추가(`0005`)와 그 값의 사용(`0006`)을 반드시 다른 파일로 분리한다.
- **DB 네이밍 (CLAUDE.md §2)**: 신규 테이블·컬럼은 예약어 `status` 단독 사용 금지(`status_cd`), 코드값은 영문 `SCREAMING_SNAKE_CASE`, 감사 컬럼 `created_at`/`updated_at` 필수. 단 기존 `requests.status`의 한글 enum 값은 레거시로 그대로 유지한다.
- **코드값**: `completion_route`는 `REQUESTER` | `AUTO` | `SYSTEM_FORCED`. `request_disputes.status_cd`는 `OPEN` | `ACCEPTED` | `REJECTED`.
- **검수 기한 7일, 리마인더 3일, 이의제기 기한 완료 후 14일.** 이 수치는 `server/src/services/inspection.ts`에 상수로 모아 한 곳에서만 정의한다.
- **문서 동기화 (CLAUDE.md §1)**: 이 작업은 `docs/reference/db-schema.md`, `docs/reference/requirements.md`, `CHANGELOG.md` 갱신을 포함한다 (Task 10).

---

## File Structure

| 파일 | 책임 |
|------|------|
| `server/drizzle/0005_add_inspection_enums.sql` (생성) | enum 값 추가만 |
| `server/drizzle/0006_inspection_and_disputes.sql` (생성) | 컬럼·테이블·트리거·뷰 |
| `server/src/db/schema.ts` (수정) | drizzle 스키마에 새 enum 값·컬럼·`requestDisputes` 테이블 반영 |
| `server/src/services/inspection.ts` (생성) | 검수·이의제기 정책 상수 및 기한 계산. 다른 모듈이 7/3/14를 직접 쓰지 않게 하는 단일 출처 |
| `server/src/services/transition.ts` (수정) | 전이 매트릭스, `completion_route` 세팅 |
| `server/src/services/disputes.ts` (생성) | 이의 생성·심사 도메인 로직 (트랜잭션 경계 포함) |
| `server/src/routes/requests.ts` (수정) | 요청자 검수 승인·재작업 권한 분기, CSAT 동반 예외 |
| `server/src/routes/disputes.ts` (생성) | 이의 HTTP 라우트 |
| `server/src/jobs/auto-complete.ts` (생성) | 자동완료·리마인더 배치 |
| `server/src/routes/dashboard.ts` (수정) | 신규 지표 4종 |
| `src/types/database.ts` (수정) | `RequestStatus`에 `검수대기`, `RequestDispute` 타입 |
| `src/lib/constants.ts` (수정) | 상태 목록·전이 매트릭스·뱃지 |
| `src/features/requests/api.ts` (수정) | 이의제기 API 클라이언트 |
| `src/features/requests/InspectionPanel.tsx` (생성) | 요청자 검수 패널 + CSAT 모달 |
| `src/features/requests/DisputePanel.tsx` (생성) | 이의제기 버튼·심사 UI |
| `src/features/requests/RequestDetail.tsx` (수정) | 위 두 패널 삽입 |
| `src/features/dashboard/Dashboard.tsx` (수정) | 검수대기 컬럼, 이의 배너, 신규 지표 |

`RequestDetail.tsx`가 이미 783줄이라 검수·이의 UI를 그 안에 직접 넣으면 통제가 안 된다. 두 패널을 별도 파일로 뽑아 `RequestDetail`은 조립만 하게 한다.

---

## Task 1: 마이그레이션 — enum 값 추가

**Files:**
- Create: `server/drizzle/0005_add_inspection_enums.sql`
- Modify: `server/drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `request_status` enum의 `검수대기` 값, `notification_type` enum의 `dispute` 값. Task 2 이후 전부가 의존한다.

- [ ] **Step 1: 마이그레이션 파일 작성**

`server/drizzle/0005_add_inspection_enums.sql`:

```sql
-- enum 값 추가는 별도 파일로 분리한다.
-- Postgres는 ALTER TYPE ... ADD VALUE로 추가한 값을 같은 트랜잭션에서 사용할 수 없고
-- (unsafe use of new value of enum type), drizzle 마이그레이터는 파일 하나를 한 트랜잭션으로 실행한다.
-- 새 값을 참조하는 컬럼·테이블·트리거·뷰는 0006에 있다.
ALTER TYPE "public"."request_status" ADD VALUE IF NOT EXISTS '검수대기' AFTER '진행중';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'dispute';
```

- [ ] **Step 2: journal에 등록**

`server/drizzle/meta/_journal.json`의 `entries` 배열 끝에 추가:

```json
    {
      "idx": 5,
      "version": "7",
      "when": 1784000000000,
      "tag": "0005_add_inspection_enums",
      "breakpoints": true
    }
```

- [ ] **Step 3: 마이그레이션 실행**

```bash
docker compose up -d
cd server && npm run db:migrate
```

Expected: `migrations applied`

- [ ] **Step 4: enum 값이 실제로 들어갔는지 확인**

```bash
psql "$DATABASE_URL" -c "select unnest(enum_range(null::request_status));"
```

Expected: 출력에 `검수대기`가 `진행중`과 `보류` 사이에 포함된다.

```bash
psql "$DATABASE_URL" -c "select unnest(enum_range(null::notification_type));"
```

Expected: 출력에 `dispute`가 포함된다.

- [ ] **Step 5: 커밋**

```bash
git add server/drizzle/0005_add_inspection_enums.sql server/drizzle/meta/_journal.json
git commit -m "feat(db): request_status에 검수대기, notification_type에 dispute enum 값 추가"
```

---

## Task 2: 마이그레이션 — 컬럼·테이블·트리거·뷰

**Files:**
- Create: `server/drizzle/0006_inspection_and_disputes.sql`
- Modify: `server/drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: Task 1의 `검수대기` enum 값.
- Produces:
  - `requests.inspection_due_at timestamptz`, `requests.completion_route varchar(16)`
  - `request_disputes` 테이블 (컬럼: `id`, `request_id`, `raised_by`, `reason`, `status_cd`, `reviewed_by`, `review_comment`, `reviewed_at`, `created_at`, `updated_at`)
  - `request_view.has_open_dispute boolean`
  - `on_status_change()` 트리거 함수 (검수대기 진입 시 `first_resolved_at`·`inspection_due_at` 세팅, `검수대기 → 진행중`도 `rework_count` 증가)

- [ ] **Step 1: 마이그레이션 파일 작성**

`server/drizzle/0006_inspection_and_disputes.sql`:

```sql
-- 검수대기 단계 + 이의제기.
-- 새 enum 값(검수대기)은 0005에서 이미 커밋됐으므로 여기서 안전하게 참조할 수 있다.

-- ① requests 신규 컬럼
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "inspection_due_at" timestamptz;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "completion_route" varchar(16);--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_completion_route_check"
  CHECK ("completion_route" IS NULL OR "completion_route" IN ('REQUESTER', 'AUTO', 'SYSTEM_FORCED'));--> statement-breakpoint

-- ② 이의제기 테이블
CREATE TABLE IF NOT EXISTS "request_disputes" (
  "id"             bigserial PRIMARY KEY,
  "request_id"     bigint NOT NULL REFERENCES "requests"("id") ON DELETE CASCADE,
  "raised_by"      uuid   NOT NULL REFERENCES "users"("id"),
  "reason"         text   NOT NULL,
  "status_cd"      varchar(16) NOT NULL DEFAULT 'OPEN'
                   CHECK ("status_cd" IN ('OPEN', 'ACCEPTED', 'REJECTED')),
  "reviewed_by"    uuid REFERENCES "users"("id"),
  "review_comment" text,
  "reviewed_at"    timestamptz,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

-- 한 요청에 동시에 열린 이의는 1건만
CREATE UNIQUE INDEX IF NOT EXISTS "request_disputes_one_open"
  ON "request_disputes" ("request_id") WHERE "status_cd" = 'OPEN';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_request_disputes_request"
  ON "request_disputes" ("request_id");--> statement-breakpoint

-- ③ on_status_change 트리거 교체
--    검수대기 진입 = 팀이 손을 뗀 시점 → 해결 SLA 판정 기준
--    최종 완료 = 요청자가 납득한 시점 → 종결 리드타임 기준
CREATE OR REPLACE FUNCTION on_status_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE uid uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF new.status IS DISTINCT FROM old.status THEN
    INSERT INTO request_status_history (request_id, from_status, to_status, changed_by)
    VALUES (new.id, old.status, new.status, uid);

    IF new.status = '검수대기' THEN
      -- 팀 작업 종료 시점. 재작업 후 재진입해도 first_resolved_at은 최초값을 보존한다.
      new.first_resolved_at := coalesce(new.first_resolved_at, now());
      new.inspection_due_at := now() + interval '7 days';
      IF new.resolution_due_at IS NOT NULL AND now() > new.resolution_due_at THEN
        new.sla_resolution_breached := true;
      END IF;

    ELSIF new.status = '완료' THEN
      new.completed_at      := coalesce(new.completed_at, now());
      new.first_resolved_at := coalesce(new.first_resolved_at, now());
      new.final_resolved_at := now();
      new.inspection_due_at := null;

    ELSIF old.status IN ('완료', '검수대기') AND new.status = '진행중' THEN
      -- 재작업: 검수 반려(검수대기→진행중)와 이의 수락(완료→진행중) 둘 다 카운트한다.
      new.completed_at             := null;
      new.final_resolved_at        := null;
      new.inspection_due_at        := null;
      new.completion_route         := null;
      new.rework_count             := new.rework_count + 1;
      new.sla_resolution_breached  := false;  -- 재작업은 SLA 안에 끝낼 수 있다

    ELSIF old.status = '완료' THEN
      new.completed_at      := null;
      new.final_resolved_at := null;
      new.completion_route  := null;
    END IF;
  END IF;
  RETURN new;
END $$;--> statement-breakpoint

-- ④ request_view 교체: has_open_dispute 추가, due_status 종결 목록에 검수대기 포함
--    검수대기는 팀이 손을 뗀 상태이므로 요청자가 늦게 확인해도 기한초과로 표시하지 않는다.
CREATE OR REPLACE VIEW request_view AS
SELECT
  r.*,
  t.label AS type_label,
  CASE WHEN r.first_resolved_at IS NOT NULL
       THEN (r.first_resolved_at::date - r.created_at::date) END AS first_lead_days,
  CASE WHEN r.final_resolved_at IS NOT NULL
       THEN (r.final_resolved_at::date - r.created_at::date) END AS final_lead_days,
  CASE
    WHEN r.status IN ('완료','반려','철회','검수대기') THEN r.status::text
    WHEN r.resolution_due_at IS NOT NULL AND now() > r.resolution_due_at THEN '기한초과'
    WHEN r.resolution_due_at IS NOT NULL AND r.resolution_due_at - now() < interval '4 hour' THEN '임박'
    ELSE '여유'
  END AS due_status,
  EXISTS (
    SELECT 1 FROM request_disputes d
    WHERE d.request_id = r.id AND d.status_cd = 'OPEN'
  ) AS has_open_dispute
FROM requests r
LEFT JOIN request_types t ON t.code = r.type_code;
```

- [ ] **Step 2: journal에 등록**

`server/drizzle/meta/_journal.json`의 `entries` 배열 끝에 추가:

```json
    {
      "idx": 6,
      "version": "7",
      "when": 1784000000001,
      "tag": "0006_inspection_and_disputes",
      "breakpoints": true
    }
```

- [ ] **Step 3: 마이그레이션 실행**

```bash
cd server && npm run db:migrate
```

Expected: `migrations applied`

- [ ] **Step 4: 뷰와 테이블 확인**

```bash
psql "$DATABASE_URL" -c "select has_open_dispute from request_view limit 1;"
psql "$DATABASE_URL" -c "\d request_disputes"
```

Expected: `has_open_dispute` 컬럼이 조회되고, `request_disputes` 테이블에 `status_cd` CHECK 제약과 부분 유니크 인덱스 `request_disputes_one_open`이 보인다.

- [ ] **Step 5: 커밋**

```bash
git add server/drizzle/0006_inspection_and_disputes.sql server/drizzle/meta/_journal.json
git commit -m "feat(db): 검수대기 컬럼·request_disputes 테이블·트리거·뷰 추가"
```

---

## Task 3: drizzle 스키마 + 검수 정책 상수

**Files:**
- Modify: `server/src/db/schema.ts:9-18` (enum), `server/src/db/schema.ts:75` 이후 (requests 컬럼), 파일 끝 (새 테이블)
- Create: `server/src/services/inspection.ts`

**Interfaces:**
- Consumes: Task 2의 DB 구조.
- Produces:
  - `requestDisputes` (drizzle 테이블), `disputeStatusCd` 타입
  - `INSPECTION_DAYS = 7`, `INSPECTION_REMINDER_DAYS = 3`, `DISPUTE_WINDOW_DAYS = 14`
  - `isDisputable(completedAt: Date | null): boolean`
  - `CompletionRoute = 'REQUESTER' | 'AUTO' | 'SYSTEM_FORCED'`

- [ ] **Step 1: drizzle 스키마의 enum 갱신**

`server/src/db/schema.ts`의 `requestStatus`에 `'검수대기'`를 `'진행중'` 뒤에, `notificationType`에 `'dispute'`를 추가한다. DB의 enum 순서와 일치시킨다.

```ts
export const requestStatus = pgEnum('request_status', [
  '접수', '진행중', '검수대기', '보류', '완료', '반려', '철회',
])
export const notificationType = pgEnum('notification_type', ['assigned', 'status', 'comment', 'dispute'])
```

- [ ] **Step 2: requests 테이블에 신규 컬럼 추가**

`server/src/db/schema.ts`의 `requests` 정의에 두 컬럼을 추가한다 (`reworkCount` 근처):

```ts
  inspectionDueAt: timestamp('inspection_due_at', { withTimezone: true }),
  completionRoute: varchar('completion_route', { length: 16 }),
```

`varchar`가 상단 import에 없으면 `drizzle-orm/pg-core` import 목록에 추가한다.

- [ ] **Step 3: request_disputes 테이블 정의 추가**

`server/src/db/schema.ts` 끝에 추가:

```ts
export const requestDisputes = pgTable('request_disputes', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  requestId: bigint('request_id', { mode: 'number' }).notNull().references(() => requests.id, { onDelete: 'cascade' }),
  raisedBy: uuid('raised_by').notNull().references(() => users.id),
  reason: text('reason').notNull(),
  statusCd: varchar('status_cd', { length: 16 }).notNull().default('OPEN'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewComment: text('review_comment'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  requestIdx: index('idx_request_disputes_request').on(t.requestId),
}))
```

`bigserial`, `varchar`, `index`가 상단 `drizzle-orm/pg-core` import에 없으면 추가한다. 이 스키마 정의는 쿼리용이며 `db:generate`를 돌리지 않는다 — 마이그레이션은 손으로 쓴 `0005`/`0006`이 SSOT다.

- [ ] **Step 4: 검수 정책 상수 모듈 작성**

`server/src/services/inspection.ts`:

```ts
/**
 * 검수·이의제기 정책 상수.
 * 7 / 3 / 14 라는 수치를 다른 모듈이 직접 쓰지 않도록 여기에만 둔다.
 */
export const INSPECTION_DAYS = 7           // 검수대기 → 자동완료까지
export const INSPECTION_REMINDER_DAYS = 3  // 검수대기 진입 후 리마인더 발송 시점
export const DISPUTE_WINDOW_DAYS = 14      // 최종 완료 후 이의제기 가능 기간

export type CompletionRoute = 'REQUESTER' | 'AUTO' | 'SYSTEM_FORCED'
export type DisputeStatusCd = 'OPEN' | 'ACCEPTED' | 'REJECTED'

/** 최종 완료 시각 기준으로 아직 이의제기가 가능한지 */
export function isDisputable(completedAt: Date | null, now: Date = new Date()): boolean {
  if (completedAt === null) return false
  const deadline = new Date(completedAt.getTime() + DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  return now <= deadline
}
```

- [ ] **Step 5: 타입 체크**

```bash
cd server && npm run typecheck
```

Expected: 에러 없음. `transition.ts`의 `RequestStatus` 유니온에 `검수대기`가 없어 생기는 에러는 Task 4에서 고치므로, 이 시점에 `transition.ts` 관련 에러가 나오면 Task 4로 넘어가기 전 임시로 두지 말고 Step 6 커밋 후 바로 Task 4를 진행한다.

- [ ] **Step 6: 커밋**

```bash
git add server/src/db/schema.ts server/src/services/inspection.ts
git commit -m "feat(server): drizzle 스키마에 검수대기·request_disputes 반영, 검수 정책 상수 추가"
```

---

## Task 4: 전이 서비스 — 검수대기 매트릭스와 completion_route

**Files:**
- Modify: `server/src/services/transition.ts`
- Test: `server/scripts/test-transition.ts` (기존 파일에 케이스 추가)
- Modify: `server/package.json` (스크립트는 이미 있음 — `test:transition`)

**Interfaces:**
- Consumes: Task 3의 `CompletionRoute`.
- Produces: `changeStatus({ reqId, to, reason, actorId, completionRoute? })`. `to === '완료'`일 때 `completionRoute`는 필수이며, 없으면 `TransitionError('MISSING_COMPLETION_ROUTE')`를 던진다.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/scripts/test-transition.ts`의 케이스 (5) 뒤, `await app.close()` 앞에 추가한다.

```ts
// ──────────────────────────────────────────
// (6) 진행중 → 완료 직행 금지 (검수대기를 반드시 거친다)
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  let threw = false
  try {
    await changeStatus({ reqId: req.id, to: '완료', actorId, completionRoute: 'SYSTEM_FORCED' })
  } catch (e: any) {
    assert.equal(e.code, 'ILLEGAL_TRANSITION')
    threw = true
  }
  assert.ok(threw, '진행중 → 완료 직행은 막혀야 함')
  console.log('(6) 진행중 → 완료 직행 금지 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (7) 진행중 → 검수대기: first_resolved_at·inspection_due_at 세팅
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '검수대기', actorId })
  const cur = await db.execute<any>(sql`
    select status, first_resolved_at, inspection_due_at, completed_at
    from requests where id = ${req.id}`)
  const r = cur.rows[0]
  assert.equal(r.status, '검수대기')
  assert.ok(r.first_resolved_at !== null, 'first_resolved_at 세팅됨')
  assert.ok(r.inspection_due_at !== null, 'inspection_due_at 세팅됨')
  assert.equal(r.completed_at, null, '아직 완료가 아니므로 completed_at은 null')
  const days = (new Date(r.inspection_due_at).getTime() - Date.now()) / 86_400_000
  assert.ok(days > 6.9 && days < 7.1, `inspection_due_at은 약 7일 뒤여야 함 (실제 ${days})`)
  console.log('(7) 진행중 → 검수대기 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (8) 검수대기 → 완료: completion_route 기록
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '검수대기', actorId })
  await changeStatus({ reqId: req.id, to: '완료', actorId, completionRoute: 'REQUESTER' })
  const cur = await db.execute<any>(sql`
    select status, completion_route, completed_at, final_resolved_at, inspection_due_at
    from requests where id = ${req.id}`)
  const r = cur.rows[0]
  assert.equal(r.status, '완료')
  assert.equal(r.completion_route, 'REQUESTER')
  assert.ok(r.completed_at !== null, 'completed_at 세팅됨')
  assert.ok(r.final_resolved_at !== null, 'final_resolved_at 세팅됨')
  assert.equal(r.inspection_due_at, null, '완료되면 inspection_due_at은 비워짐')
  console.log('(8) 검수대기 → 완료 (REQUESTER) OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (9) 검수대기 → 진행중 (검수 반려): rework_count+1
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '검수대기', actorId })
  await changeStatus({ reqId: req.id, to: '진행중', reason: '엉뚱한 데이터가 나왔습니다', actorId })
  const cur = await db.execute<any>(sql`
    select status, rework_count, rework_reason, inspection_due_at
    from requests where id = ${req.id}`)
  const r = cur.rows[0]
  assert.equal(r.status, '진행중')
  assert.equal(r.rework_count, 1, '검수 반려도 rework_count에 잡혀야 함')
  assert.equal(r.rework_reason, '엉뚱한 데이터가 나왔습니다')
  assert.equal(r.inspection_due_at, null, '진행중으로 돌아가면 inspection_due_at은 비워짐')
  console.log('(9) 검수대기 → 진행중 rework_count+1 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (10) 완료 전이에 completionRoute 누락 시 거부
// ──────────────────────────────────────────
{
  const req = await makeRequest()
  await changeStatus({ reqId: req.id, to: '진행중', actorId })
  await changeStatus({ reqId: req.id, to: '검수대기', actorId })
  let threw = false
  try {
    await changeStatus({ reqId: req.id, to: '완료', actorId })
  } catch (e: any) {
    assert.equal(e.code, 'MISSING_COMPLETION_ROUTE')
    threw = true
  }
  assert.ok(threw, 'completionRoute 없이 완료 전이는 거부되어야 함')
  console.log('(10) completionRoute 누락 거부 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}
```

기존 케이스 (2)와 (3)도 손봐야 한다. (2)는 `접수 → 완료` 금지를 검사하므로 그대로 두되 `completionRoute: 'SYSTEM_FORCED'`를 넘겨 `MISSING_COMPLETION_ROUTE`가 아니라 `ILLEGAL_TRANSITION`이 나오는지 확인한다. (3)은 `진행중 → 완료` 직행을 쓰고 있으므로 `진행중 → 검수대기 → 완료(SYSTEM_FORCED) → 진행중` 경로로 고친다.

```ts
// (2) 수정: completionRoute를 줘도 전이 자체가 불법이어야 한다
await changeStatus({ reqId: req.id, to: '완료', actorId, completionRoute: 'SYSTEM_FORCED' })

// (3) 수정: 완료에 도달하려면 검수대기를 거친다
await changeStatus({ reqId: req.id, to: '진행중', actorId })
await changeStatus({ reqId: req.id, to: '검수대기', actorId })
await changeStatus({ reqId: req.id, to: '완료', actorId, completionRoute: 'SYSTEM_FORCED' })
// 이후 완료 → 진행중 재작업 검사는 기존과 동일. 단 rework_count는 1이 아니라
// 이 시나리오에서 처음 증가하는 것이므로 before/after 비교 방식(기존 코드)이 그대로 유효하다.
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd server && npm run test:transition
```

Expected: FAIL — `'검수대기'` 가 `RequestStatus` 타입에 없고 `completionRoute` 인자가 없어 tsx 타입 에러 또는 `ILLEGAL_TRANSITION` 발생.

- [ ] **Step 3: transition.ts 구현**

`server/src/services/transition.ts`를 아래로 교체한다.

```ts
import { sql } from 'drizzle-orm'
import { withUser } from '../db/client.js'
import { notify } from './notify.js'
import type { CompletionRoute } from './inspection.js'

export type RequestStatus = '접수' | '진행중' | '검수대기' | '보류' | '완료' | '반려' | '철회'

/** 허용된 상태 전이 맵.
 *  진행중 → 완료 직행은 없다. 완료에 도달하려면 반드시 검수대기를 거친다. */
const ALLOWED: Record<RequestStatus, RequestStatus[]> = {
  '접수':   ['진행중', '반려', '철회'],
  '진행중': ['검수대기', '보류', '반려'],
  '검수대기': ['완료', '진행중'],
  '보류':   ['진행중'],
  '완료':   ['진행중'],
  '반려':   [],
  '철회':   [],
}

export class TransitionError extends Error {
  code: string
  constructor(msg: string, code: string) {
    super(msg)
    this.code = code
  }
}

/**
 * 요청 상태 전이 서비스.
 * completed_at / first_resolved_at / final_resolved_at / inspection_due_at /
 * rework_count / sla_resolution_breached 는 on_status_change 트리거가 처리하므로
 * 이 서비스에서는 건드리지 않는다. completion_route만 여기서 세팅한다.
 *
 * TOCTOU 방지: SELECT … FOR UPDATE 와 UPDATE가 같은 트랜잭션 안에서 실행되고,
 * UPDATE WHERE 절에 AND status = ${from} 을 포함해 동시성 레이스를 막는다.
 */
export async function changeStatus({
  reqId,
  to,
  reason,
  actorId,
  completionRoute,
  tx: outerTx,
}: {
  reqId: number
  to: RequestStatus
  reason?: string
  actorId: string
  completionRoute?: CompletionRoute
  /** 이미 열린 트랜잭션 안에서 호출할 때 전달한다 (이의 수락 경로). */
  tx?: Parameters<Parameters<typeof withUser>[1]>[0]
}): Promise<{ from: RequestStatus }> {
  if (to === '완료' && completionRoute === undefined) {
    throw new TransitionError('완료 전이에는 completionRoute가 필요합니다', 'MISSING_COMPLETION_ROUTE')
  }

  let notifyInfo: { requesterId: string; seq: string } | null = null

  const run = async (tx: any) => {
    const cur = await tx.execute<{ status: RequestStatus; requester_id: string | null; seq: string | null }>(
      sql`select status, requester_id, seq from requests where id = ${reqId} for update`,
    )
    const row = cur.rows[0]
    if (!row) throw new TransitionError('요청을 찾을 수 없습니다', 'NOT_FOUND')
    const from = row.status

    if (!ALLOWED[from]?.includes(to)) {
      throw new TransitionError(`${from} → ${to} 전이는 허용되지 않습니다`, 'ILLEGAL_TRANSITION')
    }

    const sets: ReturnType<typeof sql>[] = [sql`status = ${to}`]
    if (to === '완료') {
      sets.push(sql`completion_route = ${completionRoute!}`)
      // 강제 완료 사유는 rework_reason이 아니라 별도 의미이므로 hold/reject 컬럼을 쓰지 않는다.
      // 사유는 request_status_history와 알림 메시지에 남는다.
    }
    if (to === '보류' && reason != null) {
      sets.push(sql`hold_reason = ${reason}`)
    } else if (to === '반려' && reason != null) {
      sets.push(sql`reject_reason = ${reason}`)
    } else if (to === '진행중' && (from === '완료' || from === '검수대기') && reason != null) {
      // 재작업 사유 — 검수 반려와 이의 수락 둘 다 여기에 남는다
      sets.push(sql`rework_reason = ${reason}`)
    }

    const upd = await tx.execute<{ id: number }>(sql`
      update requests
      set ${sql.join(sets, sql`, `)}
      where id = ${reqId} and status = ${from}
      returning id
    `)
    if (upd.rows.length === 0) {
      throw new TransitionError(
        `동시 변경으로 인해 전이에 실패했습니다 (${from} → ${to})`,
        'CONCURRENT_MODIFICATION',
      )
    }

    const requesterId = row.requester_id
    if (requesterId && requesterId !== actorId) {
      notifyInfo = { requesterId, seq: row.seq ?? String(reqId) }
    }
    return { from }
  }

  const result = outerTx ? await run(outerTx) : await withUser(actorId, run)

  if (notifyInfo !== null) {
    const { requesterId, seq } = notifyInfo
    const message =
      to === '검수대기'
        ? `요청 ${seq} 작업이 완료되었습니다. 확인해주세요`
        : `요청 ${seq} 상태가 ${to}로 변경되었습니다`
    void notify(requesterId, 'status', reqId, message)
  }

  return result
}
```

`tx` 인자를 받는 이유는 Task 6의 이의 수락이 "이의 상태 갱신 + 상태 전이"를 하나의 트랜잭션으로 묶어야 하기 때문이다. 부분 실패로 "수락됐는데 상태는 완료"인 상태가 생기면 안 된다.

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd server && npm run test:transition
```

Expected: `(1)`~`(10)` 전부 OK 후 `test:transition ALL PASSED`

- [ ] **Step 5: 커밋**

```bash
git add server/src/services/transition.ts server/scripts/test-transition.ts
git commit -m "feat(server): 전이 매트릭스에 검수대기 추가, 완료 시 completion_route 기록"
```

---

## Task 5: 요청자 검수 권한 — 승인·재작업 요청

**Files:**
- Modify: `server/src/routes/requests.ts:117-171`
- Create: `server/scripts/test-inspection.ts`
- Modify: `server/package.json` (스크립트 추가)

**Interfaces:**
- Consumes: Task 4의 `changeStatus`.
- Produces: `PATCH /api/requests/:id`가 다음을 허용한다.
  - 요청자 본인 + `검수대기` + `{ status: '완료', csat_rating?, csat_comment? }` → `REQUESTER` 경로 완료
  - 요청자 본인 + `검수대기` + `{ status: '진행중', reason }` (reason 필수) → 재작업
  - 시스템팀 + `검수대기` + `{ status: '완료', reason }` (reason 필수) → `SYSTEM_FORCED` 경로 완료

- [ ] **Step 1: 실패하는 테스트 작성**

`server/scripts/test-inspection.ts`:

```ts
/**
 * 검수 권한 테스트
 * - 요청자가 검수대기 건을 승인/재작업 요청할 수 있다
 * - 시스템팀 강제완료는 사유가 필수다
 * - 남의 요청은 검수할 수 없다
 */
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, requests } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { changeStatus } from '../src/services/transition.js'

const app = await buildApp()
const cookie = await loginAsDev(app)

const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
const actorId = juhui!.id

/**
 * 테스트용 일반 직원 계정.
 * 시드에는 시스템팀(juhui) 1명뿐이므로, "요청자 ≠ 시스템팀" 시나리오를 만들려면 직접 만들어야 한다.
 */
async function ensureStaffUser(): Promise<string> {
  const email = 'test-staff@baeoom.com'
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
  if (existing) return existing.id
  const [row] = await db.insert(users).values({
    email, name: '테스트직원', role: 'staff', orgAffil: '공통', deptFunction: '교학팀',
  }).returning()
  return row.id
}

/** 검수대기 상태의 요청을 만든다. requesterId 기본값은 로그인 사용자 본인. */
async function makeInspecting(requesterId: string = actorId) {
  const [row] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '검수테스트',
    requesterId, visibility: 'dept',
  }).returning()
  await changeStatus({ reqId: row.id, to: '진행중', actorId })
  await changeStatus({ reqId: row.id, to: '검수대기', actorId })
  return row
}

// ──────────────────────────────────────────
// (1) 요청자 승인 → 완료(REQUESTER) + CSAT 저장
// ──────────────────────────────────────────
{
  const req = await makeInspecting()
  const res = await app.inject({
    method: 'PATCH', url: `/api/requests/${req.id}`, cookies: { session: cookie },
    payload: { status: '완료', csat_rating: 5, csat_comment: '빨랐습니다' },
  })
  assert.equal(res.statusCode, 200, res.body)
  const cur = await db.execute<any>(sql`
    select status, completion_route, csat_rating, csat_comment from requests where id = ${req.id}`)
  const r = cur.rows[0]
  assert.equal(r.status, '완료')
  assert.equal(r.completion_route, 'REQUESTER')
  assert.equal(r.csat_rating, 5, 'CSAT 별점 저장')
  assert.equal(r.csat_comment, '빨랐습니다')
  console.log('(1) 요청자 승인 + CSAT OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (2) 요청자 재작업 요청 — 사유 없으면 400
// ──────────────────────────────────────────
{
  const req = await makeInspecting()
  const res = await app.inject({
    method: 'PATCH', url: `/api/requests/${req.id}`, cookies: { session: cookie },
    payload: { status: '진행중' },
  })
  assert.equal(res.statusCode, 400, '사유 없는 재작업 요청은 거부')
  console.log('(2) 사유 없는 재작업 요청 거부 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (3) 요청자 재작업 요청 — 사유 있으면 진행중 복귀
// ──────────────────────────────────────────
{
  const req = await makeInspecting()
  const res = await app.inject({
    method: 'PATCH', url: `/api/requests/${req.id}`, cookies: { session: cookie },
    payload: { status: '진행중', reason: '요청한 항목이 빠졌습니다' },
  })
  assert.equal(res.statusCode, 200, res.body)
  const cur = await db.execute<any>(sql`
    select status, rework_count, rework_reason from requests where id = ${req.id}`)
  const r = cur.rows[0]
  assert.equal(r.status, '진행중')
  assert.equal(r.rework_count, 1)
  assert.equal(r.rework_reason, '요청한 항목이 빠졌습니다')
  console.log('(3) 요청자 재작업 요청 OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

// ──────────────────────────────────────────
// (4) 시스템팀 강제완료 — 사유 없으면 400
// ──────────────────────────────────────────
{
  // 남의 요청으로 만들어 owner 경로를 배제한다 (dev-login 사용자는 system 역할)
  const otherId = await ensureStaffUser()
  const req = await makeInspecting(otherId)
  const res = await app.inject({
    method: 'PATCH', url: `/api/requests/${req.id}`, cookies: { session: cookie },
    payload: { status: '완료' },
  })
  assert.equal(res.statusCode, 400, '사유 없는 강제완료는 거부')

  const ok = await app.inject({
    method: 'PATCH', url: `/api/requests/${req.id}`, cookies: { session: cookie },
    payload: { status: '완료', reason: '요청자와 구두 확인 완료' },
  })
  assert.equal(ok.statusCode, 200, ok.body)
  const cur = await db.execute<any>(sql`select completion_route from requests where id = ${req.id}`)
  assert.equal(cur.rows[0].completion_route, 'SYSTEM_FORCED')
  console.log('(4) 시스템팀 강제완료 (사유 필수) OK')
  await db.delete(requests).where(eq(requests.id, req.id))
}

await app.close()
await pool.end()
console.log('\ntest:inspection ALL PASSED')
```

- [ ] **Step 2: package.json에 스크립트 등록**

`server/package.json`의 `scripts`에 추가:

```json
    "test:inspection": "tsx scripts/test-inspection.ts",
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

```bash
cd server && npm run test:inspection
```

Expected: FAIL — 케이스 (1)에서 403. 현재 요청자에게 허용된 상태 변경은 `접수 → 철회`뿐이다.

- [ ] **Step 4: 라우트 구현**

`server/src/routes/requests.ts`의 `if (b.status !== undefined) { ... }` 블록(현재 141~162행)을 아래로 교체한다.

```ts
    // 상태 변경은 changeStatus()를 통해서만
    if (b.status !== undefined) {
      // status 변경과 내용 편집을 한 번에 허용하지 않아 stale-status 우회 방지.
      // 단 검수 승인(검수대기 → 완료)만은 CSAT를 함께 저장해야 하므로 예외로 둔다.
      const otherFields = ['title', 'body', 'urgency', 'visibility', 'desired_due', 'assignee_id']
      if (otherFields.some((k) => b[k] !== undefined)) {
        reply.code(400); return { error: 'status change and field edit must not be combined in one request' }
      }

      const isInspecting = row.status === '검수대기'
      const ownerCancel   = isOwner && row.status === '접수' && b.status === '철회'
      const ownerApprove  = isOwner && isInspecting && b.status === '완료'
      const ownerRework   = isOwner && isInspecting && b.status === '진행중'
      const systemForce   = sys && isInspecting && b.status === '완료'

      if (!sys && !ownerCancel && !ownerApprove && !ownerRework) {
        reply.code(403); return { error: 'forbidden' }
      }

      // 사유 필수: 검수 반려, 시스템팀 강제완료
      if ((ownerRework || systemForce) && !b.reason) {
        reply.code(400); return { error: 'reason required' }
      }

      // CSAT는 요청자 승인일 때만 허용한다
      const hasCsat = b.csat_rating !== undefined || b.csat_comment !== undefined
      if (hasCsat && !ownerApprove) {
        reply.code(400); return { error: 'csat allowed only on requester approval' }
      }
      if (b.csat_rating !== undefined) {
        const n = Number(b.csat_rating)
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          reply.code(400); return { error: 'csat_rating must be an integer 1-5' }
        }
      }

      let completionRoute: CompletionRoute | undefined
      if (b.status === '완료') {
        completionRoute = ownerApprove ? 'REQUESTER' : 'SYSTEM_FORCED'
      }

      try {
        await changeStatus({ reqId: id, to: b.status, reason: b.reason, actorId: u.id, completionRoute })
      } catch (e: any) {
        if (e instanceof TransitionError) {
          if (e.code === 'NOT_FOUND') { reply.code(404); return { error: 'not found' } }
          reply.code(400); return { error: e.message, code: e.code }
        }
        throw e
      }

      // 승인 CSAT는 전이 성공 후 별도 UPDATE로 기록한다 (전이 실패 시 남지 않도록)
      if (ownerApprove && hasCsat) {
        await db.execute(sql`
          update requests
          set csat_rating = ${b.csat_rating ?? null}, csat_comment = ${b.csat_comment ?? null}
          where id = ${id}`)
      }

      reply.code(200); return { ok: true }
    }
```

파일 상단 import에 `CompletionRoute`를 추가한다:

```ts
import type { CompletionRoute } from '../services/inspection.js'
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd server && npm run test:inspection && npm run test:transition && npm run test:api-hardening
```

Expected: 세 스크립트 모두 `ALL PASSED`. `test:api-hardening`은 기존 권한 회귀를 잡기 위해 함께 돌린다.

- [ ] **Step 6: 커밋**

```bash
git add server/src/routes/requests.ts server/scripts/test-inspection.ts server/package.json
git commit -m "feat(server): 요청자 검수 승인·재작업 요청 권한, 시스템팀 강제완료(사유 필수)"
```

---

## Task 6: 이의제기 — 서비스와 라우트

**Files:**
- Create: `server/src/services/disputes.ts`
- Create: `server/src/routes/disputes.ts`
- Modify: `server/src/app.ts` (라우트 등록)
- Create: `server/scripts/test-disputes.ts`
- Modify: `server/package.json`

**Interfaces:**
- Consumes: Task 3의 `isDisputable`, `DISPUTE_WINDOW_DAYS`. Task 4의 `changeStatus({ tx })`.
- Produces:
  - `raiseDispute({ reqId, raisedBy, reason }): Promise<{ id: number }>` — 던지는 코드: `NOT_COMPLETED`, `WINDOW_EXPIRED`, `ALREADY_OPEN`
  - `reviewDispute({ disputeId, decision, comment, actorId }): Promise<void>` — 던지는 코드: `NOT_FOUND`, `NOT_OPEN`
  - `class DisputeError { code: string }`
  - `POST /api/requests/:id/disputes` → 201 `{ id }`
  - `PATCH /api/disputes/:id` → 200 `{ ok: true }`
  - `GET /api/requests/:id/disputes` → 200 `{ disputes: [...] }`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/scripts/test-disputes.ts`:

```ts
/**
 * 이의제기 테스트
 * - 완료 건에만, 14일 이내에만, 동시에 1건만
 * - 수락하면 진행중 복귀 + rework_count 증가 (한 트랜잭션)
 * - 기각하면 완료 유지 + 사유 기록
 */
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, requests, requestDisputes } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { changeStatus } from '../src/services/transition.js'

const app = await buildApp()
const cookie = await loginAsDev(app)

const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
const actorId = juhui!.id

/** 완료 상태의 요청을 만든다 */
async function makeCompleted() {
  const [row] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '이의테스트',
    requesterId: actorId, visibility: 'dept',
  }).returning()
  await changeStatus({ reqId: row.id, to: '진행중', actorId })
  await changeStatus({ reqId: row.id, to: '검수대기', actorId })
  await changeStatus({ reqId: row.id, to: '완료', actorId, completionRoute: 'REQUESTER' })
  return row
}

async function cleanup(reqId: number) {
  await db.delete(requestDisputes).where(eq(requestDisputes.requestId, reqId))
  await db.delete(requests).where(eq(requests.id, reqId))
}

// ──────────────────────────────────────────
// (1) 완료 건에 이의제기 → 201, request_view.has_open_dispute = true
// ──────────────────────────────────────────
{
  const req = await makeCompleted()
  const res = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { session: cookie },
    payload: { reason: '요청한 기간이 아닙니다' },
  })
  assert.equal(res.statusCode, 201, res.body)

  const v = await db.execute<any>(sql`select has_open_dispute, status from request_view where id = ${req.id}`)
  assert.equal(v.rows[0].has_open_dispute, true, '열린 이의 플래그가 뷰에 뜬다')
  assert.equal(v.rows[0].status, '완료', '이의제기 중에도 상태는 완료로 남는다')
  console.log('(1) 이의제기 생성 OK')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (2) 같은 건에 두 번째 이의제기 → 409
// ──────────────────────────────────────────
{
  const req = await makeCompleted()
  await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { session: cookie },
    payload: { reason: '첫 번째' },
  })
  const dup = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { session: cookie },
    payload: { reason: '두 번째' },
  })
  assert.equal(dup.statusCode, 409, '동시에 열린 이의는 1건만')
  console.log('(2) 중복 이의제기 거부 OK')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (3) 완료가 아닌 건에 이의제기 → 400
// ──────────────────────────────────────────
{
  const [row] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '미완료건',
    requesterId: actorId, visibility: 'dept',
  }).returning()
  const res = await app.inject({
    method: 'POST', url: `/api/requests/${row.id}/disputes`, cookies: { session: cookie },
    payload: { reason: '아직 완료 안 됨' },
  })
  assert.equal(res.statusCode, 400)
  console.log('(3) 미완료 건 이의제기 거부 OK')
  await cleanup(row.id)
}

// ──────────────────────────────────────────
// (4) 완료 후 14일이 지난 건 → 400
// ──────────────────────────────────────────
{
  const req = await makeCompleted()
  await db.execute(sql`
    update requests set completed_at = now() - interval '15 days' where id = ${req.id}`)
  const res = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { session: cookie },
    payload: { reason: '늦게 발견' },
  })
  assert.equal(res.statusCode, 400, '이의제기 기간 만료')
  console.log('(4) 기간 만료 거부 OK')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (5) 이의 수락 → 진행중 복귀 + rework_count+1 + status_cd=ACCEPTED
// ──────────────────────────────────────────
{
  const req = await makeCompleted()
  const created = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { session: cookie },
    payload: { reason: '데이터가 틀렸습니다' },
  })
  const disputeId = JSON.parse(created.body).id

  const res = await app.inject({
    method: 'PATCH', url: `/api/disputes/${disputeId}`, cookies: { session: cookie },
    payload: { decision: 'ACCEPTED', comment: '확인했습니다. 다시 작업합니다' },
  })
  assert.equal(res.statusCode, 200, res.body)

  const r = await db.execute<any>(sql`
    select status, rework_count, rework_reason from requests where id = ${req.id}`)
  assert.equal(r.rows[0].status, '진행중', '수락하면 재작업으로 되돌아간다')
  assert.equal(r.rows[0].rework_count, 1)
  assert.equal(r.rows[0].rework_reason, '데이터가 틀렸습니다', '이의 사유가 재작업 사유로 넘어간다')

  const d = await db.execute<any>(sql`
    select status_cd, reviewed_by, reviewed_at, review_comment from request_disputes where id = ${disputeId}`)
  assert.equal(d.rows[0].status_cd, 'ACCEPTED')
  assert.equal(d.rows[0].reviewed_by, actorId)
  assert.ok(d.rows[0].reviewed_at !== null)
  assert.equal(d.rows[0].review_comment, '확인했습니다. 다시 작업합니다')
  console.log('(5) 이의 수락 → 재작업 OK')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (6) 이의 기각 → 완료 유지 + status_cd=REJECTED, 사유 필수
// ──────────────────────────────────────────
{
  const req = await makeCompleted()
  const created = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { session: cookie },
    payload: { reason: '이것도 해주세요' },
  })
  const disputeId = JSON.parse(created.body).id

  const noComment = await app.inject({
    method: 'PATCH', url: `/api/disputes/${disputeId}`, cookies: { session: cookie },
    payload: { decision: 'REJECTED' },
  })
  assert.equal(noComment.statusCode, 400, '기각에는 사유가 필수')

  const res = await app.inject({
    method: 'PATCH', url: `/api/disputes/${disputeId}`, cookies: { session: cookie },
    payload: { decision: 'REJECTED', comment: '최초 요청 범위 밖입니다. 새 요청으로 접수해주세요' },
  })
  assert.equal(res.statusCode, 200, res.body)

  const r = await db.execute<any>(sql`select status, rework_count from requests where id = ${req.id}`)
  assert.equal(r.rows[0].status, '완료', '기각하면 완료 상태가 유지된다')
  assert.equal(r.rows[0].rework_count, 0, '기각은 재작업이 아니다')

  const v = await db.execute<any>(sql`select has_open_dispute from request_view where id = ${req.id}`)
  assert.equal(v.rows[0].has_open_dispute, false, '심사가 끝나면 열린 이의가 사라진다')
  console.log('(6) 이의 기각 OK')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (7) 이미 심사된 이의를 다시 심사 → 400
// ──────────────────────────────────────────
{
  const req = await makeCompleted()
  const created = await app.inject({
    method: 'POST', url: `/api/requests/${req.id}/disputes`, cookies: { session: cookie },
    payload: { reason: '사유' },
  })
  const disputeId = JSON.parse(created.body).id
  await app.inject({
    method: 'PATCH', url: `/api/disputes/${disputeId}`, cookies: { session: cookie },
    payload: { decision: 'REJECTED', comment: '범위 밖' },
  })
  const again = await app.inject({
    method: 'PATCH', url: `/api/disputes/${disputeId}`, cookies: { session: cookie },
    payload: { decision: 'ACCEPTED', comment: '역시 맞네요' },
  })
  assert.equal(again.statusCode, 400, '이미 심사된 이의는 다시 심사할 수 없다')
  console.log('(7) 재심사 거부 OK')
  await cleanup(req.id)
}

await app.close()
await pool.end()
console.log('\ntest:disputes ALL PASSED')
```

- [ ] **Step 2: package.json에 스크립트 등록**

`server/package.json`의 `scripts`에 추가:

```json
    "test:disputes": "tsx scripts/test-disputes.ts",
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

```bash
cd server && npm run test:disputes
```

Expected: FAIL — `POST /api/requests/:id/disputes`가 없어 404.

- [ ] **Step 4: 도메인 서비스 구현**

`server/src/services/disputes.ts`:

```ts
import { sql } from 'drizzle-orm'
import { db, withUser } from '../db/client.js'
import { notify } from './notify.js'
import { changeStatus } from './transition.js'
import { isDisputable, type DisputeStatusCd } from './inspection.js'

export class DisputeError extends Error {
  code: string
  constructor(msg: string, code: string) {
    super(msg)
    this.code = code
  }
}

/**
 * 이의제기 생성.
 * 상태가 완료이고, 최종 완료 후 14일 이내이며, 열린 이의가 없을 때만 가능하다.
 * 열린 이의 중복은 부분 유니크 인덱스(request_disputes_one_open)가 최종 방어선이다.
 */
export async function raiseDispute({
  reqId, raisedBy, reason,
}: { reqId: number; raisedBy: string; reason: string }): Promise<{ id: number }> {
  const cur = await db.execute<{ status: string; completed_at: Date | null; seq: string | null }>(sql`
    select status, completed_at, seq from requests where id = ${reqId}`)
  const row = cur.rows[0]
  if (!row) throw new DisputeError('요청을 찾을 수 없습니다', 'NOT_FOUND')
  if (row.status !== '완료') {
    throw new DisputeError('완료된 요청에만 이의를 제기할 수 있습니다', 'NOT_COMPLETED')
  }
  if (!isDisputable(row.completed_at)) {
    throw new DisputeError('이의제기 기간이 지났습니다. 새 요청으로 접수해주세요', 'WINDOW_EXPIRED')
  }

  let id: number
  try {
    const ins = await db.execute<{ id: number }>(sql`
      insert into request_disputes (request_id, raised_by, reason)
      values (${reqId}, ${raisedBy}, ${reason})
      returning id`)
    id = ins.rows[0].id
  } catch (e: any) {
    // 부분 유니크 인덱스 위반 = 이미 열린 이의가 있다
    if (e?.code === '23505') {
      throw new DisputeError('이미 심사 중인 이의가 있습니다', 'ALREADY_OPEN')
    }
    throw e
  }

  // 시스템팀 전원에게 알림 (best-effort)
  const sysUsers = await db.execute<{ id: string }>(sql`select id from users where role = 'system'`)
  const seq = row.seq ?? String(reqId)
  for (const s of sysUsers.rows) {
    void notify(s.id, 'dispute', reqId, `요청 ${seq}에 이의가 제기되었습니다`)
  }

  return { id }
}

/**
 * 이의 심사.
 * ACCEPTED면 이의 갱신과 완료 → 진행중 전이를 하나의 트랜잭션으로 묶는다.
 * 부분 실패로 "수락됐는데 상태는 완료"인 상태가 생기면 안 된다.
 */
export async function reviewDispute({
  disputeId, decision, comment, actorId,
}: {
  disputeId: number
  decision: Extract<DisputeStatusCd, 'ACCEPTED' | 'REJECTED'>
  comment: string
  actorId: string
}): Promise<void> {
  let notifyInfo: { requesterId: string; reqId: number; seq: string } | null = null

  await withUser(actorId, async (tx) => {
    const cur = await tx.execute<{
      request_id: number; status_cd: string; reason: string
      requester_id: string | null; seq: string | null
    }>(sql`
      select d.request_id, d.status_cd, d.reason, r.requester_id, r.seq
      from request_disputes d
      join requests r on r.id = d.request_id
      where d.id = ${disputeId}
      for update of d`)
    const row = cur.rows[0]
    if (!row) throw new DisputeError('이의를 찾을 수 없습니다', 'NOT_FOUND')
    if (row.status_cd !== 'OPEN') {
      throw new DisputeError('이미 심사가 끝난 이의입니다', 'NOT_OPEN')
    }

    await tx.execute(sql`
      update request_disputes
      set status_cd = ${decision}, reviewed_by = ${actorId},
          review_comment = ${comment}, reviewed_at = now(), updated_at = now()
      where id = ${disputeId} and status_cd = 'OPEN'`)

    if (decision === 'ACCEPTED') {
      // 같은 트랜잭션 안에서 재작업으로 되돌린다. 이의 사유가 재작업 사유가 된다.
      await changeStatus({
        reqId: row.request_id, to: '진행중', reason: row.reason, actorId, tx,
      })
    }

    if (row.requester_id && row.requester_id !== actorId) {
      notifyInfo = {
        requesterId: row.requester_id,
        reqId: row.request_id,
        seq: row.seq ?? String(row.request_id),
      }
    }
  })

  if (notifyInfo !== null) {
    const { requesterId, reqId, seq } = notifyInfo
    const message =
      decision === 'ACCEPTED'
        ? `요청 ${seq} 이의가 수락되어 재작업이 시작되었습니다`
        : `요청 ${seq} 이의가 기각되었습니다: ${comment}`
    void notify(requesterId, 'dispute', reqId, message)
  }
}
```

`changeStatus`가 `tx`를 받으면 자체 트랜잭션을 열지 않고 넘겨받은 트랜잭션에서 실행되지만, 이 경우 `changeStatus` 내부의 알림 발송은 커밋 전에 예약된다. 이의 수락 알림은 위 `reviewDispute`에서 별도로 보내므로 중복이 생긴다. 이를 막기 위해 `changeStatus` 호출부에서 `actorId`를 그대로 넘겨 요청자 == actor가 아닌 경우에만 상태 알림이 나가는 기존 동작을 유지하되, 이의 수락 시나리오에서는 상태 알림("진행중으로 변경되었습니다")과 이의 알림("이의가 수락되어…")이 둘 다 유용하므로 그대로 둔다.

- [ ] **Step 5: 라우트 구현**

`server/src/routes/disputes.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { isSystem, canSeeRequest } from '../authz.js'
import { raiseDispute, reviewDispute, DisputeError } from '../services/disputes.js'

function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** DisputeError 코드를 HTTP 상태로 매핑 */
function statusFor(code: string): number {
  switch (code) {
    case 'NOT_FOUND': return 404
    case 'ALREADY_OPEN': return 409
    default: return 400
  }
}

export async function disputeRoutes(app: FastifyInstance): Promise<void> {
  // 이의 목록 — 해당 요청을 볼 수 있는 사람만
  app.get<{ Params: { id: string } }>('/api/requests/:id/disputes', async (request, reply) => {
    const u = request.currentUser!
    const id = parseId(request.params.id)
    if (id === null) { reply.code(404); return { error: 'not found' } }

    const cur = await db.execute<any>(sql`
      select requester_id, visibility, requester_org, requester_function
      from requests where id = ${id}`)
    const row = cur.rows[0]
    if (!row) { reply.code(404); return { error: 'not found' } }

    const shared = await db.execute<any>(sql`
      select target_type, target_value from request_shared_targets where request_id = ${id}`)
    const visible = canSeeRequest(
      u,
      {
        requesterId: row.requester_id,
        visibility: row.visibility,
        requesterOrg: row.requester_org,
        requesterFunction: row.requester_function,
      },
      shared.rows.map((s: any) => ({ targetType: s.target_type, targetValue: s.target_value })),
    )
    if (!visible) { reply.code(403); return { error: 'forbidden' } }

    const list = await db.execute<any>(sql`
      select d.id, d.reason, d.status_cd, d.review_comment, d.reviewed_at, d.created_at,
             ru.name as raised_by_name, vu.name as reviewed_by_name
      from request_disputes d
      left join users ru on ru.id = d.raised_by
      left join users vu on vu.id = d.reviewed_by
      where d.request_id = ${id}
      order by d.created_at desc`)
    return { disputes: list.rows }
  })

  // 이의제기 — 요청자 본인만
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/requests/:id/disputes',
    async (request, reply) => {
      const u = request.currentUser!
      const id = parseId(request.params.id)
      if (id === null) { reply.code(404); return { error: 'not found' } }

      const reason = request.body?.reason?.trim()
      if (!reason) { reply.code(400); return { error: 'reason required' } }

      const cur = await db.execute<{ requester_id: string | null }>(sql`
        select requester_id from requests where id = ${id}`)
      const row = cur.rows[0]
      if (!row) { reply.code(404); return { error: 'not found' } }
      if (row.requester_id !== u.id) {
        reply.code(403); return { error: 'forbidden: only the requester can dispute' }
      }

      try {
        const created = await raiseDispute({ reqId: id, raisedBy: u.id, reason })
        reply.code(201); return created
      } catch (e: any) {
        if (e instanceof DisputeError) {
          reply.code(statusFor(e.code)); return { error: e.message, code: e.code }
        }
        throw e
      }
    },
  )

  // 이의 심사 — 시스템팀만
  app.patch<{ Params: { id: string }; Body: { decision?: string; comment?: string } }>(
    '/api/disputes/:id',
    async (request, reply) => {
      const u = request.currentUser!
      if (!isSystem(u)) { reply.code(403); return { error: 'forbidden' } }

      const id = parseId(request.params.id)
      if (id === null) { reply.code(404); return { error: 'not found' } }

      const decision = request.body?.decision
      if (decision !== 'ACCEPTED' && decision !== 'REJECTED') {
        reply.code(400); return { error: 'decision must be ACCEPTED or REJECTED' }
      }
      const comment = request.body?.comment?.trim()
      if (!comment) { reply.code(400); return { error: 'comment required' } }

      try {
        await reviewDispute({ disputeId: id, decision, comment, actorId: u.id })
        reply.code(200); return { ok: true }
      } catch (e: any) {
        if (e instanceof DisputeError) {
          reply.code(statusFor(e.code)); return { error: e.message, code: e.code }
        }
        throw e
      }
    },
  )
}
```

- [ ] **Step 6: 라우트 등록**

`server/src/app.ts`에 import와 register를 추가한다.

```ts
import { disputeRoutes } from './routes/disputes.js'
```

`await app.register(notificationRoutes)` 뒤에:

```ts
  await app.register(disputeRoutes)
```

- [ ] **Step 7: 테스트 통과 확인**

```bash
cd server && npm run test:disputes
```

Expected: `(1)`~`(7)` 전부 OK 후 `test:disputes ALL PASSED`

- [ ] **Step 8: 커밋**

```bash
git add server/src/services/disputes.ts server/src/routes/disputes.ts server/src/app.ts server/scripts/test-disputes.ts server/package.json
git commit -m "feat(server): 이의제기 생성·심사 API — 수락 시 재작업 전이를 한 트랜잭션으로"
```

---

## Task 7: 자동완료 배치와 리마인더

**Files:**
- Create: `server/src/jobs/auto-complete.ts`
- Modify: `server/src/index.ts` (배치 기동)
- Modify: `server/src/db/schema.ts` (`requests`에 `inspectionReminderSentAt` 추가)
- Create: `server/drizzle/0007_inspection_reminder.sql`, journal 등록
- Create: `server/scripts/test-auto-complete.ts`
- Modify: `server/package.json`

**Interfaces:**
- Consumes: Task 4의 `changeStatus`, Task 3의 `INSPECTION_REMINDER_DAYS`.
- Produces:
  - `runAutoComplete(): Promise<{ completed: number; reminded: number }>` — 배치 1회 실행. 테스트가 직접 호출한다.
  - `startAutoCompleteJob(app): void` — 1시간 주기 `setInterval` 기동.

리마인더를 건당 1회만 보내려면 "이미 보냈다"는 사실을 저장해야 한다. `requests.inspection_reminder_sent_at` 컬럼을 추가한다.

- [ ] **Step 1: 마이그레이션 작성**

`server/drizzle/0007_inspection_reminder.sql`:

```sql
-- 검수 리마인더를 건당 1회만 보내기 위한 발송 시각 기록
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "inspection_reminder_sent_at" timestamptz;--> statement-breakpoint

-- 배치가 매시간 스캔하는 조건에 맞춘 부분 인덱스
CREATE INDEX IF NOT EXISTS "idx_requests_inspection_due"
  ON "requests" ("inspection_due_at") WHERE "status" = '검수대기';
```

`server/drizzle/meta/_journal.json`에 추가:

```json
    {
      "idx": 7,
      "version": "7",
      "when": 1784000000002,
      "tag": "0007_inspection_reminder",
      "breakpoints": true
    }
```

- [ ] **Step 2: drizzle 스키마에 컬럼 추가**

`server/src/db/schema.ts`의 `requests`에 `inspectionDueAt` 옆에 추가:

```ts
  inspectionReminderSentAt: timestamp('inspection_reminder_sent_at', { withTimezone: true }),
```

- [ ] **Step 3: 마이그레이션 실행**

```bash
cd server && npm run db:migrate
```

Expected: `migrations applied`

- [ ] **Step 4: 실패하는 테스트 작성**

`server/scripts/test-auto-complete.ts`:

```ts
/**
 * 자동완료 배치 테스트
 * - 검수 기한이 지난 건은 AUTO 경로로 완료된다
 * - 기한 전인 건은 건드리지 않는다
 * - 리마인더는 건당 1회만 나간다
 */
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { users, requests, notifications } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'
import { changeStatus } from '../src/services/transition.js'
import { runAutoComplete } from '../src/jobs/auto-complete.js'

const app = await buildApp()
await loginAsDev(app)

const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
const actorId = juhui!.id

/**
 * 테스트용 일반 직원 계정.
 * 시드에는 시스템팀(juhui) 1명뿐인데, 배치가 요청자에게 알림을 보내는지 보려면
 * 요청자가 배치 액터(시스템팀)와 달라야 한다.
 */
async function ensureStaffUser(): Promise<string> {
  const email = 'test-staff@baeoom.com'
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
  if (existing) return existing.id
  const [row] = await db.insert(users).values({
    email, name: '테스트직원', role: 'staff', orgAffil: '공통', deptFunction: '교학팀',
  }).returning()
  return row.id
}

const requesterId = await ensureStaffUser()

async function makeInspecting() {
  const [row] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '자동완료테스트',
    requesterId, visibility: 'dept',
  }).returning()
  await changeStatus({ reqId: row.id, to: '진행중', actorId })
  await changeStatus({ reqId: row.id, to: '검수대기', actorId })
  return row
}

async function cleanup(reqId: number) {
  await db.delete(notifications).where(eq(notifications.requestId, reqId))
  await db.delete(requests).where(eq(requests.id, reqId))
}

// ──────────────────────────────────────────
// (1) 기한이 지난 건 → AUTO 완료
// ──────────────────────────────────────────
{
  const req = await makeInspecting()
  await db.execute(sql`
    update requests set inspection_due_at = now() - interval '1 hour' where id = ${req.id}`)

  const result = await runAutoComplete()
  assert.ok(result.completed >= 1, `최소 1건은 자동완료돼야 함 (실제 ${result.completed})`)

  const cur = await db.execute<any>(sql`
    select status, completion_route, completed_at from requests where id = ${req.id}`)
  const r = cur.rows[0]
  assert.equal(r.status, '완료')
  assert.equal(r.completion_route, 'AUTO')
  assert.ok(r.completed_at !== null)
  console.log('(1) 기한 만료 → AUTO 완료 OK')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (2) 기한 전인 건은 건드리지 않는다
// ──────────────────────────────────────────
{
  const req = await makeInspecting()   // inspection_due_at = now() + 7d
  await runAutoComplete()
  const cur = await db.execute<any>(sql`select status from requests where id = ${req.id}`)
  assert.equal(cur.rows[0].status, '검수대기', '기한 전이면 그대로 둔다')
  console.log('(2) 기한 전 건 유지 OK')
  await cleanup(req.id)
}

// ──────────────────────────────────────────
// (3) 리마인더는 건당 1회만
// ──────────────────────────────────────────
{
  const req = await makeInspecting()
  // 검수대기 진입 후 4일 지난 상황 (리마인더 기준 3일 초과, 자동완료 기한 전)
  await db.execute(sql`
    update requests
    set inspection_due_at = now() + interval '3 days'
    where id = ${req.id}`)

  const first = await runAutoComplete()
  assert.ok(first.reminded >= 1, `리마인더가 나가야 함 (실제 ${first.reminded})`)

  const sent = await db.execute<any>(sql`
    select inspection_reminder_sent_at from requests where id = ${req.id}`)
  assert.ok(sent.rows[0].inspection_reminder_sent_at !== null, '발송 시각이 기록된다')

  const n1 = await db.execute<any>(sql`
    select count(*)::int as c from notifications where request_id = ${req.id}`)

  // 두 번째 실행에서는 다시 보내지 않는다
  await runAutoComplete()
  const n2 = await db.execute<any>(sql`
    select count(*)::int as c from notifications where request_id = ${req.id}`)
  assert.equal(n2.rows[0].c, n1.rows[0].c, '리마인더는 두 번 나가지 않는다')

  const cur = await db.execute<any>(sql`select status from requests where id = ${req.id}`)
  assert.equal(cur.rows[0].status, '검수대기', '리마인더만 나가고 완료되지는 않는다')
  console.log('(3) 리마인더 1회 발송 OK')
  await cleanup(req.id)
}

await app.close()
await pool.end()
console.log('\ntest:auto-complete ALL PASSED')
```

리마인더 판정 기준은 `inspection_due_at`을 역산해 쓴다. 검수 기한이 7일이고 리마인더가 3일차이므로, "남은 기간이 `INSPECTION_DAYS - INSPECTION_REMINDER_DAYS` = 4일 이하"이면 리마인더 대상이다. 위 테스트는 `inspection_due_at`을 3일 뒤로 당겨 이 조건을 만든다.

- [ ] **Step 5: package.json에 스크립트 등록**

```json
    "test:auto-complete": "tsx scripts/test-auto-complete.ts",
```

- [ ] **Step 6: 테스트가 실패하는지 확인**

```bash
cd server && npm run test:auto-complete
```

Expected: FAIL — `../src/jobs/auto-complete.js` 모듈이 없다.

- [ ] **Step 7: 배치 구현**

`server/src/jobs/auto-complete.ts`:

```ts
import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db } from '../db/client.js'
import { notify } from '../services/notify.js'
import { changeStatus, TransitionError } from '../services/transition.js'
import { INSPECTION_DAYS, INSPECTION_REMINDER_DAYS } from '../services/inspection.js'

/** 배치가 상태를 바꿀 때 쓰는 액터. 시스템팀 계정 중 하나를 쓴다. */
async function systemActorId(): Promise<string | null> {
  const r = await db.execute<{ id: string }>(sql`
    select id from users where role = 'system' order by created_at limit 1`)
  return r.rows[0]?.id ?? null
}

/**
 * 검수대기 건을 스캔해 두 가지를 한다.
 *  1. 검수 기한이 지난 건 → AUTO 경로로 완료
 *  2. 리마인더 시점을 지났고 아직 안 보낸 건 → 요청자에게 리마인더 1회
 *
 * 전이 실패(요청자가 그 사이 직접 처리한 경우 등)는 건별로 무시하고 다음 건을 계속 처리한다.
 */
export async function runAutoComplete(): Promise<{ completed: number; reminded: number }> {
  const actorId = await systemActorId()
  if (actorId === null) {
    console.error('[auto-complete] system 역할 사용자가 없어 배치를 건너뜁니다')
    return { completed: 0, reminded: 0 }
  }

  // ── 1. 자동완료
  const expired = await db.execute<{ id: number; requester_id: string | null; seq: string | null }>(sql`
    select id, requester_id, seq from requests
    where status = '검수대기' and inspection_due_at is not null and inspection_due_at < now()`)

  let completed = 0
  for (const row of expired.rows) {
    try {
      await changeStatus({ reqId: row.id, to: '완료', actorId, completionRoute: 'AUTO' })
      completed++
      if (row.requester_id) {
        const seq = row.seq ?? String(row.id)
        void notify(
          row.requester_id, 'status', row.id,
          `요청 ${seq}이(가) ${INSPECTION_DAYS}일간 확인이 없어 자동 완료되었습니다. 문제가 있으면 이의를 제기해주세요`,
        )
      }
    } catch (e) {
      if (e instanceof TransitionError) {
        // 그 사이 요청자가 직접 처리했을 수 있다. 다음 건으로 넘어간다.
        console.warn(`[auto-complete] 요청 ${row.id} 자동완료 건너뜀: ${e.code}`)
        continue
      }
      throw e
    }
  }

  // ── 2. 리마인더
  //    남은 기간이 (검수기한 - 리마인더시점) 이하로 줄었고 아직 안 보낸 건
  const remainDays = INSPECTION_DAYS - INSPECTION_REMINDER_DAYS
  const due = await db.execute<{ id: number; requester_id: string | null; seq: string | null }>(sql`
    select id, requester_id, seq from requests
    where status = '검수대기'
      and inspection_due_at is not null
      and inspection_due_at >= now()
      and inspection_due_at <= now() + (${remainDays} * interval '1 day')
      and inspection_reminder_sent_at is null
      and requester_id is not null`)

  let reminded = 0
  for (const row of due.rows) {
    // 발송 시각을 먼저 찍어 중복 발송을 막는다 (실패해도 재발송하지 않는 쪽이 낫다)
    const upd = await db.execute<{ id: number }>(sql`
      update requests set inspection_reminder_sent_at = now()
      where id = ${row.id} and inspection_reminder_sent_at is null
      returning id`)
    if (upd.rows.length === 0) continue  // 다른 워커가 이미 처리

    const seq = row.seq ?? String(row.id)
    void notify(
      row.requester_id!, 'status', row.id,
      `요청 ${seq} 확인이 아직 안 되었습니다. 기한 내 응답이 없으면 자동 완료됩니다`,
    )
    reminded++
  }

  return { completed, reminded }
}

/** 1시간 주기로 배치를 돌린다. */
export function startAutoCompleteJob(app: FastifyInstance): void {
  const ONE_HOUR = 60 * 60 * 1000
  const tick = async () => {
    try {
      const r = await runAutoComplete()
      if (r.completed > 0 || r.reminded > 0) {
        app.log.info({ ...r }, '[auto-complete] 배치 완료')
      }
    } catch (err) {
      app.log.error(err, '[auto-complete] 배치 실패')
    }
  }
  void tick()  // 기동 직후 1회
  const timer = setInterval(() => void tick(), ONE_HOUR)
  app.addHook('onClose', async () => { clearInterval(timer) })
}
```

`onClose` 훅으로 타이머를 정리하지 않으면 테스트 스크립트가 `app.close()` 후에도 종료되지 않는다.

- [ ] **Step 8: 서버 기동 시 배치 등록**

`server/src/index.ts`:

```ts
import { buildApp } from './app.js'
import { env } from './env.js'
import { startAutoCompleteJob } from './jobs/auto-complete.js'

const app = await buildApp()
startAutoCompleteJob(app)
app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`server up on :${env.PORT}`))
  .catch((err) => { app.log.error(err); process.exit(1) })
```

배치를 `app.ts`가 아니라 `index.ts`에서 기동하는 이유는, 테스트 스크립트가 `buildApp()`을 쓰는데 거기서 배치가 돌면 테스트 데이터를 건드리기 때문이다.

- [ ] **Step 9: 테스트 통과 확인**

```bash
cd server && npm run test:auto-complete
```

Expected: `(1)`~`(3)` 전부 OK 후 `test:auto-complete ALL PASSED`

- [ ] **Step 10: 커밋**

```bash
git add server/drizzle/0007_inspection_reminder.sql server/drizzle/meta/_journal.json server/src/db/schema.ts server/src/jobs/auto-complete.ts server/src/index.ts server/scripts/test-auto-complete.ts server/package.json
git commit -m "feat(server): 검수 자동완료·리마인더 배치 (1시간 주기)"
```

---

## Task 8: 대시보드 지표 4종

**Files:**
- Modify: `server/src/routes/dashboard.ts:30-80`
- Modify: `server/scripts/test-dashboard.ts`

**Interfaces:**
- Consumes: Task 2의 `request_disputes`, `completion_route`.
- Produces: `GET /api/dashboard`의 `kpi` 객체에 필드 추가.
  - `disputeRate: number | null` — 완료 건 대비 이의제기 건 비율 (0~1)
  - `disputeAcceptRate: number | null` — 심사된 이의 중 수락 비율 (0~1)
  - `avgInspectionDays: number | null` — `first_resolved_at` → `final_resolved_at` 평균 일수
  - `completionRoutes: { REQUESTER: number; AUTO: number; SYSTEM_FORCED: number }`
  - `openDisputeCount: number` — 심사 대기 중인 이의 건수 (배너용)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/scripts/test-dashboard.ts` 끝(`await app.close()` 앞)에 추가:

```ts
// ──────────────────────────────────────────
// 검수·이의 지표가 응답에 포함된다
// ──────────────────────────────────────────
{
  const res = await app.inject({ method: 'GET', url: '/api/dashboard', cookies: { session: cookie } })
  assert.equal(res.statusCode, 200, res.body)
  const body = JSON.parse(res.body)
  const k = body.kpi

  assert.ok('disputeRate' in k, 'disputeRate 필드 존재')
  assert.ok('disputeAcceptRate' in k, 'disputeAcceptRate 필드 존재')
  assert.ok('avgInspectionDays' in k, 'avgInspectionDays 필드 존재')
  assert.ok('openDisputeCount' in k, 'openDisputeCount 필드 존재')
  assert.equal(typeof k.openDisputeCount, 'number', 'openDisputeCount는 숫자')

  assert.ok(k.completionRoutes != null, 'completionRoutes 필드 존재')
  for (const route of ['REQUESTER', 'AUTO', 'SYSTEM_FORCED']) {
    assert.equal(typeof k.completionRoutes[route], 'number', `completionRoutes.${route}는 숫자`)
  }
  console.log('검수·이의 지표 필드 OK')
}
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
cd server && npm run test:dashboard
```

Expected: FAIL — `disputeRate 필드 존재` assertion 실패.

- [ ] **Step 3: dashboard.ts에 지표 추가**

`server/src/routes/dashboard.ts`의 KPI 쿼리에 아래 계산을 더한다. 기존 `rework_rate` CASE 식 뒤에 이어서 select 목록에 추가한다.

```ts
        -- 이의제기율: 완료 건 대비 이의가 제기된 건의 비율
        case
          when count(*) filter (where r.status = '완료') = 0 then null
          else (
            select count(distinct d.request_id)::numeric
            from request_disputes d
          ) / count(*) filter (where r.status = '완료')
        end as dispute_rate,

        -- 이의 수락률: 심사가 끝난 이의 중 수락 비율
        (
          select case
            when count(*) filter (where status_cd in ('ACCEPTED','REJECTED')) = 0 then null
            else count(*) filter (where status_cd = 'ACCEPTED')::numeric
                 / count(*) filter (where status_cd in ('ACCEPTED','REJECTED'))
          end
          from request_disputes
        ) as dispute_accept_rate,

        -- 평균 검수 소요일: 팀이 손 뗀 시점(first_resolved_at) → 최종 완료
        avg(
          case when r.final_resolved_at is not null and r.first_resolved_at is not null
               then extract(epoch from (r.final_resolved_at - r.first_resolved_at)) / 86400
          end
        ) as avg_inspection_days,

        count(*) filter (where r.completion_route = 'REQUESTER')     as route_requester,
        count(*) filter (where r.completion_route = 'AUTO')          as route_auto,
        count(*) filter (where r.completion_route = 'SYSTEM_FORCED') as route_system_forced,

        (select count(*) from request_disputes where status_cd = 'OPEN') as open_dispute_count,
```

`kpiRow` 타입 정의에 대응 필드를 추가하고, 응답 매핑에 다음을 더한다.

```ts
      disputeRate: kpiRow.dispute_rate != null ? parseFloat(kpiRow.dispute_rate) : null,
      disputeAcceptRate: kpiRow.dispute_accept_rate != null ? parseFloat(kpiRow.dispute_accept_rate) : null,
      avgInspectionDays: kpiRow.avg_inspection_days != null ? parseFloat(kpiRow.avg_inspection_days) : null,
      openDisputeCount: Number(kpiRow.open_dispute_count ?? 0),
      completionRoutes: {
        REQUESTER: Number(kpiRow.route_requester ?? 0),
        AUTO: Number(kpiRow.route_auto ?? 0),
        SYSTEM_FORCED: Number(kpiRow.route_system_forced ?? 0),
      },
```

`kpiRow` 인터페이스에는 `dispute_rate: string | null`, `dispute_accept_rate: string | null`, `avg_inspection_days: string | null`, `route_requester: string`, `route_auto: string`, `route_system_forced: string`, `open_dispute_count: string`을 추가한다. `pg`는 `numeric`과 `bigint`를 문자열로 돌려주므로 전부 문자열 타입이다.

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd server && npm run test:dashboard
```

Expected: `test:dashboard ALL PASSED`

- [ ] **Step 5: 커밋**

```bash
git add server/src/routes/dashboard.ts server/scripts/test-dashboard.ts
git commit -m "feat(server): 이의제기율·수락률·평균 검수일·완료 경로 분포 지표 추가"
```

---

## Task 9: 프론트 타입·상수·API 클라이언트

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/lib/constants.ts:17-61`
- Modify: `src/features/requests/api.ts`

**Interfaces:**
- Consumes: Task 5·6·8의 API 계약.
- Produces:
  - `RequestStatus`에 `'검수대기'` 포함
  - `RequestDispute` 타입: `{ id: number; reason: string; status_cd: 'OPEN'|'ACCEPTED'|'REJECTED'; review_comment: string | null; reviewed_at: string | null; created_at: string; raised_by_name: string | null; reviewed_by_name: string | null }`
  - `approveInspection(id, csat?)`, `requestRework(id, reason)`, `forceComplete(id, reason)`
  - `fetchDisputes(id)`, `raiseDispute(id, reason)`, `reviewDispute(disputeId, decision, comment)`
  - `DISPUTE_WINDOW_DAYS = 14`, `isDisputable(completedAt)` — 서버 `inspection.ts`와 같은 값 (프론트는 버튼 노출 판정에만 쓴다)

- [ ] **Step 1: 타입 갱신**

`src/types/database.ts`의 `RequestStatus`에 `'검수대기'`를 추가하고, 파일 끝에 이의 타입을 추가한다.

```ts
export type RequestStatus = '접수' | '진행중' | '검수대기' | '보류' | '완료' | '반려' | '철회'

export type DisputeStatusCd = 'OPEN' | 'ACCEPTED' | 'REJECTED'

export interface RequestDispute {
  id: number
  reason: string
  status_cd: DisputeStatusCd
  review_comment: string | null
  reviewed_at: string | null
  created_at: string
  raised_by_name: string | null
  reviewed_by_name: string | null
}
```

`Request` 인터페이스(또는 `request_view` 대응 타입)에 아래 필드를 추가한다.

```ts
  inspection_due_at: string | null
  completion_route: 'REQUESTER' | 'AUTO' | 'SYSTEM_FORCED' | null
  has_open_dispute: boolean
```

- [ ] **Step 2: 상수 갱신**

`src/lib/constants.ts`를 아래와 같이 고친다.

```ts
export const STATUS_OPTIONS: RequestStatus[] = [
  '접수', '진행중', '검수대기', '보류', '완료', '반려', '철회',
]

// 관리 보드 칸반 컬럼 — 철회는 아카이브성이므로 보드에서 제외
export const BOARD_STATUSES: RequestStatus[] = ['접수', '진행중', '검수대기', '보류', '완료', '반려']

// 열린(진행 중인) 상태 — 검수대기도 아직 종결이 아니다
export const OPEN_STATUSES: RequestStatus[] = ['접수', '진행중', '검수대기', '보류']

export const STATUS_BADGE: Record<RequestStatus, string> = {
  접수: 'bg-sky-500 text-white',
  진행중: 'bg-indigo-600 text-white',
  검수대기: 'bg-purple-600 text-white',
  보류: 'bg-amber-500 text-white',
  완료: 'bg-green-600 text-white',
  반려: 'bg-red-600 text-white',
  철회: 'bg-gray-400 text-white line-through',
}

// 허용 전이 매트릭스 (서버 transition.ts의 ALLOWED와 동일해야 한다)
// 진행중 → 완료 직행은 없다. 완료에 도달하려면 반드시 검수대기를 거친다.
export const ALLOWED_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  접수: ['진행중', '반려', '철회'],
  진행중: ['검수대기', '보류', '반려'],
  검수대기: ['완료', '진행중'],
  보류: ['진행중'],
  완료: ['진행중'], // 이의 수락 경로로만
  반려: [],
  철회: [],
}

// 검수·이의제기 정책 (서버 server/src/services/inspection.ts와 같은 값)
export const INSPECTION_DAYS = 7
export const DISPUTE_WINDOW_DAYS = 14

/** 최종 완료 시각 기준으로 아직 이의제기가 가능한지 — 버튼 노출 판정용 */
export function isDisputable(completedAt: string | null): boolean {
  if (completedAt === null) return false
  const deadline = new Date(completedAt).getTime() + DISPUTE_WINDOW_DAYS * 86_400_000
  return Date.now() <= deadline
}
```

`dueBadgeClass`의 주석에 `검수대기`를 반영하고 case를 추가한다.

```ts
// DB 생성값: '기한초과'|'임박'|'여유'|RequestStatus(검수대기/완료/반려/철회)
export function dueBadgeClass(due: string | null): string {
  switch (due) {
    case '기한초과':
      return 'bg-red-100 text-red-700 font-semibold'
    case '임박':
      return 'bg-amber-100 text-amber-800'
    case '여유':
      return 'bg-gray-100 text-gray-500'
    case '검수대기':
      return 'bg-purple-100 text-purple-700'
    case '완료':
      return 'bg-green-100 text-green-700'
    default:
      return 'bg-gray-100 text-gray-500'
  }
}
```

- [ ] **Step 3: API 클라이언트 추가**

`src/features/requests/api.ts` 끝에 추가한다. 기존 파일의 fetch 래퍼(`apiFetch` 등)와 같은 헬퍼를 쓰고, 없으면 파일 안의 기존 요청 함수와 같은 형태를 따른다.

```ts
import type { RequestDispute } from '../../types/database'

/** 검수 승인 — 요청자 본인, 검수대기 상태에서만 */
export async function approveInspection(
  id: number,
  csat?: { rating: number; comment?: string },
): Promise<void> {
  await apiFetch(`/api/requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: '완료',
      ...(csat ? { csat_rating: csat.rating, csat_comment: csat.comment ?? null } : {}),
    }),
  })
}

/** 재작업 요청 — 요청자 본인, 검수대기 상태에서만. 사유 필수 */
export async function requestRework(id: number, reason: string): Promise<void> {
  await apiFetch(`/api/requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: '진행중', reason }),
  })
}

/** 강제 완료 — 시스템팀, 검수대기 상태에서만. 사유 필수 */
export async function forceComplete(id: number, reason: string): Promise<void> {
  await apiFetch(`/api/requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: '완료', reason }),
  })
}

export async function fetchDisputes(id: number): Promise<RequestDispute[]> {
  const res = await apiFetch(`/api/requests/${id}/disputes`)
  return res.disputes
}

/** 이의제기 — 요청자 본인, 완료 후 14일 이내 */
export async function raiseDispute(id: number, reason: string): Promise<{ id: number }> {
  return apiFetch(`/api/requests/${id}/disputes`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

/** 이의 심사 — 시스템팀. 사유 필수 */
export async function reviewDispute(
  disputeId: number,
  decision: 'ACCEPTED' | 'REJECTED',
  comment: string,
): Promise<void> {
  await apiFetch(`/api/disputes/${disputeId}`, {
    method: 'PATCH',
    body: JSON.stringify({ decision, comment }),
  })
}
```

- [ ] **Step 4: 타입 체크**

```bash
npm run typecheck
```

Expected: `STATUS_BADGE`, `ALLOWED_TRANSITIONS` 등 `Record<RequestStatus, …>`가 새 상태를 요구하므로, 누락된 곳이 있으면 여기서 잡힌다. 에러 없이 통과할 때까지 고친다.

- [ ] **Step 5: 커밋**

```bash
git add src/types/database.ts src/lib/constants.ts src/features/requests/api.ts
git commit -m "feat(web): 검수대기 상태·이의제기 타입·API 클라이언트 추가"
```

---

## Task 10: 요청자 검수 패널

**Files:**
- Create: `src/features/requests/InspectionPanel.tsx`
- Modify: `src/features/requests/RequestDetail.tsx`

**Interfaces:**
- Consumes: Task 9의 `approveInspection`, `requestRework`, `forceComplete`, `INSPECTION_DAYS`.
- Produces: `<InspectionPanel request={req} isOwner={boolean} isSystem={boolean} onDone={() => void} />` — 상태가 `검수대기`가 아니면 `null`을 렌더한다.

- [ ] **Step 1: 검수 패널 작성**

`src/features/requests/InspectionPanel.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Request } from '../../types/database'
import { approveInspection, requestRework, forceComplete } from './api'

interface Props {
  request: Request
  isOwner: boolean
  isSystem: boolean
}

/** 자동완료 예정일을 'M월 D일' 로 */
function formatDue(iso: string | null): string {
  if (iso === null) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

export function InspectionPanel({ request, isOwner, isSystem }: Props) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'idle' | 'approve' | 'rework' | 'force'>('idle')
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['request', request.id] })
    void qc.invalidateQueries({ queryKey: ['requests'] })
    setMode('idle')
    setReason('')
    setComment('')
  }

  const approve = useMutation({
    mutationFn: () => approveInspection(request.id, { rating, comment: comment || undefined }),
    onSuccess: invalidate,
  })
  const rework = useMutation({
    mutationFn: () => requestRework(request.id, reason),
    onSuccess: invalidate,
  })
  const force = useMutation({
    mutationFn: () => forceComplete(request.id, reason),
    onSuccess: invalidate,
  })

  if (request.status !== '검수대기') return null

  // 요청자도 시스템팀도 아니면 안내만 보여준다
  if (!isOwner && !isSystem) {
    return (
      <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 text-sm text-purple-900">
        작업이 완료되어 요청자 확인을 기다리는 중입니다.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
      {isOwner ? (
        <>
          <h3 className="font-semibold text-purple-900">작업이 완료되었습니다. 확인해주세요</h3>
          <p className="mt-1 text-sm text-purple-800">
            처리된 내용을 확인하고 알려주세요.
            {request.inspection_due_at !== null && (
              <> {formatDue(request.inspection_due_at)}까지 응답이 없으면 자동으로 완료됩니다.</>
            )}
          </p>
        </>
      ) : (
        <>
          <h3 className="font-semibold text-purple-900">요청자 확인 대기 중</h3>
          <p className="mt-1 text-sm text-purple-800">
            요청자 확인 없이 완료하려면 사유를 남겨야 합니다.
            {request.inspection_due_at !== null && (
              <> 미응답 시 {formatDue(request.inspection_due_at)}에 자동 완료됩니다.</>
            )}
          </p>
        </>
      )}

      {mode === 'idle' && (
        <div className="mt-3 flex gap-2">
          {isOwner && (
            <>
              <button
                type="button"
                onClick={() => setMode('approve')}
                className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
              >
                확인했습니다
              </button>
              <button
                type="button"
                onClick={() => setMode('rework')}
                className="rounded border border-purple-300 bg-white px-4 py-2 text-sm font-medium text-purple-800 hover:bg-purple-100"
              >
                다시 봐주세요
              </button>
            </>
          )}
          {isSystem && !isOwner && (
            <button
              type="button"
              onClick={() => setMode('force')}
              className="rounded border border-purple-300 bg-white px-4 py-2 text-sm font-medium text-purple-800 hover:bg-purple-100"
            >
              강제 완료
            </button>
          )}
        </div>
      )}

      {mode === 'approve' && (
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-medium text-purple-900">
            처리 결과에 얼마나 만족하시나요?
          </label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                aria-label={`${n}점`}
                className={`h-9 w-9 rounded text-lg ${
                  n <= rating ? 'bg-amber-400 text-white' : 'bg-white text-gray-300 border border-gray-200'
                }`}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="남기실 말씀이 있다면 적어주세요 (선택)"
            rows={2}
            className="w-full rounded border border-gray-300 p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={approve.isPending}
              onClick={() => approve.mutate()}
              className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {approve.isPending ? '처리 중…' : '완료 확인'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="px-3 py-2 text-sm text-gray-600">
              취소
            </button>
          </div>
          {approve.isError && (
            <p className="text-sm text-red-600">확인 처리에 실패했습니다. 잠시 후 다시 시도해주세요.</p>
          )}
        </div>
      )}

      {(mode === 'rework' || mode === 'force') && (
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-medium text-purple-900">
            {mode === 'rework'
              ? '어떤 점이 잘못되었나요? (필수)'
              : '요청자 확인 없이 완료하는 사유 (필수)'}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              mode === 'rework'
                ? '예: 요청한 기간이 아니라 전월 데이터가 왔습니다'
                : '예: 요청자와 구두로 확인 완료'
            }
            rows={3}
            className="w-full rounded border border-gray-300 p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={reason.trim() === '' || rework.isPending || force.isPending}
              onClick={() => (mode === 'rework' ? rework.mutate() : force.mutate())}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {mode === 'rework' ? '재작업 요청' : '강제 완료'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="px-3 py-2 text-sm text-gray-600">
              취소
            </button>
          </div>
          {(rework.isError || force.isError) && (
            <p className="text-sm text-red-600">처리에 실패했습니다. 잠시 후 다시 시도해주세요.</p>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: RequestDetail에 삽입**

`src/features/requests/RequestDetail.tsx`에 import를 추가하고, 요청 제목·메타 영역 바로 아래(댓글 영역 위)에 패널을 넣는다. `isOwner`·`isSystem` 판정은 이 파일에 이미 있는 현재 사용자 정보를 재사용한다 (기존에 상태 변경 버튼을 감추는 데 쓰던 것과 같은 값).

```tsx
import { InspectionPanel } from './InspectionPanel'
```

```tsx
<InspectionPanel request={req} isOwner={isOwner} isSystem={isSystem} />
```

- [ ] **Step 3: 브라우저에서 확인**

```bash
npm run dev
```

시스템팀 계정으로 로그인해 요청을 하나 `진행중 → 검수대기`로 옮긴 뒤, 그 요청의 요청자 계정으로 상세 화면에 들어가 보라진 확인 패널이 뜨는지, 별점 모달과 재작업 사유 모달이 각각 동작하는지 확인한다. 자동완료 예정일이 7일 뒤로 표시되는지도 본다.

- [ ] **Step 4: 타입 체크 + 린트**

```bash
npm run typecheck && npm run lint
```

Expected: 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/features/requests/InspectionPanel.tsx src/features/requests/RequestDetail.tsx
git commit -m "feat(web): 요청자 검수 패널 — 확인(CSAT)·재작업 요청·시스템팀 강제완료"
```

---

## Task 11: 이의제기 패널

**Files:**
- Create: `src/features/requests/DisputePanel.tsx`
- Modify: `src/features/requests/RequestDetail.tsx`

**Interfaces:**
- Consumes: Task 9의 `fetchDisputes`, `raiseDispute`, `reviewDispute`, `isDisputable`, `DISPUTE_WINDOW_DAYS`.
- Produces: `<DisputePanel request={req} isOwner={boolean} isSystem={boolean} />` — 상태가 `완료`가 아니고 과거 이의 이력도 없으면 `null`을 렌더한다.

- [ ] **Step 1: 이의 패널 작성**

`src/features/requests/DisputePanel.tsx`:

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { Request } from '../../types/database'
import { isDisputable, DISPUTE_WINDOW_DAYS } from '../../lib/constants'
import { fetchDisputes, raiseDispute, reviewDispute } from './api'

interface Props {
  request: Request
  isOwner: boolean
  isSystem: boolean
}

export function DisputePanel({ request, isOwner, isSystem }: Props) {
  const qc = useQueryClient()
  const [raising, setRaising] = useState(false)
  const [reason, setReason] = useState('')
  const [reviewing, setReviewing] = useState<'ACCEPTED' | 'REJECTED' | null>(null)
  const [comment, setComment] = useState('')

  const { data: disputes = [] } = useQuery({
    queryKey: ['disputes', request.id],
    queryFn: () => fetchDisputes(request.id),
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['disputes', request.id] })
    void qc.invalidateQueries({ queryKey: ['request', request.id] })
    void qc.invalidateQueries({ queryKey: ['requests'] })
    setRaising(false)
    setReviewing(null)
    setReason('')
    setComment('')
  }

  const raise = useMutation({
    mutationFn: () => raiseDispute(request.id, reason),
    onSuccess: invalidate,
  })

  const open = disputes.find((d) => d.status_cd === 'OPEN')
  const review = useMutation({
    mutationFn: () => reviewDispute(open!.id, reviewing!, comment),
    onSuccess: invalidate,
  })

  // 완료도 아니고 이의 이력도 없으면 보여줄 게 없다
  if (request.status !== '완료' && disputes.length === 0) return null

  const canRaise =
    isOwner &&
    request.status === '완료' &&
    open === undefined &&
    isDisputable(request.completed_at)
  const windowExpired =
    isOwner && request.status === '완료' && open === undefined && !isDisputable(request.completed_at)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="font-semibold text-gray-900">처리 결과 이의</h3>

      {open !== undefined && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">심사 중인 이의가 있습니다</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-amber-800">{open.reason}</p>
          <p className="mt-1 text-xs text-amber-700">
            {open.raised_by_name ?? '요청자'} · {new Date(open.created_at).toLocaleDateString('ko-KR')}
          </p>

          {isSystem && reviewing === null && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setReviewing('ACCEPTED')}
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                수락 → 재작업
              </button>
              <button
                type="button"
                onClick={() => setReviewing('REJECTED')}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                기각
              </button>
            </div>
          )}

          {isSystem && reviewing !== null && (
            <div className="mt-3 space-y-2">
              <label className="block text-sm font-medium text-amber-900">
                {reviewing === 'ACCEPTED'
                  ? '재작업 착수 안내 (필수)'
                  : '기각 사유 — 요청자에게 그대로 전달됩니다 (필수)'}
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={
                  reviewing === 'ACCEPTED'
                    ? '예: 확인했습니다. 이번 주 내로 다시 처리하겠습니다'
                    : '예: 최초 요청 범위 밖입니다. 새 요청으로 접수해주세요'
                }
                rows={3}
                className="w-full rounded border border-gray-300 p-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={comment.trim() === '' || review.isPending}
                  onClick={() => review.mutate()}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {reviewing === 'ACCEPTED' ? '수락' : '기각'}
                </button>
                <button type="button" onClick={() => setReviewing(null)} className="px-3 py-1.5 text-sm text-gray-600">
                  취소
                </button>
              </div>
              {review.isError && (
                <p className="text-sm text-red-600">심사 처리에 실패했습니다. 잠시 후 다시 시도해주세요.</p>
              )}
            </div>
          )}
        </div>
      )}

      {canRaise && !raising && (
        <div className="mt-2">
          <p className="text-sm text-gray-600">
            처리 결과에 문제가 있다면 알려주세요. 완료 후 {DISPUTE_WINDOW_DAYS}일 이내에 이의를 제기할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={() => setRaising(true)}
            className="mt-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            이의제기
          </button>
        </div>
      )}

      {canRaise && raising && (
        <div className="mt-2 space-y-2">
          <label className="block text-sm font-medium text-gray-900">
            어떤 점이 잘못 처리되었나요? (필수)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 요청한 기간이 아니라 전월 데이터가 왔습니다"
            rows={3}
            className="w-full rounded border border-gray-300 p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={reason.trim() === '' || raise.isPending}
              onClick={() => raise.mutate()}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {raise.isPending ? '접수 중…' : '이의 접수'}
            </button>
            <button type="button" onClick={() => setRaising(false)} className="px-3 py-1.5 text-sm text-gray-600">
              취소
            </button>
          </div>
          {raise.isError && (
            <p className="text-sm text-red-600">이의 접수에 실패했습니다. 잠시 후 다시 시도해주세요.</p>
          )}
        </div>
      )}

      {windowExpired && (
        <p className="mt-2 text-sm text-gray-600">
          이의제기 기간({DISPUTE_WINDOW_DAYS}일)이 지났습니다.{' '}
          <Link to={`/requests/new?parent=${request.id}`} className="text-indigo-600 underline">
            새 요청으로 접수해주세요
          </Link>
        </p>
      )}

      {disputes.filter((d) => d.status_cd !== 'OPEN').length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          {disputes
            .filter((d) => d.status_cd !== 'OPEN')
            .map((d) => (
              <li key={d.id} className="text-sm">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                    d.status_cd === 'ACCEPTED' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {d.status_cd === 'ACCEPTED' ? '수락됨' : '기각됨'}
                </span>{' '}
                <span className="text-gray-700">{d.reason}</span>
                {d.review_comment !== null && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    답변: {d.review_comment} ({d.reviewed_by_name ?? '시스템팀'})
                  </p>
                )}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
```

새 요청 링크의 `?parent=` 파라미터를 요청 작성 화면이 아직 읽지 않는다면, 이 계획에서는 링크만 걸어둔다. 원본 연결(`parent_request_id`)을 실제로 채우는 것은 이 작업의 범위가 아니며, 링크는 사용자를 새 요청 화면으로 보내는 역할만 한다.

- [ ] **Step 2: RequestDetail에 삽입**

`src/features/requests/RequestDetail.tsx`에 import를 추가하고 `InspectionPanel` 바로 아래에 넣는다.

```tsx
import { DisputePanel } from './DisputePanel'
```

```tsx
<DisputePanel request={req} isOwner={isOwner} isSystem={isSystem} />
```

- [ ] **Step 3: 브라우저에서 확인**

```bash
npm run dev
```

요청자 계정으로 완료된 요청에 들어가 이의제기 버튼이 보이는지, 사유 없이는 제출이 막히는지 확인한다. 이의를 하나 넣고 시스템팀 계정으로 다시 들어가 `수락 → 재작업` / `기각` 버튼이 뜨는지, 수락하면 상태가 `진행중`으로 돌아가고 기각하면 `완료`로 남으면서 사유가 이력에 표시되는지 본다.

완료 후 14일이 지난 상황은 DB에서 직접 만든다.

```bash
psql "$DATABASE_URL" -c "update requests set completed_at = now() - interval '15 days' where id = <요청ID>;"
```

이 상태에서 상세를 새로고침하면 이의제기 버튼 대신 "이의제기 기간이 지났습니다" 안내와 새 요청 링크가 보여야 한다.

- [ ] **Step 4: 타입 체크 + 린트**

```bash
npm run typecheck && npm run lint
```

Expected: 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/features/requests/DisputePanel.tsx src/features/requests/RequestDetail.tsx
git commit -m "feat(web): 이의제기 패널 — 제기·심사·이력 표시"
```

---

## Task 12: 대시보드 화면

**Files:**
- Modify: `src/features/dashboard/Dashboard.tsx`

**Interfaces:**
- Consumes: Task 8의 `kpi.disputeRate`, `kpi.disputeAcceptRate`, `kpi.avgInspectionDays`, `kpi.completionRoutes`, `kpi.openDisputeCount`. Task 9의 `BOARD_STATUSES`(검수대기 포함), `STATUS_BADGE`.

- [ ] **Step 1: 칸반에 검수대기 컬럼과 남은 일수 표시**

`BOARD_STATUSES`에 `검수대기`가 이미 추가되었으므로 칸반 컬럼은 자동으로 생긴다. 검수대기 카드에 자동완료까지 남은 일수를 덧붙인다. 카드 렌더 부분에 추가:

```tsx
{r.status === '검수대기' && r.inspection_due_at !== null && (
  <span className="mt-1 block text-xs text-purple-700">
    자동완료 {Math.max(0, Math.ceil((new Date(r.inspection_due_at).getTime() - Date.now()) / 86_400_000))}일 남음
  </span>
)}
```

- [ ] **Step 2: 열린 이의 배너**

대시보드 최상단, KPI 영역 위에 넣는다. 열린 이의가 완료 컬럼에 조용히 묻히지 않게 하는 것이 목적이다.

```tsx
{kpi.openDisputeCount > 0 && (
  <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
    <p className="text-sm font-medium text-amber-900">
      심사 대기 중인 이의 {kpi.openDisputeCount}건
    </p>
    <p className="mt-0.5 text-xs text-amber-800">
      완료 처리된 요청에 요청자가 이의를 제기했습니다. 상세 화면에서 수락 또는 기각해주세요.
    </p>
  </div>
)}
```

- [ ] **Step 3: 지표 타일 추가**

기존 KPI 타일 영역에 세 개를 더한다. 기존 타일과 같은 컴포넌트/클래스를 재사용한다.

```tsx
<Kpi
  label="이의제기율"
  value={kpi.disputeRate != null ? `${(kpi.disputeRate * 100).toFixed(1)}%` : '—'}
  hint="완료 건 대비. 높으면 검수가 형식적이라는 뜻"
/>
<Kpi
  label="이의 수락률"
  value={kpi.disputeAcceptRate != null ? `${(kpi.disputeAcceptRate * 100).toFixed(1)}%` : '—'}
  hint="수락이 높으면 구현 품질, 기각이 높으면 요건 정의 문제"
/>
<Kpi
  label="평균 검수 소요일"
  value={kpi.avgInspectionDays != null ? `${kpi.avgInspectionDays.toFixed(1)}일` : '—'}
  hint="요청자가 확인에 걸리는 시간"
/>
```

`Kpi` 컴포넌트에 `hint` prop이 없으면 기존 시그니처에 맞춰 `label`/`value`만 넘기고 `hint`는 생략한다.

- [ ] **Step 4: 완료 경로 분포**

완료 경로는 비율이 아니라 구성이므로 별도 블록으로 보여준다. `AUTO` 비중이 크다는 것은 완료 숫자가 사실은 무응답이라는 뜻이므로, 이 지표가 이 기능 전체의 안전장치다.

```tsx
<div className="rounded-lg border border-gray-200 bg-white p-4">
  <h3 className="text-sm font-semibold text-gray-900">완료 경로</h3>
  <p className="mt-0.5 text-xs text-gray-500">
    자동완료 비중이 크면 요청자가 검수를 하지 않고 있다는 신호입니다.
  </p>
  <ul className="mt-2 space-y-1 text-sm">
    <li className="flex justify-between">
      <span className="text-gray-700">요청자 확인</span>
      <span className="font-medium text-green-700">{kpi.completionRoutes.REQUESTER}건</span>
    </li>
    <li className="flex justify-between">
      <span className="text-gray-700">자동 완료 (무응답)</span>
      <span className="font-medium text-amber-700">{kpi.completionRoutes.AUTO}건</span>
    </li>
    <li className="flex justify-between">
      <span className="text-gray-700">시스템팀 강제 완료</span>
      <span className="font-medium text-gray-700">{kpi.completionRoutes.SYSTEM_FORCED}건</span>
    </li>
  </ul>
</div>
```

- [ ] **Step 5: 타입 체크 + 린트 + 브라우저 확인**

```bash
npm run typecheck && npm run lint && npm run dev
```

대시보드에 검수대기 컬럼이 진행중과 완료 사이에 있는지, 검수대기 카드에 남은 일수가 뜨는지, 열린 이의가 있을 때 상단 배너가 뜨는지, 새 지표 타일과 완료 경로 블록이 렌더되는지 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add src/features/dashboard/Dashboard.tsx
git commit -m "feat(web): 대시보드에 검수대기 컬럼·이의 배너·검수 지표 4종 추가"
```

---

## Task 13: 문서 동기화

**Files:**
- Modify: `docs/reference/db-schema.md`
- Modify: `docs/reference/requirements.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-07-12-completion-inspection-and-dispute-design.md` (frontmatter `status`)

CLAUDE.md §1의 영향 매핑 표가 요구하는 갱신이다. 스키마와 기능이 모두 바뀌었으므로 스킵할 수 없다.

- [ ] **Step 1: db-schema.md 갱신**

다음을 반영한다.

- `request_status` enum에 `검수대기` 추가 (`진행중`과 `보류` 사이)
- `notification_type` enum에 `dispute` 추가
- `requests` 신규 컬럼 3종: `inspection_due_at`, `completion_route`(`REQUESTER`/`AUTO`/`SYSTEM_FORCED`), `inspection_reminder_sent_at`
- `request_disputes` 테이블 전체 (컬럼·CHECK·부분 유니크 인덱스 `request_disputes_one_open`)
- `request_view`의 신규 파생 필드 `has_open_dispute`, `due_status`의 종결 목록에 `검수대기` 포함
- `on_status_change` 트리거의 새 동작: 검수대기 진입 시 `first_resolved_at`·`inspection_due_at` 세팅, `검수대기 → 진행중`도 `rework_count` 증가
- **시간 컬럼 의미 재정의**: `first_resolved_at`은 팀이 손을 뗀 시점(해결 SLA 기준), `final_resolved_at`/`completed_at`은 요청자가 납득한 시점(종결 리드타임 기준)

frontmatter가 있으면 `last_updated`를 오늘 날짜로 갱신한다.

- [ ] **Step 2: requirements.md 갱신**

검수·이의제기 흐름을 기능 요구사항으로 추가한다.

- 진행중 → 완료 직행 불가. 작업 종료 시 검수대기로 보내고 요청자 확인을 받는다.
- 요청자는 검수대기 건을 확인(만족도 별점 동반) 또는 재작업 요청(사유 필수)할 수 있다.
- 7일 무응답 시 자동 완료되며 3일차에 리마인더가 나간다. 시스템팀은 사유를 남기고 강제 완료할 수 있다.
- 최종 완료 후 14일 이내에 요청자는 이의를 제기할 수 있다. 시스템팀이 수락하면 재작업으로 되돌아가고, 기각하면 완료가 유지되며 사유가 요청자에게 전달된다.
- 한 요청에 동시에 열린 이의는 1건이며, 이의 횟수 자체에는 제한이 없다.

frontmatter가 있으면 `last_updated`를 갱신한다.

- [ ] **Step 3: CHANGELOG.md의 Unreleased에 기록**

```markdown
### Added
- 완료 전 요청자 검수 단계(`검수대기`). 7일 무응답 시 자동 완료되며 3일차 리마인더 발송.
- 요청자 검수 승인 시 만족도(CSAT) 수집.
- 완료된 요청에 대한 이의제기(완료 후 14일 이내)와 시스템팀 심사(수락 → 재작업 / 기각).
- 대시보드 지표: 이의제기율, 이의 수락률, 평균 검수 소요일, 완료 경로 분포.

### Changed
- `진행중 → 완료` 직행 전이를 제거했다. 완료에 도달하려면 검수대기를 거쳐야 한다.
- `first_resolved_at`이 최종 완료가 아니라 검수대기 진입 시점을 가리키도록 바꿨다. 요청자가 검수를 늦게 해서 팀의 해결 SLA가 위반되지 않게 하기 위함이다.
- 재작업률(`rework_rate`)이 검수 반려도 포함하도록 넓어졌다.
```

- [ ] **Step 4: 스펙 문서 상태 갱신**

`docs/superpowers/specs/2026-07-12-completion-inspection-and-dispute-design.md`의 frontmatter를 고친다.

```yaml
status: implemented
```

- [ ] **Step 5: 전체 회귀 확인**

```bash
cd server && npm run typecheck \
  && npm run test:transition \
  && npm run test:inspection \
  && npm run test:disputes \
  && npm run test:auto-complete \
  && npm run test:dashboard \
  && npm run test:api-hardening \
  && npm run test:sla \
  && npm run test:notifications
cd .. && npm run typecheck && npm run lint && npm run build
```

Expected: 모든 스크립트가 `ALL PASSED`로 끝나고, 프론트 타입 체크·린트·빌드가 에러 없이 통과한다. `test:sla`와 `test:notifications`는 `first_resolved_at` 의미 변경의 회귀를 잡기 위해 반드시 포함한다.

- [ ] **Step 6: 커밋**

```bash
git add docs/reference/db-schema.md docs/reference/requirements.md CHANGELOG.md docs/superpowers/specs/2026-07-12-completion-inspection-and-dispute-design.md
git commit -m "docs: 검수 단계·이의제기 스키마·요구사항·CHANGELOG 동기화"
```
