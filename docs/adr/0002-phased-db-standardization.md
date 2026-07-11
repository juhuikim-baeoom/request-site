# 0002. DB 표준의 점진(forward-only) 적용 로드맵

## 상태

승인됨 (2026-07-11)

## 맥락

채택한 DB 표준(`docs/standards/01`, `02`, `03`)과 현재 운영 스키마(`schema.sql`) 사이에 다음 간극이 있다.

| 영역 | 표준 요구 | 현행 | 위험도 |
|------|-----------|------|--------|
| 코드값 네이밍 | `SCREAMING_SNAKE_CASE` 영문 | 한글 enum(`접수`,`배움`…) | 높음 — 프론트·RLS·트리거 전면 의존 |
| ENUM 방식 | 네이티브 ENUM 지양 → `VARCHAR+CHECK`/lookup | `create type ... as enum` 6종 | 중간 |
| 예약어 회피 | `status`,`name`,`order` 등 단독 금지 | `status`,`name`,`org`,`source`,`body` 단독 컬럼 | 높음 |
| 감사 컬럼 | 전 테이블 `created_at`/`updated_at`, soft-delete | `requests`만 `updated_at`, soft-delete 없음 | 중간 |
| PK 전략 | 프로젝트 내 통일 | `profiles.id`=uuid / `requests.id`=bigint 혼재 | 중간 |
| 테이블 접두사 | 목적 기반(`t_core_` 등) | 접두사 없음 | 낮음 — 테이블 8개, 불필요 |
| 마이그레이션 | 버전 파일 forward-only | 단일 `schema.sql` 통짜 | 중간 |

현행 값을 지금 개명하면 프론트엔드(요청 폼·보드·대시보드), RLS 정책, 트리거, `request_view` 뷰가 동시에 깨진다. 표준 자체도 "이미 적용된 것은 편집 금지, forward-only"를 원칙으로 한다.

## 결정

**즉시 개명하지 않는다.** 표준은 신규 작업에 적용(going-forward)하고, 기존 스키마 표준화는 아래 단계로 forward-only 진행한다. 각 단계는 착수 시점에 별도 마이그레이션 + 필요 시 후속 ADR로 처리한다.

- **0단계 (완료)**: `schema.sql`을 마이그레이션 베이스라인으로 고정. 이후 변경은 `supabase/migrations/`의 버전 파일로만.
- **1단계 (즉시 적용, 저위험)**: 신규 테이블/컬럼은 `CLAUDE.md` §2를 준수(영문 코드값·예약어 회피·감사컬럼·soft-delete).
- **2단계 (중위험)**: 신규 append 테이블부터 `created_at`/`updated_at`/`deleted_flag` 표준 세트 도입. 기존 테이블은 컬럼 추가(비파괴)로 감사 컬럼 보강.
- **3단계 (고위험, 대규모)**: 한글 enum → 영문 코드값 전환. lookup 테이블 + 코드 매핑 + 프론트 표시명 분리(값=영문, 라벨=한글)로 접근. 전환기에는 뷰/제너레이티드 컬럼으로 구·신 값 병행. 착수 전 전용 ADR 작성.

### 목표 코드값 매핑(3단계 참고, 확정본 아님)

| 도메인 | 현행(한글) | 목표(영문) |
|--------|-----------|-----------|
| status | 접수/확인/진행중/검수대기/재작업/완료/보류/반려/이관/철회 | RECEIVED/ACKED/IN_PROGRESS/REVIEW_PENDING/REWORK/DONE/ON_HOLD/REJECTED/TRANSFERRED/WITHDRAWN |
| org | 배움/배론/허브/공통 | BAEOOM/BAERON/HUB/COMMON |
| priority | 긴급/보통/낮음 | URGENT/NORMAL/LOW |

## 고려한 대안

- **즉시 전면 표준화**: 운영 중단·회귀 위험 과다. 기각.
- **영구 현행 유지**: 표준 채택(ADR-0001)의 실익을 신규 작업에 한정. 부분 채택으로 절충.

## 결과

- 장점: 운영 안정성 유지하면서 신규 작업부터 표준 수렴. 각 단계가 독립적이라 위험을 나눠 감당.
- 단점: 구·신 규약이 당분간 공존. 이 ADR과 `CLAUDE.md` 코드값 사전이 혼선을 막는 SSOT 역할.
- 후속: 3단계 착수 시 전용 ADR로 매핑 확정 및 전환 절차(뷰 병행·백필·프론트 라벨 분리) 명시.
