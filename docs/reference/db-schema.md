---
title: DB 스키마 설계 (Drizzle + Postgres)
last_updated: 2026-07-11
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
| `users` | 직원 계정·역할·소속 | role = staff / system / viewer |
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
| `user_role` | staff / system / viewer |

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

RLS 없음 (Fastify 백엔드에서 역할 판정).

| 역할 | requests 읽기 | 등록 | 상태·담당 변경 | 삭제 |
| --- | --- | --- | --- | --- |
| staff | 본인 + 공개범위 해당분 | 본인 명의로 | 불가 | 불가 |
| system | 전체 | 가능 | 가능 | 가능 |
| viewer | 전체 | 불가 | 불가 | 불가 |

**공개범위(visibility)**

| visibility | 볼 수 있는 사람 |
| --- | --- |
| private | 본인 + system |
| dept | 본인 + 같은 부서 + system |
| function | 본인 + 같은 function + system |
| org | 본인 + 같은 기관 + system |
| shared | 전 직원 (shared_targets 참조) |

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
