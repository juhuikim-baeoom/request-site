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
- **요청 목록 탭 — 역할마다 뜻이 바뀌던 2탭을 "열람 근거"별 4탭으로 재설계** (`src/features/requests/MyRequests.tsx`, `src/features/requests/api.ts`, `server/src/authz.ts`, `server/src/routes/requests.ts`): 기존 2탭(`나의 요청` / 나머지)은 두 번째 탭 라벨이 역할에 따라 "전체"·"우리 기관"·"우리 부서"·"공유받은 요청"으로 바뀌어, 같은 자리가 사람마다 다른 범위를 뜻했다. `나의 요청` · `공유받은 요청` · `우리 기관`/`우리 부서`(모니터 역할 전용) · `전체`로 나눈다.
  - **탭 = 서버가 정의하는 열람 근거**(①내가 요청자 ②모니터 소속 범위 ③공유 ④전체열람 특권)**와 1:1**. `visibilityFilter`는 사실 `① or ② or ③`의 합이었으므로 ②③을 `monitorScopeSql`·`sharedWithMeSql`로 떼어내 필터와 탭이 같은 SQL 조각을 공유하게 했다 — 두 곳이 갈라져 어긋나는 걸 막기 위함.
  - **"공유받은 요청"은 공유 근거(③)만 센다.** 역할 특권(②④)으로 보이는 건은 제외한다 — 그러지 않으면 `system`·`exec`에게 회사 전체 요청이 "공유받은"으로 표시돼 라벨이 거짓말이 된다. 프론트는 `requester_id` 비교밖에 못 하므로 서버가 행마다 **`shared_to_me`·`in_monitor_scope` 플래그**를 내려준다(`GET /api/requests`, 응답에 컬럼 2개 추가). 둘 다 "내 것이 아닌 것"만 참(내 요청은 `나의 요청` 탭에만 속한다).
  - **탭은 칸막이가 아니라 필터다** — 우리 부서 요청이면서 공개범위가 `dept`인 건은 두 탭에 모두 나온다. `전체`는 항상 상위집합.
  - **모니터 탭은 그 근거를 가진 역할에게만** 노출(라벨도 역할별로 하나뿐 → 뜻이 안 바뀜). **`전체`는 모두에게** 노출하되 범위는 서버 `visibilityFilter`가 정한다 — staff의 `전체`는 회사 전체가 아니라 "내가 볼 수 있는 전부". "모니터링 요청"이라는 라벨은 쓰지 않았다(시스템 역할명 `*_monitor`가 새어나온 개발자 언어).
  - **권한 변화 없음** — 노출 범위는 `visibilityFilter` 그대로다(리팩터 전후 동치).
  - **저장뷰는 유지된다**: 키(`my_requests_view_v1`)를 올리지 않았다 — 올리면 상태·유형·기관·정렬·종결포함까지 함께 초기화된다. 복원 시 필드별로 검증해 폐기된 탭 값(`others`)이나 현재 역할에 없는 탭이면 **탭만** `나의 요청`으로 떨구고 나머지 필터는 그대로 되살린다.
- **요청 목록 — 공유범위를 제목 셀에서 독립 컬럼으로 분리** (`src/features/requests/MyRequests.tsx`, `src/components/VisibilityBadge.tsx`): 공개범위 뱃지가 제목 아래에 얹혀 있어 별도 항목으로 읽히지 않았고, 공유대상 칩이 늘어날수록 제목 줄이 밀렸다. 표에 **공유범위** 열을 추가하고(총 10열) 뱃지를 그 열로 옮겼다.
  - **너비를 `<colgroup>` + `table-fixed`로 고정**한다 — 각 열 텍스트 길이 비율로 배정하되 제목을 가장 넓게(접수번호 9 · 제목 22 · 공유범위 13 · 기관 6 · 유형 9 · 우선순위 7 · 상태 7 · SLA 기한 10 · 담당 6 · 접수일 11%). 표 최소폭 `min-w-[900px]` → `min-w-[1100px]`. 자동 너비로 두면 공유대상이 많은 한 행이 제목 열을 짓눌러 열 폭이 행마다 흔들린다. 제목·유형은 넘치면 말줄임(전문은 `title` 속성).
  - **`VisibilityBadge`에 `maxTargets` 옵션 추가**: 목록은 공유대상 칩 2개까지만 보이고 나머지는 `외 N개`로 접는다(전문은 `title`). 미지정 시 전부 표시하므로 **요청 상세 등 기존 호출부는 동작 불변**이다. 공유대상 수가 열 너비를 좌우하면 최악 행 하나가 표 전체 레이아웃을 결정해 버리기 때문.
  - **데이터·API·권한·모바일 카드 뷰는 불변**이다.
- `진행중 → 완료` 직행 전이를 제거했다. 완료에 도달하려면 반드시 검수대기를 거쳐야 한다.
- `first_resolved_at`이 최종 완료가 아니라 검수대기 최초 진입 시점을 가리키도록 바꿨다(해결 SLA 판정 기준). `final_resolved_at`/`completed_at`은 요청자가 최종 납득한(완료 확정) 시점을 가리킨다(종결 리드타임 기준). 요청자가 검수를 늦게 해도 팀의 해결 SLA가 부당하게 위반되지 않게 하기 위함.
- 재작업률(`rework_rate`)이 검수대기 반려(`검수대기 → 진행중`)도 포함하도록 넓어졌다. 완료 → 진행중(이의제기 수락)만 세던 기존 정의보다 넓다.
- CSAT를 thumbs(👍/👎, `rating -1/1`)에서 1~5점 별점으로 전환했다. 수집 시점도 별도 `/csat` 엔드포인트 호출에서 요청자의 검수 승인 순간으로 이동. 대시보드 "만족도" 지표 기준을 `rating >= 4`로 재정의.
- 구 thumbs CSAT 엔드포인트 `POST /api/requests/:id/csat`와 프론트 `useCsat` 훅을 제거했다(`server/src/routes/request-detail.ts`, `src/features/requests/api.ts`). CSAT가 1-5점 검수 승인 경로로 대체되며 사용되지 않게 됐고, 완료 상태인 `AUTO`/`SYSTEM_FORCED` 건(`csat_rating` null)에 직접 호출 시 thumbs 값 `-1`이 1-5점 컬럼에 잘못 저장될 위험이 있어 제거했다.
- **공유대상 표기 통일 — 라벨 규칙이 세 곳에 흩어져 있던 문제** (`src/lib/constants.ts`의 `sharedTargetLabel`, `VisibilityBadge.tsx`, `RequestDetail.tsx`, `SharingTargetPicker.tsx`): 같은 공유대상이 화면마다 다르게 보였다 — 공개범위 뱃지는 `배움_교학팀`(밑줄), 선택 피커의 칩은 `배움 › 교학팀`, 활동 타임라인의 공유변경 행은 직무를 `시스템팀`(값 그대로)으로 적었다. 규칙을 `sharedTargetLabel()` 하나로 모아 세 곳이 공유한다: 직무는 "○○팀 전체", 세부부서는 "기관 › 팀". 후보 목록에 없는 값(조직도에서 빠진 팀 등)도 전송값에서 라벨을 만들어 항상 표시한다. `deptTargetLabel`(밑줄 표기)은 소비자가 없어져 제거했다. 전송값(`target_value`)은 불변.
- **공유대상 선택 UI — 체크박스 17개 → 검색 + 칩** (`src/features/requests/SharingTargetPicker.tsx` 신규, `SharingEditor.tsx`): 340px 사이드바에 체크박스 17개(직무 6 + 세부부서 11)를 격자로 펼치다 보니 줄바꿈이 제멋대로 나고 `배움_교학팀` 같은 밑줄 라벨이 반복돼 읽기 어려웠다. 더 근본적으로는 **구조가 사용 빈도와 거꾸로**였다 — 공개범위 select가 흔한 경우를 이미 덮으므로 공유대상은 예외용이고 실제 선택은 대부분 0개인데, 거의 쓰지 않는 선택지 17개를 항상 펼쳐두고 있었다.
  - 기본 상태는 입력칸 한 줄("+ 공유대상 추가" 접힘 토글 제거). 타이핑하면 후보가 좁혀지고, 고른 것만 칩으로 남는다. 이미 고른 항목은 후보에서 빠진다.
  - 표기를 정리했다: 직무는 "○○팀 전체", 세부부서는 "기관 › 팀"(예: `배론 › 상담영업팀`). **공유대상 피커에서는** 밑줄 표기(`배움_교학팀`)를 쓰지 않는다(`deptTargetLabel`은 요청 상세 뱃지 등 다른 화면에서 여전히 밑줄 표기로 쓰인다).
  - 키보드 지원(↑↓·Enter·Esc·빈 입력칸에서 Backspace) + WAI-ARIA combobox/listbox 패턴. 선택 결과는 `aria-live`로 알린다.
  - 공유대상 선택을 `SharingTargetPicker`로 분리했다. `SharingEditor`의 props는 불변이라 호출부(접수 폼·요청 상세)는 바뀌지 않는다.
  - **데이터·API·권한은 불변**이다. 서버로 보내는 값(`target_type`·`target_value`)과 화이트리스트 검증은 그대로다.
- **화면 명칭 정리 — "내 요청" 3중 중복 제거** (`src/components/TopNav.tsx`, `src/features/requests/MyRequests.tsx`, `RequestDetail.tsx`, `RequestForm.tsx`): 메뉴 "내 요청" → 페이지 제목 "내 요청 목록" → 탭 "내 요청"으로 같은 단어가 세 겹으로 반복되고, 되돌아가기 링크만 "내 요청 목록"이라 메뉴와 어긋나던 문제를 정리했다.
  - **메뉴·제목은 장소, 탭은 범위**로 역할을 나눴다: 메뉴/제목 "요청 목록", 탭 "나의 요청" / "전체"·"우리 기관"·"우리 부서"·"공유받은 요청"(역할별).
  - 상세 되돌아가기 "← 요청 목록", 접수 완료 화면 "요청 목록 보기".
  - **"관리 보드" → "요청 처리", "미배정 큐" → "배정 대기"**: 메뉴가 "요청 접수 · 요청 목록 · 요청 처리"로 이어지는 하나의 동사 흐름이 된다. "보드"(칸반 도구의 은유)와 "큐"(자료구조 이름)는 개발자 언어라, 화면이 실제로 무엇을 하는 곳인지 말해주지 못했다. "배정 대기"는 그 영역의 "배정" 버튼과 자연스럽게 이어진다.
  - "티켓" 도입은 채택하지 않았다 — 이 시스템의 언어가 이미 "요청"(요청자·요청 접수·접수번호)으로 통일돼 있어 두 언어가 섞이고, 티켓은 IT 헬프데스크 은어라 실제 사용자(교학·상담영업 등)에게 낯설다. 실제 문제는 단어가 아니라 계층 중복이었다.

### Added
- **공유 설정 사후 수정** (`server/src/services/sharing.ts`, `PUT /api/requests/:id/sharing`, `GET /api/requests/:id/sharing-history`, `src/features/requests/SharingEditor.tsx`, `server/drizzle/0007_request_sharing_history.sql`): 접수 후에도 공개범위와 공유 대상(직무·세부부서)을 바꿀 수 있다. 처리 중 다른 부서·기관이 봐야 한다는 사실이 드러났을 때 대응할 수 있게 하기 위함이다.
  - 권한 `canChangeSharing`(`server/src/authz.ts`): `canProcess`(system·system_admin) 또는 요청자 본인(상태 무관, 종결 후에도). 공유는 처리 내용을 바꾸지 않고 "누가 볼 수 있는가"만 바꾸므로 본문 편집(`canProcess` 또는 요청자 본인 && `status='접수'`)보다 넓게 열었다. 서버가 DB의 `requester_id`로 판정한다.
  - 공유 대상은 **전체 교체** — 넘긴 목록이 곧 최종 상태이므로 추가·제거가 한 번의 호출로 처리된다. 입력 검증 헬퍼 `parseSharedTargets()`를 접수(`POST /api/requests`)와 이 엔드포인트가 공유해, 잘못된 `target_type`/`target_value`가 DB CHECK 위반으로 새어 500이 되던 비대칭을 없앴다(400 `INVALID_TARGET_TYPE`/`INVALID_TARGET_VALUE`/`INVALID_SHARED_TARGETS`). 접수(POST)의 공유 대상 와이어 키를 `sharedTargets` → `shared_targets`로 통일했다(클라이언트도 함께 수정).
  - 공유 대상 선택 UI를 `SharingEditor`로 추출해 접수 폼과 상세 화면이 공유한다. 상세 화면에는 공개범위 뱃지 옆 "공유 범위 수정" 버튼(권한 있는 사람에게만)으로 노출된다.
  - 변경 이력을 `request_sharing_history`(마이그레이션 `0007`)에 남긴다. `added`/`removed`는 서버가 기존 목록과 비교해 계산한다(클라이언트가 보낸 값은 신뢰하지 않음). 공개범위·공유 대상이 둘 다 그대로면 이력을 남기지 않는다. TOCTOU 방지를 위해 `SELECT ... FOR UPDATE`로 요청 행을 잠근 뒤 같은 트랜잭션에서 교체·이력 기록을 수행한다.
  - 이력은 상세 응답에 포함하지 않고 독립 엔드포인트 `GET /api/requests/:id/sharing-history`로 서빙한다 — 이 코드베이스가 상태 이력·첨부를 독립 엔드포인트로 서빙하는 기존 관례를 따랐다. 권한은 `canSeeRequest`(요청을 볼 수 있으면 이력도 볼 수 있음), 거부 시 404. 상세 화면의 통합 타임라인에 "공유변경" 행으로 표시된다.
  - 새로 공유된 사람들에게 알림은 보내지 않는다 — 공유 대상은 직무·부서 단위라 한 번 추가하면 대상 인원이 넓어 알림 스팸이 되기 때문이다.
  - 테스트 `test:sharing`(`server/scripts/test-sharing.ts`) 14건: 권한(무관한 staff 403 · 요청자 본인 · 시스템팀 · exec는 열람 가능하나 처리 불가 403) · 열람 불가 시 이력도 404 · 공유 추가 후 대상 부서 사용자 목록에 실제로 나타나는지 · 이력 added 기록 · `GET .../sharing-history` 응답 내용(actor·added·removed) · 전체 교체 + added/removed 기록 · 무변경 시 이력 없음 · 종결 건 요청자 본인 변경 가능 · `PATCH` 우회로 차단(400) · 없는 요청 id 404 · 잘못된 입력 3종(400) · 중복 대상 dedupe · visibility만 변경 시 대상 행 id/created_at 보존.

### Changed
- **`visibility`를 `PATCH /api/requests/:id`에서 제거** (`server/src/routes/requests.ts`): 공개범위는 `PUT /api/requests/:id/sharing`으로만 바꾼다. 권한 규칙이 다른 두 경로가 같은 컬럼을 쓰면 낮은 쪽이 우회로가 되므로, 기존 `PATCH`는 400 `USE_SHARING_ENDPOINT`로 거부한다. 요청 상세의 본문 편집 폼에서 공개범위 select를 제거했다.
- **`RequireRole`이 역할 배열 대신 능력 술어를 받도록 변경 — 능력→역할 매핑 드리프트 함정 제거** (`src/auth/RequireRole.tsx`, `src/routes.tsx`, `src/components/TopNav.tsx`, `src/lib/permissions.ts`): `TopNav.tsx`의 메뉴 `roles` 배열과 `routes.tsx`의 `RequireRole allow={[...]}`가 능력→역할 매핑을 `src/lib/permissions.ts`와 별도로 두 곳 더 복제하고 있어, 역할이 늘 때마다 세 곳을 다 고쳐야 하고 하나라도 빠뜨리면 메뉴 노출과 실제 접근 권한이 어긋날 수 있었다. `RequireRole`의 prop을 `allow: UserRole[]` → `can: (role) => boolean`으로 바꾸고 `routes.tsx`가 `canProcess`·`canSeeDashboard`·`canManageAccounts`를 직접 전달하도록 수정, `TopNav.tsx`의 `NAV_ITEMS`도 `roles` 배열 대신 같은 능력 함수를 참조하도록 변경했다. "요청 접수"·"내 요청"처럼 특정 능력이 아니라 "폐기되지 않은 로그인 역할 전부"에 노출하던 항목을 위해 `permissions.ts`에 `canAccessApp`(내부적으로 `constants.ts`의 `ASSIGNABLE_ROLES`를 참조)을 신설 — 이로써 능력→역할 매핑의 소스는 `src/lib/permissions.ts` 하나로 수렴한다. 노출 규칙 자체(요청 접수·내 요청=전 역할, 관리 보드=`canProcess`, 통계=`canSeeDashboard`, 계정 관리=`canManageAccounts`)는 변경 없음. 권한 경계는 여전히 서버(`server/src/authz.ts`)가 강제하며 이번 변경은 클라이언트 화면 노출 로직에만 영향을 준다. `grep -rn "RequireRole" src/`로 다른 사용처가 없음을 확인했다.
  - docs sync: 화면 노출 규칙 불변(내부 리팩토링) — `docs/reference/requirements.md`·`docs/00-overview/index.md` 갱신 스킵.

### Fixed
- **병합 직전 최종 리뷰 지적 5건 — 공유대상 검색+칩 브랜치** (`src/features/requests/SharingTargetPicker.tsx`, `CHANGELOG.md`, `docs/superpowers/specs/2026-07-14-sharing-target-picker-design.md`):
  - **[Important] 후보에 없는 공유대상이 칩으로 안 보이고 해제도 못 하던 유령 공유**: 칩 목록(`selected`)을 후보 목록(`allCandidates`)의 부분집합으로 계산하고 있어, 저장된 값이 후보에 없으면(조직도에서 그 세부부서가 빠졌거나 `useDeptOptions()`가 아직 로딩/실패 중이면) 칩이 아예 렌더되지 않았다. 그런데 부모 Set(`fnTargets`·`deptTargets`)에는 값이 그대로 남아 있어 저장하면 그 공유가 다시 저장됐다 — 화면은 "공유대상 없음"이라고 알리는데(`aria-live`) 실제로는 공유가 살아 있고 UI로 해제할 방법이 없었다. `selected`를 부모 Set 기준으로 다시 계산하도록 수정: 후보 목록에서 라벨을 찾되, 없는 값은 `parseDeptTargetValue()`로 `기관 › 팀` 라벨을 만들어(직무는 `값 전체`) 대체 후보를 만든다. 서버로 보내는 값(`target_value`)은 그대로 두고 라벨만 만들어낸다. 실제 재현으로 확인: 서버 화이트리스트는 통과하지만(`ORGS`·`FUNCTION_TARGETS` 조합) `org_directory`에 없는 조합(`허브|시스템팀`)으로 요청을 만들어 `/api/dept-options` 응답에는 없음을 확인한 뒤, 상세 화면의 "공유 범위 수정" 패널에서 칩이 뜨고 ✕로 해제되는 것을 브라우저로 확인.
  - **[Important] 키보드로 8번째 이후 후보로 내려가면 활성 항목이 목록 밖으로 나가던 문제**: 목록이 `max-h-56`(약 7개 높이)인데 검색어가 없으면 17개가 뜨고, `activeIndex`만 바뀌고 스크롤은 따라가지 않았다. `activeIndex`·`open`이 바뀔 때 해당 옵션을 `scrollIntoView({ block: 'nearest' })`로 보이게 하는 effect를 추가.
  - **[Minor] Esc로 목록을 닫아도 입력칸에 검색어가 남으면 Enter가 접수 폼을 제출하던 문제**: `preventDefault()`가 `if (open)` 안에만 있어 검색어가 남은 채 닫힌 상태에서 Enter를 누르면 그대로 새어 나갔다. `query !== ''`일 때도 Enter의 기본 동작을 막도록 분기 추가(단, 활성 후보 선택은 목록이 열려 있을 때만).
  - **[Minor] 빈 상태 문구가 `listbox`의 잘못된 자식이던 문제**: `role="listbox"` 밑에 `role="option"`이 아닌 `<li>`가 있어 스크린리더가 건너뛸 수 있었다. `role="option"` + `aria-disabled="true"`로 수정(선택 불가이므로 `id`·`onClick` 없음).
  - **[Minor] `aria-selected` 오용 + 활성 표시가 색만으로 전달되던 문제**: `aria-selected={i === activeIndex}`는 "포커스 중"을 "선택됨"으로 잘못 표현하고 있었다(이 목록은 선택되는 즉시 후보에서 빠지므로 남은 항목은 전부 미선택이 맞다) — 제거했다. 활성 항목 표시에 `border-l-2`(좌측 인디케이터) + `font-medium`을 더해 배경·글자색만이 아닌 비색상 단서를 추가. 칩 `<ul>`에 `aria-label="선택된 공유대상"` 추가.
  - CHANGELOG의 "밑줄 표기는 쓰지 않는다" 서술을 "공유대상 피커에서는"으로 한정했다(`deptTargetLabel`은 요청 상세 뱃지에서 여전히 밑줄 표기로 쓰인다). 설계 스펙에 "후보 목록에 없는 저장값도 칩으로 표시하고 해제할 수 있다"는 규칙을 추가했다(§1).
  - 검증: `npx tsc --noEmit` 통과, `test:sharing`(14)·`test:intake`(6)·`test:api`·`db:smoke` 전부 통과. I-1은 코드 확인에 그치지 않고 실제로 재현·검증했다(위 서술 참고).
- **병합 직전 최종 리뷰 지적 7건 — 공유 설정 사후 수정 브랜치** (`server/src/services/sharing.ts`, `server/src/http.ts`, `server/src/routes/meta.ts`, `server/scripts/test-sharing.ts`, `server/scripts/test-api-list.ts`, `server/scripts/test-api-write.ts`, `src/lib/constants.ts`, `src/features/requests/RequestForm.tsx`, `CHANGELOG.md`):
  - **[Important] `GET /api/dept-options`가 화이트리스트 밖 `dept_function`을 내보내 접수를 깨뜨릴 수 있던 문제**: 접수 폼·공유 수정 패널의 세부부서 체크박스는 이 엔드포인트가 내려주는 옵션으로 렌더되는데, 그 값의 원천인 `org_directory.dept_function`은 조직도 CSV import·계정 관리 `PATCH` 어느 쪽도 검증하지 않는 자유 텍스트다. 화이트리스트(직무 6종) 밖 값(오타·빈 문자열·신규 팀명)이 옵션으로 노출되면 사용자가 체크했을 때 `parseSharedTargets`가 400 `INVALID_TARGET_VALUE`로 거부해 접수 전체가 실패했다(공유만 누락되는 게 아니라 제출 자체가 막힘). 실제로 로컬 DB의 `org_directory`에 `dept_function=''`(빈 문자열, NULL 아님) 행이 4건 있었고 `/api/dept-options`가 이를 그대로 응답에 실어 보내고 있었다 — UI가 깨지지 않은 유일한 이유는 클라이언트(`SharingEditor.tsx`)의 `if (!o.dept_function) continue` falsy 가드였다. `/api/dept-options`가 화이트리스트(직무 6종)에 있는 값만 내보내도록 필터해, 검증 불가능한 옵션이 애초에 화면에 뜨지 않게 했다(fail-safe: 400 대신 "옵션 미표시"). 직무 6종 상수 `FUNCTION_TARGETS`를 `server/src/services/sharing.ts`에서 `server/src/http.ts`(`ORGS`·`VISIBILITIES`와 같은 위치)로 옮겨 `sharing.ts`(입력 검증)와 `meta.ts`(옵션 노출 필터)가 하나의 정의를 공유하도록 했다 — 서버 내 정의는 한 곳. 회귀 테스트(`test:api`, `test-api-list.ts`): 화이트리스트 밖 값(`'없는팀'`)·빈 문자열 `dept_function`을 가진 `org_directory` 행을 `try/finally`로 임시 삽입해 `/api/dept-options` 응답에서 빠지는지 확인, 정상 직무 값도 함께 삽입해 과잉 차단이 없는지(여전히 응답에 포함) 확인. 수정 전/후 실제 DB 조회로 재현: 수정 전 12행(빈 문자열 `공통 | ` 포함) → 수정 후 11행(빈 문자열 제외, 나머지 전부 보존).
  - **[Minor] 서버 `FUNCTION_TARGETS` 사본 주석이 클라이언트를 가리키는 단방향이었던 문제** (`src/lib/constants.ts`): 위 이동으로 서버 사본(`server/src/http.ts`)의 주석은 여전히 클라이언트 `src/lib/constants.ts`를 참조하지만, 클라이언트 쪽에는 역참조가 없어 한쪽만 고치고 다른 쪽을 놓치기 쉬웠다. 클라이언트 `FUNCTION_TARGETS`에도 "서버 사본(`server/src/http.ts`)과 동일해야 한다"는 주석을 추가해 양방향으로 연결했다.
  - **[Important] `target_value`가 사실상 무검증이었던 문제** (`server/src/services/sharing.ts`): `parseSharedTargets()`가 빈 문자열이 아닌 모든 문자열을 통과시켜, 설계 스펙(`docs/superpowers/specs/2026-07-13-sharing-edit-design.md` §2)·`docs/reference/db-schema.md`가 서술하는 "`target_value`는 `FUNCTION_TARGETS`(6종)와 `기관|직무` 형식이어야 하고 위반 시 400" 검증이 실제로는 구현돼 있지 않았다(문서가 구현보다 강하게 주장). 권한 상승은 아니지만(임의 문자열은 실제 조직 값과 정확히 일치할 때만 매칭) 오타를 치면 "공유했다고 뜨는데 아무에게도 안 보이는" 상태가 되고, 임의 문자열이 `request_shared_targets`에 영속화돼 타임라인·뱃지에 그대로 렌더되는 문제가 있었다. `target_type='function'`이면 직무 6종 중 하나인지, `target_type='dept'`이면 `기관|직무` 형식(기관은 `ORGS`, 직무는 위 6종)인지 검증하도록 수정 — `parseSharedTargets()` 한 곳만 고쳐 접수(POST)·공유 변경(PUT) 양쪽에 동시 적용된다. 서버에 `FUNCTION_TARGETS` 사본을 신설했다(`server/src/http.ts`의 `ORGS`·`VISIBILITIES`와 같은 관례 — 서버는 클라이언트 코드를 import할 수 없어 클라이언트 `src/lib/constants.ts`의 `FUNCTION_TARGETS`와 동일해야 한다는 주석을 남겼다). 위반 시 기존과 같이 400 `INVALID_TARGET_VALUE`. 회귀 테스트 4건(`test:sharing`): 존재하지 않는 직무(`'없는팀'`)·구분자가 틀린 dept 값(`'배움-교학팀'`)·존재하지 않는 기관(`'없는기관|교학팀'`)은 각각 400, 정상 값(직무 6종·`기관|직무` 형식)은 여전히 통과(과잉 차단 방지).
  - **[Important] seq 3자리 회귀 테스트가 실접수가 있는 DB에서 항상 실패하던 문제** (`server/scripts/test-api-write.ts`): 99건 시드 블록이 `seq`를 `d-01`~`d-99`로 직접 insert했는데, `requests.seq`가 unique라 오늘자(KST) 실접수가 한 건이라도 있으면 `d-01` 삽입이 항상 unique 위반으로 실패했다(게다가 그 insert가 `try` 블록 밖이라 실패 시 시드 정리도 안 됨). 오늘자 기존 채번 최댓값(`max(split_part(seq,'-',2)::int)`)을 먼저 읽어 그 다음 번호부터 99까지만(이미 99 이상이면 시드 없이) 채우고, 다음 접수가 100 이상 번호에서 잘리지 않는지 확인하도록 수정. 시드도 `try` 블록 안으로 옮겨 실패 시에도 `finally`에서 정리되게 했다.
  - **[Minor] `RequestForm.tsx`의 `visibility` 오류 처리 죽은 코드 제거**: select 기본값이 항상 `'dept'`라 도달 불가능했던 `if (!visibility)` 검증 분기, 절대 렌더되지 않던 오류 `<p id="error-visibility">`, 관련 오류 키(`FIELD_PRIORITY`의 `'visibility'`)와 `clearFieldError('visibility')` 호출을 제거했다.
  - **[Minor] 공유 대상 제거(열람 권한 회수) 테스트 부재** (`server/scripts/test-sharing.ts`): "공유 추가 → 보인다"는 있었지만 "공유 제거 → 다시 안 보인다"가 없었다. 대상을 교체하며 `배론|상담영업팀`을 제거하는 기존 (4) 직후에, 그 부서 사용자의 `GET /api/requests`에 해당 요청이 더 이상 없는지 단언을 추가했다.
  - **[Minor] `CHANGELOG.md` `[Unreleased]`의 중복 `### Changed`·`### Fixed` 섹션 병합**: 신규 블록을 기존 블록 위에 삽입하며 타입별 섹션이 각각 두 번 나뉘어 있던 것을 타입당 한 섹션으로 합쳤다.
- **채번 트리거 `gen_seq()`가 두 가지 자기영속형 장애를 냄 — 갭 발생 시 unique 충돌 + 100번째 접수부터 자릿수 잘림** (`server/drizzle/0008_gen_seq_gap_tolerant.sql`, `server/drizzle/0009_gen_seq_lpad_overflow.sql`, `schema.sql`, `server/scripts/test-api-write.ts`): 이 브랜치의 공유 설정 작업과는 별건이지만 같이 실린 수정.
  - **0008**: 기존 `count(*)+1` 채번 방식은 그 날짜(KST)의 중간 행이 삭제돼 seq 번호열에 갭이 생기면 이미 존재하는 seq와 충돌(unique violation)해 `POST /api/requests`가 500이 되고, 재시도해도 같은 번호를 다시 계산하므로 그 날짜가 끝날 때까지 접수가 전면 실패했다. `max(split_part(seq,'-',2)::int)+1`(실제 마지막 번호 다음)로 교체.
  - **0009**: 0008 이후에도 `lpad(n::text, 2, '0')`이 `n`이 100 이상일 때 왼쪽 패딩 대신 결과를 2자리로 잘라내(`lpad('100','2','0')` → `'10'`) 하루 100건째 접수부터 이미 존재하는 seq와 충돌해 0008이 막으려던 것과 동일한 장애가 재발했다. `case when n < 100 then lpad(...) else n::text end`로 교체.
  - 동시 접수 직렬화(`pg_advisory_xact_lock`)는 두 수정 모두에서 유지된다 — 문제는 채번 계산식이었다. forward-only 원칙에 따라 새 마이그레이션 파일로 `create or replace function`했다(기존 파일 편집 없음).
  - 회귀 테스트(`test:api-write`): 갭 재현(중간 행 삭제 후 접수 성공·충돌 없음 확인), 오늘자(KST) 기존 채번 최대값 이후부터 99까지 시드해 다음 접수가 100 이상 번호에서도 잘리지 않는지 확인(실접수가 이미 있는 DB에서도 unique 충돌 없이 동작하도록 고정 `d-01` 시드 대신 `max(...)+1`부터 채운다).
  - docs sync: `docs/reference/db-schema.md` §10에 "교훈 4"로 상세 기록.
- **첨부 업로드 시 `comment_id` 소속 검증 누락 — 무결성 문제** (`server/src/routes/attachments.ts`, `server/scripts/test-attach-authz.ts`): 업로드 핸들러가 클라이언트가 보낸 `comment_id`를 그 댓글이 실제로 같은 요청(`request_id`) 소속인지 확인하지 않고 그대로 저장하고 있었다. A요청에 파일을 올리면서 B요청의 댓글 id를 붙일 수 있는 결함(정보 유출은 아님 — 첨부 조회가 `request_id`로 필터되어 남의 스레드에 노출되지 않고, 오히려 업로더 자신에게 안 보이게 될 뿐이지만 데이터 무결성 문제). `comment_id`가 non-null이면 `select id from request_comments where id = :commentId and request_id = :id`로 소속을 검증하고, 아니면 이 파일의 기존 관례(존재 여부 비노출을 위해 거부·부재 모두 404)에 맞춰 404로 거부하도록 수정. 회귀 테스트를 `test-attach-authz.ts`에 추가: 다른 요청의 댓글 id로 업로드 시 404, 같은 요청의 댓글 id는 201, `comment_id` 없는 첨부도 여전히 201.

### Fixed
- **병합 직전 최종 리뷰 지적 4건** (역할 모델 정교화 브랜치):
  - **[Critical] 깨끗한 DB 배포 시 system_admin이 영구히 0명 되는 부트스트랩 결함** (`server/src/db/seed.ts`, `server/src/db/migrate.ts`, `server/src/db/admin-check.ts` 신규, `server/scripts/test-bootstrap-clean-db.ts` 신규): `seed.ts`가 `juhuikim@baeoom.com`을 `role='system'`으로 삽입하고 있었는데, 공식 배포 순서(`db:migrate` → `db:seed`)를 빈 DB에 그대로 따르면 (1) 백필이 아직 비어 있는 `users`에 대해 0행 UPDATE를 실행하고도 `role_backfill_history` 마커를 정상 claim·커밋(백필 자신의 "최초 1회" 규칙은 정확히 지킴) → (2) 뒤이은 `db:seed`가 `system`으로 juhuikim을 삽입 → 이후 백필은 영원히 스킵 → **`system_admin`이 0명으로 고정**됐다. `PATCH /api/users/:id`·조직도 import가 전부 `canManageAccounts`(=system_admin 전용)라 앱 안에서 복구할 방법이 없어(DB 직접 SQL 필요) 신규 환경 배포가 사실상 계정 관리 영구 잠금으로 이어지는 결함이었다. `seed.ts`가 juhuikim을 처음부터 `system_admin`으로 삽입하도록 수정(users·org_directory 모두, `onConflictDoNothing`이라 기존 운영 DB는 영향 없음). 여기에 더해 `server/src/db/admin-check.ts`의 `countSystemAdmins()`로 부트스트랩 불변조건("system_admin ≥ 1")을 명시적으로 점검 — `seed.ts`는 완료 후 0명이면 **실패**(`process.exit(1)`), `migrate.ts`는 백필 직후 0명이면 **경고만**(seed 이전 시점이라 0이 정상일 수 있음). 회귀 테스트 `server/scripts/test-bootstrap-clean-db.ts`(`npm run test:bootstrap`)는 같은 Postgres 서버 위에 임시 DB(`bootstrap_test_<random>`)를 만들어 `db:migrate`+`db:seed`를 그대로 재현하고 `system_admin >= 1`을 단언한 뒤 임시 DB를 정리한다 — 수동 검증 결과: 임시 DB에서 `db:migrate` 직후 경고 로그 출력(`system_admin=0`, 정상) → `db:seed` 후 `system_admin=1` 확인, 원본 개발 DB는 영향 없음.
  - **[Important] `GET /api/profiles`가 무방비 — 새로 세운 계정 경계 우회** (`server/src/routes/meta.ts`): `authenticate`만 걸려 있어 전 사용자(staff 포함)에게 전 계정(id·name·email·role·소속)이 노출되고 있었다. `GET /api/users`를 `canProcess`로 좁힌 이번 브랜치의 경계가 이쪽으로 그대로 우회 가능해 무효화됐던 지점(누가 관리자인지 열거 가능). 유일한 소비자는 `src/features/board/ManageBoard.tsx`의 `useAllProfiles`이며 그 화면 자체가 이미 `canProcess` 전용이라, `GET /api/profiles`에 `canProcess` 게이트를 추가해도 정상 사용에는 영향 없음을 확인(`server/scripts/test-api-list.ts`가 dev-login(system) 세션으로 여전히 200 확인). 회귀 테스트 `server/scripts/test-role-boundaries.ts`(7): staff·exec 403, system·system_admin 200.
  - **[Important] 첨부 다운로드 게이트 fail-open — TOCTOU 레이스로 내부메모 첨부 노출 위험** (`server/src/routes/attachments.ts`, `server/src/routes/request-detail.ts`): 다운로드 라우트는 첨부 조회와 댓글 조회가 별도의 두 쿼리라, 그 사이에 댓글이 삭제되면 댓글 행을 찾지 못하는 순간이 생길 수 있는데 기존 `if (comment && !canSeeComment(...))`는 그 순간을 통과시켰다(fail-open). 목록 라우트는 단일 `LEFT JOIN` 쿼리라 같은 레이스는 없지만, 기존 `?? false`도 조인 실패 시 마찬가지로 "공개"로 간주하고 있었다. 두 지점 모두 **fail-closed**로 수정: `comment_id`가 non-null인데 댓글 행을 찾지 못하면 다운로드 거부(404)/목록 제외. `comment_id`가 null인 요청 본문 첨부는 기존처럼 정상 노출(과잉 차단 없음).
    잔여 위험: `request_attachments.comment_id`의 FK는 `onDelete: 'set null'`이라, 댓글이 삭제되면 첨부의 `comment_id`는 "행을 못 찾는 상태"가 아니라 **NULL로 바뀐다.** 그러면 위 fail-closed 필터의 첫 분기(`comment_id`가 null → 요청 본문 첨부로 간주)를 타고 **오히려 전 역할에 공개된다** — 이번 수정은 이 경로를 막지 못한다. 지금은 댓글 삭제 라우트가 없어(`app.delete` 0개) 실사용 경로가 없으며, 회귀 테스트가 `SET LOCAL session_replication_role = replica`로 FK를 우회해야만 "댓글 행을 못 찾는" orphan 상태를 재현할 수 있었다는 사실이 FK가 그 상태를 스스로 만들지 않음을 뒷받침한다. 댓글 삭제 기능을 추가할 때는 첨부도 함께 cascade 삭제하거나 `is_internal`을 첨부 쪽에 비정규화하는 등의 대책이 필요하다 — 상세는 `docs/reference/db-schema.md` §8. 회귀 테스트 `server/scripts/test-attach-authz.ts`: `SET LOCAL session_replication_role = replica`로 FK 검증을 우회해 존재하지 않는 `comment_id`를 가리키는 첨부를 만들어 system을 포함한 전 역할에서 목록 제외·다운로드 거부(fail-closed)를 확인하고, `comment_id=null` 일반 첨부는 그대로 보임을 함께 확인.
  - **[Minor] `test-attach-authz.ts` 테스트 이메일 고정 문자열 + try/finally 부재** (`server/scripts/test-attach-authz.ts`): 단언 실패 시 테스트 사용자 행이 남아 다음 실행이 unique 위반으로 죽던 문제. `test-role-boundaries.ts`·`test-authz.ts` 관례(`randomBytes(4)` 접미사 + `try/finally` 정리)를 적용.

### Changed
- **역할 모델 정교화 2단계 — 능력 기반 권한(authz) 도입** (`server/src/authz.ts`, `src/lib/permissions.ts`, `server/src/routes/users.ts`, `src/routes.tsx`, `src/components/TopNav.tsx`, `src/features/accounts/Accounts.tsx`, `src/features/requests/RequestDetail.tsx`, `src/features/requests/MyRequests.tsx`, `src/features/board/ManageBoard.tsx`, `src/features/requests/AdminPanel.tsx`): 라우트·화면이 역할 이름 대신 능력(`canProcess`·`canManageAccounts`·`canSeeDashboard`·`canSeeInternal`·`canSeeAllRequests`)을 묻도록 재구성. 기존 `isSystem`·`isViewerUp` 헬퍼는 제거했다.
  - `canProcess`(system·system_admin) — 배정·상태전이·영향도 조정·필드편집·내부메모 작성. **처리 담당자(`system`)는 더 이상 계정·역할을 관리할 수 없다** — 계정 관리는 `canManageAccounts`(`system_admin` 전용)로 격상했다. 단 `GET /api/users`는 관리 패널·관리 보드의 담당자 select가 의존하므로 `canProcess`로 계속 열려 있다.
  - `canSeeDashboard`(system·system_admin·exec), `canSeeInternal`(system·system_admin — 내부메모 본문+첨부파일 모두), `canSeeAllRequests`(system·system_admin·exec).
  - 모니터링 관리자(`dept_monitor`·`org_monitor`)는 본인 소속에서 도출한 범위(부서 = 기관+직무 일치 / 기관 = 기관 일치)의 요청을 `visibilityFilter`로 추가 열람한다. 소속(`org_affil`/`dept_function`)이 null이면 추가 범위 없음. 이들의 쓰기 권한은 공개 코멘트뿐이며 내부 메모는 볼 수 없다.
  - 클라이언트 `src/lib/permissions.ts`가 서버와 동일한 규칙 사본을 두고 상단 메뉴(`TopNav.tsx`)·라우트 가드(`routes.tsx`)·계정 관리 화면·요청 상세(관리 패널·내부메모·필드편집·재작업·되돌아가기 목적지)를 게이팅한다. 담당자 후보 필터(AdminPanel·ManageBoard)도 `canProcess` 기준으로 통일해 `system_admin`이 후보에서 누락되던 불일치를 해소했다.
  - "내 요청" 목록의 두 번째 탭 라벨이 역할에 따라 우리 부서(`dept_monitor`) / 우리 기관(`org_monitor`) / 전체 요청(`canSeeAllRequests` 보유자) / 부서·공유 요청(그 외 staff)으로 바뀐다.
  - `PATCH /api/users/:id`의 역할 화이트리스트를 옛 3역할(`['staff','system','viewer']`)에서 배정 가능 6역할(`ASSIGNABLE_ROLES` — staff·dept_monitor·org_monitor·system·exec·system_admin)로 교체했다. `viewer`는 신규 부여만 금지되고, 기존 `viewer` 행은 계정 관리 화면에서 정상 역할로 구제할 수 있다(select에 비활성 옵션으로 표시).
  - **마지막 관리자 강등 방지 가드**(`server/src/routes/users.ts`): `system_admin`이 0명이 되는 역할 변경 시도를 400 `LAST_ADMIN`으로 거부한다. 대상 행 + 현재 `system_admin` 전원을 id 오름차순 `FOR UPDATE`로 잠가, 두 관리자가 동시에 서로를 강등하는 레이스에서도 데드락 없이 하나만 성공하도록 했다.
  - 테스트: `test:authz`(`server/scripts/test-authz.ts`) 역할×능력 매트릭스(5개 능력 × 7개 역할값 = 35조합) + 모니터링 열람 범위(비모니터 staff에게 새지 않는지 부정 단언 포함). `test:roles`(`server/scripts/test-role-boundaries.ts`) API 레벨 권한 경계 — 담당자(system)의 계정관리 차단·신규 역할 화이트리스트·마지막 관리자 가드(동시성 레이스 포함)·처리 API(배정·상태전이) 차단·대시보드 접근 경계·`GET /api/users` 개방(의도적)·내부메모 열람 차단. `test:users`(`server/scripts/test-users.ts`)에 대문자 UUID PATCH 404 회귀·폐기값 `viewer` 사용자 역할 구제 회귀를 추가.

### Fixed
- **내부메모 첨부파일이 경영진·모니터링 관리자에게 노출되던 문제** (`server/src/routes/request-detail.ts`, `server/src/routes/attachments.ts`): 첨부 목록 조회가 `request_comments`를 조인해 `canSeeComment`로 필터링하지 않아, 내부메모(`is_internal=true`)에 달린 첨부파일이 열람 권한 없는 역할에게도 목록에 보이고 다운로드까지 가능했다. 첨부 목록·다운로드 게이트 모두 `canSeeComment`를 재사용하도록 통일 — 본문 필터와 동일 규칙 보장. 회귀 테스트 `server/scripts/test-attach-authz.ts`.
- **계정 관리 화면이 폐기값 `viewer` 사용자를 구제할 수 없던 문제** (`src/features/accounts/Accounts.tsx`): 역할 select에 `viewer` 옵션이 없어 편집 시작 시 select가 첫 옵션으로 표시됐고, 저장(`handleSave`)이 role을 건드리지 않아도 항상 PATCH에 담아 보내던 탓에 관리자가 부서·소속기관만 고치려 해도 역할이 조용히 바뀌는 문제가 있었다. `viewer` 현재값을 비활성 옵션으로 노출하고, role이 실제로 바뀐 경우에만 PATCH에 포함하도록 수정 — 관리자가 명시적으로 새 역할을 선택해 저장해야만 구제가 이뤄진다.
- **`PATCH /api/users/:id`의 마지막 관리자 가드가 대문자 UUID에서 404를 내던 문제** (`server/src/routes/users.ts`): 잠긴 행 목록에서 대상 id를 찾을 때 대소문자를 정규화하지 않아, 대문자 UUID로 PATCH하면 소문자로 저장된 행과 매칭되지 않아 404가 났다. 양쪽을 소문자로 정규화해 비교하도록 수정(같은 트랜잭션·같은 `FOR UPDATE` 잠금 기반 원자성은 유지).

### Added
- **역할 모델 정교화 1단계 — DB 준비** (`server/drizzle/0005_role_model_add_values.sql`, `server/src/db/backfill-roles.ts`, `server/src/db/migrate.ts`, `server/src/db/schema.ts`, `server/src/types.ts`, `src/types/supabase.ts`, `src/lib/constants.ts`, `src/components/TopNav.tsx`): `user_role` enum에 `dept_monitor`·`org_monitor`·`exec`·`system_admin` 4종을 추가(0005). 기존 `viewer` 사용자는 `exec`로 이전, `juhuikim@baeoom.com`만 `system_admin`으로 승격했고 나머지 `system` 사용자는 담당자로 유지했다 — 이 데이터 이전은 마이그레이션 파일이 아니라 `server/src/db/backfill-roles.ts`의 백필로 구현되어 `migrate.ts`가 `migrate()` 완료(= 마이그레이션 트랜잭션 커밋) 후 실행한다. (`ALTER TYPE ... ADD VALUE`로 추가한 enum 값은 같은 트랜잭션 안에서 쓸 수 없고, drizzle-orm 마이그레이터는 대기 중인 모든 마이그레이션 파일을 단일 트랜잭션으로 묶으므로 파일만 나눠서는 우회되지 않는다 — 처음에는 별도 마이그레이션 파일(0006)로 나눴으나 깨끗한 DB에서 `npm run db:migrate` 1회 실행 시 0005/0006이 같은 트랜잭션에 들어가 "unsafe use of new value of enum type" 오류로 실패함을 확인해 백필로 이전했다.) `viewer` 값 자체는 Postgres가 enum 값 삭제를 지원하지 않고 forward-only 원칙(CLAUDE.md §2)이라 남겨두되 신규 부여는 하지 않는다. 서버 `UserRoleValue`·클라이언트 `UserRole` 타입이 7개 값을 모두 인식하도록 확장했고, 공용 한국어 라벨 `ROLE_LABEL`과 계정관리 노출 목록 `ASSIGNABLE_ROLES`를 `src/lib/constants.ts`에 추가했다. `TopNav.tsx`의 역할 뱃지가 로컬 라벨 맵(`Record<UserRole, string>`, 신규 값 누락으로 컴파일 실패) 대신 공용 `ROLE_LABEL`을 쓰도록 통합하면서 표시 문구가 일부 바뀌었다(staff "일반직원"→"요청자", system "시스템팀"→"시스템팀 담당자", viewer "열람"→"(폐기) 뷰어"). 권한 판정(authz) 로직 자체는 이 시점엔 범위 밖이었으며, 능력 기반으로 재구성한 내용은 위 "역할 모델 정교화 2단계" 항목 참조.
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
  - 회귀 테스트 추가: `server/scripts/test-transition.ts` (15) 진행중 → 접수 되돌리기 + 배정 초기화.

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
