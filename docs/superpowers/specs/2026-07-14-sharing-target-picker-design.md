---
title: 공유대상 선택 UI 재설계 (검색 + 칩)
last_updated: 2026-07-14
status: Active
owner: 시스템팀
diataxis: explanation
ssot_for: 공유대상 선택 컨트롤의 상호작용·접근성 규칙
related: docs/reference/requirements.md
---

# 공유대상 선택 UI 재설계

## 배경

`SharingEditor`(`src/features/requests/SharingEditor.tsx`)는 공개범위 select와 공유대상 선택을 함께 담는다. 접수 폼의 **340px 사이드바**와 요청 상세의 공유 수정 패널이 같은 컴포넌트를 쓴다.

지금 공유대상은 **체크박스 17개**(직무 6종 + 세부부서 11종)를 격자로 펼친다. 좁은 사이드바에서 줄바꿈이 제멋대로 나 정렬이 무너지고, `배움_교학팀`처럼 밑줄이 들어간 라벨이 반복돼 읽기 어렵다.

더 근본적인 문제는 **구조가 사용 빈도와 거꾸로**라는 것이다. 공개범위 select가 흔한 경우(부서만·직무 전체·기관 전체·전 직원)를 이미 덮으므로, 공유대상은 "우리 부서 건인데 배론 상담영업팀도 봐야 한다" 같은 **예외를 위한 장치**다. 실제 선택은 대부분 0개, 가끔 1~2개다. 그런데 거의 쓰지 않는 선택지 17개를 항상 펼쳐두고 있다.

## 목표

- 선택이 0개일 때 화면이 조용하다.
- 1~2개를 고르는 일이 빠르고, 무엇을 골랐는지 한눈에 보인다.
- 좁은 사이드바에서도 레이아웃이 무너지지 않는다.
- 팀·기관이 늘어도 컨트롤이 커지지 않는다.

## 비목표

- 데이터 모델·API 변경. 서버로 보내는 값(`target_type`·`target_value`)과 화이트리스트 검증은 그대로다.
- 공개범위(visibility) select 변경. 그대로 둔다.
- 개인 단위 공유. 지금처럼 직무·부서 단위만 다룬다.

---

## 1. 상호작용

**기본 상태는 입력칸 한 줄이다.** 현재의 "+ 공유대상 추가" 접힘 토글을 없앤다. 한 줄이면 접어둘 이유가 없고, 토글은 "여기 뭔가 숨어 있다"는 부담만 준다. 공개범위 select 바로 아래에 놓인다.

**타이핑하면 후보가 좁혀진다.** 17개 항목을 한글 부분일치로 필터한다. "상담"을 입력하면 다음이 뜬다.

| 표기 | 종류 | 서버로 보낼 값 |
|------|------|----------------|
| 상담영업팀 전체 | 직무 단위 | `{ target_type: 'function', target_value: '상담영업팀' }` |
| 배움 › 상담영업팀 | 세부부서 | `{ target_type: 'dept', target_value: '배움\|상담영업팀' }` |
| 배론 › 상담영업팀 | 세부부서 | `{ target_type: 'dept', target_value: '배론\|상담영업팀' }` |
| 허브 › 상담영업팀 | 세부부서 | `{ target_type: 'dept', target_value: '허브\|상담영업팀' }` |

두 종류를 **표기로 구분**한다 — 직무 단위는 "○○팀 전체", 세부부서는 "기관 › 팀". 기존 `배움_교학팀` 밑줄 라벨은 쓰지 않는다.

**고른 것은 칩으로 남는다.** 각 칩에 제거(✕) 버튼이 있고, 이미 고른 항목은 후보 목록에서 빠진다. 0개일 때는 칩 줄 자체가 렌더되지 않는다.

**검색어가 없을 때도 목록을 연다.** 입력칸을 클릭하거나 포커스하면 전체 17개가(선택된 것 제외) 뜬다. 무엇을 고를 수 있는지 몰라 막막해지는 것을 막는다.

**일치하는 항목이 없으면** "일치하는 팀·부서가 없습니다"를 목록 자리에 표시한다.

## 2. 키보드와 접근성

WAI-ARIA의 combobox + listbox 패턴을 따른다.

| 키 | 동작 |
|----|------|
| ↓ / ↑ | 후보 이동 |
| Enter | 활성 후보 선택 |
| Esc | 목록 닫기 |
| Backspace (입력칸이 빈 상태) | 마지막 칩 제거 |

- 입력칸: `role="combobox"` · `aria-expanded` · `aria-controls` · `aria-activedescendant`
- 목록: `role="listbox"`, 각 항목 `role="option"` + `aria-selected`
- 칩의 ✕ 버튼: `aria-label="배론 › 상담영업팀 공유 해제"`처럼 **무엇을 지우는지** 읽히게 한다
- 선택 결과는 `aria-live="polite"` 영역으로 알린다("공유대상 2개 선택됨") — 칩이 시각적으로만 바뀌면 스크린리더 사용자가 선택 성공을 알 수 없다
- 색만으로 정보를 전달하지 않는다. 칩은 텍스트가 곧 내용이다.

## 3. 컴포넌트 경계

`SharingEditor`는 지금도 공개범위 + 공유대상 두 가지를 담고 180줄이다. 여기에 콤보박스 상태(입력값·열림·활성 인덱스)와 키보드 처리가 더해지면 한 파일이 두 가지 일을 하게 된다.

**공유대상 선택만 `SharingTargetPicker`로 분리한다.**

```tsx
interface SharingTargetPickerProps {
  fnTargets: Set<string>      // 직무 단위 — FUNCTION_TARGETS 값
  deptTargets: Set<string>    // 세부부서 — deptTargetValue(기관, 직무) 값
  onChange: (next: { fnTargets: Set<string>; deptTargets: Set<string> }) => void
  disabled?: boolean
}
```

`SharingEditor`는 공개범위 select + `<SharingTargetPicker>` 조립만 담당한다. 두 화면(접수 폼·요청 상세)은 계속 `SharingEditor`를 쓰므로 호출부는 바뀌지 않는다.

후보 목록 구성(직무 6종 + `useDeptOptions()`가 준 세부부서)과 라벨 표기는 `SharingTargetPicker` 안에 둔다. 라벨 규칙이 두 벌이 되면 접수와 수정의 표기가 갈라진다.

## 4. 데이터

서버 계약은 그대로다. 제출 시 `fnTargets`·`deptTargets`를 지금과 똑같이 `shared_targets` 배열로 변환한다(`RequestForm.tsx`·`RequestDetail.tsx`의 기존 변환 로직 유지).

세부부서 후보는 `GET /api/dept-options`가 준다. 이 API는 이미 직무 화이트리스트로 필터되므로, 검증 불가능한 값이 후보에 뜨지 않는다.

## 5. 오류 처리

이 컨트롤 자체는 서버를 호출하지 않는다. 저장 시 서버가 값을 거부하면(400 `INVALID_TARGET_VALUE` 등) 호출부(접수 폼·공유 수정 패널)가 지금처럼 `role="alert"`로 표시한다.

`useDeptOptions()`가 실패하면 세부부서 후보 없이 직무 6종만 뜬다. 컨트롤이 비어버리지 않게 한다.

## 6. 테스트

프론트엔드 테스트 인프라가 없으므로(이 프로젝트는 서버 스크립트 테스트만 있다) 다음을 코드 근거와 브라우저로 확인한다.

| 항목 | 방법 |
|------|------|
| 0개일 때 칩 줄이 없고 입력칸만 보인다 | 브라우저(접수 폼 340px 사이드바) |
| "상담" 입력 시 직무 1 + 세부부서 3이 뜬다 | 브라우저 |
| 선택하면 칩이 생기고 후보에서 빠진다 | 브라우저 |
| 칩 ✕로 제거된다 | 브라우저 |
| 키보드만으로 선택·제거된다 | 브라우저(Tab·↓·Enter·Backspace) |
| 제출 값이 기존과 동일하다 | 접수 → DB의 `request_shared_targets` 확인 |
| 요청 상세의 공유 수정도 동일하게 동작한다 | 브라우저 |
| 서버 회귀 없음 | `test:sharing` · `test:intake` · `test:api` |

## 7. 문서 동기화

`docs/reference/requirements.md`(접수 폼·공유 수정 화면의 공유대상 선택 서술), `CHANGELOG.md`.
