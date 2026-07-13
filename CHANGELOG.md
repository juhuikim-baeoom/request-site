# Changelog

이 프로젝트의 주요 변경 사항을 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/), 버전은 [SemVer](https://semver.org/)를 따른다.

## [Unreleased]

### Fixed
- **대시보드 해결-SLA 준수율이 `final_resolved_at`(요청자 검수) 기준이던 것을 `first_resolved_at`(팀 종료) 기준으로 정정** (`server/src/routes/dashboard.ts`): 팀이 기한 안에 검수대기로 넘겼어도 요청자가 늦게 검수하면 SLA 위반으로 잘못 집계되던 문제. 리드타임 지표(`final_resolved_at` 기반)는 변경 없음.
- **재작업 후 재검수 라운드에서 3일차 리마인더가 재발송되지 않던 문제 수정** (`server/drizzle/0009_rearm_inspection_reminder.sql`): `on_status_change` 트리거가 검수대기 진입 시 `inspection_reminder_sent_at`을 재설정하지 않아, 1차 검수 리마인더 발송 후 반려→재작업→재검수로 돌아가도 2차 검수에서는 리마인더가 다시 나가지 않았다. 검수대기 진입 시 `inspection_reminder_sent_at := null`로 재무장하도록 수정.

### Added
- **검수대기 단계와 완료 후 이의제기** (`server/drizzle/0005_add_inspection_enums.sql` ~ `0008_inspection_reminder.sql`, `server/src/services/transition.ts`, `server/src/routes/disputes.ts`, `server/src/jobs/auto-complete.ts`, `src/features/requests/RequestDetail.tsx`)
  - `request_status` enum에 `검수대기` 추가(`진행중`과 `보류` 사이). 작업 종료 시 요청자 검수를 거쳐야 완료에 도달한다.
  - 요청자 검수 승인: 만족도 1~5점 별점(`csat_rating`, 4점 이상=긍정)과 선택 코멘트를 검수 확인 시점에 수집 후 `완료`(`completion_route='REQUESTER'`)로 전이.
  - 요청자 재작업 요청: 검수대기에서 사유(필수) 입력 후 `진행중`으로 되돌림(`rework_count +1`).
  - 자동완료 배치: 검수대기 진입 7일 무응답 시 자동 완료(`completion_route='AUTO'`), 3일차에 리마인더 알림 1회 발송(`inspection_reminder_sent_at`).
  - 시스템팀 강제완료: 검수를 건너뛰고 사유(`completion_note`)와 함께 완료 처리(`completion_route='SYSTEM_FORCED'`).
  - 이의제기(`request_disputes` 테이블): 완료 후 14일 이내 요청자가 이의 제기 → 시스템팀 심사(수락 시 `완료 → 진행중` 재작업 전이, 기각 시 완료 유지 + 사유 통보). 한 요청당 동시 열린 이의 1건 제한(부분 유니크 인덱스 `request_disputes_one_open`).
  - 알림: `notification_type`에 `dispute` 추가. 검수대기 진입·3일 리마인더·자동완료·이의 접수·이의 심사 완료 시점에 발송.
  - 대시보드 신규 지표 4종: 이의제기율, 이의 수락률, 평균 검수 소요일, 완료 경로 분포(`REQUESTER`/`AUTO`/`SYSTEM_FORCED`), 열린 이의 수.

### Changed
- `진행중 → 완료` 직행 전이를 제거했다. 완료에 도달하려면 반드시 검수대기를 거쳐야 한다.
- `first_resolved_at`이 최종 완료가 아니라 검수대기 최초 진입 시점을 가리키도록 바꿨다(해결 SLA 판정 기준). `final_resolved_at`/`completed_at`은 요청자가 최종 납득한(완료 확정) 시점을 가리킨다(종결 리드타임 기준). 요청자가 검수를 늦게 해도 팀의 해결 SLA가 부당하게 위반되지 않게 하기 위함.
- 재작업률(`rework_rate`)이 검수대기 반려(`검수대기 → 진행중`)도 포함하도록 넓어졌다. 완료 → 진행중(이의제기 수락)만 세던 기존 정의보다 넓다.
- CSAT를 thumbs(👍/👎, `rating -1/1`)에서 1~5점 별점으로 전환했다. 수집 시점도 별도 `/csat` 엔드포인트 호출에서 요청자의 검수 승인 순간으로 이동. 대시보드 "만족도" 지표 기준을 `rating >= 4`로 재정의.
- 구 thumbs CSAT 엔드포인트 `POST /api/requests/:id/csat`와 프론트 `useCsat` 훅을 제거했다(`server/src/routes/request-detail.ts`, `src/features/requests/api.ts`). CSAT가 1-5점 검수 승인 경로로 대체되며 사용되지 않게 됐고, 완료 상태인 `AUTO`/`SYSTEM_FORCED` 건(`csat_rating` null)에 직접 호출 시 thumbs 값 `-1`이 1-5점 컬럼에 잘못 저장될 위험이 있어 제거했다.

### Added
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
