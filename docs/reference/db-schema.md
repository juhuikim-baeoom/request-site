---
title: DB 스키마 설계 (Drizzle + Postgres)
last_updated: 2026-07-13
status: Active
owner: 시스템팀
diataxis: reference
ssot_for: 데이터베이스 스키마 · 트리거 · 뷰
source_of_truth: server/src/db/schema.ts, server/drizzle/0001_triggers.sql
---

# 업무요청 접수·관리 사이트 — DB 스키마 설계 (Drizzle + Postgres 16)

정본 스택: Postgres 16 (Docker) + Fastify + Drizzle ORM.
스키마 정의: `server/src/db/schema.ts` (Drizzle).
마이그레이션: `server/drizzle/0000_*.sql` (Drizzle 자동생성) + `server/drizzle/0001_triggers.sql` (수작성 트리거·뷰).

---

## 1. 테이블 구조

| 테이블 | 역할 | 핵심 |
| --- | --- | --- |
| `users` | 직원 계정·역할·소속 | role = staff / system / viewer(폐기) / dept_monitor / org_monitor / exec / system_admin |
| `sessions` | 서버 세션 | 쿠키는 랜덤 토큰만 저장, 로그아웃·무효화 가능 |
| `org_directory` | 조직도 사전등록 | synced 여부로 계정 생성 연동 |
| `request_types` | 요청 유형 코드 | 오류 / 기능요청 / 데이터추출 / 파일변경 |
| `sla_policy` | SLA 응답·해결 기준 | priorityLevel(P1~P4) 기준 분 단위 |
| `holidays` | 공휴일 | SLA 비즈니스일 계산용 |
| `requests` | 접수 원장 | 상태 6종, 우선순위(P1~P4), intake_detail, CSAT |
| `request_comments` | 처리 코멘트 | isInternal 플래그(내부/외부) |
| `request_status_history` | 상태 변경 이력 | 트리거 자동 기록, changed_by = app.user_id |
| `request_attachments` | 첨부 메타 | commentId(nullable) 연결 가능 |
| `request_shared_targets` | 공유 대상 | visibility='shared'일 때 대상 목록 |
| `role_backfill_history` | 백필 적용 이력 마커 | `backfill_key` PK — `server/src/db/backfill-roles.ts`가 최초 1회만 실행되도록 원자적으로 claim |

관계: `requests` 1→N `comments` / `history` / `attachments` / `shared_targets`.
`requests.parent_request_id`로 하위건 자기참조 연결.

---

## 2. Enum 목록

| Enum | 값 |
| --- | --- |
| `request_status` | 접수 / 진행중 / 보류 / 완료 / 반려 / 철회 |
| `urgency_level` | 높음 / 보통 / 낮음 |
| `priority_level` | P1 / P2 / P3 / P4 |
| `request_org` | 배움 / 배론 / 허브 / 공통 |
| `request_source` | web / email |
| `request_visibility` | private / dept / function / org / shared |
| `user_role` | staff / system / viewer(폐기, 신규 부여 금지) / dept_monitor / org_monitor / exec / system_admin |

`user_role`은 `server/drizzle/0005_role_model_add_values.sql`(`ALTER TYPE ... ADD VALUE`)에서
`dept_monitor`·`org_monitor`·`exec`·`system_admin` 4종을 추가했다. 이 값들을 사용하는 데이터
이전(`viewer`→`exec`, `juhuikim@baeoom.com`→`system_admin`)은 마이그레이션 파일이 아니라
`server/src/db/backfill-roles.ts`의 백필로 구현되어 있다(이유는 §10 교훈 참조). `viewer` 값
자체는 Postgres가 enum 값 제거를 지원하지 않아 forward-only로 남겨두되 신규 부여는 하지 않는다.

이 백필은 **최초 1회만 실행**된다. `server/drizzle/0006_role_backfill_history.sql`이 만든
`role_backfill_history` 테이블에 고정 키(`role_model_v1`)를 원자적으로 claim(`INSERT ... ON
CONFLICT DO NOTHING RETURNING`)하고, claim에 성공했을 때만 실제 UPDATE를 수행한다. `migrate.ts`는
`npm run db:migrate`(= 배포)마다 백필 함수를 호출하지만, 이미 적용된 DB에서는 claim이 0행을
반환해 UPDATE 자체를 건너뛰므로 관리자가 계정 관리 화면에서 수동으로 바꾼 역할이 다음 배포에서
되살아나지 않는다.

이 6개 역할에 대한 접근 제어(authz)는 `server/src/authz.ts`(서버)·`src/lib/permissions.ts`
(클라이언트 사본)의 능력(capability) 기반 판정으로 구현되어 있다. 아래 §8을 참조.

---

## 3. requests 테이블 주요 컬럼

### 3-1. 기본 정보
- `seq` text unique — 접수번호 `YYMMDD-NN` (트리거 자동 생성)
- `source` request_source — web / email
- `org` request_org — 배움/배론/허브/공통
- `type_code` → request_types.code FK
- `title`, `body` — 제목·본문
- `requester_id/name/email`, `assignee_id`
- `status` request_status default '접수'
- `visibility` request_visibility default 'dept'

### 3-2. 우선순위·긴급도
- `urgency` urgency_level not null default '보통' — 긴급도
- `impact` urgency_level nullable — 영향도
- `priority_level` priority_level nullable — P1~P4 (SLA 연동)
- `sla_policy_id` → sla_policy.id FK nullable

### 3-3. 접수 상세
- `intake_detail` jsonb not null default '{}' — 유형별 추가 입력
- `requester_dept/org/function` — 접수 시점 스냅샷 (트리거 자동 기록)

### 3-4. 기한·SLA
- `desired_due` date — 요청자 희망일
- `assigned_at`, `response_due_at`, `resolution_due_at` timestamptz
- `first_response_at`, `first_resolved_at`, `final_resolved_at` timestamptz
- `sla_response_breached`, `sla_resolution_breached` boolean default false
- `completed_at` timestamptz — 최종 완료일 (트리거 관리)

### 3-5. 후처리
- `csat_rating` smallint nullable — 값 -1(불만족) / 1(만족), 앱에서 검증
- `csat_comment` text
- `hold_reason`, `reject_reason`, `rework_reason` text
- `rework_count` integer default 0

---

## 4. SLA 정책 (sla_policy)

| priority_level | response_minutes | resolution_minutes |
| --- | --- | --- |
| P1 | 120 (2h) | 480 (8h) |
| P2 | 240 (4h) | 960 (16h) |
| P3 | 480 (8h) | 1920 (32h) |
| P4 | 960 (16h) | null (없음) |

---

## 5. 상태 흐름

`접수 → 진행중 → 완료` (주요 경로)
`→ 보류` (일시 중단) / `→ 반려` (처리 불가) / `→ 철회` (요청자 취소)

상태 변경 시 트리거(`on_status_change`)가 자동으로:
- `request_status_history`에 이력 기록 (changed_by = `app.user_id` 세션 변수)
- `완료` 진입 시: `completed_at`·`first_resolved_at`(최초 1회)·`final_resolved_at` 세팅, `resolution_due_at` 초과 시 `sla_resolution_breached=true`
- `완료 → 진행중` 되돌림 시: `completed_at`·`final_resolved_at` 해제 + `rework_count +1`

---

## 6. 계산 뷰 (request_view)

`request_view`를 조회하면 아래가 계산됩니다:

- `type_label` — request_types.label 조인
- `first_lead_days` — first_resolved_at::date - created_at::date
- `final_lead_days` — final_resolved_at::date - created_at::date
- `due_status` — 다음 규칙으로 계산:
  - 상태가 완료/반려/철회 → 상태 그대로
  - resolution_due_at 있고 `now() > resolution_due_at` → '초과'
  - resolution_due_at 있고 `resolution_due_at - now() < 4시간` → '임박'
  - 그 외 → '정상'

---

## 7. 인증·세션

서버 세션 기반 인증 (Fastify + sessions 테이블).
Google OAuth 연동, `@baeoom.com`/`@baeron.com` 도메인 제한.
쿠키에는 랜덤 세션 토큰만 저장 — 로그아웃/무효화 가능.

---

## 8. 접근 제어

RLS 없음 (Fastify 백엔드에서 역할 판정). 라우트는 역할 이름 대신 능력(capability)을
묻는다 — 역할이 늘어도 호출부를 고치지 않기 위함이다. 정의: `server/src/authz.ts`
(서버, source of truth) · `src/lib/permissions.ts`(클라이언트 사본, 화면 노출 편의용 —
실제 권한 경계는 서버가 강제). 옛 `isSystem`·`isViewerUp` 헬퍼는 제거됐다.

**능력별 허용 역할**

| 능력 | 의미 | 허용 역할 |
| --- | --- | --- |
| `canProcess` | 배정·상태전이·영향도 조정·필드편집·내부메모 작성 | system · system_admin |
| `canManageAccounts` | 계정·역할 변경, 조직도 import | system_admin |
| `canSeeDashboard` | 통계 대시보드 열람 | system · system_admin · exec |
| `canSeeInternal` | 내부메모 열람(본문 + 첨부파일) | system · system_admin |
| `canSeeAllRequests` | 공개범위와 무관하게 전 요청 열람 | system · system_admin · exec |

`staff`·`dept_monitor`·`org_monitor`와 폐기값 `viewer`는 위 5개 능력이 모두 false다
(화이트리스트 방식 — 알 수 없는/폐기된 역할은 최소 권한).

**공개범위(visibility) + 모니터링 열람 범위**

`canSeeAllRequests` 역할(system·system_admin·exec)은 공개범위와 무관하게 전체 열람.
그 외에는 아래 visibility 규칙에 더해, 모니터링 관리자가 본인 소속에서 도출한 범위를
추가로 본다: `dept_monitor` = 같은 기관 **+** 같은 직무, `org_monitor` = 같은 기관
전체. 본인의 `org_affil`/`dept_function`이 null이면 추가 범위 없음(false로 안전 처리).

| visibility | 볼 수 있는 사람 |
| --- | --- |
| private | 본인 + canSeeAllRequests 역할 |
| dept | 본인 + 같은 기관·직무 + canSeeAllRequests 역할 |
| function | 본인 + 같은 function + canSeeAllRequests 역할 |
| org | 본인 + 같은 기관 + canSeeAllRequests 역할 |
| shared | 전 직원 (shared_targets 참조) |

목록 조회 시 위 판정은 `visibilityFilter()`가 SQL WHERE 절로, 단건 조회 시
`canSeeRequest()`가 동일 규칙을 애플리케이션 레벨로 이식한다. 댓글의 내부메모
(`is_internal=true`)는 `canSeeComment()`가 별도 판정 — `canSeeInternal` 역할이거나
작성자 본인일 때만 보인다(첨부파일 목록·다운로드도 동일 규칙 공유).

회귀 테스트: `server/scripts/test-authz.ts`(`npm run test:authz`, 역할×능력 매트릭스 +
모니터링 열람 범위), `server/scripts/test-role-boundaries.ts`(`npm run test:roles`,
API 레벨 권한 경계).

---

## 9. 메일 접수 통합

- `source` = web / email 로 접수 경로 구분
- `source_thread_id` + 부분 unique 인덱스로 메일 중복 방지
- `is_locked` — 메일 접수 건의 자동 추적 중 사람이 보정한 값 보호

---

## 10. 마이그레이션 관리

Greenfield(데이터 없음) 재생성 방식.

```
docker compose down -v && docker compose up -d
npm run db:migrate   # drizzle/0000_*.sql + 0001_triggers.sql
npm run db:seed      # request_types / users / sla_policy / holidays
npm run db:smoke     # seq 생성·상태이력·뷰 조회 검증
```

enum 값 변경 필요 시 drizzle 파일 전체 재생성 후 DB 초기화.

**교훈 1**: `ALTER TYPE ... ADD VALUE`로 추가한 enum 값은 같은 트랜잭션 안에서 사용(SELECT/UPDATE 등)할 수 없다. drizzle-orm 마이그레이터(`drizzle-orm/node-postgres/migrator`)는 대기 중인 모든 마이그레이션 파일을 단일 트랜잭션으로 묶어 실행하므로, 값 추가와 그 값을 쓰는 데이터 이전을 파일만 나눠서는 우회할 수 없다 — **값 추가는 마이그레이션, 그 값을 쓰는 데이터 이전은 `migrate()` 완료(트랜잭션 커밋) 후 실행되는 백필**(예: `server/src/db/backfill-roles.ts`, `server/src/db/migrate.ts`에서 호출)로 분리한다.

**교훈 2**: 위 백필은 `migrate.ts`가 `npm run db:migrate`(= 배포)마다 호출한다. 백필이 조건절(`WHERE role='viewer'` 등)만으로 멱등을 흉내 내면, 그 조건이 "이메일 == 특정 값"처럼 사용자가 이후에 임의로 바꿀 수 있는 값을 대상으로 할 때 문제가 생긴다 — 관리자가 화면에서 역할을 바꿔도 다음 배포에서 조건이 다시 참이 되어 백필이 그 값을 조용히 덮어쓴다. 그래서 백필은 **적용 여부 자체를 별도 이력 테이블(`role_backfill_history`, `server/drizzle/0006_role_backfill_history.sql`)에 원자적으로 기록**하고, 이미 적용됐으면(= 이력에 키가 존재하면) 대상 조건과 무관하게 무조건 스킵한다. "재실행해도 안전"(idempotent)과 "최초 1회만 실행"(one-shot)은 다른 요구사항이며, 이후 사람이 수정할 수 있는 데이터를 다루는 백필은 후자를 만족해야 한다.
