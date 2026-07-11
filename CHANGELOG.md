# Changelog

이 프로젝트의 주요 변경 사항을 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/), 버전은 [SemVer](https://semver.org/)를 따른다.

## [Unreleased]

### Added
- **관리 보드 P3 BoardUI 재설계** (`src/features/board/ManageBoard.tsx`)
  - 트리아지 존: `status='접수' && assignee=null` 건을 상단 미배정 큐로 표시. 배정 모달(담당자 + 영향도 + 예상 priority_level 미리보기) → `useAssignRequest`.
  - 칸반 5컬럼(접수·진행중·보류·완료·반려): 헤더 건수, WIP 한도(12) 초과 시 amber 강조.
  - 카드: priority_level 뱃지(P1~P4/미정), seq, 제목, 기관, 유형, SLA(due_status + D-N 상대표기), 담당자 인라인 선택, 재작업 뱃지.
  - HTML5 드래그 드롭 상태 전이: `ALLOWED_TRANSITIONS` 선검증, 불허 시 토스트, `useChangeStatus` 낙관적 업데이트+실패 롤백. 접수→진행중 드롭은 배정 모달 트리거.
  - 인라인 담당자 변경: `useChangeAssignee`로 status PATCH와 분리.
  - 종결 포함 토글(완료·반려·철회 기본 제외) + 기간 없이 단순 토글.
  - 벌크 선택+일괄 상태/담당자 변경(`useBulkUpdate`) + undo 토스트.
  - 저장뷰: 필터 상태 localStorage 자동 저장/복원(`manage_board_filters_v1`).
  - 리스트 뷰 토글 유지 + 전체 선택 체크박스.

### Fixed
- **supabase.ts 타입 갱신**: `requests` 테이블에 `urgency` (`urgency_level` enum) · `intake_detail` (jsonb) 컬럼 추가, `urgency_level` enum (`높음`/`보통`/`낮음`) Enums 섹션에 추가.
- **intake 필드 오류 미해제 버그**: `setIntakeField` 내부에서 오류 키를 `intake_${key}` 형식으로 조회하도록 수정 — 값 입력 시 붉은 테두리·오류 메시지가 정상 해제됨.
- **희망완료일 과거 날짜 차단**: `<input type="date">` 에 `min={today}` 추가, `validate()` 에 과거 날짜 조건 추가.
- **접근성 — label/input 명시적 연결**: 모든 `<label>`에 `htmlFor`, 대응 입력 요소에 `id` 부여 (유형·제목·상세·긴급도·희망완료일·공개범위·첨부·intake 동적 필드 포함).
- **Urgency 타입 중복 제거**: `api.ts`의 독립 정의 삭제 → `constants.ts`를 단일 정본으로, `api.ts`는 import 후 re-export.

### Added
- **P2 접수폼 재설계**: 유형 우선(type-first) 흐름 — 유형 선택 후 해당 타입 전용 intake_detail 필드 노출 (`error`/`feature`/`data`/`file` 각 2~3개 필드).
- `URGENCY_OPTIONS` (`높음`/`보통`/`낮음`) 및 `TYPE_FIELDS` 맵을 `src/lib/constants.ts`에 추가.
- `Urgency` 타입을 `src/lib/constants.ts`에 추가.
- 접수폼 인라인 검증: 공통 필수 필드(유형·제목·희망완료일·긴급도·공개범위) + 타입별 intake_detail 필수 키 미충족 시 필드 근처에 오류 메시지 표시, 제출 차단.

### Changed
- 접수폼에서 우선순위(priority) 입력 제거 → 긴급도(urgency) 입력으로 대체. 우선순위(priority_level)는 배정 시 시스템팀이 설정.
- `CreateRequestInput`에서 `priority` 제거, `urgency`·`intake_detail` 추가. `body` 선택 필드로 변경.
- `useCreateRequest` 뮤테이션 페이로드: `priority` → `urgency`, `intake_detail` 추가.
- 웹 프로젝트 표준(DB 네이밍·테이블/컬럼·데이터 관리·문서 관리)을 `docs/standards/`로 채택 (ADR-0001).
- 저장소 루트 `CLAUDE.md` — 프로젝트 규칙 SSOT(영향 매핑 표·DB going-forward 규칙·문서 표기 규칙).
- 문서 구조를 Diátaxis 기반으로 재편: `docs/00-overview/index.md`(SSOT 인덱스), `docs/reference/`, `docs/adr/`, `docs/standards/`.
- 아키텍처 결정 기록 `docs/adr/0001`, `docs/adr/0002`(DB 표준 점진 적용 로드맵).
- `supabase/migrations/` — forward-only 마이그레이션 디렉토리 및 규약 README.
- 비차단 문서 동기화 리마인더 훅 `.claude/hooks/docs-sync-reminder.js` + `.claude/settings.json`.

### Changed
- `docs/DB설계.md` → `docs/reference/db-schema.md`, `docs/요구사항정의서.md` → `docs/reference/requirements.md` (git 이력 보존, frontmatter 추가).
- 백엔드를 Supabase → 자체호스팅 PostgreSQL 16 + Fastify + Drizzle + 세션인증 + REST로 이전 완료(다른 세션). SSOT 인덱스·개요를 새 스택으로 갱신.

### Design
- 프로세스·프론트 재정비 설계를 정본 스택(Postgres/Fastify/Drizzle)에 재타겟: `docs/superpowers/specs/2026-07-11-redesign-on-postgres-stack.md` (ADR-0003). 상태 6종·Impact×Urgency P1~P4·SLA 두 시계·타입 우선 접수·내부/공개 댓글·대시보드·CSAT. 전이/SLA/검증은 서버 서비스 계층으로 이동. 구현 P0~P8.

### Notes
- Supabase 전제 재설계 구현물(supabase CLI·pgTAP·DB RPC)은 폐기, `wip/supabase-p0-redesign` 브랜치에 보존.
- `docs/reference/db-schema.md`는 구 Supabase 스키마 기준이라 갱신 필요(정본은 `server/src/db/schema.ts`).
