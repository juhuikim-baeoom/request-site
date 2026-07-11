# 업무요청 접수·관리 사이트

배움·배론·허브 3개 기관 소속 직원의 업무요청을 웹으로 접수하고, 시스템팀이 진행 관리하는 사이트. 기존 Gmail 접수의 분류 불일치·자동추적 한계를 접수 단계 구조화로 해결한다.

## 스택

- **프론트엔드**: React 18 + Vite + TypeScript
- **라우팅**: react-router-dom v6
- **데이터**: @supabase/supabase-js + @tanstack/react-query
- **스타일**: Tailwind CSS
- **백엔드**: Supabase (Auth · DB · Storage)
- **배포**: Vercel (예정)

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

## 개발 시작

```bash
# 1) 의존성 설치
npm install

# 2) 환경변수 설정 — Supabase 대시보드 > Project Settings > API 값 입력
cp .env.example .env
#   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY

# 3) DB 스키마 적용 — Supabase 대시보드 > SQL Editor 에 schema.sql 붙여넣고 실행

# 4) 개발 서버
npm run dev

# 5) 빌드
npm run build
```

## 현재 상태 (뼈대 단계)

- ✅ 프로젝트 라우팅·레이아웃, 역할 기반 라우트 가드
- ✅ Supabase 클라이언트, AuthProvider(Google OAuth, 도메인 안내), React Query
- ✅ DB 타입, schema.sql 동봉
- ⬜ 각 기능 화면은 **플레이스홀더**(구현 예정) — 실제 폼·목록·칸반·통계·계정관리 로직은 다음 단계

## 문서

- [요구사항정의서](docs/요구사항정의서.md)
- [DB 설계](docs/DB설계.md)
- [schema.sql](schema.sql)
