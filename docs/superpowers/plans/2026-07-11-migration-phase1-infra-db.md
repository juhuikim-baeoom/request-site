# Phase 1: 인프라 + DB 마이그레이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Docker Postgres를 띄우고, `schema.sql`을 Supabase 비종속 형태로 Drizzle 스키마·트리거·뷰로 이식한 뒤 초기 데이터(김주희)를 시드한다.

**Architecture:** `docker-compose.yml`로 Postgres 16 컨테이너를 실행하고, 새 `server/` 디렉터리에 Fastify + Drizzle(TypeScript) 백엔드 골격을 만든다. `auth.users`+`profiles`를 단일 `users` 테이블로 통합하고, RLS·storage·auth.uid() 종속을 제거하되 순수 트리거(접수번호·스냅샷·상태이력·updated_at)와 `request_view` 뷰는 유지한다. `auth.uid()`는 트랜잭션 세션변수 `app.user_id`로 대체한다.

**Tech Stack:** Docker Compose, PostgreSQL 16, Node.js 26 (ESM), Fastify 4, Drizzle ORM + drizzle-kit, node-postgres(pg), tsx.

## Global Constraints

- 백엔드 언어: TypeScript, ESM (`"type": "module"`).
- Postgres 접속: `DATABASE_URL=postgresql://request:request@localhost:5432/request_site`.
- DB 사용자/암호/DB명: `request` / `request` / `request_site` (로컬 전용).
- 통합 사용자 테이블명은 `users` (구 `profiles`+`auth.users`).
- `on_status_change` 트리거의 변경자 식별: `current_setting('app.user_id', true)::uuid` (백엔드가 `SET LOCAL app.user_id` 주입, Phase 2에서 연결).
- Postgres 전용 요소 제거 대상: RLS 정책 전체, `is_system/is_viewer_up/my_*/can_see_request` 함수, `storage.*`. (권한 로직은 Phase 2 `authz.ts`로 이식)
- enum 값·테이블 컬럼명·트리거 로직은 `schema.sql`과 의미적으로 동일하게 유지.
- 첨부 메타 컬럼 `storage_path`는 유지하되 의미를 "서버 디스크 상대경로"로 재해석(Phase 3에서 사용).

---

### Task 1: Docker 설치 + Postgres 컨테이너

**Files:**
- Create: `docker-compose.yml`
- Modify: `.gitignore` (server 산출물 무시 추가)

**Interfaces:**
- Produces: `localhost:5432`에서 접속 가능한 Postgres 16 (`request_site` DB). 이후 모든 태스크가 이 DB에 연결.

- [ ] **Step 1: Docker Desktop 설치**

Run:
```bash
brew install --cask docker
```
Expected: `docker` cask 설치 완료. (대안: 완전 CLI 환경을 원하면 `brew install colima docker docker-compose && colima start`)

- [ ] **Step 2: Docker 데몬 기동 (수동 GUI 단계)**

Run:
```bash
open -a Docker
```
그 후 Docker Desktop이 "Running" 상태가 될 때까지 대기. 확인:
```bash
docker info >/dev/null 2>&1 && echo "daemon up" || echo "waiting"
```
Expected: `daemon up`

- [ ] **Step 3: `docker-compose.yml` 작성**

Create `docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16
    container_name: request-site-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: request
      POSTGRES_PASSWORD: request
      POSTGRES_DB: request_site
      TZ: Asia/Seoul
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U request -d request_site"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
```

- [ ] **Step 4: 컨테이너 기동 후 접속 확인**

Run:
```bash
docker compose up -d && \
until docker compose exec -T db pg_isready -U request -d request_site >/dev/null 2>&1; do sleep 1; done && \
docker compose exec -T db psql -U request -d request_site -c "select version();"
```
Expected: `PostgreSQL 16.x ...` 버전 문자열 출력

- [ ] **Step 5: `.gitignore` 갱신**

Modify `.gitignore` — 파일 끝에 추가:
```
# server
server/node_modules
server/uploads
server/dist
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .gitignore
git commit -m "feat(infra): Postgres 16 docker-compose 추가"
```

---

### Task 2: server/ 스캐폴드 + 헬스체크

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/.env.example`, `server/.env`, `server/src/index.ts`, `server/src/env.ts`

**Interfaces:**
- Consumes: Task 1의 Postgres.
- Produces: `server/src/env.ts`가 export하는 `env` 객체 (`env.DATABASE_URL`, `env.PORT`, `env.APP_ENV`). `npm run dev`로 기동하는 Fastify 서버, `GET /health` → `{ ok: true }`.

- [ ] **Step 1: `server/package.json` 작성**

Create `server/package.json`:
```json
{
  "name": "request-site-server",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:seed": "tsx src/db/seed.ts",
    "db:smoke": "tsx scripts/smoke.ts"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "drizzle-orm": "^0.36.0",
    "fastify": "^4.28.1",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "@types/pg": "^8.11.10",
    "drizzle-kit": "^0.28.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2"
  }
}
```

- [ ] **Step 2: `server/tsconfig.json` 작성**

Create `server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "scripts", "drizzle.config.ts"]
}
```

- [ ] **Step 3: env 파일 작성**

Create `server/.env.example`:
```
DATABASE_URL=postgresql://request:request@localhost:5432/request_site
PORT=4000
APP_ENV=local
SESSION_SECRET=change-me-in-prod-please-32bytes-min
# Google OAuth (Phase 2 — 로컬은 dev-login 사용, 비워둬도 됨)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback
WEB_ORIGIN=http://localhost:5173
```
Create `server/.env` (동일 내용 복사):
```bash
cp server/.env.example server/.env
```

- [ ] **Step 4: `server/src/env.ts` 작성**

Create `server/src/env.ts`:
```ts
import 'dotenv/config'

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`환경변수 ${name} 가 필요합니다. server/.env 를 확인하세요.`)
  return v
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  PORT: Number(process.env.PORT ?? 4000),
  APP_ENV: process.env.APP_ENV ?? 'local',
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'dev-secret',
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
}

export const isLocal = env.APP_ENV === 'local'
```

- [ ] **Step 5: `server/src/index.ts` 작성**

Create `server/src/index.ts`:
```ts
import Fastify from 'fastify'
import { env } from './env.js'

const app = Fastify({ logger: true })

app.get('/health', async () => ({ ok: true }))

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`server up on :${env.PORT}`))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
```

- [ ] **Step 6: 설치 후 기동 확인**

Run:
```bash
cd server && npm install && (npm run dev &) && sleep 3 && curl -s localhost:4000/health; echo
```
Expected: `{"ok":true}` — 확인 후 `kill %1` 로 서버 종료

- [ ] **Step 7: Commit**

```bash
git add server/package.json server/tsconfig.json server/.env.example server/src/index.ts server/src/env.ts server/package-lock.json
git commit -m "feat(server): Fastify 스캐폴드 + /health"
```

---

### Task 3: Drizzle 스키마 (enum·users·전 테이블) + 마이그레이션 생성/적용

**Files:**
- Create: `server/drizzle.config.ts`, `server/src/db/schema.ts`, `server/src/db/client.ts`, `server/src/db/migrate.ts`
- Create(생성물): `server/drizzle/0000_*.sql`

**Interfaces:**
- Consumes: Task 2의 `env`.
- Produces:
  - `server/src/db/client.ts` → `export const pool` (pg Pool), `export const db` (drizzle 인스턴스), `export async function withUser<T>(userId: string | null, fn: (tx) => Promise<T>): Promise<T>` (트랜잭션 내 `SET LOCAL app.user_id` 주입).
  - `server/src/db/schema.ts` → 테이블 export: `users, orgDirectory, requestTypes, requests, requestComments, requestStatusHistory, requestAttachments, requestSharedTargets` 및 enum export.

- [ ] **Step 1: `server/drizzle.config.ts` 작성**

Create `server/drizzle.config.ts`:
```ts
import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

- [ ] **Step 2: `server/src/db/schema.ts` 작성**

Create `server/src/db/schema.ts`:
```ts
import {
  pgEnum, pgTable, uuid, text, integer, bigint, boolean, timestamp, date, index, unique,
} from 'drizzle-orm/pg-core'

export const userRole = pgEnum('user_role', ['staff', 'system', 'viewer'])
export const requestOrg = pgEnum('request_org', ['배움', '배론', '허브', '공통'])
export const requestStatus = pgEnum('request_status', [
  '접수', '확인', '진행중', '검수대기', '재작업', '완료', '보류', '반려', '이관', '철회',
])
export const requestPriority = pgEnum('request_priority', ['긴급', '보통', '낮음'])
export const requestSource = pgEnum('request_source', ['web', 'email'])
export const requestVisibility = pgEnum('request_visibility', [
  'private', 'dept', 'function', 'org', 'shared',
])

// auth.users + profiles 통합
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  googleSub: text('google_sub').unique(),
  name: text('name'),
  dept: text('dept'),
  orgAffil: requestOrg('org_affil'),
  deptFunction: text('dept_function'),
  role: userRole('role').notNull().default('staff'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orgDirectory = pgTable('org_directory', {
  email: text('email').primaryKey(),
  name: text('name').notNull(),
  dept: text('dept').notNull(),
  orgAffil: requestOrg('org_affil').notNull(),
  deptFunction: text('dept_function'),
  role: userRole('role').notNull().default('staff'),
  synced: boolean('synced').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const requestTypes = pgTable('request_types', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').default(0),
  active: boolean('active').default(true),
})

export const requests = pgTable('requests', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  seq: text('seq').unique(),
  source: requestSource('source').notNull().default('web'),
  org: requestOrg('org').notNull(),
  typeCode: text('type_code').notNull().references(() => requestTypes.code),
  priority: requestPriority('priority').notNull().default('보통'),
  title: text('title').notNull(),
  body: text('body'),
  requesterId: uuid('requester_id').references(() => users.id),
  requesterName: text('requester_name'),
  requesterEmail: text('requester_email'),
  assigneeId: uuid('assignee_id').references(() => users.id),
  status: requestStatus('status').notNull().default('접수'),
  visibility: requestVisibility('visibility').notNull().default('dept'),
  requesterDept: text('requester_dept'),
  requesterOrg: requestOrg('requester_org'),
  requesterFunction: text('requester_function'),
  desiredDue: date('desired_due'),
  firstCompletedAt: timestamp('first_completed_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  reworkCount: integer('rework_count').notNull().default(0),
  parentRequestId: bigint('parent_request_id', { mode: 'number' }),
  sourceThreadId: text('source_thread_id'),
  isLocked: boolean('is_locked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('idx_requests_status').on(t.status),
  orgIdx: index('idx_requests_org').on(t.org),
  assigneeIdx: index('idx_requests_assignee').on(t.assigneeId),
  requesterIdx: index('idx_requests_requester').on(t.requesterId),
  createdIdx: index('idx_requests_created').on(t.createdAt),
  parentIdx: index('idx_requests_parent').on(t.parentRequestId),
}))

export const requestComments = pgTable('request_comments', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  requestId: bigint('request_id', { mode: 'number' }).notNull().references(() => requests.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').references(() => users.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  requestIdx: index('idx_comments_request').on(t.requestId),
}))

export const requestStatusHistory = pgTable('request_status_history', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  requestId: bigint('request_id', { mode: 'number' }).notNull().references(() => requests.id, { onDelete: 'cascade' }),
  fromStatus: requestStatus('from_status'),
  toStatus: requestStatus('to_status').notNull(),
  changedBy: uuid('changed_by').references(() => users.id),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  requestIdx: index('idx_history_request').on(t.requestId),
}))

export const requestAttachments = pgTable('request_attachments', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  requestId: bigint('request_id', { mode: 'number' }).notNull().references(() => requests.id, { onDelete: 'cascade' }),
  storagePath: text('storage_path').notNull(),
  fileName: text('file_name'),
  fileSize: bigint('file_size', { mode: 'number' }),
  mimeType: text('mime_type'),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  requestIdx: index('idx_attach_request').on(t.requestId),
}))

export const requestSharedTargets = pgTable('request_shared_targets', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  requestId: bigint('request_id', { mode: 'number' }).notNull().references(() => requests.id, { onDelete: 'cascade' }),
  targetType: text('target_type').notNull(),
  targetValue: text('target_value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: unique('uq_shared_target').on(t.requestId, t.targetType, t.targetValue),
  requestIdx: index('idx_shared_targets_request').on(t.requestId),
}))
```

- [ ] **Step 3: `server/src/db/client.ts` 작성**

Create `server/src/db/client.ts`:
```ts
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { env } from '../env.js'
import * as schema from './schema.js'

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL })
export const db = drizzle(pool, { schema })

/** 트랜잭션 내에서 app.user_id 세션변수를 세팅해 트리거(on_status_change)가 변경자를 인식하게 함 */
export async function withUser<T>(
  userId: string | null,
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId ?? ''}, true)`)
    return fn(tx as unknown as typeof db)
  })
}
```

- [ ] **Step 4: `server/src/db/migrate.ts` 작성**

Create `server/src/db/migrate.ts`:
```ts
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './client.js'

await migrate(db, { migrationsFolder: './drizzle' })
await pool.end()
console.log('migrations applied')
```

- [ ] **Step 5: 마이그레이션 생성**

Run:
```bash
cd server && npm run db:generate
```
Expected: `server/drizzle/0000_*.sql` 및 `meta/` 생성. SQL 안에 `create type "public"."user_role" ...`, `create table "users" ...` 등이 포함됨을 확인.

- [ ] **Step 6: 마이그레이션 적용 후 테이블 확인**

Run:
```bash
cd server && npm run db:migrate && \
docker compose -f ../docker-compose.yml exec -T db psql -U request -d request_site -c "\dt"
```
Expected: `users, org_directory, request_types, requests, request_comments, request_status_history, request_attachments, request_shared_targets` 테이블 목록 출력

- [ ] **Step 7: Commit**

```bash
cd .. && git add server/drizzle.config.ts server/src/db/schema.ts server/src/db/client.ts server/src/db/migrate.ts server/drizzle
git commit -m "feat(db): Drizzle 스키마(users 통합) + 초기 마이그레이션"
```

---

### Task 4: 트리거·함수·뷰 커스텀 마이그레이션

**Files:**
- Create(생성 후 편집): `server/drizzle/0001_triggers.sql`

**Interfaces:**
- Consumes: Task 3의 테이블.
- Produces: DB에 트리거(`trg_requests_touch/seq/snapshot/status`)와 뷰 `request_view` 생성. insert 시 `seq` 자동 생성, update 시 상태이력 자동 기록(변경자=`app.user_id`).

- [ ] **Step 1: 빈 커스텀 마이그레이션 생성**

Run:
```bash
cd server && npx drizzle-kit generate --custom --name triggers
```
Expected: `server/drizzle/0001_triggers.sql` (빈 파일) 생성 + journal 등록

- [ ] **Step 2: `0001_triggers.sql` 내용 작성**

Edit `server/drizzle/0001_triggers.sql` — 아래 전체를 기입:
```sql
-- updated_at 자동 갱신
create function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger trg_requests_touch before update on requests
for each row execute function touch_updated_at();
--> statement-breakpoint

-- 접수번호 생성: YYMMDD-NN (KST, advisory lock으로 중복 방지)
create function gen_seq() returns trigger
language plpgsql as $$
declare d text := to_char(now() at time zone 'Asia/Seoul', 'YYMMDD'); n int;
begin
  if new.seq is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('req_seq_' || d));
  select count(*) + 1 into n from requests where seq like d || '-%';
  new.seq := d || '-' || lpad(n::text, 2, '0');
  return new;
end $$;
create trigger trg_requests_seq before insert on requests
for each row execute function gen_seq();
--> statement-breakpoint

-- 접수 시점 요청자 소속 스냅샷 (profiles → users)
create function snapshot_requester() returns trigger
language plpgsql set search_path = public as $$
declare p record;
begin
  if new.requester_id is not null then
    select dept, org_affil, dept_function into p from users where id = new.requester_id;
    new.requester_dept     := coalesce(new.requester_dept, p.dept);
    new.requester_org      := coalesce(new.requester_org, p.org_affil);
    new.requester_function := coalesce(new.requester_function, p.dept_function);
  end if;
  return new;
end $$;
create trigger trg_requests_snapshot before insert on requests
for each row execute function snapshot_requester();
--> statement-breakpoint

-- 상태 변경 처리: 이력 기록(변경자=app.user_id) + 완료일/재작업 관리
create function on_status_change() returns trigger
language plpgsql set search_path = public as $$
declare uid uuid := nullif(current_setting('app.user_id', true), '')::uuid;
begin
  if new.status is distinct from old.status then
    insert into request_status_history (request_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, uid);

    if new.status = '완료' then
      new.completed_at := coalesce(new.completed_at, now());
      new.first_completed_at := coalesce(new.first_completed_at, new.completed_at);
    elsif old.status = '완료' then
      new.completed_at := null;
      if new.status = '재작업' then new.rework_count := new.rework_count + 1; end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_requests_status before update on requests
for each row execute function on_status_change();
--> statement-breakpoint

-- 보드/대시보드용 계산 뷰 (RLS 제거 → 일반 뷰. 권한은 백엔드에서)
create view request_view as
select
  r.*,
  t.label as type_label,
  case when r.first_completed_at is not null
       then (r.first_completed_at::date - r.created_at::date) end as first_lead_days,
  case when r.completed_at is not null
       then (r.completed_at::date - r.created_at::date) end       as final_lead_days,
  case
    when r.status in ('완료','반려','보류','이관','철회') then r.status::text
    when r.desired_due is not null and r.desired_due <  current_date       then '기한초과'
    when r.desired_due is not null and r.desired_due <= current_date + 1   then '임박'
    when r.desired_due is null and r.created_at::date <= current_date - 3   then '지연'
    else '여유'
  end as due_status
from requests r
left join request_types t on t.code = r.type_code;
```

- [ ] **Step 3: 마이그레이션 적용**

Run:
```bash
cd server && npm run db:migrate && \
docker compose -f ../docker-compose.yml exec -T db psql -U request -d request_site -c "\dv" -c "\df gen_seq"
```
Expected: `request_view` 뷰 존재, `gen_seq` 함수 존재 출력

- [ ] **Step 4: Commit**

```bash
cd .. && git add server/drizzle/0001_triggers.sql server/drizzle/meta
git commit -m "feat(db): 트리거(접수번호·스냅샷·상태이력)·request_view 이식"
```

---

### Task 5: 시드 데이터(김주희) + 스모크 테스트

**Files:**
- Create: `server/src/db/seed.ts`, `server/scripts/smoke.ts`

**Interfaces:**
- Consumes: Task 3 스키마, Task 4 트리거.
- Produces: `users`에 김주희(system 역할) 존재. `request_types` 4종. `org_directory` 김주희 사전등록. 이후 Phase 2 dev-login이 이 김주희 유저를 사용.

- [ ] **Step 1: `server/src/db/seed.ts` 작성**

Create `server/src/db/seed.ts`:
```ts
import { pool, db } from './client.js'
import { users, orgDirectory, requestTypes } from './schema.js'
import { sql } from 'drizzle-orm'

async function seed() {
  // 요청 유형
  await db.insert(requestTypes).values([
    { code: 'error', label: '오류', sortOrder: 1 },
    { code: 'feature', label: '기능요청', sortOrder: 2 },
    { code: 'data', label: '데이터추출', sortOrder: 3 },
    { code: 'file', label: '파일변경', sortOrder: 4 },
  ]).onConflictDoNothing()

  // 조직도 사전등록 — 김주희
  await db.insert(orgDirectory).values({
    email: 'juhuikim@baeoom.com',
    name: '김주희',
    dept: '시스템팀',
    orgAffil: '공통',
    deptFunction: '시스템팀',
    role: 'system',
    synced: true,
  }).onConflictDoNothing()

  // 사용자 — 김주희 (dev-login 대상)
  await db.insert(users).values({
    email: 'juhuikim@baeoom.com',
    name: '김주희',
    dept: '시스템팀',
    orgAffil: '공통',
    deptFunction: '시스템팀',
    role: 'system',
  }).onConflictDoNothing()

  const [{ count }] = await db.execute<{ count: string }>(
    sql`select count(*)::int as count from users`,
  ).then((r) => r.rows)
  console.log(`seed done. users=${count}`)
  await pool.end()
}

seed().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: 시드 실행 후 확인**

Run:
```bash
cd server && npm run db:seed && \
docker compose -f ../docker-compose.yml exec -T db psql -U request -d request_site \
  -c "select email, name, role from users where email='juhuikim@baeoom.com';"
```
Expected: `juhuikim@baeoom.com | 김주희 | system` 한 행 출력

- [ ] **Step 3: `server/scripts/smoke.ts` 작성 (트리거 검증)**

Create `server/scripts/smoke.ts`:
```ts
import { pool, db, withUser } from '../src/db/client.js'
import { users, requests } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'

async function main() {
  const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
  if (!juhui) throw new Error('김주희 유저 없음 — db:seed 먼저 실행')

  // 요청 1건 생성 → seq 자동 생성 확인
  const [req] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '스모크 테스트',
    requesterId: juhui.id, visibility: 'dept',
  }).returning()
  if (!req.seq || !/^\d{6}-\d{2}$/.test(req.seq)) throw new Error(`seq 형식 오류: ${req.seq}`)
  console.log(`created seq=${req.seq}, requesterOrg(snapshot)=${req.requesterOrg}`)

  // 상태변경 → history 자동 기록(변경자=김주희) 확인
  await withUser(juhui.id, (tx) =>
    tx.update(requests).set({ status: '진행중' }).where(eq(requests.id, req.id)),
  )
  const hist = await db.execute<{ to_status: string; changed_by: string }>(
    sql`select to_status, changed_by from request_status_history where request_id = ${req.id} order by id desc limit 1`,
  )
  const row = hist.rows[0]
  if (row?.to_status !== '진행중' || row?.changed_by !== juhui.id) {
    throw new Error(`상태이력 검증 실패: ${JSON.stringify(row)}`)
  }
  console.log(`history ok: ${row.to_status} by ${row.changed_by}`)

  // 뷰 조회 확인
  const view = await db.execute(sql`select id, seq, type_label, due_status from request_view where id = ${req.id}`)
  console.log('view row:', view.rows[0])

  // 정리
  await db.delete(requests).where(eq(requests.id, req.id))
  await pool.end()
  console.log('SMOKE OK')
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 4: 스모크 테스트 실행**

Run:
```bash
cd server && npm run db:smoke
```
Expected: `SMOKE OK` (seq는 `YYMMDD-01` 형식, history/view 출력 후 성공)

- [ ] **Step 5: Commit**

```bash
cd .. && git add server/src/db/seed.ts server/scripts/smoke.ts
git commit -m "feat(db): 김주희 시드 + 트리거 스모크 테스트"
```

---

## Phase 1 완료 정의

- `docker compose up -d` 로 Postgres 기동, `npm run db:migrate` 성공
- `\dt` 에 8개 테이블, `request_view` 뷰, 트리거·함수 존재
- `npm run db:seed` 후 김주희(system) 유저 존재
- `npm run db:smoke` → `SMOKE OK` (접수번호 생성·상태이력·뷰 정상)

## Self-Review 결과

- **Spec 커버리지:** 설계 §2(DB 마이그레이션) 전체 이식 — users 통합✓, RLS/storage 제거✓, 순수 트리거 유지✓, auth.uid()→app.user_id✓, request_view✓. §5-1(인프라·시드) 커버✓. (인증/API/프론트는 Phase 2~4)
- **Placeholder 스캔:** 모든 스텝에 실제 코드/명령·기대출력 포함. TBD 없음.
- **타입 일관성:** `withUser(userId, fn)` 시그니처가 client.ts 정의와 smoke.ts 사용처 일치. 테이블 export명(`users/requests/...`)이 seed·smoke에서 동일 사용.

## 다음 단계 (Phase 2 예고 — 이 플랜 완료 후 별도 작성)

인증(Google OAuth + 세션쿠키 + **dev-login 김주희**) + `authz.ts`(can_see_request 등 RLS 로직 TS 이식). Phase 1의 `users`·`withUser`를 소비한다.
