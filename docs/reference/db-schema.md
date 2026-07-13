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
마이그레이션: `server/drizzle/0000_*.sql` (Drizzle 자동생성) + `server/drizzle/0001_triggers.sql` (수작성 트리거·뷰) +
`server/drizzle/0007_request_sharing_history.sql`(공유 변경 이력 테이블) + `0008_gen_seq_gap_tolerant.sql`·
`0009_gen_seq_lpad_overflow.sql`(채번 트리거 `gen_seq()` 버그 수정, §10 참조).

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
| `request_sharing_history` | 공유 설정(공개범위·공유대상) 변경 이력 | `added`/`removed` jsonb — 서버가 기존 목록과 비교해 계산(클라이언트가 보낸 값은 신뢰하지 않음), `from_visibility`/`to_visibility`는 공개범위가 실제로 바뀐 경우에만 채워짐. 마이그레이션 `0007` |
| `role_backfill_history` | 백필 적용 이력 마커 | `backfill_key` PK — `server/src/db/backfill-roles.ts`가 최초 1회만 실행되도록 원자적으로 claim |

관계: `requests` 1→N `comments` / `history` / `attachments` / `shared_targets` / `sharing_history`.
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
`dept_monitor`·`org_monitor`·`exec`·`system_admin` 4종을 추가했다. 기존 DB의 데이터 이전
(`viewer`→`exec`, `juhuikim@baeoom.com`→`system_admin`)은 마이그레이션 파일이 아니라
`server/src/db/backfill-roles.ts`의 백필로 구현되어 있다(이유는 §10 교훈 참조). `viewer` 값
자체는 Postgres가 enum 값 제거를 지원하지 않아 forward-only로 남겨두되 신규 부여는 하지 않는다.

이 백필은 **최초 1회만 실행**된다. `server/drizzle/0006_role_backfill_history.sql`이 만든
`role_backfill_history` 테이블에 고정 키(`role_model_v1`)를 원자적으로 claim(`INSERT ... ON
CONFLICT DO NOTHING RETURNING`)하고, claim에 성공했을 때만 실제 UPDATE를 수행한다. `migrate.ts`는
`npm run db:migrate`(= 배포)마다 백필 함수를 호출하지만, 이미 적용된 DB에서는 claim이 0행을
반환해 UPDATE 자체를 건너뛰므로 관리자가 계정 관리 화면에서 수동으로 바꾼 역할이 다음 배포에서
되살아나지 않는다.

**깨끗한 DB의 최초 관리자는 백필이 아니라 `server/src/db/seed.ts`가 직접 만든다** —
`db:seed`가 `juhuikim@baeoom.com`을 처음부터 `role='system_admin'`으로 삽입한다(이전에는
`role='system'`으로 삽입해, 빈 DB에 공식 순서(`db:migrate` → `db:seed`)를 따르면 백필이
0행 UPDATE로 마커만 claim하고 seed가 `system`을 넣어 `system_admin`이 영구히 0명이 되는
결함이 있었다 — §10 교훈 3 참조). `backfill-roles.ts`는 이 seed 수정 이전에 이미 배포되어
`role='system'`으로 존재하는 기존 DB를 위한 이전 경로로 계속 남는다.

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

**공유 설정(공개범위 + 공유 대상) 변경**: `canChangeSharing()`는 `canProcess`(system·system_admin)
또는 **요청자 본인**을 허용한다 — 본문 편집(`canProcess` 또는 요청자 본인 && `status='접수'`)과
달리 상태와 무관하다(진행중·보류·완료·반려 등 종결 후에도 요청자가 공유 범위를 바꿀 수 있다).
공유는 처리 내용을 바꾸지 않고 "누가 볼 수 있는가"만 바꾸므로 본문 편집보다 넓게 열려 있다.
`PUT /api/requests/:id/sharing`(body `{ visibility, shared_targets: [{ target_type, target_value }] }`)가
공개범위와 공유 대상을 **전체 교체**한다 — 넘긴 목록이 곧 최종 상태이므로 추가·제거가 한 번의
호출로 처리된다. 입력 검증(`parseSharedTargets()`, `server/src/services/sharing.ts`)은 접수
(`POST /api/requests`)와 이 엔드포인트가 공유하는 단일 헬퍼다 — 잘못된 `target_type`/`target_value`가
DB CHECK 위반으로 새어 500이 되는 것을 막고, 중복 대상은 침묵 없이 dedupe한다. `target_value`는
형식까지 검증한다: `target_type='function'`이면 직무 6종(`FUNCTION_TARGETS`) 중 하나, `target_type='dept'`
이면 `기관|직무` 형식(기관은 `ORGS`, 직무는 위 6종)이어야 하며 위반 시 400 `INVALID_TARGET_VALUE`다.
`FUNCTION_TARGETS`는 서버(`server/src/services/sharing.ts`)와 클라이언트(`src/lib/constants.ts`)에
사본을 두는데, 이는 `server/src/http.ts`의 `ORGS`·`VISIBILITIES`와 같은 관례다(서버는 클라이언트
코드를 import할 수 없다). 서버는 기존 목록과
비교해 `added`/`removed`를 계산해 `request_sharing_history`에 기록하며(공개범위·대상이 둘 다
그대로면 이력을 남기지 않는다), TOCTOU 방지를 위해 `SELECT ... FOR UPDATE`로 요청 행을 잠근 뒤
같은 트랜잭션에서 교체·이력 기록을 수행한다. `visibility`는 `PATCH /api/requests/:id`에서는 더
이상 바꿀 수 없다 — 시도하면 400 `USE_SHARING_ENDPOINT`. 권한 규칙이 다른 두 경로가 같은 컬럼을
쓰면 낮은 쪽(본문 편집)이 우회로가 되기 때문이다. 새로 공유된 사람들에게 알림은 보내지 않는다 —
공유 대상은 직무·부서 단위라 한 번 추가하면 대상 인원이 넓어 알림 스팸이 되기 때문이다.

공유 변경 이력은 `GET /api/requests/:id/sharing-history`(독립 엔드포인트 — 상태 이력
`GET /api/requests/:id/history`, 첨부 `GET /api/requests/:id/attachments`와 같은 관례)로 조회한다.
권한은 `canSeeRequest()`(해당 요청을 볼 수 있으면 이력도 볼 수 있다) — 내부메모와 달리 별도로
좁히지 않는다. 열람 권한이 없으면 404.

첨부파일 목록·다운로드 게이트는 **fail-closed**다: 첨부의 `comment_id`가 non-null인데(내부메모에
딸린 첨부) 조인·조회된 댓글 행을 찾지 못하면 "공개"로 fail-open 처리하지 않고 목록에서 제외·
다운로드를 거부(404)한다. 다운로드 라우트(`GET /api/attachments/:id/download`)는 첨부 조회와
댓글 조회가 별도의 두 쿼리라 그 사이에 댓글이 삭제되면 TOCTOU(check-then-act) 레이스가 생길 수
있는데, 이번 수정이 실제로 닫는 것은 이 창이다. 목록 라우트(`GET /api/requests/:id/attachments`)는
단일 `LEFT JOIN` 쿼리라 같은 레이스는 없지만, 두 경로의 동작을 일치시키기 위해 동일한 fail-closed
규칙을 적용했다. `comment_id`가 애초에 null인 요청 본문 첨부는 그대로 노출된다(과잉 차단 아님).

업로드 시점(`POST /api/requests/:id/attachments`)에도 `comment_id`가 non-null이면 그 댓글이
실제로 같은 요청(`request_id`) 소속인지 검증한다 — 검증 없이 그대로 저장하면 A요청에 파일을
올리면서 B요청의 댓글 id를 붙일 수 있었다(정보 유출은 아님 — 첨부 조회가 `request_id`로 필터되므로
남의 스레드에 노출되지 않고, 오히려 업로더 자신에게도 안 보이게 될 뿐이지만 무결성 문제). 소속이
아니면 이 라우트의 기존 관례대로 404로 거부한다.

**잔여 위험(중요)**: `request_attachments.comment_id`의 FK는 `onDelete: 'set null'`이다. 즉 댓글이
삭제되면 그 첨부의 `comment_id`는 "댓글 행을 찾을 수 없는 상태"가 아니라 **NULL로 바뀐다.** 위
fail-closed 필터의 첫 분기는 `comment_id`가 null이면 요청 본문 첨부로 간주해 통과시키므로, **댓글
삭제 기능이 추가되는 순간 삭제된 내부메모의 첨부는 그 분기를 타고 전 역할에 공개된다.** 이번
수정은 이 상태를 막지 않는다 — 막는 것은 어디까지나 "`comment_id`는 있는데 댓글 행이 없는" 순간의
TOCTOU 창뿐이다. 현재는 댓글 삭제 라우트가 없어(`app.delete` 라우트 0개) 실사용 경로가 없으며,
회귀 테스트(`server/scripts/test-attach-authz.ts`)가 `SET LOCAL session_replication_role = replica`로
FK 자체를 우회해야만 그 orphan 상태를 재현할 수 있었다는 점이 이를 뒷받침한다(FK가 정상 동작하는
한 그 상태는 스스로 발생하지 않는다). **댓글 삭제 기능을 추가할 때는** 그 댓글에 딸린 첨부도 함께
삭제(cascade)하거나, `request_attachments`에 `is_internal`을 비정규화해 `comment_id`가 NULL이 되어도
내부메모 여부를 판별할 수 있게 하는 등의 대책이 반드시 필요하다.

`GET /api/profiles`(계정 디렉터리: id·name·email·role·소속)는 `GET /api/users`와 동일하게
`canProcess` 전용이다 — 유일한 소비자(관리 보드 담당자 select)가 `canProcess` 화면이기
때문이며, 그렇지 않으면 `GET /api/users`를 `canProcess`로 좁힌 경계가 이쪽으로 우회된다.

회귀 테스트: `server/scripts/test-authz.ts`(`npm run test:authz`, 역할×능력 매트릭스 +
모니터링 열람 범위), `server/scripts/test-role-boundaries.ts`(`npm run test:roles`,
API 레벨 권한 경계 — `GET /api/profiles` 포함), `server/scripts/test-attach-authz.ts`
(`npm run test:attach-authz`, 내부메모 첨부 차단 + fail-closed 동작),
`server/scripts/test-sharing.ts`(`npm run test:sharing`, 14건 — 권한 3종(무관한 staff 403 ·
exec 열람 가능·처리 불가 403 · 종결 건 요청자 본인 200) · 전체 교체 · 이력 기록(added/removed) ·
공유 후 대상 부서 사용자 열람 반영 · 무변경 시 이력 없음 · `PATCH` 우회로 차단(400) · 없는 요청
id 404 · 잘못된 입력 3종(400) · 중복 대상 dedupe · visibility만 변경 시 대상 행 id/created_at
보존 · `GET .../sharing-history` 권한(열람 불가 시 404)·응답 내용).

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
npm run db:migrate   # drizzle/0000_*.sql + 0001_triggers.sql (+ 역할 백필, system_admin 0명이면 경고)
npm run db:seed      # request_types / users / sla_policy / holidays (system_admin 0명이면 실패)
npm run db:smoke     # seq 생성·상태이력·뷰 조회 검증
npm run test:bootstrap  # 별도 임시 DB에서 위 순서를 재현해 system_admin >= 1을 검증(회귀 테스트)
```

enum 값 변경 필요 시 drizzle 파일 전체 재생성 후 DB 초기화.

**교훈 1**: `ALTER TYPE ... ADD VALUE`로 추가한 enum 값은 같은 트랜잭션 안에서 사용(SELECT/UPDATE 등)할 수 없다. drizzle-orm 마이그레이터(`drizzle-orm/node-postgres/migrator`)는 대기 중인 모든 마이그레이션 파일을 단일 트랜잭션으로 묶어 실행하므로, 값 추가와 그 값을 쓰는 데이터 이전을 파일만 나눠서는 우회할 수 없다 — **값 추가는 마이그레이션, 그 값을 쓰는 데이터 이전은 `migrate()` 완료(트랜잭션 커밋) 후 실행되는 백필**(예: `server/src/db/backfill-roles.ts`, `server/src/db/migrate.ts`에서 호출)로 분리한다.

**교훈 2**: 위 백필은 `migrate.ts`가 `npm run db:migrate`(= 배포)마다 호출한다. 백필이 조건절(`WHERE role='viewer'` 등)만으로 멱등을 흉내 내면, 그 조건이 "이메일 == 특정 값"처럼 사용자가 이후에 임의로 바꿀 수 있는 값을 대상으로 할 때 문제가 생긴다 — 관리자가 화면에서 역할을 바꿔도 다음 배포에서 조건이 다시 참이 되어 백필이 그 값을 조용히 덮어쓴다. 그래서 백필은 **적용 여부 자체를 별도 이력 테이블(`role_backfill_history`, `server/drizzle/0006_role_backfill_history.sql`)에 원자적으로 기록**하고, 이미 적용됐으면(= 이력에 키가 존재하면) 대상 조건과 무관하게 무조건 스킵한다. "재실행해도 안전"(idempotent)과 "최초 1회만 실행"(one-shot)은 다른 요구사항이며, 이후 사람이 수정할 수 있는 데이터를 다루는 백필은 후자를 만족해야 한다.

**교훈 3**: "최초 1회만 실행"(교훈 2)과 "깨끗한 DB에서 항상 성립해야 하는 불변조건"은 또 다른 문제다. `seed.ts`가 한동안 `juhuikim@baeoom.com`을 `role='system'`으로 삽입했는데, 공식 배포 순서(`db:migrate` → `db:seed`)를 빈 DB에 그대로 따르면: (1) `db:migrate`의 백필이 아직 비어 있는 `users`에 대해 0행 UPDATE를 실행하고도 `role_backfill_history` 마커는 정상 claim·커밋 — "최초 1회" 규칙을 정확히 지켰지만, (2) 뒤이은 `db:seed`가 `system`으로 juhuikim을 삽입 — 이후 백필은 영원히 스킵되므로 **`system_admin`이 0명으로 고정**된다. `canManageAccounts`(=system_admin 전용)로 게이트된 `PATCH /api/users/:id`·조직도 import가 이 상태를 앱 안에서 복구할 방법을 제공하지 않아 DB 직접 SQL 없이는 회복 불가능했다. 교훈: **부트스트랩이 만들어야 하는 불변조건("관리자 ≥ 1명")은 백필의 멱등성/일회성 보장과 별개로, 그 불변조건이 실제로 성립하는 시점(여기서는 seed 완료 후) 직후 명시적으로 검증**해야 한다 — `seed.ts`는 `system_admin` 카운트가 0이면 실패(`process.exit(1)`)하고, `migrate.ts`는 (seed 이전 시점이라 0이 정상일 수 있으므로) 경고만 남긴다(`server/src/db/admin-check.ts`). 회귀 테스트 `server/scripts/test-bootstrap-clean-db.ts`(`npm run test:bootstrap`)는 같은 Postgres 서버 위에 임시 DB를 만들어 `db:migrate`+`db:seed`를 그대로 재현하고 `system_admin >= 1`을 단언한다.

**교훈 4**: 채번 트리거 `gen_seq()`(접수번호 `YYMMDD-NN`)가 자기영속형 장애를 두 번 냈다 — 둘 다 "그 날짜(KST)가 끝날 때까지 그 날의 모든 접수가 500으로 실패"하는 패턴이었다.
- **0008**: 원래 구현은 `count(*)+1`로 다음 번호를 계산했다. 그 날짜의 중간 행이 하나라도 삭제되면 번호열에 갭이 생기고, `count(*)+1`이 계산한 번호가 이미 존재하는 seq와 충돌(unique violation)해 접수가 500이 됐다. 재시도해도 `count(*)`는 그대로라 같은 번호를 다시 계산하므로 스스로 복구되지 않았다. `max(split_part(seq,'-',2)::int)+1`(그 날짜에 실제로 존재하는 마지막 번호 다음)로 교체해, 중간에 갭이 있어도 항상 충돌 없는 다음 번호를 계산하도록 고쳤다.
- **0009**: 0008 배포 후에도 같은 패턴의 장애가 남아 있었다 — Postgres의 `lpad(str, len, fill)`은 `str`이 `len`보다 길면 왼쪽 패딩이 아니라 결과를 `len` 길이로 **잘라낸다**(`lpad('100', 2, '0')` → `'10'`, 오른쪽 버림). 어떤 날짜에 99건이 쌓이면 100번째 접수는 `n=100` → `lpad(...)`가 `'10'`으로 잘라 `seq='YYMMDD-10'`이 되어 이미 존재하는 10번째 seq와 충돌 → 500. 재시도해도 `max(split_part(...))`는 여전히 99이므로 `n`은 계속 100으로 계산돼 0008이 막으려던 것과 정확히 같은 자기영속형 장애가 재발했다. `case when n < 100 then lpad(n::text, 2, '0') else n::text end`로 교체해 100 이상부터는 자릿수가 자연스럽게 늘어나도록 고쳤다.
- 두 수정 모두 동시 접수 직렬화(`pg_advisory_xact_lock(hashtext('req_seq_' || d))`)는 그대로 유지한다 — 문제는 채번 계산식이었지 락이 아니었다. forward-only 원칙에 따라 0001이 만든 함수를 `create or replace`로, 그다음 0008을 다시 `create or replace`로 교체했다(이미 적용된 파일은 편집하지 않음). `schema.sql`도 최종 정의로 갱신했다.
- 회귀 테스트(`server/scripts/test-api-write.ts`, `npm run test:api-write`): (1) 갭 재현 — 3건 접수 후 중간 건 삭제, 다음 접수가 성공하고 기존 seq와 충돌하지 않는지 확인. (2) 99건 시드 후 100번째 접수가 성공하고 `seq`가 3자리(`YYMMDD-100`)인지, unique 충돌이 없는지 확인.
