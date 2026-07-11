# Phase 2: 인증 + dev-login + authz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 백엔드에 세션 쿠키 인증, 로컬 전용 김주희 dev-login, Google OAuth(게이트), 그리고 RLS를 대체하는 authz 모듈을 구축한다.

**Architecture:** Fastify를 `buildApp()` 팩토리로 분리해 `app.inject()`로 테스트 가능하게 만든다. 서명된 httpOnly 쿠키(`sid`=userId)로 세션을 유지하고, `preHandler` 훅이 쿠키에서 사용자를 로드해 `request.currentUser`에 붙인다. dev-login은 `APP_ENV=local`일 때만 라우트를 등록한다. Google OAuth는 `GOOGLE_CLIENT_ID`가 있을 때만 등록하며, 로그인 성공 시 `upsertUserFromEmail`로 도메인 검증·org_directory 반영 후 세션을 발급한다. authz는 순수 함수(`canSeeRequest`)와 목록용 SQL 필터 빌더로 `schema.sql`의 RLS 로직을 이식한다.

**Tech Stack:** Fastify 4, @fastify/cookie, @fastify/oauth2, Drizzle, node:test(assert) + Fastify inject, tsx.

## Global Constraints

- 세션 쿠키명 `sid`, 값=`users.id`, `httpOnly, sameSite:'lax', signed, path:'/'`. 서명 키는 `env.SESSION_SECRET`.
- 허용 도메인: `baeoom.com`, `baeron.com` (그 외 로그인 차단 — `handle_new_user` 로직 이식).
- dev-login 대상: 김주희 `juhuikim@baeoom.com` (Phase 1에서 시드됨).
- dev-login 라우트는 `APP_ENV !== 'local'` 이면 등록하지 않는다(404).
- Google OAuth 라우트는 `GOOGLE_CLIENT_ID`가 비어 있으면 등록하지 않는다.
- `request.currentUser` 타입: `{ id: string; email: string; name: string | null; orgAffil: string | null; deptFunction: string | null; role: 'staff'|'system'|'viewer' }`.
- 권한 로직은 `schema.sql`의 `can_see_request`와 의미적으로 동일하게 이식.
- CORS: `env.WEB_ORIGIN` 허용, `credentials: true`.

---

### Task 1: buildApp 리팩터 + CORS/쿠키 + 세션 인증 + /api/auth/me·logout

**Files:**
- Create: `server/src/app.ts`, `server/src/auth/session.ts`, `server/src/routes/auth.ts`, `server/src/types.ts`
- Modify: `server/src/index.ts` (buildApp 사용), `server/package.json` (deps 추가)
- Test: `server/scripts/test-auth.ts`

**Interfaces:**
- Consumes: Phase 1 `db`, `users` 스키마.
- Produces:
  - `server/src/app.ts` → `export async function buildApp(): Promise<FastifyInstance>`
  - `server/src/auth/session.ts` → `setSession(reply, userId)`, `clearSession(reply)`, `getSessionUserId(request): string | null`, `loadCurrentUser(request): Promise<CurrentUser | null>`, `authenticate` preHandler (401 if none)
  - `server/src/types.ts` → `export interface CurrentUser { id: string; email: string; name: string | null; orgAffil: string | null; deptFunction: string | null; role: 'staff'|'system'|'viewer' }` + Fastify 모듈 확장(`currentUser`)
  - 라우트: `GET /api/auth/me`, `POST /api/auth/logout`

- [ ] **Step 1: 의존성 추가**

Run:
```bash
cd server && npm install @fastify/cookie@^10 @fastify/cors@^10
```
Expected: 설치 성공 (Fastify 4 호환 버전)

- [ ] **Step 2: `server/src/types.ts` 작성**

Create `server/src/types.ts`:
```ts
import type { FastifyRequest } from 'fastify'

export interface CurrentUser {
  id: string
  email: string
  name: string | null
  orgAffil: string | null
  deptFunction: string | null
  role: 'staff' | 'system' | 'viewer'
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: CurrentUser | null
  }
}

export type Req = FastifyRequest
```

- [ ] **Step 3: `server/src/auth/session.ts` 작성**

Create `server/src/auth/session.ts`:
```ts
import type { FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import type { CurrentUser } from '../types.js'

const COOKIE = 'sid'

export function setSession(reply: FastifyReply, userId: string) {
  reply.setCookie(COOKIE, userId, {
    httpOnly: true, sameSite: 'lax', signed: true, path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(COOKIE, { path: '/' })
}

export function getSessionUserId(request: FastifyRequest): string | null {
  const raw = request.cookies[COOKIE]
  if (!raw) return null
  const un = request.unsignCookie(raw)
  return un.valid ? un.value : null
}

export async function loadCurrentUser(request: FastifyRequest): Promise<CurrentUser | null> {
  const id = getSessionUserId(request)
  if (!id) return null
  const u = await db.query.users.findFirst({ where: eq(users.id, id) })
  if (!u) return null
  return {
    id: u.id, email: u.email, name: u.name,
    orgAffil: u.orgAffil, deptFunction: u.deptFunction, role: u.role,
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const user = await loadCurrentUser(request)
  if (!user) { reply.code(401).send({ error: 'unauthorized' }); return }
  request.currentUser = user
}
```

- [ ] **Step 4: `server/src/routes/auth.ts` 작성 (me·logout만; dev-login/google은 Task 2·4)**

Create `server/src/routes/auth.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { loadCurrentUser, clearSession } from '../auth/session.js'

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/me', async (request) => {
    const user = await loadCurrentUser(request)
    return { user }
  })

  app.post('/api/auth/logout', async (_request, reply) => {
    clearSession(reply)
    return { ok: true }
  })
}
```

- [ ] **Step 5: `server/src/app.ts` 작성**

Create `server/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { env } from './env.js'
import { authRoutes } from './routes/auth.js'
import './types.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true })

  await app.register(cookie, { secret: env.SESSION_SECRET })
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true })

  app.decorateRequest('currentUser', null)
  app.get('/health', async () => ({ ok: true }))
  await app.register(authRoutes)

  return app
}
```

- [ ] **Step 6: `server/src/index.ts` 를 buildApp 사용으로 수정**

Replace `server/src/index.ts` 전체:
```ts
import { buildApp } from './app.js'
import { env } from './env.js'

const app = await buildApp()
app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`server up on :${env.PORT}`))
  .catch((err) => { app.log.error(err); process.exit(1) })
```

- [ ] **Step 7: `server/scripts/test-auth.ts` 작성 (inject 기반)**

Create `server/scripts/test-auth.ts`:
```ts
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { db } from '../src/db/client.js'
import { users } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { pool } from '../src/db/client.js'

const app = await buildApp()

// 1) 쿠키 없으면 me.user == null
const anon = await app.inject({ method: 'GET', url: '/api/auth/me' })
assert.equal(anon.statusCode, 200)
assert.equal(anon.json().user, null)
console.log('anon me ok')

// 2) 서명 쿠키를 심으면 me.user 반환
const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
assert.ok(juhui, 'seed 필요')
const signed = app.signCookie(juhui.id)
const authed = await app.inject({
  method: 'GET', url: '/api/auth/me', cookies: { sid: signed },
})
assert.equal(authed.json().user.email, 'juhuikim@baeoom.com')
assert.equal(authed.json().user.role, 'system')
console.log('authed me ok')

// 3) logout 은 쿠키 삭제 헤더를 보냄
const out = await app.inject({ method: 'POST', url: '/api/auth/logout' })
assert.match(out.headers['set-cookie'] as string, /sid=;/)
console.log('logout ok')

await app.close()
await pool.end()
console.log('AUTH TEST OK')
```

- [ ] **Step 8: package.json 에 test 스크립트 추가**

Modify `server/package.json` scripts 에 추가:
```json
"test:auth": "tsx scripts/test-auth.ts",
```

- [ ] **Step 9: 테스트 실행**

Run:
```bash
cd server && npm run test:auth
```
Expected: `anon me ok` / `authed me ok` / `logout ok` / `AUTH TEST OK`

- [ ] **Step 10: 서버 기동 회귀 확인**

Run:
```bash
cd server && (npm run dev >/tmp/srv.log 2>&1 &) && sleep 4 && curl -s localhost:4000/api/auth/me; echo; pkill -f "tsx watch src/index.ts"
```
Expected: `{"user":null}`

- [ ] **Step 11: Commit**

```bash
cd .. && git add server/src server/scripts/test-auth.ts server/package.json server/package-lock.json
git commit -m "feat(auth): 세션 쿠키 + /api/auth/me·logout + buildApp 리팩터"
```

---

### Task 2: dev-login (로컬 전용 김주희 자동 로그인)

**Files:**
- Create: `server/src/auth/dev-login.ts`
- Modify: `server/src/app.ts` (조건부 등록)
- Test: `server/scripts/test-devlogin.ts`

**Interfaces:**
- Consumes: Task 1 `setSession`, `isLocal`, `db`, `users`.
- Produces: `server/src/auth/dev-login.ts` → `export async function devLoginRoutes(app)`. 라우트 `POST /api/auth/dev-login` — 김주희 유저 조회 후 세션 발급, `{ user }` 반환.

- [ ] **Step 1: `server/src/auth/dev-login.ts` 작성**

Create `server/src/auth/dev-login.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { setSession } from './session.js'

const DEV_EMAIL = 'juhuikim@baeoom.com'

export async function devLoginRoutes(app: FastifyInstance) {
  // APP_ENV=local 일 때만 이 함수가 등록됨(app.ts 에서 게이트)
  app.post('/api/auth/dev-login', async (_request, reply) => {
    const u = await db.query.users.findFirst({ where: eq(users.email, DEV_EMAIL) })
    if (!u) {
      reply.code(500).send({ error: 'dev 유저 없음 — npm run db:seed 실행 필요' })
      return
    }
    setSession(reply, u.id)
    return {
      user: {
        id: u.id, email: u.email, name: u.name,
        orgAffil: u.orgAffil, deptFunction: u.deptFunction, role: u.role,
      },
    }
  })
}
```

- [ ] **Step 2: `server/src/app.ts` 에 조건부 등록 추가**

Modify `server/src/app.ts` — `import { isLocal } from './env.js'` 및 `import { devLoginRoutes } from './auth/dev-login.js'` 추가하고, `await app.register(authRoutes)` 다음에:
```ts
  if (isLocal) await app.register(devLoginRoutes)
```

- [ ] **Step 3: `server/scripts/test-devlogin.ts` 작성**

Create `server/scripts/test-devlogin.ts`:
```ts
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { pool } from '../src/db/client.js'

const app = await buildApp()

// dev-login → Set-Cookie + 김주희 반환
const res = await app.inject({ method: 'POST', url: '/api/auth/dev-login' })
assert.equal(res.statusCode, 200)
assert.equal(res.json().user.email, 'juhuikim@baeoom.com')
const setCookie = res.headers['set-cookie'] as string
assert.match(setCookie, /sid=/)
console.log('dev-login issues session ok')

// 발급된 쿠키로 me 호출 시 김주희
const sid = setCookie.split('sid=')[1].split(';')[0]
const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { sid } })
assert.equal(me.json().user.email, 'juhuikim@baeoom.com')
console.log('session round-trip ok')

await app.close()
await pool.end()
console.log('DEVLOGIN TEST OK')
```

- [ ] **Step 4: 로컬 등록 테스트 실행**

Run:
```bash
cd server && echo '"test:devlogin": "tsx scripts/test-devlogin.ts"' >/dev/null; npx tsx scripts/test-devlogin.ts
```
Expected: `dev-login issues session ok` / `session round-trip ok` / `DEVLOGIN TEST OK`

- [ ] **Step 5: 프로덕션 게이트 확인 (APP_ENV=production 이면 404)**

Run:
```bash
cd server && APP_ENV=production npx tsx -e "
import('./src/app.js').then(async m => {
  const app = await m.buildApp()
  const r = await app.inject({ method: 'POST', url: '/api/auth/dev-login' })
  const { pool } = await import('./src/db/client.js')
  console.log('status', r.statusCode)
  if (r.statusCode !== 404) { console.error('FAIL: dev-login이 프로덕션에 노출됨'); process.exit(1) }
  await app.close(); await pool.end(); console.log('GATE OK')
})"
```
Expected: `status 404` / `GATE OK`

- [ ] **Step 6: package.json test:devlogin 스크립트 추가 + Commit**

Modify `server/package.json` scripts 에 `"test:devlogin": "tsx scripts/test-devlogin.ts"` 추가.
```bash
cd .. && git add server/src/auth/dev-login.ts server/src/app.ts server/scripts/test-devlogin.ts server/package.json
git commit -m "feat(auth): 로컬 전용 dev-login(김주희) + 프로덕션 게이트"
```

---

### Task 3: authz 모듈 (can_see_request 이식 + 목록 필터)

**Files:**
- Create: `server/src/authz.ts`
- Test: `server/scripts/test-authz.ts`

**Interfaces:**
- Consumes: `CurrentUser`, `users`/`requests`/`requestSharedTargets` 스키마, drizzle `sql`.
- Produces:
  - `server/src/authz.ts`:
    - `isSystem(u: CurrentUser): boolean`
    - `isViewerUp(u: CurrentUser): boolean`
    - `canSeeRequest(u, req, sharedTargets): boolean` — req는 `{ requesterId, visibility, requesterOrg, requesterFunction }`, sharedTargets는 `{ targetType, targetValue }[]`
    - `visibilityFilter(u: CurrentUser): SQL` — requests/request_view 목록 조회 WHERE 절 (drizzle `sql` 조각). viewer_up이면 `sql\`true\``, 아니면 공개범위·본인·공유대상 OR 조건.

- [ ] **Step 1: `server/src/authz.ts` 작성**

Create `server/src/authz.ts`:
```ts
import { sql, type SQL } from 'drizzle-orm'
import type { CurrentUser } from './types.js'

export function isSystem(u: CurrentUser): boolean {
  return u.role === 'system'
}
export function isViewerUp(u: CurrentUser): boolean {
  return u.role === 'system' || u.role === 'viewer'
}

interface ReqRef {
  requesterId: string | null
  visibility: 'private' | 'dept' | 'function' | 'org' | 'shared'
  requesterOrg: string | null
  requesterFunction: string | null
}
interface SharedRef { targetType: string; targetValue: string }

/** schema.sql can_see_request 이식 */
export function canSeeRequest(u: CurrentUser, req: ReqRef, shared: SharedRef[]): boolean {
  if (isViewerUp(u)) return true
  if (req.requesterId && req.requesterId === u.id) return true
  if (req.visibility === 'shared') return true
  if (req.visibility === 'org' && req.requesterOrg && req.requesterOrg === u.orgAffil) return true
  if (req.visibility === 'function' && req.requesterFunction && req.requesterFunction === u.deptFunction) return true
  if (
    req.visibility === 'dept' && req.requesterOrg && req.requesterFunction &&
    req.requesterOrg === u.orgAffil && req.requesterFunction === u.deptFunction
  ) return true
  for (const st of shared) {
    if (st.targetType === 'function' && st.targetValue === u.deptFunction) return true
    if (st.targetType === 'dept' && st.targetValue === `${u.orgAffil}|${u.deptFunction}`) return true
  }
  return false
}

/**
 * 목록 조회용 WHERE 필터. `r` 별칭(requests 또는 request_view) 기준.
 * viewer_up(system/viewer)은 전체, staff는 공개범위+본인+공유대상.
 */
export function visibilityFilter(u: CurrentUser): SQL {
  if (isViewerUp(u)) return sql`true`
  const uid = u.id
  const org = u.orgAffil
  const fn = u.deptFunction
  const deptTarget = `${org}|${fn}`
  return sql`(
    r.requester_id = ${uid}
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

- [ ] **Step 2: `server/scripts/test-authz.ts` 작성**

Create `server/scripts/test-authz.ts`:
```ts
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
```

- [ ] **Step 3: authz 단위 테스트 실행**

Run:
```bash
cd server && npx tsx scripts/test-authz.ts
```
Expected: `AUTHZ TEST OK`

- [ ] **Step 4: 필터가 실제 DB에서 SQL로 동작하는지 통합 확인**

Run:
```bash
cd server && npx tsx -e "
import('./src/db/client.js').then(async ({ db, pool }) => {
  const { sql } = await import('drizzle-orm')
  const { visibilityFilter } = await import('./src/authz.js')
  const staff = { id: '00000000-0000-0000-0000-000000000000', email: 'x', name: null, orgAffil: '배움', deptFunction: '교학팀', role: 'staff' }
  const f = visibilityFilter(staff)
  const r = await db.execute(sql\`select count(*)::int as c from request_view r where \${f}\`)
  console.log('filtered count =', r.rows[0].c)
  await pool.end(); console.log('FILTER SQL OK')
})"
```
Expected: `filtered count = 0` (데이터 없음, SQL 파싱·실행만 검증) / `FILTER SQL OK`

- [ ] **Step 5: package.json test:authz 추가 + Commit**

Modify `server/package.json` scripts 에 `"test:authz": "tsx scripts/test-authz.ts"` 추가.
```bash
cd .. && git add server/src/authz.ts server/scripts/test-authz.ts server/package.json
git commit -m "feat(authz): can_see_request·visibilityFilter RLS 로직 TS 이식"
```

---

### Task 4: Google OAuth (게이트 등록 + upsertUserFromEmail)

**Files:**
- Create: `server/src/auth/upsert.ts`, `server/src/auth/google.ts`
- Modify: `server/src/app.ts` (조건부 등록)
- Test: `server/scripts/test-upsert.ts`

**Interfaces:**
- Consumes: `db`, `users`/`orgDirectory`, `setSession`, `env`.
- Produces:
  - `server/src/auth/upsert.ts` → `export async function upsertUserFromEmail(email: string, name: string | null, googleSub: string | null): Promise<{ id: string } >` — 도메인 검증(불허 시 throw `DomainNotAllowedError`), org_directory 반영, users upsert.
  - `server/src/auth/google.ts` → `export async function googleRoutes(app)` — `GET /api/auth/google`, `GET /api/auth/google/callback`.

- [ ] **Step 1: 의존성 추가**

Run:
```bash
cd server && npm install @fastify/oauth2@^8
```
Expected: 설치 성공

- [ ] **Step 2: `server/src/auth/upsert.ts` 작성 (handle_new_user 이식)**

Create `server/src/auth/upsert.ts`:
```ts
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users, orgDirectory } from '../db/schema.js'

const ALLOWED = ['baeoom.com', 'baeron.com']

export class DomainNotAllowedError extends Error {
  constructor() { super('허용되지 않은 도메인입니다. @baeoom.com 또는 @baeron.com 계정만 이용할 수 있습니다.') }
}

export async function upsertUserFromEmail(
  email: string, name: string | null, googleSub: string | null,
): Promise<{ id: string }> {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain || !ALLOWED.includes(domain)) throw new DomainNotAllowedError()

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
  if (existing) {
    if (googleSub && existing.googleSub !== googleSub) {
      await db.update(users).set({ googleSub }).where(eq(users.id, existing.id))
    }
    return { id: existing.id }
  }

  // org_directory 사전등록 반영
  const dir = await db.query.orgDirectory.findFirst({
    where: sql`lower(${orgDirectory.email}) = lower(${email})`,
  })
  const [inserted] = await db.insert(users).values(
    dir
      ? { email, name: dir.name, dept: dir.dept, orgAffil: dir.orgAffil, deptFunction: dir.deptFunction, role: dir.role, googleSub }
      : { email, name: name ?? email, googleSub },
  ).returning({ id: users.id })

  if (dir) {
    await db.update(orgDirectory).set({ synced: true })
      .where(sql`lower(${orgDirectory.email}) = lower(${email})`)
  }
  return inserted
}
```

- [ ] **Step 3: `server/src/auth/google.ts` 작성**

Create `server/src/auth/google.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import oauth2 from '@fastify/oauth2'
import { env } from '../env.js'
import { setSession } from './session.js'
import { upsertUserFromEmail, DomainNotAllowedError } from './upsert.js'

export async function googleRoutes(app: FastifyInstance) {
  await app.register(oauth2, {
    name: 'googleOAuth2',
    scope: ['openid', 'email', 'profile'],
    credentials: {
      client: { id: process.env.GOOGLE_CLIENT_ID!, secret: process.env.GOOGLE_CLIENT_SECRET! },
      auth: oauth2.GOOGLE_CONFIGURATION,
    },
    startRedirectPath: '/api/auth/google',
    callbackUri: process.env.GOOGLE_CALLBACK_URL!,
  })

  app.get('/api/auth/google/callback', async (request, reply) => {
    const { token } = await (app as any).googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    const info = (await res.json()) as { email: string; name?: string; sub?: string }
    try {
      const { id } = await upsertUserFromEmail(info.email, info.name ?? null, info.sub ?? null)
      setSession(reply, id)
      reply.redirect(env.WEB_ORIGIN)
    } catch (e) {
      if (e instanceof DomainNotAllowedError) {
        reply.redirect(`${env.WEB_ORIGIN}/login?error=domain`)
        return
      }
      throw e
    }
  })
}
```

- [ ] **Step 4: `server/src/app.ts` 에 조건부 등록**

Modify `server/src/app.ts` — `import { googleRoutes } from './auth/google.js'` 추가, dev-login 등록 뒤에:
```ts
  if (process.env.GOOGLE_CLIENT_ID) await app.register(googleRoutes)
```

- [ ] **Step 5: `server/scripts/test-upsert.ts` 작성**

Create `server/scripts/test-upsert.ts`:
```ts
import assert from 'node:assert/strict'
import { upsertUserFromEmail, DomainNotAllowedError } from '../src/auth/upsert.js'
import { db, pool } from '../src/db/client.js'
import { users } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'

// 1) 불허 도메인 차단
await assert.rejects(
  () => upsertUserFromEmail('someone@gmail.com', 'X', 'sub1'),
  DomainNotAllowedError,
)
console.log('domain block ok')

// 2) org_directory 사전등록 반영 (김주희는 seed 로 이미 users 에 있음 → 기존 반환)
const r1 = await upsertUserFromEmail('juhuikim@baeoom.com', '김주희', 'gsub-juhui')
assert.ok(r1.id)
const u = await db.query.users.findFirst({ where: eq(users.id, r1.id) })
assert.equal(u?.googleSub, 'gsub-juhui')  // googleSub 갱신됨
console.log('existing upsert + googleSub ok')

// 3) 신규 허용 도메인 유저 생성 후 정리
const r2 = await upsertUserFromEmail('tester-upsert@baeron.com', '테스터', 'gsub-t')
assert.ok(r2.id)
await db.delete(users).where(eq(users.id, r2.id))
console.log('new user create ok')

await pool.end()
console.log('UPSERT TEST OK')
```

- [ ] **Step 6: upsert 테스트 실행**

Run:
```bash
cd server && npx tsx scripts/test-upsert.ts
```
Expected: `domain block ok` / `existing upsert + googleSub ok` / `new user create ok` / `UPSERT TEST OK`

- [ ] **Step 7: OAuth 게이트 확인 (creds 없으면 google 라우트 미등록)**

Run:
```bash
cd server && npx tsx -e "
import('./src/app.js').then(async m => {
  const app = await m.buildApp()
  const r = await app.inject({ method: 'GET', url: '/api/auth/google' })
  const { pool } = await import('./src/db/client.js')
  console.log('status', r.statusCode)  // creds 비었으면 404
  await app.close(); await pool.end()
})"
```
Expected: `status 404` (`.env` 에 GOOGLE_CLIENT_ID 비어있음 → 미등록)

- [ ] **Step 8: package.json test:upsert 추가 + Commit**

Modify `server/package.json` scripts 에 `"test:upsert": "tsx scripts/test-upsert.ts"` 추가.
```bash
cd .. && git add server/src/auth/upsert.ts server/src/auth/google.ts server/src/app.ts server/scripts/test-upsert.ts server/package.json server/package-lock.json
git commit -m "feat(auth): Google OAuth(게이트) + upsertUserFromEmail(handle_new_user 이식)"
```

---

## Phase 2 완료 정의

- `npm run test:auth` → `AUTH TEST OK` (세션 라운드트립)
- `npm run test:devlogin` → `DEVLOGIN TEST OK`, 프로덕션 게이트 404
- `npm run test:authz` → `AUTHZ TEST OK`, visibilityFilter SQL 실행 성공
- `npm run test:upsert` → `UPSERT TEST OK` (도메인 차단·org_directory 반영)
- `npm run typecheck` 통과

## Self-Review 결과

- **Spec 커버리지:** 설계 §2(인증), §3(권한) 이식 — 세션쿠키✓, dev-login(김주희·게이트)✓, Google OAuth+upsert(handle_new_user 도메인·org_directory)✓, authz(can_see_request·필터)✓.
- **Placeholder 스캔:** 모든 스텝 실제 코드/명령·기대출력 포함. TBD 없음.
- **타입 일관성:** `CurrentUser`(types.ts) 정의가 session.ts·authz.ts·dev-login.ts·test에서 동일. `upsertUserFromEmail(email, name, googleSub)` 시그니처가 google.ts·test-upsert.ts와 일치. `setSession(reply, userId)`/`visibilityFilter(u)` 시그니처 일관.

## 다음 단계 (Phase 3 예고)

REST API — requests(목록에 `visibilityFilter` 적용)·comments·history·shared-targets·attachments·dashboard·accounts. `authenticate` preHandler + `canSeeRequest` 가드 소비. Phase 4에서 프론트가 이 엔드포인트로 교체된다.
