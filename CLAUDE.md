# CLAUDE.md — 프로젝트 규칙 (AI 에이전트 + 사람 공통)

업무요청 접수·관리 사이트. **이 파일은 프로젝트 규칙의 SSOT다.** 코드/스키마/문서를 만지기 전에 여기서 규칙을 확인한다. 상세 표준은 `docs/standards/`를 참조한다.

## 스택

React 18 · Vite 5 · TypeScript · Tailwind · React Router · TanStack Query / Supabase(PostgreSQL·Auth·Storage·RLS) / Vercel 배포.

## 채택한 표준 (SSOT: `docs/standards/`)

| 표준 | 문서 |
|------|------|
| DB 네이밍 (약어·예약어·접미사) | `docs/standards/01-database-naming-rules.md` |
| 테이블·컬럼 설계 (접두사·감사컬럼·PK·soft-delete) | `docs/standards/02-table-column-standards.md` |
| 데이터 관리 (마이그레이션·시드·EAV·시크릿) | `docs/standards/03-data-management-rules.md` |
| 문서 관리 (docs-as-code·SSOT·Diátaxis·ADR) | `docs/standards/04-document-management-rules.md` |

문서 전체 진입점(주제→문서 매핑)은 `docs/00-overview/index.md`.

---

## 1. 문서 동기화 규칙 (필수)

**코드/설정을 사용자 노출 수준에서 바꾸면, 같은 작업 안에서 아래 영향 매핑 표가 가리키는 문서를 갱신한다.** 판단 상세는 `docs/standards/04-document-management-rules.md` §2를 따른다.

### 영향 매핑 표 (변경 파일 → 함께 갱신할 문서)

| 변경 파일(패턴) | 함께 갱신할 문서 |
|-----------------|------------------|
| `schema.sql`, `supabase/migrations/*.sql` | `docs/reference/db-schema.md`, `CHANGELOG.md` |
| `src/types/**`, `src/lib/constants.ts` | `docs/reference/db-schema.md` |
| `src/features/**`, `src/pages/**`, `src/components/**` | `docs/reference/requirements.md`, `CHANGELOG.md` |
| `src/auth/**` | `docs/reference/db-schema.md`(RLS·역할), `docs/00-overview/index.md` |
| `.env.example`, `vite.config.ts`, `package.json` | `docs/00-overview/index.md` |
| `CLAUDE.md` 자체 변경 | `docs/00-overview/index.md` |

- **스킵 가능**: 내부 리팩토링, 이름 변경(외부 계약 불변), 테스트만 변경, 일회성 디버그/주석. 단 스킵 사유를 커밋 메시지에 한 줄 남긴다 (예: `docs sync: 내부 리팩토링만 — 스킵`).
- 자명한 갱신(버전·예시·옵션 추가)은 즉시 직접 수정. 큰 갱신(구조 재작성)은 사용자 승인 후 진행.
- frontmatter가 있는 문서를 고치면 `last_updated`를 오늘 날짜로 갱신한다.
- 신규 소스 영역이 생기면 위 표에 행을 추가한다.

> 이 규칙은 `.claude/hooks/docs-sync-reminder.js` 훅이 코드 편집 직후 자동으로 상기시킨다(비차단). 훅은 리마인더일 뿐, 실제 동기화 판단·수행은 위 규칙을 따른다.

---

## 2. DB 규칙 (going-forward)

현재 스키마(`schema.sql`)는 한글 enum·예약어 컬럼명 등 표준과 다른 부분이 있으나 **이미 운영 중이므로 forward-only로 보존**한다. 표준 전면 적용 로드맵은 `docs/adr/0002-phased-db-standardization.md` 참조. **신규 테이블·컬럼·마이그레이션은 아래를 지킨다.**

- **식별자**: 소문자 `snake_case`. 예약어(`status`,`type`,`name`,`order`,`user`,`group`,`value`,`key`) 단독 사용 금지 → `status_cd`,`_tp`,`_nm`,`_seq` 등으로 흡수.
- **접미사로 타입 표현**: 시각 `_at`(TIMESTAMPTZ) · 날짜 `_on`(DATE) · 불리언 `_flag`/`is_`/`has_`(NOT NULL DEFAULT) · 코드 `_cd`(VARCHAR) · 유형 `_tp` · 명칭 `_nm` · 식별자 `_uuid`/`_id`.
- **코드값**: `SCREAMING_SNAKE_CASE` 영문 (예: `PENDING`,`IN_PROGRESS`). 네이티브 ENUM 신규 도입 지양 → `VARCHAR + CHECK` 또는 lookup 테이블.
- **감사 컬럼**: 신규 테이블은 `created_at`/`updated_at` MUST, 사용자·업무 데이터는 soft-delete(`deleted_flag`) 지향. 물리삭제(`DELETE`)는 근거를 명시.
- **마이그레이션**: 버전 파일 forward-only, 이미 적용된 파일 편집 금지. 상세는 `supabase/migrations/README.md`.
- **시크릿/PII 평문 금지**: SQL·문서·커밋·로그 어디에도 남기지 않는다. `.env`는 커밋하지 않는다.

### 이 프로젝트 코드값 사전 (현행 = 레거시 한글)

현행 값은 앱·RLS·트리거가 의존하므로 유지한다. 표준 영문값은 로드맵상 목표이며 매핑은 ADR-0002가 SSOT.

| 도메인 | 현행 값(레거시, 유지) |
|--------|------------------------|
| `request_status` | 접수·확인·진행중·검수대기·재작업·완료·보류·반려·이관·철회 |
| `request_org` | 배움·배론·허브·공통 |
| `request_priority` | 긴급·보통·낮음 |
| `request_visibility` | private·dept·function·org·shared |

---

## 3. 문서 표기 규칙

- 아키텍처·흐름·ERD는 **Mermaid**, 비교·스펙·목록은 **마크다운 테이블**. ASCII 박스 다이어그램 금지.
- 문서 1개 본문은 단일 언어. 한국어 문서는 파일명·폴더명·본문에 **CJK 한자 사용 금지**(한글은 허용). 중국·일본 고유명사는 로마자 표기.
- 코드/명령은 언어 명시 코드블록으로 감싼다. 시크릿 실제 값은 문서에 남기지 않는다.
- 아키텍처 결정은 `docs/adr/`에 ADR로, 릴리스 변경은 `CHANGELOG.md`의 `Unreleased`에 기록.

## 4. 코딩 컨벤션 (현행 유지)

- 라우팅 `src/routes.tsx`, 화면은 `src/features/{도메인}/`, 공용 컴포넌트 `src/components/`, Supabase 접근 `src/features/*/api.ts` + `src/lib/supabase.ts`.
- DB 컬럼은 snake_case, TS 타입/필드는 기존 `src/types/database.ts` 정의를 SSOT로 사용.
