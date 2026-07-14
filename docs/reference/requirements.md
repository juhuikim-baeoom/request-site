---
title: 요구사항 정의서 v1
last_updated: 2026-07-13
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
| 역할 | staff(일반직원) / system(시스템팀) / viewer(실장 등 열람) |
| 대상 | 전 직원 약 50명 |
| DB | 별도 Supabase (사내 MSSQL 미사용). 스키마는 `schema.sql` 참조 |

**요청 속성(공통 데이터 모델)**
- 기관: 배움 / 배론 / 허브 / 공통
- 유형: 오류 / 기능요청 / 데이터추출 / 파일변경
- 긴급도(urgency): 높음 / 보통 / 낮음 — 요청자 입력 (우선순위 대체)
- 우선순위(priority_level): P1~P4 — 배정 시 시스템팀이 설정 (요청자 미입력)
- 상태: 접수 → 진행중 → 검수대기 → 완료 (+보류/반려/철회). `진행중 → 완료` 직행 불가 — 검수대기를 거쳐야 한다
- 공개범위: private / dept / function / org / shared (기본 dept)
- 접수번호: YYMMDD-NN (자동)
- intake_detail: 유형별 구조화 필드(jsonb)

---

## 1. 공통 사항

- **로그인**: Google 로그인 단일 지원. 미인증 시 로그인 화면으로. 허용 도메인 외 계정은 차단.
- **역할별 메뉴 노출**
  - staff: 접수 폼, 내 요청 목록
  - system: 상기 + 관리 보드, 통계 대시보드, 계정 관리
  - viewer: 통계 대시보드(전체 조회), 요청 열람(읽기 전용)
- **상단 내비**: 로고, 메뉴, 로그인 사용자명·역할, 로그아웃.
- **반응형**: PC 우선, 접수 폼·내 요청은 모바일에서도 사용 가능해야 함(외근·현장 접수 대비).
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
- 제출 시 requests insert → 접수번호 자동 발급 → 접수 완료 안내(번호 표시) → 내 요청 목록으로 이동.
- 요청자(requester_id)는 로그인 계정으로 자동 설정. 접수 시점 요청자 부서·기관이 스냅샷 저장됨.
- 첨부는 requests 생성 후 개별 업로드 → request_attachments 기록. **부분 실패 시 요청 중복 생성 없이** 실패 파일만 재시도(기존 request id로 POST). `useCreateRequest` 반환: `{ id, seq, failedFiles: File[], totalFiles: number }`. 완료 화면에서 "첨부 N건 중 M건 실패"에 `totalFiles`(N)·`failedFiles.length`(M) 사용.
- **제출 검증 실패 시** 첫 오류 필드로 포커스+scrollIntoView 이동.
- **제출 중** 버튼 disabled + 입력 잠금(중복 제출 방지).

---

## 3. 화면 ② 내 요청 목록

**목적**: 요청자가 본인 및 볼 수 있는 요청의 진행 상황 확인
**접근**: staff 이상 (공개범위 정책에 따라 노출)

**구성 (P5 재설계 — 2026-07-12)**

- **기본 저장뷰 "내 열린 요청"**: 진입 시 기본 필터 = 본인 탭 + 열린 상태(접수·진행중·보류). 필터 상태(tab/status/typeCode/org/sort/showClosed)를 직렬화 객체로 `localStorage('my_requests_view_v1')`에 자동 저장·복원.
- **탭**: 내 요청 / 부서·공유 요청.
- **종결 포함 토글**: 기본 꺼짐(완료·반려·철회 제외) → 켜면 전체 상태 표시.
- **필터**: 상태(6종) · 유형 · 기관 · 정렬(최신순/기한 우선).
- **SLA/기한 컬럼**: `due_status` 기반 뱃지(색+텍스트+아이콘) + `resolution_due_at` 있으면 D-N / N일 초과 상대표기.
- **우선순위**: `priority_level`(P1~P4, PRIORITY_LEVEL_BADGE). null이면 "미정". 옛 `priority` 컬럼 미사용.
- **접근성**: 모든 뱃지 색+텍스트 병용. 표 헤더/셀 `scope` 속성. 버튼 `aria-pressed`, select `aria-label`.
- **모바일 카드 뷰**: `sm:` 미만에서 표 → 카드 레이아웃(접수번호·제목·상태·우선순위·기한·담당). Tailwind 반응형.

**상세 화면 (P4 DetailUI — 2026-07-12 기준)**

- **통합 타임라인**: 상태변경 이력 + 코멘트(내부메모/공개) + 첨부를 시간순 한 피드로 병합. **단일 섹션 · 항목당 1행**(구분선 리스트): `유형 뱃지 · 내용(넘치면 말줄임, title에 전문) · 작성자 · 시각`. 내부메모 행은 amber 배경+뱃지로 시각 구분(요청자 화면엔 노출 안 됨).
- **코멘트 작성기** (`CommentComposer.tsx`): 토글 대신 **공개 코멘트(위) · 내부 메모(아래)를 상하로 나란히** 배치. 각각 독립 폼(본문 + 다중 파일첨부 + 자체 제출·오류 표시). 제출 시 POST comment → 반환 id로 comment_id 링크 업로드. 내부 메모는 시스템팀에게만 렌더링되며 **코드·로그 입력 전제**: monospace · 8행 · 줄바꿈 없음(`wrap=off`) · 맞춤법검사 off · Tab 들여쓰기(2칸, Esc 후 Tab은 포커스 이동 — 키보드 트랩 방지).
- **SLA 표시**: resolution_due_at 기준 due_status 뱃지 + 남은시간 상대표기(D-N/초과). 담당자·우선순위(priority_level) 표시.
- **재작업 버튼**: 시스템팀 & `status='완료'` → PATCH `{ status:'진행중', reason? }`(이의제기 수락 경로). 사유 필수.
- **요청자 액션**: `status='접수'`일 때 수정(title/body/urgency/visibility/desired_due) / 철회(PATCH `{ status:'철회' }`). 편집과 상태변경 분리(서버 400 회피).
- **검수 확인 패널**: 요청자 & `status='검수대기'`일 때 상단에 확인 패널 표시. 자동완료 예정일(`inspection_due_at`) 안내.
  - **확인했습니다**: 별점 1~5(CSAT, `csat_rating`) + 선택 코멘트(`csat_comment`) 모달 → `PATCH { status:'완료', csat_rating, csat_comment }`(`completion_route='REQUESTER'`).
  - **다시 봐주세요**: 사유 입력(필수) 모달 → `PATCH { status:'진행중', reason }`(재작업, `rework_count +1`).
- **이의제기 패널**: 요청자 & `status='완료'` & 완료 후 14일 이내 & 열린 이의 없음일 때 "이의제기" 버튼 노출.
  - 사유 입력 → `POST /api/requests/:id/disputes`. 이미 열린 이의가 있으면 버튼 대신 "심사 중" + 제기 사유 표시.
  - 14일이 지났으면 이의제기 대신 새 요청 작성 안내(원본을 `parent_request_id`로 연결).
  - 시스템팀은 상세 화면에서 `수락(→ 재작업)` / `기각(사유 필수)` 두 동작을 `PATCH /api/disputes/:id`로 수행.

**검수·이의제기 정책 (2026-07-13 도입)**

- 진행중 → 완료 직행은 불가하다. 작업 종료 시 반드시 검수대기로 보내고 요청자 확인을 받는다.
- 요청자는 검수대기 건을 확인(만족도 별점 1~5 동반)하거나 재작업을 요청(사유 필수)할 수 있다.
- 검수대기 진입 후 7일 무응답이면 자동으로 완료 처리되며(`completion_route='AUTO'`), 3일차에 리마인더 알림이 검수 라운드당 1회 발송된다(`inspection_reminder_sent_at`으로 같은 라운드 내 중복 방지). 재작업 후 재검수 라운드에서는 `inspection_reminder_sent_at`이 재무장되어 리마인더가 다시 발송될 수 있다.
- 시스템팀은 검수를 건너뛰고 사유를 남긴 채 강제 완료할 수 있다(`completion_route='SYSTEM_FORCED'`, 사유는 `completion_note`에 저장).
- 최종 완료 후 14일 이내에 요청자는 이의를 제기할 수 있다. 시스템팀이 수락하면 재작업(`진행중`)으로 되돌아가고, 기각하면 완료 상태가 유지되며 기각 사유가 요청자에게 전달된다.
- 한 요청에 동시에 열린(`OPEN`) 이의는 1건이며, 이의 제기 횟수 자체에는 제한이 없다(기각된 이의도 이력으로 남아 집계됨).
- **되돌아가기 목적지 분기**: 목록에서 상세로 들어올 때 진입 경로를 쿼리 파라미터로 넘긴다(관리 보드 `?from=board`, 내 요청 목록 `?from=mine`). 상세 상단 링크는 이 값에 따라 "← 관리 보드"(`/board`) 또는 "← 내 요청 목록"(`/requests/mine`)으로 렌더링한다. 값이 없거나(알림 벨 진입 등) 알 수 없는 값, 또는 `from=board`인데 system 역할이 아니면 내 요청 목록으로 폴백한다. 관리 보드 필터는 기존 localStorage 복원 로직으로 유지된다.

---

## 4. 화면 ③ 관리 보드 (시스템팀)

**목적**: 시스템팀이 전체 요청을 배정·진행 관리
**접근**: system

**구성 (P3 BoardUI 기준 — 2026-07-12)**

- **트리아지 존(미배정 큐)**: `status='접수' && assignee 없음` 건을 보드 상단에 별도 표시. "배정" 버튼 클릭 시 담당자+영향도 선택 모달 → `POST /api/requests/:id/assign` 호출. 배정 완료 시 진행중으로 자동 전이.
- **칸반 보드 6컬럼**: 접수/진행중/검수대기/보류/완료/반려. 각 헤더에 건수 표시, WIP 한도(12) 초과 시 amber 강조. `검수대기` 카드에는 자동완료(`inspection_due_at`)까지 남은 일수를 표시해 재촉·강제완료 판단에 쓴다.
- **카드**: priority_level 뱃지(P1~P4 색상, null이면 '미정'), 접수번호(seq), 제목(링크), 기관, 유형, SLA(due_status 뱃지 + resolution_due_at 상대 표기 D-N/초과), 담당자 인라인 선택, rework_count>0면 재작업 표시, `has_open_dispute`면 이의 뱃지(완료 컬럼에 남되 강조).
- **드래그 드롭 상태 전이**: `ALLOWED_TRANSITIONS` 매트릭스로 클라이언트 선검증. 불허 조합은 드롭 거부+토스트. `useChangeStatus` 낙관적 업데이트(실패 롤백). 접수→진행중 드롭 시 배정 모달 트리거.
- **허용 전이 매트릭스**: 클라이언트(`src/lib/constants.ts`)와 서버(`server/src/services/transition.ts`)가 동일한 표를 갖고, 서버가 최종 검증한다(불허 시 `ILLEGAL_TRANSITION`). 개별 드롭·벌크 액션 모두 같은 `PATCH /api/requests/:id` 경로를 탄다.

  | 현재 상태 | 허용 대상 |
  |-----------|-----------|
  | 접수 | 진행중(배정 필요) · 반려 · 철회 |
  | 진행중 | 완료 · 보류 · 반려 · 접수(배정 취소) |
  | 보류 | 진행중 |
  | 완료 | 진행중(재작업, `rework_count`+1) |
  | 반려 · 철회 | (종결 — 전이 불가) |

- **배정 취소(진행중→접수)**: 서버가 `assignee_id`·`impact`·`priority_level`·`assigned_at`·`first_response_at`·`response_due_at`·`resolution_due_at`·`sla_policy_id`를 null로, `sla_response_breached`를 false로 되돌려 미배정 큐로 복귀시킨다. 이후 재배정이 가능하다.
- **인라인 담당자 변경**: 카드/리스트 내 select → `PATCH { assignee_id }` (상태와 분리).
- **리스트 뷰 토글**: 표 형태로 전체 필드 확인, 체크박스 다중 선택 포함.
- **종결 필터**: 완료·반려·철회 포함 토글. 기본은 종결 제외.
- **벌크 액션**: 다중 선택 → 상단 액션 바에서 상태 또는 담당자 일괄 변경 → `useBulkUpdate` + undo 토스트.
- **저장뷰**: 필터 상태를 localStorage에 자동 저장/복원 (`manage_board_filters_v1`).
- **필터**: 기관·유형·기한상태·담당자·종결 포함 여부.

---

## 5. 화면 ④ 통계 대시보드

**목적**: 접수·처리 현황과 지표 파악, 연간 기록 관리
**접근**: system, viewer

**(P6 대시보드 UI — 2026-07-12 기준)**

**기간 필터**: 연도 선택 / 월 선택 / 사용자지정(from-to) 3모드. `GET /api/dashboard/metrics?from=&to=` 쿼리파라미터로 전달.

**KPI 카드**
- 미완료 건수 (`status not in 완료·반려·철회`)
- 기한초과+임박 건수 (`due_status in 기한초과·임박` & 미완료)
- P1/P2 미완료 건수 (`priority_level in P1·P2` & 미완료)
- 재작업율 (%) — 완료 건 중 `rework_count > 0` 비율. **검수대기 반려(`검수대기 → 진행중`)도 포함하도록 넓어짐** — "요청자가 한 번에 만족하지 못한 비율"이 원래 재려던 값이기 때문
- 만족도 (%) — `csat_rating >= 4` / 전체 csat 제출 비율. **CSAT가 thumbs(-1/1)에서 1~5점 별점으로 전환**되며 기준을 4점 이상으로 재정의. CSAT는 요청자가 검수대기를 확인(`완료`, `completion_route='REQUESTER'`)하는 순간에만 수집됨

**검수·이의제기 지표 (신규)**
- 이의제기율 — 완료 건 대비 이의제기가 발생한 비율. 검수를 통과하고도 나중에 문제가 드러난 비율(높으면 검수가 형식적이라는 뜻)
- 이의 수락률 — 심사된 이의 중 `ACCEPTED` 비율(수락이 높으면 구현 품질 문제, 기각이 높으면 요건 정의·기대치 관리 문제)
- 평균 검수 소요일 — 검수대기 진입~완료까지 요청자가 확인에 걸리는 평균 일수
- 완료 경로 분포 — `REQUESTER`(요청자 확인) / `AUTO`(7일 자동완료) / `SYSTEM_FORCED`(강제완료) 건수 비율. `AUTO` 비중이 크면 "완료" 숫자가 사실은 무응답이라는 신호
- 열린 이의 수 — 현재 `status_cd='OPEN'`인 이의 건수(심사 대기 중)

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
**접근**: system

**구성 (P7 AccountsUI — 2026-07-12 기준)**

- **사용자 목록 표**: 이름·이메일·부서(dept)·소속기관(org_affil)·직무(dept_function)·역할(role). `GET /api/users`.
- **인라인 수정**: 행별 "수정" 버튼 → 부서(text)·소속기관(select 4종)·직무(text)·역할(select 3종) 인라인 편집 → "저장" `PATCH /api/users/:id`.
- **CSV 일괄 가져오기**: 파일 선택 → 클라이언트 파싱(헤더: email,name,dept,org_affil,dept_function,role) → `POST /api/org-directory/import {rows}` → 결과(업서트/건너뜀/오류) 표시.
- **주의 안내**: 부서·기관을 변경해도 이미 접수된 요청의 공개범위는 접수 시점 스냅샷을 유지하며, 변경은 이후 신규 요청부터 반영됨.
- **접근성**: 역할 뱃지 색+텍스트 병용, 모든 버튼 `aria-label`, 표 `scope` 속성.

---

## 6-1. 인앱 알림 벨 (전 역할)

**목적**: 요청 상태 변경·댓글 등 이벤트를 실시간에 가깝게 알림
**접근**: 로그인한 전 사용자(staff·system·viewer 공통)

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
- 웹 접수 + 메일 접수가 한 원장(requests)에 합류 → 관리 보드·대시보드에서 통합 관리.
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
- 작업 순서: 프로젝트 뼈대(Vite+React+라우팅) → Supabase 연동·인증 → 접수 폼 → 내 요청 목록 → 관리 보드 → 대시보드 → 계정 관리 → 에디터 통합 → 배포.
- 에디터는 확장된 코드 확보 후 컴포넌트로 래핑.
