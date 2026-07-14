---
title: 역할 모델 정교화 (6역할 · 능력 기반 권한)
last_updated: 2026-07-13
status: Active
owner: 시스템팀
diataxis: explanation
ssot_for: 역할 정의 · 역할별 권한 매트릭스 · 열람 범위 규칙
related: docs/reference/requirements.md, docs/reference/db-schema.md
---

# 역할 모델 정교화

## 배경

현재 역할은 `staff` · `system` · `viewer` 세 가지다(`server/src/db/schema.ts:7`). 권한이 `system` 하나에 뭉쳐 있어 다음 문제가 있다.

1. **처리자와 관리자가 구분되지 않는다.** 요청을 처리하는 시스템팀 팀원이 계정 관리 화면에서 남의 역할을 바꿀 수 있다(`server/src/routes/users.ts:16,43,127`은 `isSystem`만 확인).
2. **중간 열람 범위가 없다.** 팀장이 자기 부서 요청을, 원장이 자기 기관 요청을 보려면 전체를 보는 `viewer`를 줘야 한다. 범위 제한 수단이 없다.
3. **권한 판정이 역할 이름에 직접 묶여 있다.** 라우트 전반이 `isSystem()`을 직접 호출하므로 역할이 늘면 호출부를 전부 찾아 고쳐야 한다.

## 목표

- 조직 구조(팀원 · 팀장 · 원장 · 시스템팀 팀원 · 시스템팀 팀장 · 실장/대표)를 역할로 표현한다.
- 권한을 **열람 범위 · 처리 · 관리** 세 축으로 분리한다.
- 권한 판정을 능력(capability) 함수로 추상화해, 역할이 늘어도 호출부를 건드리지 않게 한다.

## 비목표

- 공개범위(`private`/`dept`/`function`/`org`/`shared`) 모델 변경. 요청자가 지정하는 공개범위는 그대로다.
- 요청별 개별 권한 부여(ACL). 역할과 소속으로만 판정한다.
- 담당자(`assignee_id`)를 열람 근거로 삼는 것. 담당자는 시스템팀이므로 이미 전체를 본다.

---

## 1. 역할 정의

| 역할 (내부값) | 조직상 대상 |
|---|---|
| `staff` | 요청자 — 일반 팀원 |
| `dept_monitor` | 부서 모니터링 관리자 — 팀장 |
| `org_monitor` | 기관 모니터링 관리자 — 원장 |
| `system` | 시스템팀 담당자 — 시스템팀 팀원 |
| `exec` | 경영진 — 실장 · 대표 |
| `system_admin` | 시스템팀 관리자 — 시스템팀 팀장 · 별도 admin |

## 2. 권한 매트릭스

| 역할 | 요청 열람 범위 | 처리(배정·상태·영향도) | 공개 코멘트 | 내부 메모 | CSAT 열람 | 통계 대시보드 | 계정·역할 관리 |
|---|---|---|---|---|---|---|---|
| `staff` | 본인 + 공개범위 | ✗ | ✓ | ✗ | 본인 요청에 작성 | ✗ | ✗ |
| `dept_monitor` | 본인 + 공개범위 + **자기 부서** | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ |
| `org_monitor` | 본인 + 공개범위 + **자기 기관** | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ |
| `system` | 전체 | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| `exec` | 전체 | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ |
| `system_admin` | 전체 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

- **내부 메모는 시스템팀(담당자·관리자) 전용.** 경영진·모니터링 관리자에게도 보이지 않는다. 시스템팀이 내부 판단·디버그 로그를 솔직히 남길 수 있어야 하기 때문이다. 기존 규칙(`canSeeComment`: 내부메모는 시스템팀 또는 작성자)을 유지한다.
- **모니터링 관리자와 경영진은 쓰기가 코멘트뿐이다.** 상태·배정·영향도·필드 편집은 전부 불가.
- CSAT는 요청 상세에 이미 표시되는 값이므로, 요청을 볼 수 있으면 CSAT도 본다. 별도 게이트를 두지 않는다.

## 3. 열람 범위 규칙

모니터링 범위는 **본인 계정의 소속에서 도출**한다. 별도 매핑 테이블을 만들지 않는다.

| 역할 | 추가로 보이는 요청 |
|---|---|
| `dept_monitor` | 요청자의 `org_affil`과 `dept_function`이 **모두** 본인과 같은 요청 |
| `org_monitor` | 요청자의 `org_affil`이 본인과 같은 요청 |
| `system` · `system_admin` · `exec` | 전체 |

`request_view`에 이미 `requester_org` · `requester_function`이 있으므로 뷰 변경 없이 `visibilityFilter`의 WHERE 절만 확장한다.

본인의 `org_affil`이나 `dept_function`이 null인 모니터링 관리자는 **추가 범위를 얻지 못한다**(null 매칭 금지). 기존 `visibilityFilter`가 null을 다루는 방식과 같다 — 소속이 비어 있는 계정에 조직 전체가 열리는 사고를 막는다.

## 4. 능력 기반 권한 판정

`server/src/authz.ts`에 능력 함수를 세우고, 라우트는 역할 이름 대신 능력을 묻는다.

| 함수 | 참인 역할 | 쓰이는 곳 |
|---|---|---|
| `canProcess(u)` | `system`, `system_admin` | 배정 · 상태 전이 · 영향도 · 필드 편집 · 내부메모 작성 |
| `canManageAccounts(u)` | `system_admin` | `/api/users` 조회·수정, 조직도 import |
| `canSeeDashboard(u)` | `system`, `system_admin`, `exec` | `/api/dashboard/metrics` |
| `canSeeInternal(u)` | `system`, `system_admin` | 내부메모 열람(`canSeeComment` 내부에서 사용) |
| `canSeeAllRequests(u)` | `system`, `system_admin`, `exec` | `visibilityFilter` 전체 통과 |

기존 `isSystem` · `isViewerUp`은 제거한다. `isViewerUp`이 담당하던 "전체 열람"은 `canSeeAllRequests`로, "대시보드 접근"은 `canSeeDashboard`로 갈라진다 — 지금은 두 개념이 한 함수에 섞여 있어 경영진에게 통계만 주고 처리를 막는 구분이 불가능하다.

## 5. 데이터 이전

마이그레이션 한 개(`server/drizzle/0005_*.sql`)로 처리한다.

1. `user_role` enum에 `system_admin` · `dept_monitor` · `org_monitor` · `exec` 추가 (`ALTER TYPE ... ADD VALUE`).
2. 기존 `viewer` 사용자를 `exec`로 이전. `viewer`는 성격이 같다(전체 열람 + 통계, 쓰기 없음).
3. `juhuikim@baeoom.com`을 `system_admin`으로 승격. **다른 `system` 사용자는 담당자로 남긴다.** 전원 승격하면 처리자·관리자를 나눈 의미가 사라진다.
4. `users` · `org_directory`의 `role` 기본값은 `staff` 유지.

`viewer` enum 값 자체는 삭제하지 않는다. Postgres는 enum 값 제거를 지원하지 않고, 이 프로젝트는 forward-only 마이그레이션 원칙을 따른다(CLAUDE.md §2). 코드에서 더 이상 부여하지 않는 것으로 폐기한다.

이후 역할 변경은 **계정 관리 화면**에서 한다. 마이그레이션에 사람을 더 넣지 않는다.

## 6. 화면 변경

**계정 관리(`/accounts`)** — `system_admin` 전용. 역할 select에 6개 역할을 한국어 라벨로 노출한다(요청자 · 부서 모니터링 관리자 · 기관 모니터링 관리자 · 시스템팀 담당자 · 경영진 · 시스템팀 관리자). 서버도 `canManageAccounts`로 막으므로 화면을 숨기는 것만으로 끝내지 않는다.

**메뉴(`src/components/TopNav.tsx`)** — 메뉴 항목의 `roles` 배열을 새 역할로 갱신한다.

| 메뉴 | 보이는 역할 |
|---|---|
| 요청 접수 · 내 요청 | 전 역할 |
| 관리 보드 | `system`, `system_admin` |
| 통계 | `system`, `system_admin`, `exec` |
| 계정 관리 | `system_admin` |

**내 요청(`/requests/mine`)** — 이미 `내 요청 / 부서·공유 요청` 두 탭이 있고, 두 번째 탭은 "내가 볼 수 있으나 내가 낸 건 아닌 요청"을 서버 `visibilityFilter`로 가져온다. 열람 범위가 넓어지면 이 탭이 그대로 모니터링 목록이 된다. **새 탭·새 목록 로직을 만들지 않고 라벨만 역할에 맞게 바꾼다.**

| 역할 | 두 번째 탭 라벨 |
|---|---|
| `staff` | 부서·공유 요청 (현행) |
| `dept_monitor` | 우리 부서 요청 |
| `org_monitor` | 우리 기관 요청 |
| `system` · `system_admin` · `exec` | 전체 요청 |

**요청 상세** — 관리 패널(`AdminPanel`)은 `canProcess`인 역할에게만 보인다. 내부 메모 작성 폼도 마찬가지다. 경영진·모니터링 관리자에게는 공개 코멘트 폼만 보인다.

## 7. 오류 처리

권한 없는 접근은 서버가 403으로 거부한다. 화면 숨김은 편의일 뿐 권한 경계가 아니다 — 모든 능력 검사는 서버에서 한다.

`viewer`처럼 폐기된 역할이 남아 있는 계정은 능력 함수가 전부 false를 반환해 `staff`와 같은 최소 권한으로 동작한다. 알 수 없는 역할에 권한을 열어주지 않는다.

## 8. 테스트

| 대상 | 방식 |
|---|---|
| 능력 함수 | 6역할 × 5능력 = 30조합을 표로 단언 (기존 `server/scripts/test-authz.ts` 확장) |
| 열람 범위 | `dept_monitor`는 같은 부서 요청만, `org_monitor`는 같은 기관 요청만 보이는지. 소속이 null이면 추가 범위 없음 |
| 처리 차단 | `exec`·`dept_monitor`가 상태 변경·배정·영향도 API 호출 시 403 |
| 계정 관리 차단 | `system`(담당자)이 `PATCH /api/users/:id` 호출 시 403 — **이번 변경의 핵심 회귀** |
| 내부 메모 | `exec`·`dept_monitor`에게 내부메모가 응답에서 제외되는지 |
| 기존 회귀 | `test:authz` · `test:api` · `test:dashboard` |

## 9. 문서 동기화

`docs/reference/db-schema.md`(user_role enum · 역할별 권한), `docs/reference/requirements.md`(역할·권한·화면 노출), `CHANGELOG.md`.
