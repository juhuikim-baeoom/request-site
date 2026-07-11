# 업무요청 접수·관리 사이트

배움·배론·허브 3개 기관 소속 직원의 업무요청을 웹으로 접수하고, 시스템팀이 진행 관리하는 사이트. 기존 Gmail 접수의 분류 불일치·자동추적 한계를 접수 단계 구조화로 해결한다.

## 스택

- **프론트엔드**: React 18 + Vite + TypeScript
- **라우팅**: react-router-dom v6
- **데이터**: 자체 REST API(fetch) + @tanstack/react-query
- **스타일**: Tailwind CSS
- **백엔드**: Fastify 5 + Drizzle ORM (`server/`) — 세션 쿠키 인증 · 로컬 디스크 첨부
- **DB**: PostgreSQL 16 (Docker / colima)
- **인증**: Google OAuth(프로덕션) + 로컬 전용 임시 로그인(김주희)
- **배포**: 미정

> 이 프로젝트는 원래 Supabase 기반이었으나 순수 PostgreSQL + 자체 백엔드로 마이그레이션되었습니다.
> 설계·구현 기록: `docs/superpowers/specs/`, `docs/superpowers/plans/`

## 역할

| 역할 | 설명 | 접근 |
| --- | --- | --- |
| `staff` | 일반직원 | 요청 접수, 내 요청 목록 |
| `system` | 시스템팀 | 전체 + 관리 보드, 통계, 계정 관리 |
| `viewer` | 실장 등 열람 | 통계 대시보드(조회), 요청 열람(읽기 전용) |

## 화면

| 경로 | 화면 | 접근 |
| --- | --- | --- |
| `/login` | Google 로그인 | 비로그인 |
| `/requests/new` | 요청 접수 폼 | staff↑ |
| `/requests/mine` | 내 요청 목록 | staff↑ |
| `/requests/:id` | 요청 상세 | staff↑ |
| `/board` | 관리 보드(칸반) | system |
| `/dashboard` | 통계 대시보드 | system, viewer |
| `/accounts` | 계정 관리 | system |

## 폴더 구조

```
src/
├─ lib/          Supabase·React Query 클라이언트
├─ types/        DB 타입(schema.sql 기반)
├─ auth/         세션·역할 컨텍스트, 라우트 가드
├─ components/   Layout, TopNav, 공통 UI
├─ pages/        로그인
├─ features/     requests · board · dashboard · accounts
└─ routes.tsx    라우팅 + 역할 가드 매핑
```

## 개발 시작 (로컬)

Docker 데몬이 필요합니다. Docker Desktop 또는 colima 중 하나:

```bash
# 0) Docker 데몬 (colima 예시)
colima start

# 1) PostgreSQL 기동
docker compose up -d

# 2) 백엔드 (server/)
cd server
npm install
cp .env.example .env          # 로컬 기본값 그대로 사용 가능
npm run db:migrate            # 스키마·트리거·뷰 적용
npm run db:seed               # 초기 데이터(김주희 등)
npm run dev                   # http://localhost:4000

# 3) 프론트엔드 (루트)
cd ..
npm install
npm run dev                   # http://localhost:5173  (/api → :4000 프록시)
```

로그인: `/login` 에서 **🔧 임시 로그인 (김주희)** 버튼(로컬 전용, `import.meta.env.DEV`)으로
Google 없이 바로 로그인됩니다. 프로덕션에서는 Google OAuth(`server/.env`의 `GOOGLE_*` 설정)를 사용합니다.

### 백엔드 테스트

```bash
cd server
npm run test:auth && npm run test:devlogin && npm run test:authz && npm run test:upsert
npm run test:api && npm run test:api-detail && npm run test:api-write && npm run test:api-attach
```

## 프로젝트 구조 (백엔드)

```
server/
├─ src/db/        Drizzle 스키마·마이그레이션·시드 (schema.sql 이식)
├─ src/auth/      세션 쿠키 · dev-login · Google OAuth · upsert
├─ src/authz.ts   공개범위/역할 권한 (구 RLS 이식)
├─ src/routes/    requests · request-detail · attachments · meta · auth
└─ src/storage.ts 첨부 로컬 디스크(uploads/)
docker-compose.yml  PostgreSQL 16
```

## 문서

- [요구사항정의서](docs/요구사항정의서.md)
- [DB 설계](docs/DB설계.md)
- [schema.sql](schema.sql) — 원본 Supabase 스키마(참고용, 실제 적용은 `server/drizzle/`)
- [마이그레이션 설계](docs/superpowers/specs/2026-07-11-supabase-to-postgres-migration-design.md)
