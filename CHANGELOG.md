# Changelog

이 프로젝트의 주요 변경 사항을 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/), 버전은 [SemVer](https://semver.org/)를 따른다.

## [Unreleased]

### Added
- **역할 모델 정교화 1단계 — DB 준비** (`server/drizzle/0005_role_model_add_values.sql`, `server/src/db/backfill-roles.ts`, `server/src/db/migrate.ts`, `server/src/db/schema.ts`, `server/src/types.ts`, `src/types/supabase.ts`, `src/lib/constants.ts`, `src/components/TopNav.tsx`): `user_role` enum에 `dept_monitor`·`org_monitor`·`exec`·`system_admin` 4종을 추가(0005). 기존 `viewer` 사용자는 `exec`로 이전, `juhuikim@baeoom.com`만 `system_admin`으로 승격했고 나머지 `system` 사용자는 담당자로 유지했다 — 이 데이터 이전은 마이그레이션 파일이 아니라 `server/src/db/backfill-roles.ts`의 백필로 구현되어 `migrate.ts`가 `migrate()` 완료(= 마이그레이션 트랜잭션 커밋) 후 실행한다. (`ALTER TYPE ... ADD VALUE`로 추가한 enum 값은 같은 트랜잭션 안에서 쓸 수 없고, drizzle-orm 마이그레이터는 대기 중인 모든 마이그레이션 파일을 단일 트랜잭션으로 묶으므로 파일만 나눠서는 우회되지 않는다 — 처음에는 별도 마이그레이션 파일(0006)로 나눴으나 깨끗한 DB에서 `npm run db:migrate` 1회 실행 시 0005/0006이 같은 트랜잭션에 들어가 "unsafe use of new value of enum type" 오류로 실패함을 확인해 백필로 이전했다.) `viewer` 값 자체는 Postgres가 enum 값 삭제를 지원하지 않고 forward-only 원칙(CLAUDE.md §2)이라 남겨두되 신규 부여는 하지 않는다. 서버 `UserRoleValue`·클라이언트 `UserRole` 타입이 7개 값을 모두 인식하도록 확장했고, 공용 한국어 라벨 `ROLE_LABEL`과 계정관리 노출 목록 `ASSIGNABLE_ROLES`를 `src/lib/constants.ts`에 추가했다. `TopNav.tsx`의 역할 뱃지가 로컬 라벨 맵(`Record<UserRole, string>`, 신규 값 누락으로 컴파일 실패) 대신 공용 `ROLE_LABEL`을 쓰도록 통합하면서 표시 문구가 일부 바뀌었다(staff "일반직원"→"요청자", system "시스템팀"→"시스템팀 담당자", viewer "열람"→"(폐기) 뷰어"). **권한 판정(authz) 로직 자체는 이번 변경 범위 밖**이며 후속 작업에서 다룬다.
- **요청 상세 관리 패널** (`src/features/requests/AdminPanel.tsx`): 시스템팀 전용. 담당자·상태·영향도를 상세 화면에서 직접 변경. 담당자 후보는 `role='system'`만 노출(관리 보드 `assigneeOptions`와 동일 규칙 — 일반 staff 배정 시 공개범위 필터 사각지대 방지). 상태는 `ALLOWED_TRANSITIONS` 기준 불허 전이를 select에서 비활성화("(불가)" 표기)하고, 보류·반려는 사유 입력 모달을 거친다. 영향도는 종결(완료·반려·철회) 건을 미배정 여부와 무관하게 우선 비활성 처리하고("종결된 요청은 영향도를 조정할 수 없습니다"), 종결이 아니면서 미배정인 건만 "배정 후 조정할 수 있습니다" 안내를 표시한다(서버 `PATCH /api/requests/:id/impact` 검사 순서와 일치). 필드 편집(제목·본문·긴급도·희망완료일) 권한이 시스템팀으로 확장(상태 무관하게 편집 가능), 철회 버튼은 `ALLOWED_TRANSITIONS`상 '접수' 상태에서만 노출. **긴급도(urgency) 편집 시 배정된(impact != null)·종결 아닌 건은 `priority_level`·SLA 기한을 `computeSlaFields`로 재산정**(배정·영향도 조정 API와 동일 공용 함수 공유, `assigned_at`·`first_response_at`·`status`는 보존).
- **영향도 재조정 API** (`server/src/services/impact.ts`, `PATCH /api/requests/:id/impact`): 시스템팀 전용, body `{ impact: 높음|보통|낮음 }`. 배정 후에도 영향도를 바꿔 `priority_level`·`response_due_at`·`resolution_due_at`·`sla_policy_id`·`sla_response_breached`를 재산정한다(`assigned_at`·`first_response_at`·`status`는 보존). **종결(완료·반려·철회) 건은 미배정 여부와 무관하게 우선 400 `CLOSED`로 거부**하고, 종결이 아니면서 미배정인 건만 400 `NOT_ASSIGNED`로 거부한다(접수→반려/철회로 직행한 미배정 종결 건은 배정 자체가 영영 불가능하므로 `CLOSED`가 실제 원인을 정확히 알려줌). TOCTOU 방지를 위해 `SELECT … FOR UPDATE` + `UPDATE … WHERE assignee_id is not null` 사용. 회귀 테스트 `server/scripts/test-impact.ts`(`npm run test:impact`) 5건: 재산정·미배정 거부·종결(배정 건) 거부·**미배정+종결 건 → CLOSED**·담당자 알림.

### Fixed
- **역할 백필이 매 배포마다 juhuikim을 system_admin으로 되돌리던 문제** (`server/drizzle/0006_role_backfill_history.sql`(신규 테이블 `role_backfill_history`), `server/src/db/backfill-roles.ts`, `server/src/db/schema.ts`, `server/src/db/migrate.ts`): 위 "역할 모델 정교화 1단계"의 백필이 이메일 조건(`WHERE email='juhuikim@baeoom.com'`)만 보고 매번 `system_admin`으로 UPDATE했다. `migrate.ts`가 `npm run db:migrate`(= 배포마다) 백필을 호출하므로, 관리자가 계정 관리 화면에서 juhuikim의 역할을 바꿔도 다음 배포에서 조용히 `system_admin`으로 되살아나는 문제가 있었다. `role_backfill_history` 테이블에 고정 키(`role_model_v1`)를 `INSERT ... ON CONFLICT DO NOTHING RETURNING`으로 원자적으로 claim하고, claim에 성공했을 때(= 이 DB에서 처음 실행될 때)만 실제 UPDATE(viewer→exec, juhuikim→system_admin)를 수행하도록 수정 — claim과 UPDATE는 한 트랜잭션으로 묶여 원자적이다. 이미 적용된 DB에서 재실행하면 claim이 0행을 반환해 UPDATE 자체를 건너뛰므로, 이후 수동으로 바뀐 역할이 되살아나지 않는다. 검증: 깨끗한 DB에서 `db:migrate` 1회로 마이그레이션+백필 정상 적용, 이미 이전된 DB에서 juhuikim을 `staff`로 바꾼 뒤 `db:migrate` 재실행해도 `staff`로 유지됨을 확인(로그도 `role backfill skipped — already applied`로 전환).
- **문서 — 삭제된 `0006_role_model_migrate_users.sql` 참조** (`docs/reference/db-schema.md`): 데이터 이전을 백필로 옮기며(090917c) 삭제된 0006 마이그레이션 파일을 §2가 여전히 참조해 §10 교훈 단락과 모순되던 문제 수정. 실제 구현(0005 마이그레이션 + `backfill-roles.ts` 백필 + `role_backfill_history` 마커 테이블)에 맞게 §1·§2·§10을 갱신.
- **계정 관리 화면이 신규 역할 4종을 모르던 문제** (`src/features/accounts/Accounts.tsx`): 로컬 `ROLE_OPTIONS`(staff/system/viewer 3종)가 백필이 만든 `system_admin` 등 신규 값을 인식하지 못해, 목록에 영문 원값이 그대로 노출되고 편집 드롭다운에도 옵션이 없어 실제 값과 화면이 어긋났다. 로컬 `ROLE_OPTIONS`를 제거하고 공용 `ROLE_LABEL`/`ASSIGNABLE_ROLES`(`src/lib/constants.ts`)를 쓰도록 수정 — 라벨 정의를 한 곳(SSOT)으로 통일. 폐기값 `viewer`는 편집 select 옵션에는 없지만 기존 행에는 라벨("(폐기) 뷰어")로 계속 표시된다.

### Changed
- **관리보드 접수 영역 분할** (`src/features/board/ManageBoard.tsx`): 미배정 큐는 `status='접수' && assignee_id 없음`, 칸반 접수 컬럼은 `status='접수' && assignee_id 있음`으로 배타 분할해 중복 표시를 제거. 미배정 큐는 필터가 적용된 목록(`filtered`)을 소스로 사용해, 기관·담당자 등 필터를 걸면 큐도 함께 좁혀지고 헤더 건수 표시와 일치한다. 미배정 큐도 드롭 대상으로 추가해, 진행중 카드를 큐나 접수 컬럼에 놓으면 배정 취소(→ 접수)로 처리된다. 드래그 오버 하이라이트는 `dragOverZone: 'queue' | RequestStatus | null`로 큐와 칸반 접수 컬럼을 구분해, 진행중 카드를 접수 컬럼 위로 끌어도 마우스가 닿지 않은 미배정 큐는 강조되지 않는다. 드래그 오버 시 "여기에 놓기" 텍스트 표시.
- **SLA 계산 공용화** (`server/src/services/sla-fields.ts`): 우선순위·기한 계산 로직(`computeSlaFields`, `loadHolidaySet`)을 분리해 배정(`assign.ts`)과 영향도 재조정(`impact.ts`)이 공유. `CLOSED_STATUSES`를 `src/lib/constants.ts`로 단일화(클라이언트 `MyRequests`·`ManageBoard`·`AdminPanel`이 공유; 서버는 별도 런타임이라 `impact.ts` 자체 상수 유지). 동작 변경 없음.
- **요청 상세 되돌아가기 목적지 분기** (`src/features/requests/RequestDetail.tsx`, `src/features/board/ManageBoard.tsx`, `src/features/requests/MyRequests.tsx`): 상세 상단 링크가 항상 `/requests/mine`으로 고정돼 관리 보드에서 진입해도 내 요청 목록으로만 돌아가던 문제 수정. 목록의 카드/표 링크가 진입 경로를 쿼리 파라미터로 넘기고(`?from=board` / `?from=mine`), 상세는 이를 읽어 "← 관리 보드"(`/board`) 또는 "← 내 요청 목록"(`/requests/mine`)을 렌더링한다. 라우터 state 대신 쿼리 파라미터를 쓰므로 새로고침·링크 공유에도 유지된다.
  - 폴백: `from`이 없거나(알림 벨 진입 등) 알 수 없는 값, 또는 `from=board`인데 system 역할이 아니면 내 요청 목록. 오류 상태의 "목록으로" 링크도 같은 목적지를 따른다.
- **활동 타임라인 1행 리스트화** (`src/features/requests/RequestDetail.tsx`): 항목마다 카드(2행: 헤더+본문)로 쌓이던 구조를 단일 섹션 안의 구분선 리스트로 변경. 한 항목 = 한 행(`유형 뱃지 · 내용 · 작성자 · 시각`), 긴 코멘트·파일명은 말줄임. 줄바꿈이 포함된 코멘트(코드·로그)는 ▸ 토글로 펼쳐 `<pre>` 전문(가로 스크롤)을 보여준다. 내부메모 행은 amber 배경 유지.
- **코멘트 작성기 공개/내부 상하 분리** (`src/features/requests/CommentComposer.tsx` 신규, `RequestDetail.tsx`): 내부메모/공개 토글 버튼(탭 방식)을 제거하고 공개 코멘트(위)·내부 메모(아래)를 각각 독립 폼으로 배치. 시스템팀에게만 내부 메모 폼이 보인다. 내부 메모는 코드·로그 입력을 전제로 monospace · 8행 · `wrap="off"` · spellcheck off · Tab 2칸 들여쓰기(Esc 후 Tab은 포커스 이동으로 빠져나감). 폼별로 본문·첨부·제출 상태와 오류 메시지를 각자 관리한다.
- **진행중 → 접수 되돌리기(배정 취소) 허용** (`server/src/services/transition.ts`, `src/lib/constants.ts`): 허용 전이 매트릭스에 `진행중 → 접수`를 추가. 관리 보드에서 개별 드래그·리스트 인라인 select·벌크 상태 일괄변경 모두에서 진행중 건을 접수로 되돌릴 수 있다. 이전에는 매트릭스에 없어 서버가 `ILLEGAL_TRANSITION`으로 거부했다.
  - 되돌릴 때 서버가 배정 정보를 초기화한다: `assignee_id`·`impact`·`priority_level`·`assigned_at`·`first_response_at`·`response_due_at`·`resolution_due_at`·`sla_policy_id` → null, `sla_response_breached` → false. 미배정 큐로 복귀하며 재배정이 가능하다(`assignRequest`는 `status='접수'`만 대상으로 삼음).
  - 회귀 테스트 추가: `server/scripts/test-transition.ts` (6) 진행중 → 접수 되돌리기 + 배정 초기화.

### Fixed
- **배정 모달 "예상 우선순위"가 영향도만 보고 긴급도를 무시하던 문제** (`src/features/board/ManageBoard.tsx`, `src/features/requests/AdminPanel.tsx`, `src/lib/constants.ts`): 배정 모달의 `IMPACT_PRIORITY_PREVIEW`가 영향도만으로 우선순위를 매핑해(예: 긴급도='보통'·영향도='보통'인데 "P2"로 표시, 실제 서버 산정값은 P3), 낮음 영향도는 "P3/P4"처럼 모호한 값까지 노출했다. 서버 `server/src/sla.ts`의 `derivePriority(urgency, impact)`와 동일한 격자를 클라이언트 사본 `derivePriorityPreview(urgency, impact)`(`src/lib/constants.ts`)로 추가하고, 배정 모달이 대상 요청의 실제 `urgency`와 선택된 `impact`를 함께 넣어 정확한 단일 값을 계산하도록 수정. 요청 상세 관리 패널(`AdminPanel.tsx`)의 영향도 select에도 같은 격자를 적용해, 각 옵션 선택 시 재산정될 우선순위를 미리 보여준다(이전에는 현재 우선순위 뱃지만 표시).
- **담당자 select가 후보 목록 밖의 현재 담당자를 "미배정"으로 표시하던 문제** (`src/features/board/ManageBoard.tsx`, `src/features/requests/AdminPanel.tsx`, `src/lib/constants.ts`): 담당자 후보를 `role='system'`으로 필터링하는데, 현재 담당자가 그 후보 목록에 없으면(예: 배정 이후 역할이 바뀐 경우) select의 `value`가 어떤 `<option>`과도 매칭되지 않아 첫 옵션인 "미배정"으로 표시되는 문제가 있었다 — 요약바에는 실제 담당자 이름이 나오는데 select만 미배정으로 보임. 공용 헬퍼 `withCurrentAssignee`(`src/lib/constants.ts`)를 추가해, 현재 담당자가 후보 목록에 없을 때 그 사용자를 "(시스템팀 아님)" 표시가 붙은 옵션으로 편입한다. 관리 보드 인라인 select(칸반 카드·리스트뷰)와 관리 패널 select가 동일한 규칙을 공유한다.
- **`sla_response_breached` 재계산이 `first_response_at`을 무시하던 문제** (`server/src/services/sla-fields.ts`): `computeSlaFields`가 항상 `new Date() > responseDueAt`(현재 시각 기준)으로 판정해, 오래전 생성되어 기한 내 정상 응답을 마친 건도 나중에 긴급도·영향도만 바꾸면 `response_due_at`(생성 시각 기준 과거 시점)이 이미 지난 것으로 잡혀 `sla_response_breached`가 true로 뒤집히는 데이터 오염이 있었다. `firstResponseAt` 인자를 추가해, 응답이 이미 이뤄진 건은 "응답 시각이 기한을 넘겼는가", 아직 응답 전인 건만 "현재 시각이 기한을 넘겼는가"로 판정하도록 수정. 호출자 3곳(`assign.ts`·`impact.ts`·`routes/requests.ts` 긴급도 재산정 분기)이 각자 맥락의 `firstResponseAt`을 전달한다 — 배정(`assignRequest`)은 배정 시점에 `first_response_at`을 세팅하는 경로이므로 그 시각을 그대로 넘겨 "응답 기한을 이미 넘긴 채 배정되면 breach=true" 기존 동작을 보존. 회귀 테스트: `server/scripts/test-impact.ts` (5) 2주 전 생성·기한 내 응답 완료 건에서 영향도만 바꿔도 `sla_response_breached=false` 유지.
- **미배정 건의 긴급도 편집이 `response_due_at`을 갱신하지 않던 문제** (`server/src/routes/requests.ts`): 긴급도 재산정 분기가 `impact != null`(=배정된 건)일 때만 동작해, 요청자가 유일하게 편집 가능한 창(`status='접수'`, 대개 미배정)에서 긴급도를 바꿔도 `response_due_at`이 이전 긴급도 기준으로 남아 응답 SLA가 과소평가되는 문제가 있었다. `impact == null`이고 종결 상태가 아닌 경우, 요청 생성부의 계산을 추출한 공용 함수 `computeResponseDueAtForUrgency`(`server/src/services/sla-fields.ts`)로 `response_due_at`만 재산정하도록 수정(계산식 중복 정의 없음). 회귀 테스트: `server/scripts/test-api-write.ts` 미배정 건 긴급도 편집 시 `response_due_at` 재산정.

### Added
- **접수폼 2-페인 레이아웃 재설계** (`src/features/requests/RequestForm.tsx`, `src/features/requests/BodyEditorSlot.tsx`, `src/lib/constants.ts`)
  - 레이아웃: `grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]` 셸 + `max-w-[1600px]` 상한. ≥lg 2-페인, <lg 단일 컬럼 + 모바일 하단 고정 제출바(`env(safe-area-inset-bottom)`).
  - 유형 선택: 드롭다운 → 네이티브 `<input type="radio">` 카드화(아이콘+라벨+힌트). `TYPE_ICON` 상수 맵 추가. `useRequestTypes()` 동적 렌더, 로딩/빈 상태 처리.
  - 에디터 슬롯: `BodyEditorSlot.tsx` 분리(잠정 textarea, plain text body). 향후 서상연 팀장 에디터 교체 대비 슬롯 props 계약 명문화.
  - 첨부 드롭존: 드래그드롭 + 숨김 input+label(키보드 선택) + drag-over 상태 + 파일 칩(제거 버튼). 파일당 20MB 클라이언트 사전검증(서버 제한과 일치).
  - 사이드바(속성·공유): 긴급도·희망완료일 2열 → 공개범위 → 공유대상(기본 접힘, 선택 수 뱃지, 접어도 선택 보존) → 제출.
  - `useCreateRequest` 개선: 첨부 부분 업로드 실패 시 요청 중복 생성 없이 `{ id, seq, failedFiles, totalFiles }` 반환. 성공 화면에서 실패 파일만 기존 id로 재시도. "N건 중 M건 실패" 메시지에 `totalFiles`(N) 사용.
  - 접근성: 제출 검증 실패 시 첫 오류 필드로 포커스+scrollIntoView 이동. 제출 중 버튼 disabled + 입력 잠금.

### Fixed
- **접수폼 접근성 — 모바일 제출바 AT 접근 불가** (`RequestForm.tsx`): 모바일 하단 고정 제출바 컨테이너 `aria-hidden="true"` 제거. 스크린리더에서 '접수하기' 버튼 접근 가능.
- **접수폼 접근성 — 모바일 제출 버튼 form 연결 오류** (`RequestForm.tsx`): `<form id="request-form">` 추가, 버튼 `form="request-form-hidden"` → `form="request-form"` 수정. native form submission 정상화.
- **접수폼 접근성 — 유형 카드 aria-invalid 미표시** (`RequestForm.tsx`): type_code 오류 시 모든 radio에 `aria-invalid` + `aria-describedby="error-type_code"` 추가.
- **접수폼 접근성 — focusFirstError type_code 포커스 대상** (`RequestForm.tsx`): `fieldset`에 `id="fieldset-type_code" tabIndex={-1}` 추가. 오류 시 sr-only radio 대신 fieldset으로 포커스/스크롤해 시각 사용자도 이동 인지.
- **접수폼 접근성 — share-panel aria-controls 참조 DOM 부재** (`RequestForm.tsx`): `{shareOpen && <div>}` 조건부 렌더 → `<div hidden={!shareOpen}>` 방식으로 변경. `aria-controls="share-panel"` 항상 유효한 DOM 참조 유지.
- **접수폼 사이드바 2열 그리드 브레이크포인트** (`RequestForm.tsx`): `grid-cols-1 sm:grid-cols-2` → `grid-cols-[repeat(auto-fit,minmax(120px,1fr))]`. 뷰포트 기반 sm 대신 컨테이너 폭 기반 auto-fit으로 좁은 폭/확대 시 1열 fallback.
- **접수폼 부분 실패 메시지 총 파일 수 누락** (`RequestForm.tsx`, `api.ts`): `CreateRequestResult`에 `totalFiles: number` 추가. "첨부 N건 중 M건 실패"에서 N = `totalFiles`(시도 총 건수), M = `failedFiles.length`(실패 건수)로 정확히 표시.

- **P7 계정 관리 UI** (`src/features/accounts/Accounts.tsx`, `src/features/accounts/api.ts`)
  - `useUsers` 훅: `GET /api/users` 호출, 30s staleTime.
  - `useUpdateUser(userId)` 훅: `PATCH /api/users/:id` — role/dept/org_affil/dept_function 부분 수정.
  - `useImportOrgDirectory` 훅: `POST /api/org-directory/import {rows}` — org_directory 대량 upsert.
  - 사용자 목록 표: 이름·이메일·부서·소속기관·직무·역할. 행별 인라인 수정(수정 버튼 → 편집 행 전환 → 저장/취소).
  - CSV 업로드 패널: 파일 선택 → 클라이언트 파싱(헤더 email,name,dept,org_affil,dept_function,role) → 미리보기 행수 표시 → 가져오기 → 결과(upserted/skipped/errors) 표시.
  - 안내문: 부서·기관 변경은 신규 요청부터 반영(과거 스냅샷 유지) amber 배너.
  - 접근성: 역할 뱃지 색+텍스트 병용, 모든 버튼 `aria-label`, 표 `scope`, `role="alert"` 오류, `role="status"` 결과.

- **P8 인앱 알림 벨** (`src/components/NotificationBell.tsx`, `src/features/notifications/api.ts`)
  - `useNotifications` 훅: `GET /api/notifications` 30초 refetchInterval, 15s staleTime.
  - `useMarkRead` 훅: `POST /api/notifications/:id/read` 단건 읽음.
  - `useMarkAllRead` 훅: `POST /api/notifications/read-all` 전체 읽음.
  - `NotificationBell` 컴포넌트: TopNav 우측 배치(전 역할 노출). 미읽음 수 빨간 뱃지(색+숫자). 드롭다운 최근 50개 목록(메시지·시각), 미읽음 파란 점 구분, 항목 클릭 → 해당 요청 상세 이동 + 읽음 처리, '모두 읽음' 버튼.
  - Escape 키 / 외부 클릭으로 드롭다운 닫기, 포커스 복귀.
  - 접근성: `aria-label`(미읽음 수 텍스트 포함), `aria-haspopup`, `aria-expanded`, 패널 `role="dialog"`, `aria-live` 폴링 결과.

### Added
- **P6 대시보드 UI** (`src/features/dashboard/Dashboard.tsx`, `src/features/dashboard/api.ts`)
  - `useDashboardMetrics(from?, to?)` 훅: `GET /api/dashboard/metrics` 호출, React Query 60s staleTime.
  - 기간 필터: 연도 선택 / 월 선택 / 사용자지정(from-to) 3모드, URL 쿼리파라미터 전달.
  - KPI 카드: 미완료·기한초과+임박·P1/P2 미완료·재작업율·만족도.
  - 리드타임 중앙값: 1차 응답·해결 (시간→일+시간 가독 표기).
  - 노화 히스토그램: Recharts BarChart 4버켓 (`<3d / 3-7d / 7-14d / >14d`).
  - SLA 준수율: 응답·해결 % + 진행바.
  - 분포: 상태별·기관별·유형별 BarChart/PieChart, 유형별 월 추이 스택 BarChart, 담당자별 처리현황 표.
  - 접근성: 모든 차트 제목+요약 텍스트 병기, 색만 의존 금지, 로딩·빈 상태.

- **P5 내 요청 재설계** (`src/features/requests/MyRequests.tsx`, `src/lib/constants.ts`)
  - 기본 저장뷰: 진입 시 본인 탭 + 열린 상태(접수·진행중·보류) 기본 필터. 필터 상태를 `localStorage('my_requests_view_v1')`에 직렬화 자동 저장·복원.
  - 종결 포함 토글: 기본 꺼짐(완료·반려·철회 제외). 켜면 6종 전체 표시.
  - SLA/기한 컬럼: `due_status` 3단계 뱃지(색+텍스트+아이콘) + `resolution_due_at` 기준 D-N / N일 초과 상대표기.
  - 우선순위: `priority_level`(P1~P4, `PRIORITY_LEVEL_BADGE`) 표기. null → "미정". 옛 `priority` 컬럼 제거.
  - 접근성: 모든 뱃지 색+텍스트 병용, 표 `scope`, 버튼 `aria-pressed`, select `aria-label`.
  - 모바일 카드 뷰: `sm:` 미만에서 표 → 카드 레이아웃(Tailwind 반응형).
  - `OPEN_STATUSES` 상수 추가 (`src/lib/constants.ts`): `['접수', '진행중', '보류']`.

### Added
- **P4 요청 상세 재설계** (`src/features/requests/RequestDetail.tsx`, `src/features/requests/api.ts`)
  - 통합 타임라인: 상태변경 이력·코멘트·첨부를 시간순 한 피드로 병합. 내부메모는 amber 배경+뱃지로 시각 구분.
  - 댓글 작성기: 파일 다중 첨부, 시스템팀 내부메모/공개 토글(기본 내부), comment_id 링크 업로드.
  - SLA 표시: resolution_due_at + due_status 뱃지 + D-N 상대표기. 담당자·우선순위(priority_level) 요약 바.
  - 재작업 버튼: 시스템팀 & 완료 상태 → PATCH 진행중 전이, 사유 입력 모달.
  - 요청자 철회: 접수 상태에서 PATCH status:철회 (편집과 분리).
  - 편집 폼: priority 제거, urgency 입력으로 대체.
  - CSAT: 요청자 & 완료 & 미제출 시 👍/👎 + 선택 코멘트 → POST /csat, 제출 후 결과 표시.
  - 신규 훅: `useUploadCommentAttachment`, `useCsat`, `useRework`, `useAddComment` is_internal 지원+id 반환.
  - `RequestViewWithCsat` 인터페이스로 csat_rating/csat_comment 타입 확장.

### Fixed
- **리스트뷰 인라인 상태변경 — ALLOWED_TRANSITIONS 클라이언트 검증 추가** (`ManageBoard.tsx`): 리스트 뷰 상태 select에서 비허용 전이 선택 시 토스트로 차단하고 mutate 호출을 막음. 비허용 옵션은 `disabled` + "(불가)" 표시로 칸반 드래그와 동일한 동작 보장.
- **벌크 담당자 일괄변경 — 미배정 선택 가능하도록 수정** (`ManageBoard.tsx`): 일괄 담당자 select의 "미배정" 옵션 value를 `__unassigned__`로 변경해 플레이스홀더(`value=""`)와 구분. `applyBulkAssignee`에서 `__unassigned__` → `assignee_id: null`로 변환.
- **벌크 undo — 실제 캐시 복원 구현** (`ManageBoard.tsx`): `applyBulkStatus` undo 콜백에서 `queryClient.setQueryData(['requests','view'], result.previous)` 호출로 직전 스냅샷을 즉시 복원. 이전에는 토스트만 표시하고 캐시를 복원하지 않았음.
- **cancelQueries 범위 축소** (`features/requests/api.ts`): `useChangeStatus`·`useChangeAssignee`의 `onMutate`에서 `cancelQueries({ queryKey: ['requests'] })` → `cancelQueries({ queryKey: ['requests','view'] })`로 변경해 detail/comments/history/attachments 하위 쿼리 취소 방지.

### Added
- **관리 보드 P3 BoardUI 재설계** (`src/features/board/ManageBoard.tsx`)
  - 트리아지 존: `status='접수' && assignee=null` 건을 상단 미배정 큐로 표시. 배정 모달(담당자 + 영향도 + 예상 priority_level 미리보기) → `useAssignRequest`.
  - 칸반 5컬럼(접수·진행중·보류·완료·반려): 헤더 건수, WIP 한도(12) 초과 시 amber 강조.
  - 카드: priority_level 뱃지(P1~P4/미정), seq, 제목, 기관, 유형, SLA(due_status + D-N 상대표기), 담당자 인라인 선택, 재작업 뱃지.
  - HTML5 드래그 드롭 상태 전이: `ALLOWED_TRANSITIONS` 선검증, 불허 시 토스트, `useChangeStatus` 낙관적 업데이트+실패 롤백. 접수→진행중 드롭은 배정 모달 트리거.
  - 인라인 담당자 변경: `useChangeAssignee`로 status PATCH와 분리.
  - 종결 포함 토글(완료·반려·철회 기본 제외) + 기간 없이 단순 토글.
  - 벌크 선택+일괄 상태/담당자 변경(`useBulkUpdate`) + undo 토스트.
  - 저장뷰: 필터 상태 localStorage 자동 저장/복원(`manage_board_filters_v1`).
  - 리스트 뷰 토글 유지 + 전체 선택 체크박스.

### Fixed
- **supabase.ts 타입 갱신**: `requests` 테이블에 `urgency` (`urgency_level` enum) · `intake_detail` (jsonb) 컬럼 추가, `urgency_level` enum (`높음`/`보통`/`낮음`) Enums 섹션에 추가.
- **intake 필드 오류 미해제 버그**: `setIntakeField` 내부에서 오류 키를 `intake_${key}` 형식으로 조회하도록 수정 — 값 입력 시 붉은 테두리·오류 메시지가 정상 해제됨.
- **희망완료일 과거 날짜 차단**: `<input type="date">` 에 `min={today}` 추가, `validate()` 에 과거 날짜 조건 추가.
- **접근성 — label/input 명시적 연결**: 모든 `<label>`에 `htmlFor`, 대응 입력 요소에 `id` 부여 (유형·제목·상세·긴급도·희망완료일·공개범위·첨부·intake 동적 필드 포함).
- **Urgency 타입 중복 제거**: `api.ts`의 독립 정의 삭제 → `constants.ts`를 단일 정본으로, `api.ts`는 import 후 re-export.

### Added
- **P2 접수폼 재설계**: 유형 우선(type-first) 흐름 — 유형 선택 후 해당 타입 전용 intake_detail 필드 노출 (`error`/`feature`/`data`/`file` 각 2~3개 필드).
- `URGENCY_OPTIONS` (`높음`/`보통`/`낮음`) 및 `TYPE_FIELDS` 맵을 `src/lib/constants.ts`에 추가.
- `Urgency` 타입을 `src/lib/constants.ts`에 추가.
- 접수폼 인라인 검증: 공통 필수 필드(유형·제목·희망완료일·긴급도·공개범위) + 타입별 intake_detail 필수 키 미충족 시 필드 근처에 오류 메시지 표시, 제출 차단.

### Changed
- 접수폼에서 우선순위(priority) 입력 제거 → 긴급도(urgency) 입력으로 대체. 우선순위(priority_level)는 배정 시 시스템팀이 설정.
- `CreateRequestInput`에서 `priority` 제거, `urgency`·`intake_detail` 추가. `body` 선택 필드로 변경.
- `useCreateRequest` 뮤테이션 페이로드: `priority` → `urgency`, `intake_detail` 추가.
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
