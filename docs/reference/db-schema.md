---
title: DB 스키마 설계 (Supabase)
last_updated: 2026-07-11
status: Active
owner: 시스템팀
diataxis: reference
ssot_for: 데이터베이스 스키마 · RLS · 트리거 · 뷰
source_of_truth: schema.sql
---

# 업무요청 접수·관리 사이트 — DB 스키마 설계 (Supabase)

React + Supabase + Vercel 독립 구축 기준. `schema.sql`을 Supabase SQL Editor에 그대로 실행하면 테이블·권한·트리거·뷰가 한 번에 생성됩니다.

> 이 문서는 첨부 원본의 인코딩을 정리해 복원한 사본입니다.

---

## 1. 테이블 구조

| 테이블 | 역할 | 핵심 |
| --- | --- | --- |
| `profiles` | 직원 계정·역할·소속 | `auth.users` 확장. role = staff/system/viewer |
| `request_types` | 요청 유형 코드 + 주간보고 매핑 | 오류/기능요청/데이터추출/파일변경 4종 |
| `requests` | 접수 원장 | 기존 GAS 접수대장의 이관 |
| `request_comments` | 처리 코멘트 | 요청자↔담당자 소통 |
| `request_status_history` | 상태 변경 이력 | 리드타임·재작업 근거 (자동 기록) |
| `request_attachments` | 첨부 메타 | Supabase Storage 연동 |

관계: `requests` 1→N `comments` / `history` / `attachments`, `requests.parent_request_id`로 하위건 자기참조 연결.

`profiles`의 `dept`(부서)·`org_affil`(소속기관)을 두어 공개범위 판정에 사용하고, 접수 시점 요청자 `requests.requester_dept`·`requester_org`에 스냅샷으로 고정합니다.

---

## 2. 유형 4종 확정

4가 확정된 유형 4종을 그대로 씁니다: **오류 / 기능요청 / 데이터추출 / 파일변경**. 코드테이블(`request_types`)이라 유형 추가·이름 변경을 데이터로만 처리할 수 있습니다.

**접수번호**: `YYMMDD-NN` 일자별 연번 (예: 260711-03). 동시 접수 시 번호 중복이 없도록 advisory lock 처리.

---

## 3. 상태 흐름

`접수 → 확인 → 진행중 → 검수대기 → 재작업 → 완료` (+ `보류` / `반려` / `이관`)

상태를 바꾸면 트리거가 자동으로:
- `request_status_history`에 변경 이력 기록
- `완료` 진입 시 `completed_at`·`first_completed_at`(최초 1회) 세팅
- `완료→재작업` 되돌림 시 `completed_at` 해제 + `rework_count` +1

→ GAS에서 키워드로 추적하던 재작업·1차/최종완료를 **상태 전이로 정확히** 잡습니다.

---

## 4. 계산 필드 (뷰 `request_view`)

원장 대신 `request_view`를 조회하면 아래가 계산됩니다.

- `first_lead_days` / `final_lead_days` : 1차·최종 리드타임(일)
- `due_status` : 기한초과 / 임박 / 지연 / 여유 / (완료·반려·보류·이관은 상태 그대로)
- `type_label`, `weekly_category` : 유형·주간보고 조인 결과

기한상태는 조회 시점 `current_date` 기준으로 계산되므로, GAS처럼 별도 일괄 재계산이 필요 없습니다.

---

## 5. 권한 (RLS)

**역할 3단계**

| 역할 | requests 읽기 | 등록 | 상태·담당 변경 | 삭제 |
| --- | --- | --- | --- | --- |
| staff(일반직원) | 본인 + 공개범위 해당분 | 본인 명의로 | 불가 | 불가 |
| system(시스템팀) | 전체 | 가능 | 가능 | 가능 |
| viewer(실장 등) | 전체 | 불가 | 불가 | 불가 |

**공개범위 (요청자가 접수 시 선택, 시스템팀 수정 가능, 기본값 `dept`)**

| visibility | 볼 수 있는 사람 |
| --- | --- |
| private | 본인 + 시스템팀 |
| dept | 본인 + 같은 부서 + 시스템팀 |
| org | 본인 + 같은 기관 + 시스템팀 |
| shared | 전 직원 |

- "같은 부서/기관" 판정은 `profiles.dept` / `profiles.org_affil` 기준.
- 접수 시 요청자 소속을 `requester_dept` / `requester_org`에 **스냅샷**으로 저장 → 요청자가 부서를 옮겨도 접수 당시 기준으로 공개범위가 유지됩니다.
- 코멘트·첨부·이력 접근은 `can_see_request()` 헬퍼로 requests와 동일 판정.
- **요청 내용 수정**: 요청자는 `접수` 상태일 때만 본인 요청을 수정 가능(본문·공개범위·희망일 정정). 처리가 시작되면 잠기고 코멘트로만 소통. (※ 이건 요청 데이터 수정이며, 아래 계정 정보 수정과 별개)
- **profiles 수정**: 본인 자가수정 불가. 이름·역할·부서·기관 모두 시스템팀(계정 관리 페이지)만 수정.
- **부서/기관 변경 시 과거 요청 불변**: 시스템팀이 누군가의 dept·org_affil을 바꿔도, 이미 접수된 요청의 `requester_dept`·`requester_org` 스냅샷값은 유지 → 변경은 이후 신규 요청부터만 반영.

## 5-1. 계정 관리 페이지 (5번째 화면)

시스템팀 전용. 직원 목록(profiles) 조회 + 역할(staff/system/viewer)·부서·소속기관 수정. RLS `prof_update_admin` 정책이 이를 지지. 최초 인원은 조직도 기준으로 50명 일괄 수동 입력(CSV import 또는 관리 화면에서 순차 입력).

---

## 6. 인증

Supabase Auth Google OAuth. 가입 시 `profiles` 자동 생성.
`@baeoom.com`·`@baeron.com` 도메인 제한은 Auth 설정(허용 도메인) 또는 가입 트리거에서 차단 로직 추가로 처리 (2차 예정).

---

## 7. 메일 접수과의 통합 (전환기)

- `source` = web / email 로 접수 경로 구분.
- 기존 GAS 수집은 유지하되 저장 대상을 시트 대신 이 DB로 돌리면(`source='email'`, `source_thread_id`로 중복 방지), 웹 접수와 메일 접수가 한 원장에 합류합니다.
- `is_locked`는 메일 접수 건의 자동추적 시 사람이 보정한 값을 보호하는 용도(GAS의 잠금과 동일 개념).

---

## 8. 검토 반영 내역 (2차)

1. **[보안] role 자기승격 차단** — 일반직원이 본인 role을 system으로 올릴 수 없는 정책 구멍 수정.
2. **계정 관리 정책 추가** — 시스템팀이 전 직원의 role·dept·org_affil을 수정 가능(`prof_update_admin`) → 계정 관리 페이지 지원.
3. **접수번호 동시성** — count 방식의 중복 가능성을 advisory lock으로 방지, 형식 `YYMMDD-NN`.
4. **본인 건 수정** — `접수` 상태일 때만 요청자 수정 허용.
5. **첨부 삭제 정책** — 업로드 본인 또는 시스템팀.
6. **메일 접수 경로 명시** — GAS/서버는 service_role 키로 insert(RLS 우회), `source='email'` + `source_thread_id`로 중복 방지.
7. 주간보고 매핑 제외.

## 8-1. 남은 결정 (요구사항 단계에서)

- 상태·담당 필드를 요청자가 못 바꾸게 하는 컬럼 수준 제어는 앱단에서 처리(RLS는 행 단위라 한계). 더 엄격히 하려면 상태변경 전용 RPC 함수로 전환 가능.
- 이관 시 이관처 기록 방식(코멘트로 vs 전용 필드).

---

## 9. 다음 단계

이 스키마 확정 후 → 요구사항 정의서(화면별 기능) → 화면 와이어프레임 → 개발. 스키마부터 잡았으니 프론트에서 바로 Supabase 클라이언트로 붙일 수 있습니다.
