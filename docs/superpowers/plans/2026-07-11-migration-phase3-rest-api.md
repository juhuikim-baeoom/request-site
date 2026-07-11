# Phase 3: REST API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/features/requests/api.ts`의 모든 Supabase 쿼리를 대체하는 REST 엔드포인트를 Fastify에 구현한다(권한은 authz로 강제).

**Architecture:** 모든 `/api/*`(auth 제외) 라우트는 `authenticate` preHandler로 세션을 요구한다. 목록은 `visibilityFilter`를 WHERE에 주입하고, 단건 접근은 `canSeeRequest`로 가드한다. 쓰기(생성/수정/철회/보드)는 `withUser`로 트랜잭션 내 `app.user_id`를 세팅해 상태이력 트리거가 변경자를 기록하게 한다. 첨부는 `@fastify/multipart`로 받아 `server/uploads/<reqId>/`에 저장하고 다운로드 시 권한을 검사한다.

**Tech Stack:** Fastify 5, Drizzle, @fastify/multipart, node:fs/promises, tsx 테스트.

## Global Constraints

- 모든 `/api/*` 라우트(‑ `/api/auth/*` 제외)는 세션 필수(`authenticate`), 미인증 시 401.
- 응답 JSON 키는 프론트 `api.ts`가 기대하는 **snake_case DB 컬럼명**과 동일(예: `requester_id`, `type_label`, `due_status`). Drizzle 결과를 그대로 반환하되 컬럼 별칭이 snake_case가 되도록 `db.execute(sql...)` 또는 select 매핑을 사용.
- 목록/뷰 조회는 `request_view` 뷰 + `visibilityFilter(u)` 적용, 최신순(`created_at desc`).
- 단건/하위(comments·history·attachments·shared) 접근은 `canSeeRequest` 통과 필요, 실패 시 403.
- 쓰기 규칙(schema.sql RLS 이식):
  - 생성: `requester_id = 현재 사용자`.
  - 수정(title/body/priority/visibility/desired_due): `is_system` 또는 (본인 且 status='접수').
  - 철회: 본인 且 status='접수' → status='철회'.
  - 보드 변경(status/assignee_id): `is_system`만.
- 첨부 저장 경로: `server/uploads/<requestId>/<timestamp>-<uuid><ext>` (ASCII), 원본 파일명은 `file_name` 컬럼.
- 상태 변경을 유발하는 update는 반드시 `withUser(currentUser.id, ...)` 안에서 수행.

---

### Task 1: 공통 미들웨어 + 정적 조회(request-types·dept-options·profiles) + 요청 목록·공유대상

**Files:**
- Create: `server/src/routes/meta.ts`, `server/src/routes/requests.ts`, `server/src/routes/helpers.ts`
- Modify: `server/src/app.ts`
- Test: `server/scripts/test-api-list.ts`

**Interfaces:**
- Consumes: `authenticate`, `visibilityFilter`, `db`, `sql`.
- Produces:
  - `helpers.ts` → `requireAuth(app)` (모든 `/api` 라우트에 `authenticate` preHandler 적용하는 등록 헬퍼) — 실제로는 각 라우트 모듈에서 `app.addHook('preHandler', authenticate)` 사용.
  - 라우트: `GET /api/request-types`, `GET /api/dept-options`, `GET /api/profiles`, `GET /api/requests`, `GET /api/requests/shared-targets`.

- [ ] **Step 1: `server/src/routes/meta.ts` 작성**

Create `server/src/routes/meta.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'

export async function metaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/api/request-types', async () => {
    const r = await db.execute(sql`
      select code, label, sort_order, active from request_types
      where active = true order by sort_order`)
    return r.rows
  })

  app.get('/api/dept-options', async () => {
    const r = await db.execute(sql`
      select distinct org_affil, dept_function from org_directory
      where dept_function is not null order by org_affil, dept_function`)
    return r.rows
  })

  app.get('/api/profiles', async () => {
    const r = await db.execute(sql`
      select id, name, email, role, org_affil, dept_function from users order by name`)
    return r.rows
  })
}
```

- [ ] **Step 2: `server/src/routes/requests.ts` 작성 (목록 + 공유대상; 상세/생성/수정은 후속 Task에서 이 파일에 추가)**

Create `server/src/routes/requests.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { visibilityFilter } from '../authz.js'

export async function requestRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // 내가 볼 수 있는 요청 목록 (request_view + visibilityFilter). 최신순
  app.get('/api/requests', async (request) => {
    const u = request.currentUser!
    const filter = visibilityFilter(u)
    const r = await db.execute(sql`
      select r.* from request_view r
      where ${filter}
      order by r.created_at desc`)
    return r.rows
  })

  // 볼 수 있는 요청들의 추가 공유 대상 (뱃지 표시용) — visibilityFilter 통과 요청만
  app.get('/api/requests/shared-targets', async (request) => {
    const u = request.currentUser!
    const filter = visibilityFilter(u)
    const r = await db.execute(sql`
      select st.* from request_shared_targets st
      where st.request_id in (select r.id from request_view r where ${filter})`)
    return r.rows
  })
}
```

- [ ] **Step 3: `server/src/app.ts` 에 라우트 등록**

Modify `server/src/app.ts` — import 추가 후 `authRoutes` 등록 뒤에:
```ts
  await app.register(metaRoutes)
  await app.register(requestRoutes)
```
(import: `import { metaRoutes } from './routes/meta.js'`, `import { requestRoutes } from './routes/requests.js'`)

- [ ] **Step 4: `server/src/routes/helpers.ts` 작성 (테스트용 로그인 헬퍼)**

Create `server/src/routes/helpers.ts`:
```ts
// 테스트에서 dev-login 세션 쿠키를 얻기 위한 헬퍼
import type { FastifyInstance } from 'fastify'

export async function loginAsDev(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/dev-login' })
  const setCookie = res.headers['set-cookie'] as string
  return decodeURIComponent(setCookie.split('sid=')[1].split(';')[0])
}
```

- [ ] **Step 5: `server/scripts/test-api-list.ts` 작성**

Create `server/scripts/test-api-list.ts`:
```ts
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { pool } from '../src/db/client.js'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()

// 미인증 401
const anon = await app.inject({ method: 'GET', url: '/api/requests' })
assert.equal(anon.statusCode, 401)
console.log('unauth 401 ok')

const sid = await loginAsDev(app)
const cookies = { sid }

const types = await app.inject({ method: 'GET', url: '/api/request-types', cookies })
assert.equal(types.statusCode, 200)
assert.equal(types.json().length, 4)
console.log('request-types ok')

const profiles = await app.inject({ method: 'GET', url: '/api/profiles', cookies })
assert.ok(profiles.json().some((p: any) => p.email === 'juhuikim@baeoom.com'))
console.log('profiles ok')

const list = await app.inject({ method: 'GET', url: '/api/requests', cookies })
assert.equal(list.statusCode, 200)
assert.ok(Array.isArray(list.json()))
console.log('requests list ok')

const shared = await app.inject({ method: 'GET', url: '/api/requests/shared-targets', cookies })
assert.equal(shared.statusCode, 200)
console.log('shared-targets ok')

await app.close()
await pool.end()
console.log('API LIST TEST OK')
```

- [ ] **Step 6: package.json 스크립트 + 실행**

Modify `server/package.json` scripts 에 `"test:api": "tsx scripts/test-api-list.ts"` 추가.
Run:
```bash
cd server && npm run test:api
```
Expected: `unauth 401 ok` / `request-types ok` / `profiles ok` / `requests list ok` / `shared-targets ok` / `API LIST TEST OK`

- [ ] **Step 7: Commit**

```bash
cd .. && git add server/src/routes server/src/app.ts server/scripts/test-api-list.ts server/package.json
git commit -m "feat(api): 요청 목록·공유대상·정적조회 + 세션 가드"
```

---

### Task 2: 요청 상세 + 코멘트(조회/작성) + 이력 + 첨부목록

**Files:**
- Modify: `server/src/routes/requests.ts`
- Create: `server/src/routes/request-detail.ts`
- Modify: `server/src/app.ts`
- Test: `server/scripts/test-api-detail.ts`

**Interfaces:**
- Consumes: `canSeeRequest`, `withUser`, `db`.
- Produces: 라우트 `GET /api/requests/:id`, `GET /api/requests/:id/comments`, `POST /api/requests/:id/comments`, `GET /api/requests/:id/history`, `GET /api/requests/:id/attachments`. 공용 헬퍼 `assertCanSee(u, id): Promise<void>` (403 throw).

- [ ] **Step 1: `server/src/routes/request-detail.ts` 작성**

Create `server/src/routes/request-detail.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { canSeeRequest } from '../authz.js'
import type { CurrentUser } from '../types.js'

async function loadForSee(u: CurrentUser, id: number) {
  const r = await db.execute<any>(sql`
    select id, requester_id, visibility, requester_org, requester_function
    from requests where id = ${id}`)
  const req = r.rows[0]
  if (!req) return { req: null, ok: false }
  const st = await db.execute<any>(sql`
    select target_type, target_value from request_shared_targets where request_id = ${id}`)
  const ok = canSeeRequest(
    u,
    { requesterId: req.requester_id, visibility: req.visibility, requesterOrg: req.requester_org, requesterFunction: req.requester_function },
    st.rows.map((x) => ({ targetType: x.target_type, targetValue: x.target_value })),
  )
  return { req, ok }
}

export async function requestDetailRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // 상세: view + requester/assignee + sharedTargets
  app.get<{ Params: { id: string } }>('/api/requests/:id', async (request, reply) => {
    const u = request.currentUser!
    const id = Number(request.params.id)
    const { ok } = await loadForSee(u, id)
    if (!ok) { reply.code(ok === false ? 404 : 403); return { error: 'not found or forbidden' } }

    const viewRes = await db.execute<any>(sql`select * from request_view where id = ${id}`)
    const view = viewRes.rows[0]
    const ids = [view.requester_id, view.assignee_id].filter(Boolean)
    let byId: Record<string, any> = {}
    if (ids.length) {
      const p = await db.execute<any>(sql`
        select id, name, email, dept_function, org_affil from users where id = any(${ids})`)
      byId = Object.fromEntries(p.rows.map((r) => [r.id, r]))
    }
    const st = await db.execute<any>(sql`
      select * from request_shared_targets where request_id = ${id}`)
    return {
      view,
      requester: view.requester_id ? byId[view.requester_id] ?? null : null,
      assignee: view.assignee_id ? byId[view.assignee_id] ?? null : null,
      sharedTargets: st.rows,
    }
  })

  app.get<{ Params: { id: string } }>('/api/requests/:id/comments', async (request, reply) => {
    const u = request.currentUser!; const id = Number(request.params.id)
    const { ok } = await loadForSee(u, id)
    if (!ok) { reply.code(403); return { error: 'forbidden' } }
    const r = await db.execute<any>(sql`
      select c.*, json_build_object('name', a.name) as author
      from request_comments c left join users a on a.id = c.author_id
      where c.request_id = ${id} order by c.created_at asc`)
    return r.rows
  })

  app.post<{ Params: { id: string }; Body: { body: string } }>('/api/requests/:id/comments', async (request, reply) => {
    const u = request.currentUser!; const id = Number(request.params.id)
    const { ok } = await loadForSee(u, id)
    if (!ok) { reply.code(403); return { error: 'forbidden' } }
    const body = (request.body?.body ?? '').trim()
    if (!body) { reply.code(400); return { error: 'empty' } }
    await db.execute(sql`
      insert into request_comments (request_id, author_id, body)
      values (${id}, ${u.id}, ${body})`)
    reply.code(201); return { ok: true }
  })

  app.get<{ Params: { id: string } }>('/api/requests/:id/history', async (request, reply) => {
    const u = request.currentUser!; const id = Number(request.params.id)
    const { ok } = await loadForSee(u, id)
    if (!ok) { reply.code(403); return { error: 'forbidden' } }
    const r = await db.execute<any>(sql`
      select h.*, json_build_object('name', a.name) as actor
      from request_status_history h left join users a on a.id = h.changed_by
      where h.request_id = ${id} order by h.changed_at asc`)
    return r.rows
  })

  app.get<{ Params: { id: string } }>('/api/requests/:id/attachments', async (request, reply) => {
    const u = request.currentUser!; const id = Number(request.params.id)
    const { ok } = await loadForSee(u, id)
    if (!ok) { reply.code(403); return { error: 'forbidden' } }
    const r = await db.execute<any>(sql`
      select * from request_attachments where request_id = ${id} order by created_at asc`)
    return r.rows
  })
}
```

- [ ] **Step 2: app.ts 등록**

Modify `server/src/app.ts` — `import { requestDetailRoutes } from './routes/request-detail.js'` 추가, `requestRoutes` 등록 뒤 `await app.register(requestDetailRoutes)`.

- [ ] **Step 3: `server/scripts/test-api-detail.ts` 작성**

Create `server/scripts/test-api-detail.ts`:
```ts
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool, withUser } from '../src/db/client.js'
import { users, requests } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()
const sid = await loginAsDev(app)
const cookies = { sid }
const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })

// 픽스처 요청 생성
const [req] = await db.insert(requests).values({
  org: '공통', typeCode: 'error', title: 'detail 테스트',
  requesterId: juhui!.id, visibility: 'dept',
}).returning()

// 상세
const detail = await app.inject({ method: 'GET', url: `/api/requests/${req.id}`, cookies })
assert.equal(detail.statusCode, 200)
assert.equal(detail.json().view.title, 'detail 테스트')
assert.equal(detail.json().requester.email, 'juhuikim@baeoom.com')
console.log('detail ok')

// 코멘트 작성 → 조회
const add = await app.inject({ method: 'POST', url: `/api/requests/${req.id}/comments`, cookies, payload: { body: '테스트 코멘트' } })
assert.equal(add.statusCode, 201)
const comments = await app.inject({ method: 'GET', url: `/api/requests/${req.id}/comments`, cookies })
assert.equal(comments.json()[0].body, '테스트 코멘트')
assert.equal(comments.json()[0].author.name, '김주희')
console.log('comments ok')

// 상태변경 후 이력
await withUser(juhui!.id, (tx) => tx.update(requests).set({ status: '진행중' }).where(eq(requests.id, req.id)))
const hist = await app.inject({ method: 'GET', url: `/api/requests/${req.id}/history`, cookies })
assert.ok(hist.json().some((h: any) => h.to_status === '진행중' && h.actor.name === '김주희'))
console.log('history ok')

// 첨부목록(빈 배열)
const att = await app.inject({ method: 'GET', url: `/api/requests/${req.id}/attachments`, cookies })
assert.deepEqual(att.json(), [])
console.log('attachments ok')

// 정리
await db.delete(requests).where(eq(requests.id, req.id))
await app.close(); await pool.end()
console.log('API DETAIL TEST OK')
```

- [ ] **Step 4: 실행 + Commit**

Modify `server/package.json` scripts 에 `"test:api-detail": "tsx scripts/test-api-detail.ts"` 추가.
Run:
```bash
cd server && npm run test:api-detail
```
Expected: `detail ok` / `comments ok` / `history ok` / `attachments ok` / `API DETAIL TEST OK`
```bash
cd .. && git add server/src/routes/request-detail.ts server/src/app.ts server/scripts/test-api-detail.ts server/package.json
git commit -m "feat(api): 요청 상세·코멘트·이력·첨부목록 + canSeeRequest 가드"
```

---

### Task 3: 요청 생성(JSON) + 공유대상, 수정/철회/보드 변경(PATCH)

**Files:**
- Modify: `server/src/routes/requests.ts`
- Test: `server/scripts/test-api-write.ts`

**Interfaces:**
- Consumes: `withUser`, `isSystem`, `db`.
- Produces: `POST /api/requests` (body: org,type_code,priority,visibility,title,body,desired_due,sharedTargets[]) → 생성된 request row. `PATCH /api/requests/:id` (수정/철회/보드 통합, 역할별 규칙).

- [ ] **Step 1: `requests.ts` 에 생성·수정 라우트 추가**

Edit `server/src/routes/requests.ts` — `requestRoutes` 함수 안, 기존 GET들 뒤에 추가. 상단 import에 `withUser`(from '../db/client.js'), `isSystem`(from '../authz.js') 추가:
```ts
  // 요청 생성
  app.post<{ Body: any }>('/api/requests', async (request, reply) => {
    const u = request.currentUser!
    const b = request.body ?? {}
    if (!b.org || !b.type_code || !b.title?.trim()) { reply.code(400); return { error: 'invalid' } }
    const created = await withUser(u.id, async (tx) => {
      const ins = await tx.execute<any>(sql`
        insert into requests (org, type_code, priority, visibility, title, body, desired_due, requester_id)
        values (${b.org}, ${b.type_code}, ${b.priority ?? '보통'}, ${b.visibility ?? 'dept'},
                ${b.title.trim()}, ${b.body ?? null}, ${b.desired_due || null}, ${u.id})
        returning *`)
      const row = ins.rows[0]
      const targets = Array.isArray(b.sharedTargets) ? b.sharedTargets : []
      for (const t of targets) {
        await tx.execute(sql`
          insert into request_shared_targets (request_id, target_type, target_value)
          values (${row.id}, ${t.target_type}, ${t.target_value})
          on conflict do nothing`)
      }
      return row
    })
    reply.code(201); return created
  })

  // 수정/철회/보드 변경 통합
  app.patch<{ Params: { id: string }; Body: any }>('/api/requests/:id', async (request, reply) => {
    const u = request.currentUser!
    const id = Number(request.params.id)
    const b = request.body ?? {}
    const cur = await db.execute<any>(sql`select requester_id, status from requests where id = ${id}`)
    const row = cur.rows[0]
    if (!row) { reply.code(404); return { error: 'not found' } }

    const isOwner = row.requester_id === u.id
    const sys = isSystem(u)

    // 보드 변경(status/assignee) — 시스템팀만. 단 철회는 소유자도 가능.
    const wantsBoard = b.status !== undefined || b.assignee_id !== undefined
    const ownerCancel = isOwner && row.status === '접수' && b.status === '철회' && b.assignee_id === undefined
    if (wantsBoard && !sys && !ownerCancel) { reply.code(403); return { error: 'forbidden' } }

    // 내용 수정 — 시스템팀 또는 (본인 且 접수)
    const wantsEdit = ['title', 'body', 'priority', 'visibility', 'desired_due'].some((k) => b[k] !== undefined)
    if (wantsEdit && !sys && !(isOwner && row.status === '접수')) { reply.code(403); return { error: 'forbidden' } }

    const sets: any[] = []
    for (const k of ['title', 'body', 'priority', 'visibility', 'desired_due', 'status', 'assignee_id']) {
      if (b[k] !== undefined) sets.push(sql`${sql.raw(k)} = ${b[k]}`)
    }
    if (!sets.length) { reply.code(400); return { error: 'no fields' } }

    await withUser(u.id, (tx) =>
      tx.execute(sql`update requests set ${sql.join(sets, sql`, `)} where id = ${id}`))
    reply.code(200); return { ok: true }
  })
```

- [ ] **Step 2: `server/scripts/test-api-write.ts` 작성**

Create `server/scripts/test-api-write.ts`:
```ts
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { requests } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()
const sid = await loginAsDev(app)
const cookies = { sid }

// 생성 (+공유대상)
const create = await app.inject({
  method: 'POST', url: '/api/requests', cookies,
  payload: {
    org: '공통', type_code: 'feature', priority: '보통', visibility: 'dept',
    title: 'write 테스트', body: '<p>본문</p>', desired_due: null,
    sharedTargets: [{ target_type: 'function', target_value: '교학팀' }],
  },
})
assert.equal(create.statusCode, 201)
const reqId = create.json().id
assert.match(create.json().seq, /^\d{6}-\d{2}$/)
console.log('create ok seq=', create.json().seq)

// 보드 변경 (시스템팀 = 김주희)
const board = await app.inject({ method: 'PATCH', url: `/api/requests/${reqId}`, cookies, payload: { status: '진행중' } })
assert.equal(board.statusCode, 200)
const check = await db.execute<any>(sql`select status from requests where id = ${reqId}`)
assert.equal(check.rows[0].status, '진행중')
console.log('board update ok')

// 내용 수정
const edit = await app.inject({ method: 'PATCH', url: `/api/requests/${reqId}`, cookies, payload: { title: '수정됨' } })
assert.equal(edit.statusCode, 200)
console.log('edit ok')

// 정리
await db.delete(requests).where(eq(requests.id, reqId))
await app.close(); await pool.end()
console.log('API WRITE TEST OK')
```

- [ ] **Step 3: 실행 + Commit**

Modify `server/package.json` scripts 에 `"test:api-write": "tsx scripts/test-api-write.ts"` 추가.
Run:
```bash
cd server && npm run test:api-write
```
Expected: `create ok seq=...` / `board update ok` / `edit ok` / `API WRITE TEST OK`
```bash
cd .. && git add server/src/routes/requests.ts server/scripts/test-api-write.ts server/package.json
git commit -m "feat(api): 요청 생성(+공유대상)·수정·철회·보드변경 PATCH"
```

---

### Task 4: 첨부 업로드/다운로드 (multipart + 로컬 디스크)

**Files:**
- Create: `server/src/routes/attachments.ts`, `server/src/storage.ts`
- Modify: `server/src/app.ts`, `server/package.json` (deps)
- Test: `server/scripts/test-api-attach.ts`

**Interfaces:**
- Consumes: `canSeeRequest`(via loadForSee 재사용은 별도 — 여기선 소유/시스템 규칙), `db`, fs.
- Produces:
  - `storage.ts` → `saveUpload(requestId, fileName, buf): Promise<{ path, size }>`, `resolveUpload(path): string`(절대경로), `safeExt(name)`.
  - `POST /api/requests/:id/attachments` (multipart), `GET /api/attachments/:id/download`.

- [ ] **Step 1: 의존성 추가**

Run: `cd server && npm install @fastify/multipart@^9`
Expected: 설치 성공 (Fastify 5 호환)

- [ ] **Step 2: `server/src/storage.ts` 작성**

Create `server/src/storage.ts`:
```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const ROOT = resolve(process.cwd(), 'uploads')

export function safeExt(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return ''
  const ext = name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
  return ext ? `.${ext}` : ''
}

export async function saveUpload(requestId: number, fileName: string, buf: Buffer) {
  const rel = `${requestId}/${Date.now()}-${randomUUID()}${safeExt(fileName)}`
  const abs = join(ROOT, rel)
  await mkdir(join(ROOT, String(requestId)), { recursive: true })
  await writeFile(abs, buf)
  return { path: rel, size: buf.length }
}

export function resolveUpload(rel: string): string {
  const abs = resolve(ROOT, rel)
  if (!abs.startsWith(ROOT)) throw new Error('경로 이탈')  // path traversal 방지
  return abs
}
```

- [ ] **Step 3: `server/src/routes/attachments.ts` 작성**

Create `server/src/routes/attachments.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { canSeeRequest } from '../authz.js'
import { saveUpload, resolveUpload } from '../storage.js'
import type { CurrentUser } from '../types.js'

async function canSee(u: CurrentUser, requestId: number): Promise<boolean> {
  const r = await db.execute<any>(sql`
    select requester_id, visibility, requester_org, requester_function
    from requests where id = ${requestId}`)
  const req = r.rows[0]; if (!req) return false
  const st = await db.execute<any>(sql`select target_type, target_value from request_shared_targets where request_id = ${requestId}`)
  return canSeeRequest(u,
    { requesterId: req.requester_id, visibility: req.visibility, requesterOrg: req.requester_org, requesterFunction: req.requester_function },
    st.rows.map((x: any) => ({ targetType: x.target_type, targetValue: x.target_value })))
}

export async function attachmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.post<{ Params: { id: string } }>('/api/requests/:id/attachments', async (request, reply) => {
    const u = request.currentUser!; const id = Number(request.params.id)
    if (!(await canSee(u, id))) { reply.code(403); return { error: 'forbidden' } }
    const part = await request.file()
    if (!part) { reply.code(400); return { error: 'no file' } }
    const buf = await part.toBuffer()
    const { path, size } = await saveUpload(id, part.filename, buf)
    const r = await db.execute<any>(sql`
      insert into request_attachments (request_id, storage_path, file_name, file_size, mime_type, uploaded_by)
      values (${id}, ${path}, ${part.filename}, ${size}, ${part.mimetype || null}, ${u.id})
      returning *`)
    reply.code(201); return r.rows[0]
  })

  app.get<{ Params: { id: string } }>('/api/attachments/:id/download', async (request, reply) => {
    const u = request.currentUser!; const attId = Number(request.params.id)
    const a = await db.execute<any>(sql`select * from request_attachments where id = ${attId}`)
    const att = a.rows[0]; if (!att) { reply.code(404); return { error: 'not found' } }
    if (!(await canSee(u, att.request_id))) { reply.code(403); return { error: 'forbidden' } }
    reply.header('Content-Type', att.mime_type ?? 'application/octet-stream')
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.file_name ?? 'file')}`)
    return reply.send(createReadStream(resolveUpload(att.storage_path)))
  })
}
```

- [ ] **Step 4: app.ts 등록 + multipart**

Modify `server/src/app.ts` — `import multipart from '@fastify/multipart'`, `import { attachmentRoutes } from './routes/attachments.js'` 추가. cors 등록 뒤에 `await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } })`, 그리고 라우트 등록부에 `await app.register(attachmentRoutes)`.

- [ ] **Step 5: `server/scripts/test-api-attach.ts` 작성**

Create `server/scripts/test-api-attach.ts`:
```ts
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db, pool } from '../src/db/client.js'
import { requests } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'
import { loginAsDev } from '../src/routes/helpers.js'

const app = await buildApp()
const sid = await loginAsDev(app)
const juhui = await db.query.users.findFirst({ where: eq(sql`email`, sql`email`) as any }).catch(() => null)
const cookies = { sid }

// 픽스처
const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', cookies })
const uid = meRes.json().user.id
const [req] = await db.insert(requests).values({ org: '공통', typeCode: 'error', title: 'attach 테스트', requesterId: uid, visibility: 'dept' }).returning()

// multipart 업로드
const boundary = '----t'
const body = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="한글.txt"\r\nContent-Type: text/plain\r\n\r\n`),
  Buffer.from('hello-첨부'),
  Buffer.from(`\r\n--${boundary}--\r\n`),
])
const up = await app.inject({
  method: 'POST', url: `/api/requests/${req.id}/attachments`, cookies,
  headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
})
assert.equal(up.statusCode, 201)
assert.equal(up.json().file_name, '한글.txt')
const attId = up.json().id
console.log('upload ok path=', up.json().storage_path)

// 다운로드
const dl = await app.inject({ method: 'GET', url: `/api/attachments/${attId}/download`, cookies })
assert.equal(dl.statusCode, 200)
assert.ok(dl.rawPayload.toString().includes('hello-첨부'))
console.log('download ok')

// 정리 (요청 삭제 → 첨부 cascade)
await db.delete(requests).where(eq(requests.id, req.id))
await app.close(); await pool.end()
console.log('API ATTACH TEST OK')
```

- [ ] **Step 6: 실행 + Commit**

Modify `server/package.json` scripts 에 `"test:api-attach": "tsx scripts/test-api-attach.ts"` 추가.
Run:
```bash
cd server && npm run test:api-attach
```
Expected: `upload ok path=...` / `download ok` / `API ATTACH TEST OK`
```bash
cd .. && git add server/src/routes/attachments.ts server/src/storage.ts server/src/app.ts server/scripts/test-api-attach.ts server/package.json server/package-lock.json
git commit -m "feat(api): 첨부 업로드/다운로드(multipart+로컬디스크) + 권한검사"
```

---

## Phase 3 완료 정의

- `npm run test:api` / `test:api-detail` / `test:api-write` / `test:api-attach` 전부 OK
- 미인증 요청 401, 권한 없는 단건 접근 403
- `npm run typecheck` 통과
- `api.ts`의 모든 훅에 대응하는 엔드포인트 존재(목록·상세·코멘트·이력·첨부·생성·수정·철회·보드·types·dept-options·profiles)

## Self-Review 결과

- **Spec 커버리지:** 설계 §4(REST API), §5(스토리지) — api.ts 훅 15종 전부 매핑. visibilityFilter(목록)·canSeeRequest(단건)·쓰기규칙(생성/수정/철회/보드) 이식. 첨부 로컬디스크+권한 다운로드.
- **Placeholder 스캔:** 실제 코드/명령·기대출력 포함. TBD 없음.
- **타입 일관성:** `loginAsDev(app)→sid`, `saveUpload/resolveUpload` 시그니처 일관. 응답 키 snake_case(프론트 계약)로 통일. `canSeeRequest` 호출 인자 형태 detail/attach에서 동일.

## 다음 단계 (Phase 4 예고)

프론트 교체 — `lib/api.ts`(fetch 클라이언트) + AuthProvider(/api/auth/me·dev-login) + LoginPage(임시로그인 버튼) + `features/requests/api.ts`를 새 엔드포인트로 재작성 + Supabase 제거. Phase 2·3의 엔드포인트를 소비한다.
