# 0003. 프로세스·프론트 재정비를 Postgres/Fastify/Drizzle 스택에 재타겟

## 상태
승인됨 (2026-07-11)

## 맥락
두 갈래 작업이 병렬로 진행됐다.
- **A. 인프라 이전(완료·정본)**: Supabase → 자체호스팅 PostgreSQL 16(Docker) + Fastify + Drizzle ORM + 세션쿠키 인증 + REST API. 프론트에서 Supabase 제거. authz는 `server/src/authz.ts`(RLS 대체), 도메인 트리거(seq·snapshot·touch·on_status_change) 유지. 11개 통합 테스트 통과. origin/main에 병합됨.
- **B. 프로세스·프론트 재정비 설계(본 저장소 wip 브랜치)**: 상태 모델 단순화, Impact×Urgency P1~P4, SLA 두 시계, 타입 우선 접수, 내부/공개 댓글, 대시보드·계정관리·CSAT 등. 단, **Supabase(RPC·RLS·native enum·pgTAP)** 전제로 설계·구현 착수됨.

A가 도메인 모델을 그대로 보존한 채 스택만 바꿨으므로 B의 도메인 결정은 아직 미적용이다. B의 Supabase 전제 구현(P0-T0~T2, ADR-0003-supabase 등)은 A와 충돌한다.

## 결정
- **정본 스택은 A**(Postgres/Fastify/Drizzle/REST/세션인증). B의 도메인 설계를 이 스택에 **재타겟**한다.
- B의 Supabase 전제 구현물(supabase CLI 스택·baseline 마이그레이션·pgTAP·`change_request_status`/`assign_request` DB RPC·auth.uid RLS)은 **폐기**한다. 해당 로컬 커밋은 `wip/supabase-p0-redesign` 브랜치에 보존(참조용).
- 재타겟 원칙 (레이어 이동):
  - **상태 전이 무결성·SLA 계산·intake 검증**은 DB RPC가 아니라 **서버 서비스 계층(Fastify/TS)** 에서 강제한다. 앱 계층이 이미 있으므로 이게 더 단순·이식적.
  - **스키마 변경**은 raw SQL 마이그레이션이 아니라 **Drizzle 스키마(`server/src/db/schema.ts`) + drizzle 마이그레이션**으로 한다.
  - **권한**은 RLS가 아니라 `authz.ts` 확장으로 한다(내부메모 필터 등).
  - **도메인 트리거**(seq·snapshot·audit history·touch)는 유지·확장한다.
  - **실시간**은 Supabase Realtime 대신 인앱 알림(폴링 기본, SSE는 선택 업그레이드).
  - **테스트**는 pgTAP 대신 기존 방식(`server/scripts/test-*.ts`, Fastify inject + tsx)을 따른다.
- 앞서의 ADR-0004(순수 Postgres 가정)는 A의 실제 구현으로 실현됐으므로 별도 유지하지 않는다.

## 고려한 대안
- B(Supabase 재설계)를 계속: 정본 A와 충돌, 이미 제거된 Supabase 재도입 필요 → 기각.
- 재설계 폐기하고 A 그대로 사용: 프로세스 개선(상태 단순화·SLA·우선순위) 이득 상실 → 기각.

## 결과
- 재타겟 통합 설계는 `docs/superpowers/specs/2026-07-11-redesign-on-postgres-stack.md`.
- 구현은 A 코드베이스(`server/`, `src/`) 위에서 단계별로 진행.
- `wip/supabase-p0-redesign` 브랜치는 참조 후 정리 가능.
