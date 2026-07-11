# Changelog

이 프로젝트의 주요 변경 사항을 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/), 버전은 [SemVer](https://semver.org/)를 따른다.

## [Unreleased]

### Added
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
