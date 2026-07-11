# Phase 4: 프론트엔드 교체 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프론트의 Supabase 런타임 의존을 자체 REST API 클라이언트로 교체하고, 로컬 전용 "임시 로그인(김주희)" 버튼을 붙여 브라우저에서 앱이 순수 Postgres 백엔드로 동작하게 한다.

**Architecture:** `lib/api.ts`(fetch 래퍼, `credentials:'include'`)로 백엔드를 호출한다. `AuthProvider`는 기존 컨텍스트 형태(`session/profile/role/loading/signInWithGoogle/signOut`)를 유지하되 `/api/auth/me` 기반으로 재작성하고 `devLogin()`을 추가한다. `features/requests/api.ts`의 모든 훅을 새 엔드포인트로 재작성한다. 타입 파일(`types/database.ts`,`types/supabase.ts`)은 타입 전용이라 유지한다. Vite는 `/api`를 백엔드(:4000)로 프록시한다.

**Tech Stack:** React 18, Vite 5, @tanstack/react-query, fetch.

## Global Constraints

- API 베이스: 개발은 Vite 프록시(`/api` → `http://localhost:4000`), 모든 fetch는 `credentials: 'include'`.
- `AuthContextValue` 형태 유지(기존 소비처 RequireRole/TopNav/board 불변): `{ session, profile, role, loading, signInWithGoogle, signOut }` + 신규 `devLogin`.
- `session`은 로그인 사용자 객체 또는 null(RequireRole의 `!session` 판정 유지).
- 임시 로그인 버튼은 `import.meta.env.DEV`일 때만 렌더.
- 백엔드 응답은 snake_case DB 행 → 기존 프론트 타입(RequestView 등)과 그대로 호환.
- `@supabase/supabase-js` 의존성 및 `lib/supabase.ts` 제거. 타입 파일은 유지.
- React Query 쿼리키·훅 시그니처는 기존과 동일하게 유지(호출부 변경 최소화).

---

### Task 1: API 클라이언트 + Vite 프록시 + 환경변수

**Files:**
- Create: `src/lib/api.ts`
- Modify: `vite.config.ts`, `.env.example`

**Interfaces:**
- Produces: `src/lib/api.ts` → `apiGet<T>(path): Promise<T>`, `apiSend<T>(method, path, body?): Promise<T>`, `apiUpload<T>(path, formData): Promise<T>`, `API_BASE`. 모든 함수 `credentials:'include'`, 비2xx면 `ApiError`(message는 서버 `error` 또는 statusText) throw.

- [ ] **Step 1: `src/lib/api.ts` 작성**

Create `src/lib/api.ts`:
```ts
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || res.statusText
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' })
  return parse<T>(res)
}

export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return parse<T>(res)
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', body: formData })
  return parse<T>(res)
}
```

- [ ] **Step 2: `vite.config.ts` 에 프록시 추가**

Modify `vite.config.ts` — `server` 블록을 아래로 교체:
```ts
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
```

- [ ] **Step 3: `.env.example` 갱신**

Replace `.env.example` 전체:
```
# 개발 시에는 Vite 프록시(/api → localhost:4000)를 쓰므로 비워둡니다.
# 별도 도메인의 백엔드를 쓸 때만 설정하세요. 예: https://api.example.com
VITE_API_BASE_URL=
```

- [ ] **Step 4: 확인 (빌드 타입만; 실동작은 Task 4 통합확인)**

Run:
```bash
npx tsc -b --noEmit 2>&1 | head -5 || true
```
Expected: `api.ts` 관련 에러 없음 (다른 파일의 기존 에러는 이후 Task에서 해소)

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts vite.config.ts .env.example
git commit -m "feat(web): API fetch 클라이언트 + Vite /api 프록시"
```

---

### Task 2: AuthProvider 재작성 (/api/auth/me + devLogin) + LoginPage 임시로그인 버튼

**Files:**
- Modify: `src/auth/AuthProvider.tsx`, `src/pages/LoginPage.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiSend`, `API_BASE`.
- Produces: `AuthContextValue` = `{ session: AuthUser | null; profile: AuthUser | null; role: UserRole | null; loading: boolean; signInWithGoogle(): void; signOut(): Promise<void>; devLogin(): Promise<void> }`. `AuthUser = { id; email; name; org_affil; dept_function; role }`.

- [ ] **Step 1: `src/auth/AuthProvider.tsx` 재작성**

Replace `src/auth/AuthProvider.tsx` 전체:
```tsx
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { UserRole } from '../types/database'
import { apiGet, apiSend, API_BASE } from '../lib/api'

export interface AuthUser {
  id: string
  email: string
  name: string | null
  org_affil: string | null
  dept_function: string | null
  role: UserRole
}

export interface AuthContextValue {
  session: AuthUser | null
  profile: AuthUser | null
  role: UserRole | null
  loading: boolean
  signInWithGoogle: () => void
  signOut: () => Promise<void>
  devLogin: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const ALLOWED_DOMAINS = ['baeoom.com', 'baeron.com']
export function isAllowedEmail(email: string | undefined | null): boolean {
  if (!email) return false
  const domain = email.split('@')[1]?.toLowerCase()
  return !!domain && ALLOWED_DOMAINS.includes(domain)
}

// 서버 /api/auth/me 응답을 프론트 AuthUser 로 매핑
interface MeUser { id: string; email: string; name: string | null; orgAffil: string | null; deptFunction: string | null; role: UserRole }
function mapUser(u: MeUser | null): AuthUser | null {
  if (!u) return null
  return { id: u.id, email: u.email, name: u.name, org_affil: u.orgAffil, dept_function: u.deptFunction, role: u.role }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const { user } = await apiGet<{ user: MeUser | null }>('/api/auth/me')
      setUser(mapUser(user))
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const value = useMemo<AuthContextValue>(() => ({
    session: user,
    profile: user,
    role: user?.role ?? null,
    loading,
    signInWithGoogle() {
      window.location.href = `${API_BASE}/api/auth/google`
    },
    async signOut() {
      await apiSend('POST', '/api/auth/logout')
      setUser(null)
    },
    async devLogin() {
      const { user } = await apiSend<{ user: MeUser }>('POST', '/api/auth/dev-login')
      setUser(mapUser(user))
    },
  }), [user, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
```

- [ ] **Step 2: `src/pages/LoginPage.tsx` 재작성 (Google 유지 + 임시 로그인 버튼)**

Replace `src/pages/LoginPage.tsx` 전체:
```tsx
import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

function readAuthError(): string | null {
  const params = new URLSearchParams(window.location.search)
  if (params.get('error') === 'domain') {
    return '허용되지 않은 계정입니다. @baeoom.com 또는 @baeron.com 도메인 계정으로만 로그인할 수 있습니다.'
  }
  return null
}

export function LoginPage() {
  const { session, loading, signInWithGoogle, devLogin } = useAuth()
  const navigate = useNavigate()
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    const message = readAuthError()
    if (message) {
      setAuthError(message)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  if (loading) return <div className="p-8 text-center text-gray-500">로딩 중…</div>
  if (session) return <Navigate to="/" replace />

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-xl font-bold text-gray-900">업무요청 접수·관리</h1>
        <p className="mt-2 text-center text-sm text-gray-500">배움·배론·허브 임직원 전용</p>

        {authError && (
          <div role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {authError}
          </div>
        )}

        <button
          onClick={() => signInWithGoogle()}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Google 계정으로 로그인
        </button>

        {import.meta.env.DEV && (
          <button
            onClick={async () => { await devLogin(); navigate('/', { replace: true }) }}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
          >
            🔧 임시 로그인 (김주희) · 로컬 전용
          </button>
        )}

        <p className="mt-4 text-center text-xs text-gray-400">
          @baeoom.com · @baeron.com 도메인 계정만 접근할 수 있습니다.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 확인**

Run:
```bash
npx tsc -b --noEmit 2>&1 | grep -E "AuthProvider|LoginPage" | head -5 || echo "auth/login 타입 에러 없음"
```
Expected: `auth/login 타입 에러 없음` (api.ts 재작성 전이라 features/requests/api.ts 에러는 남아있을 수 있음)

- [ ] **Step 4: Commit**

```bash
git add src/auth/AuthProvider.tsx src/pages/LoginPage.tsx
git commit -m "feat(web): AuthProvider /api/auth 기반 재작성 + 임시로그인(김주희) 버튼"
```

---

### Task 3: features/requests/api.ts 재작성 (Supabase → REST)

**Files:**
- Modify: `src/features/requests/api.ts`

**Interfaces:**
- Consumes: `apiGet/apiSend/apiUpload`, `API_BASE`.
- Produces: 동일한 훅 export(`useRequestViews`, `useVisibleSharedTargets`, `useRequestDetail`, `useRequestComments`, `useRequestHistory`, `useRequestAttachments`, `getAttachmentUrl`, `useAddComment`, `useUpdateRequest`, `useCancelRequest`, `useAllProfiles`, `useBoardUpdate`, `useRequestTypes`, `useDeptOptions`, `useCreateRequest`) — 시그니처·쿼리키 유지, 내부만 REST.

- [ ] **Step 1: `src/features/requests/api.ts` 상단 import 교체**

Modify — 파일 최상단 `import { supabase } ...` 및 `const ATTACHMENT_BUCKET` 제거하고:
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend, apiUpload, API_BASE } from '../../lib/api'
import type { /* 기존 타입들 그대로 유지 */ } from '../../types/database'
```
(타입 import 블록은 기존 것을 유지)

- [ ] **Step 2: 조회 훅들 재작성**

각 조회 훅의 `queryFn` 을 아래로 교체(쿼리키·시그니처 유지):
```ts
// useRequestViews
queryFn: () => apiGet<RequestView[]>('/api/requests'),

// useVisibleSharedTargets
queryFn: async (): Promise<Map<number, RequestSharedTarget[]>> => {
  const rows = await apiGet<RequestSharedTarget[]>('/api/requests/shared-targets')
  const map = new Map<number, RequestSharedTarget[]>()
  for (const t of rows) {
    const list = map.get(t.request_id) ?? []
    list.push(t); map.set(t.request_id, list)
  }
  return map
},

// useRequestDetail
queryFn: () => apiGet<RequestDetailData>(`/api/requests/${id}`),

// useRequestComments
queryFn: () => apiGet<CommentWithAuthor[]>(`/api/requests/${id}/comments`),

// useRequestHistory
queryFn: () => apiGet<HistoryWithActor[]>(`/api/requests/${id}/history`),

// useRequestAttachments
queryFn: () => apiGet<RequestAttachment[]>(`/api/requests/${id}/attachments`),

// useAllProfiles
queryFn: () => apiGet<BoardProfile[]>('/api/profiles'),

// useRequestTypes
queryFn: () => apiGet<RequestType[]>('/api/request-types'),

// useDeptOptions
queryFn: () => apiGet<DeptOption[]>('/api/dept-options'),
```

- [ ] **Step 3: `getAttachmentUrl` 교체 (다운로드 URL 반환)**

```ts
/** 첨부 다운로드 URL (권한 검사는 서버가 수행) */
export function getAttachmentUrl(attachmentId: number): string {
  return `${API_BASE}/api/attachments/${attachmentId}/download`
}
```
> 주의: 시그니처가 `(path:string)→Promise` 에서 `(attachmentId:number)→string` 로 변경됨. 호출부(RequestDetail.tsx)는 Task 4에서 함께 수정.

- [ ] **Step 4: 뮤테이션 훅들 재작성**

```ts
// useAddComment
mutationFn: (body: string) => apiSend('POST', `/api/requests/${requestId}/comments`, { body: body.trim() }),

// useUpdateRequest
mutationFn: (patch: UpdateRequestInput) => apiSend('PATCH', `/api/requests/${id}`, patch),

// useCancelRequest
mutationFn: () => apiSend('PATCH', `/api/requests/${id}`, { status: '철회' }),

// useBoardUpdate
mutationFn: (vars: { id: number; patch: { status?: RequestStatus; assignee_id?: string | null } }) =>
  apiSend('PATCH', `/api/requests/${vars.id}`, vars.patch),
```

- [ ] **Step 5: `useCreateRequest` 재작성 (생성 → 공유대상 포함 → 첨부 업로드)**

```ts
export function useCreateRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateRequestInput): Promise<RequestRow> => {
      // 1) 요청 생성 (+ 공유대상)
      const request = await apiSend<RequestRow>('POST', '/api/requests', {
        org: input.org,
        type_code: input.type_code,
        priority: input.priority,
        visibility: input.visibility,
        title: input.title.trim(),
        body: input.body,
        desired_due: input.desired_due || null,
        sharedTargets: input.sharedTargets,
      })
      // 2) 첨부 업로드 (각 파일 개별 multipart)
      for (const file of input.files) {
        const fd = new FormData()
        fd.append('file', file, file.name)
        await apiUpload(`/api/requests/${request.id}/attachments`, fd)
      }
      return request
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['requests'] }) },
  })
}
```
> `safeExt`/`buildStoragePath`/`ATTACHMENT_BUCKET` 및 `supabase.auth.getUser()` 관련 코드 삭제(서버가 처리).

- [ ] **Step 6: 타입체크**

Run:
```bash
npx tsc -b --noEmit 2>&1 | grep "features/requests/api.ts" | head -10 || echo "api.ts 타입 에러 없음"
```
Expected: `api.ts 타입 에러 없음`

- [ ] **Step 7: Commit**

```bash
git add src/features/requests/api.ts
git commit -m "feat(web): features/requests/api.ts REST 재작성 (Supabase 제거)"
```

---

### Task 4: RequestDetail 다운로드 호출부 수정 + Supabase 제거 + 통합 확인

**Files:**
- Modify: `src/features/requests/RequestDetail.tsx` (getAttachmentUrl 사용처), `package.json`
- Delete: `src/lib/supabase.ts`

**Interfaces:**
- Consumes: 변경된 `getAttachmentUrl(attachmentId: number): string`.

- [ ] **Step 1: `getAttachmentUrl` 사용처 확인·수정**

Run:
```bash
grep -rn "getAttachmentUrl" src
```
그 사용처(RequestDetail.tsx 등)에서 `await getAttachmentUrl(att.storage_path)` → 동기 `getAttachmentUrl(att.id)` 로 수정하고, 링크는 `href={getAttachmentUrl(att.id)}` 형태로 사용. (async 처리·useState 제거)

- [ ] **Step 2: `lib/supabase.ts` 삭제 + 잔여 참조 확인**

Run:
```bash
rm src/lib/supabase.ts
grep -rn "lib/supabase\|@supabase/supabase-js\|supabase\." src || echo "supabase 런타임 참조 없음"
```
Expected: `supabase 런타임 참조 없음` (남으면 해당 파일 수정)

- [ ] **Step 3: `@supabase/supabase-js` 의존성 제거**

Run:
```bash
npm uninstall @supabase/supabase-js
```

- [ ] **Step 4: 전체 타입체크 + 빌드**

Run:
```bash
npm run typecheck && npm run build 2>&1 | tail -8
```
Expected: 타입체크 통과, `dist/` 빌드 성공

- [ ] **Step 5: 통합 실동작 확인 (백엔드 + 프론트)**

Run (백엔드·DB 기동 상태에서):
```bash
# 백엔드
(cd server && npm run dev >/tmp/be.log 2>&1 &) && sleep 4
# 프론트
(npm run dev >/tmp/fe.log 2>&1 &) && sleep 5
# 프록시 통해 dev-login → me 왕복
curl -s -c /tmp/cj.txt -X POST localhost:5173/api/auth/dev-login | head -c 120; echo
curl -s -b /tmp/cj.txt localhost:5173/api/requests | head -c 120; echo
pkill -f "tsx watch src/index.ts"; pkill -f vite
```
Expected: dev-login이 김주희 반환, `/api/requests`가 배열(JSON) 반환 (프록시·세션·목록 정상)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): Supabase 제거 완료 — 첨부 다운로드 호출부 수정, 의존성 정리"
```

---

## Phase 4 완료 정의

- `npm run typecheck` + `npm run build` 통과
- 코드베이스에 `@supabase/supabase-js`·`lib/supabase` 런타임 참조 없음
- Vite 프록시 통해 dev-login·요청목록 API 왕복 성공
- 브라우저 `/login`에 "임시 로그인 (김주희)" 버튼 표시(DEV) → 클릭 시 로그인·홈 이동

## Self-Review 결과

- **Spec 커버리지:** 설계 §6(프론트) — lib/api.ts✓, AuthProvider(me·devLogin)✓, LoginPage 임시로그인 버튼✓, api.ts 전면 재작성✓, Supabase 제거✓, vite 프록시✓. 타입 파일 유지(호환).
- **Placeholder 스캔:** 실제 코드/명령 포함. TBD 없음.
- **타입 일관성:** `AuthContextValue`에 `devLogin` 추가하되 기존 필드 유지(RequireRole/LoginPage 호환). `getAttachmentUrl` 시그니처 변경을 Task 4에서 호출부까지 반영. 훅 시그니처·쿼리키 불변.

## 다음 단계 (Phase 5 예고)

정리·검증 — README/문서 갱신(실행법: colima→compose→server→web), `.env.example` 정리, 전체 회귀(서버 테스트 8종 + 프론트 빌드), 브라우저 E2E 스모크(임시 로그인으로 접수/목록/상세/보드). 최종 브랜치 정리.
