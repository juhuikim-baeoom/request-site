# Supabase → 순수 PostgreSQL 마이그레이션 설계

- 작성일: 2026-07-11
- 상태: 확정 (구현 계획 수립 전)
- 대상 저장소: `request-site` (React + Vite + TS SPA)

## 배경 / 목표

현재 이 앱은 **백엔드 서버가 없는 순수 SPA**로, 브라우저가 Supabase에
직접 붙어 인증(Google OAuth)·데이터(PostgREST)·스토리지를 처리한다.
목표는 **Supabase 의존을 완전히 제거하고 자체 PostgreSQL + 백엔드 API로 전면
마이그레이션**하는 것이다. 로컬에서는 Google 로그인 없이 **김주희 계정으로
즉시 로그인되는 임시 로그인 버튼**을 제공한다.

### 확정된 결정 사항

| 항목 | 결정 |
| --- | --- |
| 방향 | Supabase 제거, 순수 Postgres 기반으로 전부 마이그레이션 |
| 인증 | Google OAuth 유지(프로덕션) + 로컬 전용 dev-login(김주희) |
| 백엔드 스택 | Node + Fastify + Drizzle ORM (TypeScript) |
| 스토리지 | 백엔드 로컬 디스크(`server/uploads/`) |
| 권한 모델 | RLS 제거 → 백엔드 `authz` 모듈에서 처리 |
| Postgres 실행 | Docker(docker-compose), 앱은 `npm`으로 로컬 실행 |

## 현재 상태 (마이그레이션 대상 분석)

- Supabase 참조는 프론트 **6개 파일 / 42곳**에 한정:
  - `src/lib/supabase.ts` (클라이언트)
  - `src/auth/AuthProvider.tsx` (세션/역할)
  - `src/pages/LoginPage.tsx` (`signInWithGoogle`)
  - `src/features/requests/api.ts` (408줄, 데이터 접근 집중)
  - `src/types/database.ts`, `src/types/supabase.ts` (타입)
- `schema.sql`의 Supabase 종속:
  - `profiles.id → auth.users`, `handle_new_user` 트리거(`on auth.users`)
  - 권한 함수 `is_system/is_viewer_up/my_dept/my_org/my_function/can_see_request` — 전부 `auth.uid()` 의존
  - 전 테이블 RLS 정책
  - `storage.buckets` / `storage.objects` 버킷·정책
- Supabase 비종속(그대로 이식 가능한) 자산:
  - enum 6종, 테이블(요청 원장·코멘트·이력·첨부·공유대상·요청유형·조직도)
  - 순수 트리거: `gen_seq`(접수번호), `snapshot_requester`, `touch_updated_at`, `on_status_change`
  - `request_view` 뷰, `list_dept_options`

## 목표 구조

```
request-site/
├─ docker-compose.yml       # Postgres 16 컨테이너 (신규)
├─ server/                  # Fastify + Drizzle 백엔드 (신규)
│  ├─ src/
│  │  ├─ index.ts             서버 부트스트랩
│  │  ├─ db/
│  │  │  ├─ schema.ts          Drizzle 스키마 (schema.sql 이식)
│  │  │  ├─ client.ts          pg 커넥션 + SET LOCAL app.user_id 헬퍼
│  │  │  └─ seed.ts            초기 데이터 (김주희 · request_types · 샘플)
│  │  ├─ auth/
│  │  │  ├─ google.ts          Google OAuth (@fastify/oauth2)
│  │  │  ├─ session.ts         서명 세션 쿠키(httpOnly)
│  │  │  └─ dev-login.ts       로컬 전용 김주희 자동 로그인
│  │  ├─ authz.ts              공개범위/역할 권한 (RLS → TS 이식)
│  │  ├─ routes/
│  │  │  ├─ auth.ts            /api/auth/me·google·logout·dev-login
│  │  │  ├─ requests.ts        목록·상세·생성·수정·철회
│  │  │  ├─ comments.ts
│  │  │  ├─ attachments.ts     업로드/다운로드 (multipart)
│  │  │  ├─ accounts.ts
│  │  │  └─ dashboard.ts
│  │  └─ uploads/              첨부파일 로컬 저장소 (gitignore)
│  ├─ drizzle/                 생성된 마이그레이션 SQL
│  ├─ drizzle.config.ts
│  ├─ package.json
│  └─ .env.example            DATABASE_URL · SESSION_SECRET · GOOGLE_* · APP_ENV
└─ src/ (기존 프론트)
   └─ supabase 호출 → lib/api.ts 자체 클라이언트로 교체
```

> Postgres만 Docker로 띄우고 백엔드·프론트는 `npm`으로 로컬 실행한다.
> ("로컬에 Docker + Postgres 설치" 목적에 부합)

## 컴포넌트 설계

### 1. DB 마이그레이션 (`server/src/db/schema.ts` + drizzle)

- **`auth.users` + `profiles` → `users` 단일 테이블**로 통합
  - 컬럼: `id uuid pk default gen_random_uuid()`, `email unique`, `google_sub text unique null`,
    `name`, `org_affil`, `dept_function`, `dept`, `role`, `created_at`
- `org_directory`, `request_types`, `requests`, `request_comments`,
  `request_status_history`, `request_attachments`, `request_shared_targets`,
  enum 6종 — 그대로 이식 (`requester_id/assignee_id` FK 대상은 `users`)
- **RLS 정책 전부 제거.** 권한은 백엔드 `authz.ts`가 담당
- **순수 트리거는 DB에 유지**: `gen_seq`, `snapshot_requester`, `touch_updated_at`,
  `on_status_change`
  - `on_status_change`가 쓰던 `auth.uid()` → 백엔드가 트랜잭션마다
    `SET LOCAL app.user_id = $sessionUserId` 주입, 트리거는
    `current_setting('app.user_id', true)::uuid` 로 읽음
- `storage.*` 관련 전부 삭제 (첨부는 파일시스템)
- `handle_new_user`의 **도메인 제한 + org_directory 사전등록 반영** 로직은
  백엔드 로그인 시 users upsert로 이식
- `request_view` 뷰: `security_invoker` 제거 후 일반 뷰로 이식(권한은 백엔드에서)

### 2. 인증 (`server/src/auth/`)

- **프로덕션 — Google OAuth**: `@fastify/oauth2`로 인가 → 토큰 교환 →
  이메일 도메인(`baeoom.com`/`baeron.com`) 검증 → `users` upsert(org_directory
  사전등록 반영) → 서명된 **httpOnly 세션 쿠키** 발급
- **로컬 — dev-login**: `POST /api/auth/dev-login` 은 `APP_ENV=local`(또는
  `ENABLE_DEV_LOGIN=true`)일 때만 라우트 등록. 김주희 유저를 조회/생성해 즉시
  세션 쿠키 발급. 그 외 환경에서는 라우트 자체가 없음(404)
- 세션: `userId`를 담은 서명 쿠키. 매 요청 미들웨어가 `users`에서 role/부서 로드
- 엔드포인트: `GET /api/auth/me`, `GET /api/auth/google` (+ callback),
  `POST /api/auth/logout`, `POST /api/auth/dev-login`(로컬)

### 3. 권한 (`server/src/authz.ts`)

- `schema.sql`의 RLS 로직을 TS로 이식:
  - `isSystem`, `isViewerUp`, `myDept/myOrg/myFunction`
  - `canSeeRequest(user, request)` — 공개범위 5단계(private/dept/function/
    org/shared) + 추가 공유 대상(dept/function) + 담당/작성자 규칙
- 목록 조회 시 SQL `WHERE` 필터로, 상세/수정 시 가드로 적용
- 상태변경·철회 등 쓰기 규칙(예: 본인 접수건이며 status='접수'일 때만 수정)도
  백엔드에서 강제

### 4. REST API (`server/src/routes/`)

기존 `src/features/requests/api.ts`의 쿼리들과 1:1 대응:

| 프론트 훅 | 엔드포인트 |
| --- | --- |
| `useRequestViews` | `GET /api/requests` |
| `useRequestDetail` | `GET /api/requests/:id` |
| 생성 | `POST /api/requests` |
| 수정/철회 | `PATCH /api/requests/:id` |
| 상태·담당 변경 | `PATCH /api/requests/:id` |
| 코멘트 | `GET/POST /api/requests/:id/comments` |
| 이력 | `GET /api/requests/:id/history` |
| 공유대상 | `GET/POST/DELETE /api/requests/:id/shared-targets` |
| 첨부 업로드 | `POST /api/requests/:id/attachments` (multipart) |
| 첨부 다운로드 | `GET /api/attachments/:id` (권한검사 후 스트리밍) |
| 대시보드 통계 | `GET /api/dashboard/...` |
| 계정 관리 | `GET/PATCH /api/accounts` |

### 5. 스토리지 (`@fastify/multipart`)

- 업로드: 요청 첨부를 `server/uploads/<request_id>/<uuid>-<filename>` 저장,
  메타는 `request_attachments`에 기록
- 다운로드: `GET /api/attachments/:id` — `canSeeRequest` 검사 후 파일 스트리밍
  (Supabase presigned URL 대체)
- `server/uploads/` 는 gitignore

### 6. 프론트엔드 변경

- `src/lib/supabase.ts` → **`src/lib/api.ts`** (fetch 래퍼, `credentials:'include'`,
  에러 처리 공통화)
- `src/auth/AuthProvider.tsx`: Supabase 세션 → `/api/auth/me` 기반 재작성.
  `signInWithGoogle` → `/api/auth/google` 리디렉트, `signOut` → `/api/auth/logout`,
  **`devLogin()`** 추가
- `src/pages/LoginPage.tsx`: Google 버튼 유지 + **로컬 전용 "임시 로그인
  (김주희)" 버튼** (`import.meta.env.DEV` 일 때만 렌더)
- `src/features/requests/api.ts`: Supabase 쿼리 → 새 REST 호출로 전면 교체
  (React Query 구조·쿼리키는 유지)
- 타입: `src/types/database.ts` 유지·정리, `src/types/supabase.ts` 제거
- `@supabase/supabase-js` 의존성 제거
- `.env.example` 갱신 (`VITE_API_BASE_URL` 등)
- `vite.config.ts`: `/api` → 백엔드 프록시 설정

## 작업 순서 (구현 단계)

1. **인프라**: `docker-compose.yml`(Postgres 16) + `server/` 스캐폴드 +
   Drizzle 스키마/마이그레이션 + 시드(김주희 · request_types)
2. **인증**: Google OAuth + 세션 쿠키 + **dev-login(김주희)** + `authz.ts`
3. **API**: requests/comments/history/shared-targets/attachments/dashboard/accounts
4. **프론트 교체**: `lib/api.ts` + AuthProvider + LoginPage 임시로그인 버튼 +
   `features/requests/api.ts` 재작성
5. **정리·검증**: Supabase 의존 제거, README/문서 갱신, 로컬 E2E 확인
   (임시 로그인으로 전 화면 동작 확인)

## 검증 기준 (완료 정의)

- `docker compose up` 으로 Postgres 기동, 마이그레이션·시드 성공
- 백엔드 `npm run dev`, 프론트 `npm run dev` 동시 기동
- 로컬에서 **"임시 로그인 (김주희)" 버튼**으로 로그인 → 요청 접수/목록/상세/
  관리 보드/대시보드/계정 화면이 정상 동작
- 코드베이스에 `@supabase/supabase-js` 및 `supabase` 참조가 남지 않음
- `npm run build`(프론트), `server`의 typecheck 통과

## 범위 밖 (YAGNI)

- 실제 Google OAuth 클라이언트 발급/프로덕션 배포 구성 (dev-login 우선,
  OAuth는 설정값만 준비)
- MinIO/S3 등 외부 스토리지 (로컬 디스크로 충분, 추후 교체 가능하게만 설계)
- Docker로 백엔드/프론트까지 컨테이너화 (개발은 npm 직접 실행)
- Vercel 등 배포 파이프라인 재구성
