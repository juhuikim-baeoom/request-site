---
title: 요구사항 정의서 v1
last_updated: 2026-07-14
status: Active
owner: 시스템팀
diataxis: reference
ssot_for: 화면별 기능 요구사항 · 역할별 권한 · 비기능 요구사항
---

# 업무요청 접수·관리 사이트 — 요구사항 정의서 v1

배움·배론·허브 3개 기관 소속 직원의 업무요청을 웹으로 접수하고, 시스템팀이 진행 관리하는 사이트. 기존 Gmail 접수의 분류 불일치·자동추적 한계를 접수 단계 구조화로 해결한다.

> 이 문서는 첨부 원본의 인코딩을 정리해 복원한 사본입니다. 원본이 있으면 교체하세요.

---

## 0. 개요

| 항목 | 내용 |
| --- | --- |
| 스택 | React(Vite) + Supabase(Auth·DB·Storage) + Vercel 배포 |
| 에디터 | 다라라JS 등 오픈소스 에디터 차용 (요청 상세작성도) |
| 인증 | Supabase Auth · Google OAuth · @baeoom.com/@baeron.com 도메인 제한 |
| 역할 | staff(요청자) / dept_monitor(부서 모니터링 관리자) / org_monitor(기관 모니터링 관리자) / system(시스템팀 담당자) / exec(경영진) / system_admin(시스템팀 관리자) — 폐기값 viewer(신규 부여 금지, 기존 행 호환용) |
| 대상 | 전 직원 약 50명 |
| DB | 별도 Supabase (사내 MSSQL 미사용). 스키마는 `schema.sql` 참조 |

**요청 속성(공통 데이터 모델)**
- 기관: 배움 / 배론 / 허브 / 공통
- 유형: 오류 / 기능요청 / 데이터추출 / 파일변경
- 긴급도(urgency): 높음 / 보통 / 낮음 — 요청자 입력 (우선순위 대체)
- 우선순위(priority_level): P1~P4 — 배정 시 시스템팀이 설정 (요청자 미입력)
- 상태: 접수 → 진행중 → 완료 (+보류/반려/철회)
- 공개범위: private / dept / function / org / shared (기본 dept)
- 접수번호: YYMMDD-NN (자동)
- intake_detail: 유형별 구조화 필드(jsonb)

---

## 1. 공통 사항

- **로그인**: Google 로그인 단일 지원. 미인증 시 로그인 화면으로. 허용 도메인 외 계정은 차단.
- **권한 모델(6역할, 능력 기반)**: 라우트·화면은 역할 이름 대신 능력(capability)을 묻는다
  (`server/src/authz.ts` · 클라이언트 사본 `src/lib/permissions.ts`). 역할 → 조직상 대상:
  `staff` 요청자(팀원) · `dept_monitor` 부서 모니터링 관리자(팀장) · `org_monitor` 기관
  모니터링 관리자(원장) · `system` 시스템팀 담당자(팀원) · `exec` 경영진(실장·대표) ·
  `system_admin` 시스템팀 관리자. 폐기값 `viewer`는 모든 능력이 false(최소 권한)이며
  신규 부여는 금지되지만 기존 행은 forward-only 원칙상 값 자체를 유지한다.

  | 능력 | 의미 | 허용 역할 |
  | --- | --- | --- |
  | `canProcess` | 배정·상태전이·영향도 조정·필드편집·내부메모 작성 | system · system_admin |
  | `canManageAccounts` | 계정·역할 변경, 조직도 import | system_admin |
  | `canSeeDashboard` | 통계 대시보드 열람 | system · system_admin · exec |
  | `canSeeInternal` | 내부메모 열람(본문 + 첨부파일) | system · system_admin |
  | `canSeeAllRequests` | 공개범위와 무관하게 전 요청 열람 | system · system_admin · exec |

  **열람 범위**: `canSeeAllRequests` 역할은 공개범위 무관 전체 열람. 모니터링 관리자는
  본인 소속에서 도출한 범위를 추가로 본다 — `dept_monitor` = 같은 기관+직무,
  `org_monitor` = 같은 기관 전체. 소속(org_affil/dept_function)이 null이면 추가 범위
  없음. 쓰기는 공개 코멘트만 가능하고 내부 메모는 볼 수 없다(`canSeeInternal` 아님).

- **역할별 메뉴 노출**
  - 전 역할(staff·dept_monitor·org_monitor·system·exec·system_admin): 접수 폼, 요청 목록
  - `canProcess`(system·system_admin): 상기 + 요청 처리 화면
  - `canSeeDashboard`(system·system_admin·exec): 상기 + 통계 대시보드
  - `canManageAccounts`(system_admin): 상기 + 계정 관리
- **상단 내비**: 로고, 메뉴, 로그인 사용자명·역할, 로그아웃.
- **반응형**: PC 우선, 접수 폼·요청 목록은 모바일에서도 사용 가능해야 함(외근·현장 접수 대비).
- **삭제 정책**: 요청 삭제는 시스템팀만. 일반적으로 삭제 대신 반려/보류 상태 사용 권장.

---

## 2. 화면 ① 접수 폼

**목적**: 직원이 업무요청을 구조화된 폼으로 제출
**접근**: 로그인한 전 직원(staff 이상)

**레이아웃 (2-페인 재설계 — 2026-07-12)**

- 셸: `grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]`, 상한 `max-w-[1600px]`.
- ≥lg: 2-페인(작성 컬럼 + 속성 사이드바 340px sticky). <lg: 단일 컬럼 스택 + 모바일 하단 고정 제출바.
- 작성 컬럼: 유형(카드) → 유형별 상세(조건부) → 제목 → 상세내용(에디터 슬롯) → 첨부(드롭존).
- 속성 사이드바: 긴급도·희망완료일(2열) → 공개범위 → 공유대상(기본 접힘, 선택 수 뱃지) → 제출.

**입력 요소**

| 필드 | 형태 | 필수 | 비고 |
| --- | --- | --- | --- |
| 기관 | 로그인 계정 소속기관 자동 설정 | ✔ | 직접 선택 불가 |
| 유형 | **카드형 네이티브 radio** (아이콘+라벨+힌트) | ✔ | **타입 우선**: 유형 선택 후 해당 타입 전용 필드 노출. `TYPE_ICON` 상수 맵 |
| 유형별 필수 정보 | 아래 표 참조 | ✔ | intake_detail 객체로 서버 전송. 오류 시 aria-invalid+aria-describedby |
| 제목 | 텍스트 | ✔ | |
| 상세 내용 | **에디터 슬롯** (`BodyEditorSlot.tsx`, 잠정 textarea · plain text) | ✖ | 향후 서상연 팀장 에디터로 교체 예정. 슬롯 props: value/onChange/disabled/ariaLabelledby/id/minHeight |
| 희망완료일 | 날짜 선택 | ✔ | 사이드바 2열 배치 |
| 긴급도 | 드롭다운(높음/보통/낮음) | ✔ | 기본 보통. 사이드바 2열 배치 |
| 공개범위 | 드롭다운(본인만/부서만/직무 전체/기관 전체/전 직원) | ✔ | 기본 부서만. 사이드바 |
| 공유대상 | 직무 단위·세부부서 체크박스 | ✖ | 기본 접힘 "+ 공유대상 추가" 토글, 접어도 선택 보존, 접힘 시 선택 수 뱃지 |
| 첨부파일 | **드롭존** (드래그드롭 + 클릭 선택 + 파일 칩) | ✖ | 파일당 20MB, 서버 `@fastify/multipart` 제한과 동일 |

**유형별 intake_detail 필수 키**

| 유형 | 필수 키 | 설명 |
| --- | --- | --- |
| error | screen_url, reproduce, occurred_at | 발생 화면 URL / 재현 방법 / 발생 시각 |
| feature | purpose, expected_effect | 사용 목적 / 기대 효과 |
| data | items, period, format | 필요 항목 / 기간 / 형식 |
| file | target_file, change_detail | 대상 파일 / 변경 내용 |

**동작**
- 제출 시 requests insert → 접수번호 자동 발급 → 접수 완료 안내(번호 표시) → 요청 목록으로 이동.
- 요청자(requester_id)는 로그인 계정으로 자동 설정. 접수 시점 요청자 부서·기관이 스냅샷 저장됨.
- 첨부는 requests 생성 후 개별 업로드 → request_attachments 기록. **부분 실패 시 요청 중복 생성 없이** 실패 파일만 재시도(기존 request id로 POST). `useCreateRequest` 반환: `{ id, seq, failedFiles: File[], totalFiles: number }`. 완료 화면에서 "첨부 N건 중 M건 실패"에 `totalFiles`(N)·`failedFiles.length`(M) 사용.
- **제출 검증 실패 시** 첫 오류 필드로 포커스+scrollIntoView 이동.
- **제출 중** 버튼 disabled + 입력 잠금(중복 제출 방지).

---

## 3. 화면 ② 요청 목록

**목적**: 요청자가 본인 및 볼 수 있는 요청의 진행 상황 확인
**접근**: staff 이상 (공개범위 정책에 따라 노출)

**구성 (P5 재설계 — 2026-07-12)**

- **기본 저장뷰 "내 열린 요청"**: 진입 시 기본 필터 = 본인 탭 + 열린 상태(접수·진행중·보류). 필터 상태(tab/status/typeCode/org/sort/showClosed)를 직렬화 객체로 `localStorage('my_requests_view_v1')`에 자동 저장·복원.
- **탭**: 나의 요청 / (역할에 따라 라벨이 달라지는) 두 번째 탭 — `canSeeAllRequests`(system·system_admin·exec)는 "전체", `org_monitor`는 "우리 기관", `dept_monitor`는 "우리 부서", 그 외(staff)는 "공유받은 요청". 메뉴·제목은 장소("요청 목록"), 탭은 범위를 가리켜 같은 단어가 겹치지 않게 한다. 실제 열람 범위는 서버 `visibilityFilter`가 결정한다(§1 참조).
- **종결 포함 토글**: 기본 꺼짐(완료·반려·철회 제외) → 켜면 전체 상태 표시.
- **필터**: 상태(6종) · 유형 · 기관 · 정렬(최신순/기한 우선).
- **SLA/기한 컬럼**: `due_status` 기반 뱃지(색+텍스트+아이콘) + `resolution_due_at` 있으면 D-N / N일 초과 상대표기.
- **우선순위**: `priority_level`(P1~P4, PRIORITY_LEVEL_BADGE). null이면 "미정". 옛 `priority` 컬럼 미사용.
- **접근성**: 모든 뱃지 색+텍스트 병용. 표 헤더/셀 `scope` 속성. 버튼 `aria-pressed`, select `aria-label`.
- **모바일 카드 뷰**: `sm:` 미만에서 표 → 카드 레이아웃(접수번호·제목·상태·우선순위·기한·담당). Tailwind 반응형.

**상세 화면 (P4 DetailUI — 2026-07-12 기준, 관리 패널 추가 — 2026-07-13)**

- **통합 타임라인**: 상태변경 이력 + 코멘트(내부메모/공개) + 첨부를 시간순 한 피드로 병합. **단일 섹션 · 항목당 1행**(구분선 리스트): `유형 뱃지 · 내용(넘치면 말줄임, title에 전문) · 작성자 · 시각`. 내부메모 행은 amber 배경+뱃지로 시각 구분(요청자 화면엔 노출 안 됨).
- **코멘트 작성기** (`CommentComposer.tsx`): 토글 대신 **공개 코멘트(위) · 내부 메모(아래)를 상하로 나란히** 배치. 각각 독립 폼(본문 + 다중 파일첨부 + 자체 제출·오류 표시). 제출 시 POST comment → 반환 id로 comment_id 링크 업로드. 내부 메모는 `canSeeInternal`(system·system_admin)에게만 렌더링되며 **코드·로그 입력 전제**: monospace · 8행 · 줄바꿈 없음(`wrap=off`) · 맞춤법검사 off · Tab 들여쓰기(2칸, Esc 후 Tab은 포커스 이동 — 키보드 트랩 방지).
- **SLA 표시**: resolution_due_at 기준 due_status 뱃지 + 남은시간 상대표기(D-N/초과). 담당자·우선순위(priority_level) 표시.
- **관리 패널(`canProcess` 전용 — system·system_admin, `src/features/requests/AdminPanel.tsx`)**: 요약 영역 아래 담당자·상태·영향도 select. **담당자 후보는 `canProcess` 보유자만**(요청 처리 화면 `assigneeOptions`와 동일 규칙 — canProcess가 없는 사용자를 배정하면 공개범위 필터가 assignee_id를 열람 근거로 쓰지 않아 본인이 못 보는 문제 방지). **단, 현재 담당자가 이 후보 목록 밖이어도(예: 배정 후 역할 변경) select 후보에 편입해 "(시스템팀 아님)" 표기로 노출한다** — 그래야 select value가 실제 담당자와 항상 일치한다(공용 헬퍼 `withCurrentAssignee`, `src/lib/constants.ts`; 요청 처리 화면 인라인 select와 동일 규칙 공유). 담당자는 `PATCH /api/requests/:id { assignee_id }`. **영향도 select 각 옵션은 선택 시 재산정될 우선순위를 함께 표시한다**(`derivePriorityPreview`로 계산, 서버 `derivePriority`와 동일 격자). 상태는 `ALLOWED_TRANSITIONS` 기준으로 불허 전이를 select에서 비활성화("(불가)" 표기)하며, 보류·반려로의 전이는 사유 입력 모달을 거친다. 영향도는 `PATCH /api/requests/:id/impact`(`canProcess` 전용, body `{ impact: 높음|보통|낮음 }`)로 조정하며 **종결(완료·반려·철회) 건은 미배정 여부와 무관하게 우선 400 `CLOSED`로 거부**하고, 종결이 아니면서 미배정인 건만 select 비활성+400 `NOT_ASSIGNED`로 거부한다(클라이언트 안내 문구·서버 검사 순서 동일 — 접수→반려/철회로 직행한 미배정 종결 건은 배정 자체가 불가능하므로 "배정 후 조정" 안내가 아닌 "종결" 안내를 표시). 성공 시 `priority_level`·`response_due_at`·`resolution_due_at`·`sla_policy_id`·`sla_response_breached`를 재산정하고 `assigned_at`·`first_response_at`·`status`는 보존한다(계산은 배정 API와 `server/src/services/sla-fields.ts`를 공유).
- **재작업 버튼**: `canProcess`(system·system_admin) & `status='완료'` → PATCH `{ status:'진행중', reason? }`. 사유 입력 선택.
- **요청자 액션**: `status='접수'`일 때 수정(title/body/urgency/desired_due) / 철회(PATCH `{ status:'철회' }`). 편집과 상태변경 분리(서버 400 회피). **필드 편집 권한**: `canProcess`(system·system_admin) 또는 (요청자 본인 && `status='접수'`)일 때 가능 — `canProcess` 보유자는 상태 무관하게 편집 가능하도록 확장됨. 철회 버튼은 `ALLOWED_TRANSITIONS`상 '접수' 상태에서만 노출. **`visibility`(공개범위)는 이 편집 폼에서 제외됐다** — 아래 "공유 범위 수정"으로 옮겨졌다. `PATCH /api/requests/:id`에 `visibility`를 보내면 400 `USE_SHARING_ENDPOINT`로 거부한다(권한 규칙이 다른 두 경로가 같은 컬럼을 쓰면 낮은 쪽이 우회로가 되기 때문). **긴급도(urgency) 편집 시 재산정**: urgency가 실제로 바뀌고 종결 상태가 아니면 두 경우로 나뉜다.
  - **배정된 건**(`impact`가 있음): `server/src/services/sla-fields.ts`의 `computeSlaFields`(배정·영향도 조정 API와 공유)로 `priority_level`·`response_due_at`·`resolution_due_at`·`sla_policy_id`·`sla_response_breached`를 함께 재산정한다. `assigned_at`·`first_response_at`·`status`는 보존.
  - **미배정 건**(`impact`가 없음, 요청자가 편집 가능한 유일한 창인 `status='접수'`가 대부분): `impact`가 없어 `priority_level`·`resolution_due_at`은 정할 수 없으므로, 요청 생성부와 동일한 `computeResponseDueAtForUrgency`(urgencyResponseLevel 기준)로 `response_due_at`만 새 긴급도 기준으로 재산정한다. `priority_level`·`sla_response_breached` 등은 건드리지 않는다.
  - **`sla_response_breached` 판정 기준**: 이미 응답이 이뤄진 건(`first_response_at` 존재)은 "응답 시각이 `response_due_at`을 넘겼는가"로, 아직 응답 전인 건은 "현재 시각이 `response_due_at`을 넘겼는가"로 판정한다(`computeSlaFields`의 `firstResponseAt` 인자). 오래된 건에서 기한 내 정상 응답을 마친 뒤 나중에 긴급도·영향도만 바꿔도 이 판정 덕분에 breached가 false로 유지된다.
- **공유 범위 수정**: 공개범위 뱃지 옆 "공유 범위 수정" 버튼(권한 있는 사람에게만 노출) → `SharingEditor` 패널(`src/features/requests/SharingEditor.tsx`)이 열린다. 같은 컴포넌트를 접수 폼(화면 ①)과 이 상세 화면이 공유한다. **권한**(`canChangeSharing`): `canProcess`(system·system_admin) 또는 **요청자 본인** — 상태와 무관하다(진행중·보류·완료·반려 등 종결 후에도 요청자가 바꿀 수 있다). 본문 편집(위 항목, `canProcess` 또는 요청자 본인 && `status='접수'`)보다 넓게 열려 있다 — 공유는 처리 내용을 바꾸지 않고 "누가 볼 수 있는가"만 바꾸기 때문이다. 공개범위와 공유 대상(직무·세부부서)을 `PUT /api/requests/:id/sharing`(body `{ visibility, shared_targets: [{ target_type, target_value }] }`) 한 번의 호출로 **전체 교체**한다. 입력 검증(`parseSharedTargets()`)은 접수 폼의 공유대상 입력과 동일한 서버 헬퍼를 공유하며, 잘못된 `target_type`/`target_value`·컨테이너 오류는 각각 400(`INVALID_TARGET_TYPE`/`INVALID_TARGET_VALUE`/`INVALID_SHARED_TARGETS`)으로 거부되고 중복 대상은 조용히 dedupe된다.
- **공유 변경 이력**: 누가 언제 공개범위를 바꾸고 어떤 대상을 추가·제거했는지 `request_sharing_history`에 남는다(서버가 기존 목록과 비교해 `added`/`removed`를 계산 — 클라이언트가 보낸 값은 신뢰하지 않음). 공개범위와 공유 대상이 둘 다 그대로면 이력을 남기지 않는다. 상세 화면의 통합 타임라인에 "공유변경" 행으로 상태변경·코멘트와 시간순으로 함께 표시된다. 이력은 독립 엔드포인트 `GET /api/requests/:id/sharing-history`로 조회한다(상태 이력·첨부와 같은 관례). 권한은 `canSeeRequest`(그 요청을 볼 수 있으면 이력도 볼 수 있다 — 내부메모처럼 별도로 좁히지 않음), 열람 권한이 없으면 404.
- **새로 공유된 사람들에게 알림은 보내지 않는다.** 공유 대상은 직무·부서 단위라 한 번 추가하면 대상 인원이 넓어 알림 스팸이 되기 때문이다.
- **CSAT**: 요청자 & `status='완료'` & 미제출 시 👍/👎 + 선택 코멘트 → POST /csat. 제출 후 결과 표시.
- **되돌아가기 목적지 분기**: 목록에서 상세로 들어올 때 진입 경로를 쿼리 파라미터로 넘긴다(요청 처리 화면 `?from=board`, 요청 목록 `?from=mine`). 상세 상단 링크는 이 값에 따라 "← 요청 처리"(`/board`) 또는 "← 요청 목록"(`/requests/mine`)으로 렌더링한다. 값이 없거나(알림 벨 진입 등) 알 수 없는 값, 또는 `from=board`인데 `canProcess`가 없으면 요청 목록으로 폴백한다. 요청 처리 화면 필터는 기존 localStorage 복원 로직으로 유지된다.

---

## 4. 화면 ③ 요청 처리 (시스템팀)

**목적**: 시스템팀이 전체 요청을 배정·진행 관리
**접근**: `canProcess`(system·system_admin)

**구성 (P3 BoardUI 기준 — 2026-07-12, 접수 영역 분할 — 2026-07-13)**

- **담당자 후보 데이터 소스**: `assigneeOptions`는 `GET /api/profiles`(계정 디렉터리 — id·name·email·role·소속)에서 `canProcess` 보유자만 걸러 만든다. 이 API 자체도 `GET /api/users`와 동일하게 `canProcess` 전용으로 게이트되어 있다(유일한 소비자가 이 화면이기 때문 — 그렇지 않으면 `GET /api/users`를 `canProcess`로 좁힌 경계가 무효화된다).
- **트리아지 존(배정 대기)**: 필터가 적용된 목록(`filtered`) 중 `status='접수' && assignee_id 없음` 건을 보드 상단에 별도 표시 — 기관·담당자 등 필터를 걸면 큐도 함께 좁혀져 헤더 건수 표시와 일치한다. "배정" 버튼 클릭 시 담당자+영향도 선택 모달 → `POST /api/requests/:id/assign` 호출. 배정 완료 시 진행중으로 자동 전이. 배정 대기도 드롭 대상이며, 진행중 카드를 큐에 놓으면 배정 취소(→ 접수)로 처리된다. 드래그 오버 시 "여기에 놓기" 텍스트를 표시한다. **예상 우선순위 미리보기**: 모달의 "예상 우선순위"는 대상 요청의 실제 긴급도와 선택된 영향도를 서버 `derivePriority` 격자와 동일한 클라이언트 사본(`derivePriorityPreview`, `src/lib/constants.ts`)에 넣어 계산한다(영향도만 보고 매핑하지 않음).
- **칸반 접수 컬럼**: `status='접수' && assignee_id 있음` 건만 표시. 배정 대기와 배타적이라 접수 건은 정확히 한 곳에만 나타난다. 진행중 카드를 이 컬럼에 놓아도 배정 취소(→ 접수)로 처리된다.
- **칸반 보드 5컬럼**: 접수/진행중/보류/완료/반려. 각 헤더에 건수 표시, WIP 한도(12) 초과 시 amber 강조.
- **카드**: priority_level 뱃지(P1~P4 색상, null이면 '미정'), 접수번호(seq), 제목(링크), 기관, 유형, SLA(due_status 뱃지 + resolution_due_at 상대 표기 D-N/초과), 담당자 인라인 선택, rework_count>0면 재작업 표시.
- **드래그 드롭 상태 전이**: `ALLOWED_TRANSITIONS` 매트릭스로 클라이언트 선검증. 불허 조합은 드롭 거부+토스트. `useChangeStatus` 낙관적 업데이트(실패 롤백). 접수→진행중 드롭 시 배정 모달 트리거. 드롭 대상 하이라이트는 배정 대기(`queue`)와 칸반 접수 컬럼(`접수`)을 별도 구분해 표시하므로, 진행중 카드를 접수 컬럼 위로 끌어도 마우스가 닿지 않은 배정 대기는 강조되지 않는다.
- **허용 전이 매트릭스**: 클라이언트(`src/lib/constants.ts`)와 서버(`server/src/services/transition.ts`)가 동일한 표를 갖고, 서버가 최종 검증한다(불허 시 `ILLEGAL_TRANSITION`). 개별 드롭·벌크 액션 모두 같은 `PATCH /api/requests/:id` 경로를 탄다.

  | 현재 상태 | 허용 대상 |
  |-----------|-----------|
  | 접수 | 진행중(배정 필요) · 반려 · 철회 |
  | 진행중 | 완료 · 보류 · 반려 · 접수(배정 취소) |
  | 보류 | 진행중 |
  | 완료 | 진행중(재작업, `rework_count`+1) |
  | 반려 · 철회 | (종결 — 전이 불가) |

- **배정 취소(진행중→접수)**: 서버가 `assignee_id`·`impact`·`priority_level`·`assigned_at`·`first_response_at`·`response_due_at`·`resolution_due_at`·`sla_policy_id`를 null로, `sla_response_breached`를 false로 되돌려 배정 대기로 복귀시킨다. 이후 재배정이 가능하다.
- **인라인 담당자 변경**: 카드/리스트 내 select → `PATCH { assignee_id }` (상태와 분리). 현재 담당자가 후보(`canProcess` 보유자) 목록 밖이어도 `withCurrentAssignee`로 편입해 "(시스템팀 아님)" 표기로 표시 — 관리 패널과 동일 규칙.
- **리스트 뷰 토글**: 표 형태로 전체 필드 확인, 체크박스 다중 선택 포함.
- **종결 필터**: 완료·반려·철회 포함 토글. 기본은 종결 제외.
- **벌크 액션**: 다중 선택 → 상단 액션 바에서 상태 또는 담당자 일괄 변경 → `useBulkUpdate` + undo 토스트.
- **저장뷰**: 필터 상태를 localStorage에 자동 저장/복원 (`manage_board_filters_v1`).
- **필터**: 기관·유형·기한상태·담당자·종결 포함 여부.

---

## 5. 화면 ④ 통계 대시보드

**목적**: 접수·처리 현황과 지표 파악, 연간 기록 관리
**접근**: `canSeeDashboard`(system·system_admin·exec)

**(P6 대시보드 UI — 2026-07-12 기준)**

**기간 필터**: 연도 선택 / 월 선택 / 사용자지정(from-to) 3모드. `GET /api/dashboard/metrics?from=&to=` 쿼리파라미터로 전달.

**KPI 카드**
- 미완료 건수 (`status not in 완료·반려·철회`)
- 기한초과+임박 건수 (`due_status in 초과·임박` & 미완료)
- P1/P2 미완료 건수 (`priority_level in P1·P2` & 미완료)
- 재작업율 (%) — 완료 건 중 `rework_count > 0` 비율
- 만족도 (%) — `csat_rating = 1` / 전체 csat 제출 비율

**리드타임 (중앙값)**
- 1차 응답: `created_at → first_response_at` 중앙값 (시간·일+시간 가독 표기)
- 해결: `created_at → final_resolved_at` 중앙값 (시간·일+시간 가독 표기)

**노화 히스토그램**: 미완료 건을 생성 경과일로 버켓(`<3d / 3-7d / 7-14d / >14d`) BarChart.

**SLA 준수율**: 응답 SLA / 해결 SLA 각각 % + 진행바(RadialBar 또는 숫자+bar).

**분포 차트**
- 상태별 · 기관별 · 유형별 건수 (BarChart/PieChart)
- 유형별 월 추이 (스택 BarChart)
- 담당자별 처리현황 (열린 건 / 완료 건 BarChart 또는 표)

**접근성**: 모든 차트에 제목+요약 텍스트 병기 (색만 의존 금지). 로딩·빈 상태 표시.

계산은 `request_view` + `GET /api/dashboard/metrics` 기반.

---

## 6. 화면 ⑤ 계정 관리 (시스템팀)

**목적**: 직원 계정의 역할·소속 관리
**접근**: `canManageAccounts`(system_admin 전용 — 처리 담당자 `system`은 계정·역할을 관리할 수 없다)

**최초 관리자(부트스트랩)**: 이 화면 자체가 `system_admin` 전용이라, 깨끗한 DB에 배포 직후
`system_admin`이 0명이면 이 화면에도 아무도 진입할 수 없어 앱 안에서 첫 관리자를 만들 방법이
없다(DB 직접 SQL 말고는 복구 불가). 공식 배포 순서(`db:migrate` → `db:seed`)의 `db:seed`가
`juhuikim@baeoom.com`을 처음부터 `role='system_admin'`으로 삽입해 이 상태를 피한다.
`db:seed`는 부트스트랩 직후 `system_admin` 카운트가 0이면 실패하고, `db:migrate`는 (seed
이전 시점이라 0이 정상일 수 있어) 경고만 남긴다. 상세는 `docs/reference/db-schema.md` §2·§10.

**구성 (P7 AccountsUI — 2026-07-12 기준)**

- **사용자 목록 표**: 이름·이메일·부서(dept)·소속기관(org_affil)·직무(dept_function)·역할(role). `GET /api/users`.
- **인라인 수정**: 행별 "수정" 버튼 → 부서(text)·소속기관(select 4종)·직무(text)·역할(select, `ASSIGNABLE_ROLES` 6종 — staff/dept_monitor/org_monitor/system/exec/system_admin) 인라인 편집 → "저장" `PATCH /api/users/:id`. 폐기값 `viewer`는 신규 부여 옵션에는 없지만, 현재 값이 `viewer`인 행을 열면 select에 비활성 옵션("(폐기값) — 아래에서 새 역할 선택 필요")으로 임시 표시해 관리자가 정상 역할을 골라 저장하면 구제(역할 변경)가 완료된다. role은 실제로 값이 바뀐 경우에만 PATCH에 담기므로(부서·소속기관만 고치는 저장은 role을 건드리지 않음), 편집하지 않은 `viewer` 값이 저장 시 의도치 않게 다른 역할로 바뀌지 않는다. 라벨·옵션 정의는 `src/lib/constants.ts`의 공용 `ROLE_LABEL`/`ASSIGNABLE_ROLES`가 SSOT(계정 관리 화면과 상단 메뉴가 공유). **마지막 관리자 강등 방지**: `system_admin`이 0명이 되는 역할 변경은 서버가 400 `LAST_ADMIN`으로 거부한다(트랜잭션 + `FOR UPDATE`로 동시 강등 레이스 처리).
- **CSV 일괄 가져오기**: 파일 선택 → 클라이언트 파싱(헤더: email,name,dept,org_affil,dept_function,role) → `POST /api/org-directory/import {rows}` → 결과(업서트/건너뜀/오류) 표시.
- **주의 안내**: 부서·기관을 변경해도 이미 접수된 요청의 공개범위는 접수 시점 스냅샷을 유지하며, 변경은 이후 신규 요청부터 반영됨.
- **접근성**: 역할 뱃지 색+텍스트 병용, 모든 버튼 `aria-label`, 표 `scope` 속성.

---

## 6-1. 인앱 알림 벨 (전 역할)

**목적**: 요청 상태 변경·댓글 등 이벤트를 실시간에 가깝게 알림
**접근**: 로그인한 전 사용자(6역할 공통)

**구성 (P8 NotificationBell — 2026-07-12 기준)**

- **위치**: 상단바(TopNav) 우측 사용자명·로그아웃 사이.
- **미읽음 뱃지**: 미읽음 수 표시(빨간 원형 뱃지, 색+숫자 병용). `GET /api/notifications` 30초 간격 폴링.
- **드롭다운 목록**: 최근 50개, 메시지·시각 표시. 미읽음 항목은 파란 점+텍스트로 구분.
- **항목 클릭**: 해당 요청 상세(`/requests/:id`)로 이동 + `POST /api/notifications/:id/read` 단건 읽음 처리.
- **모두 읽음**: 헤더 버튼 → `POST /api/notifications/read-all`.
- **접근성**: 벨 버튼 `aria-label`(미읽음 수 포함), `aria-haspopup`, `aria-expanded`, 드롭다운 `role="dialog"`, 항목 `role="listitem"`, `aria-live` 결과 안내.

---

## 7. 메일 접수 통합 (전환기)

- 사이트 오픈 후에도 당분간 Gmail 접수가 병행됨.
- 기존 GAS를 유지하되, 저장 대상을 시트 대신 Supabase로 전환(`source='email'`, `source_thread_id`로 중복 방지). service_role 키로 insert(RLS 우회).
- 웹 접수 + 메일 접수가 한 원장(requests)에 합류 → 요청 처리 화면·대시보드에서 통합 관리.
- 사이트 정착 후 메일 접수 축소 예정.

---

## 8. 비기능 요구사항

- 도메인 제한 로그인(@baeoom/@baeron), RLS로 데이터 접근 통제.
- 파일 업로드 용량·확장자 제한(악성 파일).
- 감사 추적: 상태 변경 이력 보존(request_status_history).
- 접근성·모바일 대응(접수/조회 화면 우선).

---

## 9. 이번 범위 밖 (추후)

- 지연·기한임박 능동 알림(Slack/메일) → 방식 미확정.
- 이관처 전용 필드.
- 상태변경 전용 RPC(컬럼 수준 제어 강화).
- 요청 통계의 대외 리포트 자동화.

---

## 10. Claude Code 착수 시 참고

- 이 문서 + `schema.sql` + `DB설계.md`를 컨텍스트로 전달.
- 작업 순서: 프로젝트 뼈대(Vite+React+라우팅) → Supabase 연동·인증 → 접수 폼 → 요청 목록 → 요청 처리 화면 → 대시보드 → 계정 관리 → 에디터 통합 → 배포.
- 에디터는 확장된 코드 확보 후 컴포넌트로 래핑.
