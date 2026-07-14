# 공유대상 선택 UI 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공유대상 선택을 체크박스 17개 격자에서 **검색 + 칩** 방식으로 바꿔, 선택이 0개일 때(대부분의 경우) 화면이 조용하고 좁은 사이드바에서도 레이아웃이 무너지지 않게 한다.

**Architecture:** 공유대상 선택만 `SharingTargetPicker`(신규)로 분리한다. `SharingEditor`는 공개범위 select + 피커 조립만 담당하고, 호출부(접수 폼·요청 상세)는 계속 `SharingEditor`를 쓰므로 바뀌지 않는다. 피커는 WAI-ARIA combobox + listbox 패턴을 따르며, 서버로 보내는 값과 데이터 흐름은 그대로다.

**Tech Stack:** React 18 · TypeScript · Tailwind · TanStack Query(`useDeptOptions`).

## Global Constraints

- 스펙 SSOT: `docs/superpowers/specs/2026-07-14-sharing-target-picker-design.md`
- **데이터·API·권한은 바뀌지 않는다.** 서버로 보내는 값은 그대로다: 직무 단위 `{ target_type: 'function', target_value: '교학팀' }`, 세부부서 `{ target_type: 'dept', target_value: '배움|교학팀' }`.
- 상수는 `src/lib/constants.ts`가 단일 소스(`FUNCTION_TARGETS` 6종 · `deptTargetValue(org, fn)` · `VISIBILITY_OPTIONS`). 새로 정의하지 않는다. `deptTargetLabel`(`배움_교학팀` 표기)은 이 컨트롤에서 **더 이상 쓰지 않는다**(다른 화면에서 쓰므로 함수는 남긴다).
- 세부부서 후보는 `useDeptOptions()`(`GET /api/dept-options`)가 준다. 이 API는 이미 직무 화이트리스트로 필터되므로 검증 불가능한 값이 후보에 뜨지 않는다. `dept_function`이 빈 값인 행은 여전히 방어적으로 걸러낸다.
- 공개범위(visibility) select는 **변경하지 않는다**(라벨·설명·id·aria 그대로).
- 접근성: 색만으로 정보 전달 금지, 모든 인터랙티브 요소에 라벨/aria-label, 선택 결과는 `aria-live="polite"`로 알린다.
- 표기 규칙: 직무 단위는 "○○팀 전체", 세부부서는 "기관 › 팀"(예: `배론 › 상담영업팀`). 밑줄 표기(`배움_교학팀`)는 쓰지 않는다.
- 이 프로젝트에는 **프론트엔드 테스트 인프라가 없다**(서버 스크립트 테스트만 있다). 검증은 타입체크 + 브라우저 + 서버 회귀 테스트로 한다.
- 문서 동기화: 사용자 노출 변경이므로 `docs/reference/requirements.md`·`CHANGELOG.md`를 Task 3에서 갱신한다(CLAUDE.md §1).

---

### Task 1: SharingTargetPicker 신설

**Files:**
- Create: `src/features/requests/SharingTargetPicker.tsx`

**Interfaces:**
- Produces: `<SharingTargetPicker fnTargets deptTargets onChange disabled />` — Task 2의 `SharingEditor`가 조립한다.

```tsx
export interface SharingTargetPickerProps {
  fnTargets: Set<string>    // 직무 단위 — FUNCTION_TARGETS 값 (예: '교학팀')
  deptTargets: Set<string>  // 세부부서 — deptTargetValue(기관, 직무) 값 (예: '배움|교학팀')
  onChange: (next: { fnTargets: Set<string>; deptTargets: Set<string> }) => void
  disabled?: boolean
}
```

- [ ] **Step 1: 컴포넌트 작성**

`src/features/requests/SharingTargetPicker.tsx`:

```tsx
import { useId, useMemo, useRef, useState } from 'react'
import { FUNCTION_TARGETS, deptTargetValue } from '../../lib/constants'
import { useDeptOptions } from './api'

export interface SharingTargetPickerProps {
  fnTargets: Set<string>
  deptTargets: Set<string>
  onChange: (next: { fnTargets: Set<string>; deptTargets: Set<string> }) => void
  disabled?: boolean
}

/** 후보 한 건 — 직무 단위와 세부부서를 하나의 목록으로 다룬다 */
interface Candidate {
  kind: 'function' | 'dept'
  value: string   // 서버로 보낼 target_value ('교학팀' 또는 '배움|교학팀')
  label: string   // 화면 표기 ('교학팀 전체' 또는 '배움 › 교학팀')
}

/**
 * 공유대상 선택 — 검색 + 칩.
 * 선택은 대부분 0개, 가끔 1~2개다. 그래서 기본 상태는 입력칸 한 줄이고,
 * 고른 것만 칩으로 남긴다. 체크박스 17개를 항상 펼치던 이전 구조는
 * 사용 빈도와 거꾸로였다.
 *
 * 서버로 보내는 값은 바뀌지 않는다 — 직무는 FUNCTION_TARGETS 값,
 * 세부부서는 deptTargetValue(기관, 직무)가 만드는 '기관|직무' 형식이다.
 */
export function SharingTargetPicker({
  fnTargets,
  deptTargets,
  onChange,
  disabled,
}: SharingTargetPickerProps) {
  const { data: deptOptions } = useDeptOptions()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const optionId = (i: number) => `${listId}-opt-${i}`

  // 후보 전체 — 직무 6종 + 세부부서(dept-options)
  const allCandidates = useMemo<Candidate[]>(() => {
    const fns: Candidate[] = FUNCTION_TARGETS.map((fn) => ({
      kind: 'function',
      value: fn,
      label: `${fn} 전체`,
    }))
    const depts: Candidate[] = (deptOptions ?? [])
      .filter((o) => o.dept_function) // 빈 문자열 방어 — 서버가 이미 걸러내지만 한 번 더
      .map((o) => ({
        kind: 'dept' as const,
        value: deptTargetValue(o.org_affil, o.dept_function),
        label: `${o.org_affil} › ${o.dept_function}`,
      }))
    return [...fns, ...depts]
  }, [deptOptions])

  const selectedValues = useMemo(
    () => new Set<string>([...fnTargets, ...deptTargets]),
    [fnTargets, deptTargets],
  )

  // 이미 고른 항목은 후보에서 뺀다. 검색어가 없으면 전체를 보여준다.
  const candidates = useMemo(() => {
    const q = query.trim()
    return allCandidates.filter(
      (c) => !selectedValues.has(c.value) && (q === '' || c.label.includes(q)),
    )
  }, [allCandidates, selectedValues, query])

  // 선택된 것 — 칩으로 표시 (후보 목록과 같은 라벨 규칙을 쓴다)
  const selected = useMemo(
    () => allCandidates.filter((c) => selectedValues.has(c.value)),
    [allCandidates, selectedValues],
  )

  function add(c: Candidate) {
    if (c.kind === 'function') {
      const next = new Set(fnTargets)
      next.add(c.value)
      onChange({ fnTargets: next, deptTargets })
    } else {
      const next = new Set(deptTargets)
      next.add(c.value)
      onChange({ fnTargets, deptTargets: next })
    }
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.focus()
  }

  function remove(c: Candidate) {
    if (c.kind === 'function') {
      const next = new Set(fnTargets)
      next.delete(c.value)
      onChange({ fnTargets: next, deptTargets })
    } else {
      const next = new Set(deptTargets)
      next.delete(c.value)
      onChange({ fnTargets, deptTargets: next })
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActiveIndex((i) => (candidates.length === 0 ? 0 : (i + 1) % candidates.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setActiveIndex((i) =>
        candidates.length === 0 ? 0 : (i - 1 + candidates.length) % candidates.length,
      )
    } else if (e.key === 'Enter') {
      if (open && candidates[activeIndex]) {
        e.preventDefault()
        add(candidates[activeIndex])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'Backspace' && query === '' && selected.length > 0) {
      // 입력칸이 빈 상태에서 Backspace → 마지막 칩 제거
      remove(selected[selected.length - 1])
    }
  }

  return (
    <div>
      <label htmlFor={`${listId}-input`} className="block text-xs font-medium text-gray-700">
        공유대상
      </label>
      <p className="mt-0.5 text-xs text-gray-500">
        공개범위에 더해 특정 직무·부서에도 이 요청을 공유합니다.
      </p>

      <div className="relative mt-1.5">
        <input
          id={`${listId}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && candidates[activeIndex] ? optionId(activeIndex) : undefined}
          autoComplete="off"
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-gray-50 disabled:text-gray-400"
          placeholder="팀·부서 검색…"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActiveIndex(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)} // 옵션 클릭이 먼저 처리되도록
          onKeyDown={onKeyDown}
        />

        {open && !disabled && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
          >
            {candidates.length === 0 ? (
              <li className="px-3 py-2 text-xs text-gray-400">일치하는 팀·부서가 없습니다.</li>
            ) : (
              candidates.map((c, i) => (
                <li
                  key={c.value}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseDown={(e) => e.preventDefault()} // blur보다 먼저 클릭이 처리되게
                  onClick={() => add(c)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`cursor-pointer px-3 py-1.5 text-sm ${
                    i === activeIndex ? 'bg-brand/10 text-brand' : 'text-gray-700'
                  }`}
                >
                  {c.label}
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* 선택된 공유대상 — 0개면 렌더하지 않는다 */}
      {selected.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((c) => (
            <li
              key={c.value}
              className="inline-flex items-center gap-1 rounded-full bg-brand/10 py-0.5 pl-2.5 pr-1 text-xs text-brand"
            >
              {c.label}
              <button
                type="button"
                onClick={() => remove(c)}
                disabled={disabled}
                aria-label={`${c.label} 공유 해제`}
                className="rounded-full px-1 text-brand hover:bg-brand/20 disabled:opacity-50"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 스크린리더 안내 — 칩이 시각적으로만 바뀌면 선택 성공을 알 수 없다 */}
      <p aria-live="polite" className="sr-only">
        {selected.length > 0 ? `공유대상 ${selected.length}개 선택됨` : '선택된 공유대상 없음'}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: 타입체크**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 오류 없음. (아직 아무도 이 컴포넌트를 쓰지 않으므로 이 시점에는 미사용 경고만 없으면 된다. `noUnusedLocals`는 export된 컴포넌트에는 적용되지 않는다.)

참고: `useDeptOptions()`는 `DeptOption[]`을 돌려주고, `DeptOption`은 `{ org_affil: RequestOrg; dept_function: string }`이다(`src/types/database.ts:57`). `dept_function`은 nullable이 아니므로 캐스팅이 필요 없다. 빈 문자열 방어 필터는 남긴다(조직도에 빈 직무가 들어간 적이 있다).

- [ ] **Step 3: 커밋**

```bash
git add src/features/requests/SharingTargetPicker.tsx
git commit -m "feat(web): 공유대상 선택 컴포넌트 SharingTargetPicker — 검색 + 칩

선택은 대부분 0개, 가끔 1~2개인데 체크박스 17개를 항상 펼치고 있었다.
기본은 입력칸 한 줄, 타이핑하면 후보가 좁혀지고 고른 것만 칩으로 남는다.
서버로 보내는 값은 그대로다(직무는 FUNCTION_TARGETS 값, 세부부서는 '기관|직무').

docs sync: 스킵(Task 3에서 일괄 처리)"
```

---

### Task 2: SharingEditor를 피커로 교체

**Files:**
- Modify: `src/features/requests/SharingEditor.tsx` (공유대상 체크박스 블록 제거, 피커 조립)

**Interfaces:**
- Consumes: Task 1의 `<SharingTargetPicker>`
- Produces: `SharingEditor`의 props(`value: SharingValue` · `onChange` · `disabled`)는 **바뀌지 않는다**. 호출부(`RequestForm.tsx:611`, `RequestDetail.tsx:411`)는 수정하지 않는다.

- [ ] **Step 1: 공유대상 블록을 피커로 교체**

`src/features/requests/SharingEditor.tsx`를 다음으로 만든다. 공개범위 select 부분(라벨·id·aria·설명문)은 **지금 것을 그대로 유지**하고, 그 아래 "+ 공유대상 추가" 접힘 블록 전체를 `<SharingTargetPicker>` 한 줄로 바꾼다:

```tsx
import { useMemo } from 'react'
import { VISIBILITY_OPTIONS } from '../../lib/constants'
import type { RequestVisibility } from '../../types/database'
import { SharingTargetPicker } from './SharingTargetPicker'

const fieldCls =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-gray-50 disabled:text-gray-400'
const sidebarLabelCls = 'block text-xs font-medium text-gray-700'

export interface SharingValue {
  visibility: RequestVisibility
  fnTargets: Set<string> // 직무 단위 — FUNCTION_TARGETS 값
  deptTargets: Set<string> // 세부부서 단위 — deptTargetValue(기관, 직무) 값
}

interface SharingEditorProps {
  value: SharingValue
  onChange: (next: SharingValue) => void
  disabled?: boolean
}

/**
 * 공개범위 + 공유대상 선택 UI.
 * 접수 폼과 요청 상세의 공유 범위 수정이 이 컴포넌트를 공유한다 —
 * 선택 규칙이 두 벌이 되면 접수와 수정의 동작이 갈라진다.
 * 공유대상 선택 자체는 SharingTargetPicker가 담당한다.
 */
export function SharingEditor({ value, onChange, disabled }: SharingEditorProps) {
  const visibilityDesc = useMemo(
    () => VISIBILITY_OPTIONS.find((o) => o.value === value.visibility)?.description,
    [value.visibility],
  )

  return (
    <div className="space-y-3">
      {/* 공개범위 */}
      <div>
        <label htmlFor="field-visibility" className={sidebarLabelCls}>
          공개범위 <span className="text-red-500" aria-hidden="true">*</span>
        </label>
        <select
          id="field-visibility"
          className={fieldCls}
          value={value.visibility}
          onChange={(e) =>
            onChange({ ...value, visibility: e.target.value as RequestVisibility })
          }
          disabled={disabled}
          aria-describedby={visibilityDesc ? 'hint-visibility' : undefined}
          aria-required="true"
        >
          {VISIBILITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {visibilityDesc && (
          <p id="hint-visibility" className="mt-1 text-xs text-gray-500">
            {visibilityDesc}
          </p>
        )}
      </div>

      {/* 공유대상 — 검색 + 칩 */}
      <SharingTargetPicker
        fnTargets={value.fnTargets}
        deptTargets={value.deptTargets}
        onChange={(next) => onChange({ ...value, ...next })}
        disabled={disabled}
      />
    </div>
  )
}
```

**주의**: 이 교체로 `toggle()` 헬퍼, `useState`(shareOpen), `useDeptOptions`, `FUNCTION_TARGETS`, `deptTargetValue`, `deptTargetLabel` import가 이 파일에서 더 이상 필요 없어진다. 남겨두면 `noUnusedLocals` 타입체크가 실패한다 — 위 코드처럼 모두 지운다.

- [ ] **Step 2: 타입체크**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: 오류 없음. 실패하면 남은 미사용 import를 지운다.

- [ ] **Step 3: 접수 폼이 여전히 같은 값을 보내는지 확인 (코드 근거)**

`src/features/requests/RequestForm.tsx`의 제출 로직(`handleSubmit`)이 `fnTargets`·`deptTargets`를 `shared_targets` 배열로 바꾸는 부분을 읽고, **바뀌지 않았음**을 확인한다. 이 태스크는 선택 UI만 바꿨고 값의 형태는 그대로여야 한다. 확인한 코드 위치를 보고서에 적는다.

- [ ] **Step 4: 브라우저 확인 (접수 폼)**

dev 서버는 이미 떠 있다(웹 `http://localhost:5173`, 서버 `http://localhost:4000`). 접수 폼(`/requests/new`)을 열어 확인한다:

- 사이드바에 **입력칸 한 줄**만 보인다(체크박스 격자 없음, "+ 공유대상 추가" 토글 없음)
- 입력칸을 클릭하면 후보 17개가 뜬다
- "상담"을 입력하면 `상담영업팀 전체` + `배움 › 상담영업팀` + `배론 › 상담영업팀` + `허브 › 상담영업팀`이 뜬다
- 하나 고르면 칩이 생기고, 그 항목은 후보에서 사라진다
- 칩의 ✕로 제거된다
- 키보드만으로 된다: Tab으로 입력칸 → ↓로 후보 이동 → Enter로 선택 → (입력칸 빈 상태에서) Backspace로 마지막 칩 제거

브라우저 접근이 불가하면 각 항목의 코드 근거를 보고서에 적는다.

- [ ] **Step 5: 제출 값이 그대로인지 실제로 확인**

접수 폼에서 공유대상을 하나 골라 실제로 접수한 뒤, DB에 예전과 같은 형태로 저장되는지 확인한다:

```bash
docker exec request-site-db psql -U request -d request_site -c "select r.seq, t.target_type, t.target_value from request_shared_targets t join requests r on r.id = t.request_id order by t.id desc limit 3;"
```

Expected: 직무를 골랐으면 `function | 교학팀`, 세부부서를 골랐으면 `dept | 배움|교학팀` 형태. **확인 후 그 테스트 요청은 지운다**:

```bash
docker exec request-site-db psql -U request -d request_site -c "delete from requests where title like '%공유대상 UI 확인%';"
```

- [ ] **Step 6: 서버 회귀 확인**

UI만 바꿨지만 접수 경로를 건드렸으므로 서버 계약이 깨지지 않았는지 확인한다:

```bash
cd server && npm run test:sharing && npm run test:intake && npm run test:api
```

Expected: 전부 PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/features/requests/SharingEditor.tsx
git commit -m "refactor(web): SharingEditor의 공유대상 체크박스를 SharingTargetPicker로 교체

340px 사이드바에서 체크박스 17개가 줄바꿈으로 흩어지던 문제를 없앤다.
공개범위 select는 그대로 두고, 공유대상 선택만 피커에 위임한다.
SharingEditor의 props는 불변이라 호출부(접수 폼·요청 상세)는 수정하지 않는다.

docs sync: 스킵(Task 3에서 일괄 처리)"
```

---

### Task 3: 요청 상세 확인 + 문서 동기화

**Files:**
- Modify: `docs/reference/requirements.md` (접수 폼·공유 수정 화면의 공유대상 선택 서술)
- Modify: `CHANGELOG.md` (`Unreleased`)

**Interfaces:**
- Consumes: Task 1·2의 결과

- [ ] **Step 1: 요청 상세의 공유 범위 수정도 동작하는지 확인**

같은 `SharingEditor`를 쓰므로 자동으로 바뀌지만, **넓은 폭에서도 어색하지 않은지** 실제로 본다. 요청을 하나 만들고 상세에서 "공유 범위 수정"을 연다:

```bash
curl -s -c /tmp/sc.txt -X POST http://localhost:4000/api/auth/dev-login \
  -H 'Content-Type: application/json' -d '{"email":"juhuikim@baeoom.com"}' -o /dev/null
curl -s -b /tmp/sc.txt -X POST http://localhost:4000/api/requests \
  -H 'Content-Type: application/json' \
  -d '{"org":"공통","type_code":"error","title":"공유 피커 확인","body":"x","urgency":"보통","visibility":"dept","desired_due":"2026-07-25","intake_detail":{"screen_url":"/x","reproduce":"x","occurred_at":"2026-07-14"},"shared_targets":[]}'
```

브라우저에서 `/requests/<id>` → "공유 범위 수정" → 피커가 접수 폼과 같게 동작하는지 확인한다. 확인 후 그 요청을 지운다:

```bash
docker exec request-site-db psql -U request -d request_site -c "delete from requests where title = '공유 피커 확인';"
```

- [ ] **Step 2: `requirements.md` 갱신**

공유대상 선택을 서술한 부분(접수 폼 절과 요청 상세의 "공유 범위 수정" 절)을 새 UI에 맞게 고친다. frontmatter의 `last_updated`를 `2026-07-14`로.

```markdown
- **공유대상 선택**: 공개범위에 더해 특정 직무·부서에도 공유한다. 검색 입력칸에 팀·부서명을 입력하면 후보가 좁혀지고, 고른 항목은 칩으로 표시된다(칩의 ✕로 제거). 후보는 직무 단위("○○팀 전체", `FUNCTION_TARGETS` 6종)와 세부부서("기관 › 팀", `GET /api/dept-options`)를 한 목록에서 다룬다. 선택이 없으면 입력칸만 보인다 — 실제 선택은 대부분 0개다. 키보드로도 조작한다(↑↓ 이동 · Enter 선택 · Esc 닫기 · 빈 입력칸에서 Backspace로 마지막 칩 제거). 접수 폼과 요청 상세의 공유 범위 수정이 같은 컴포넌트(`SharingEditor` → `SharingTargetPicker`)를 쓴다.
```

- [ ] **Step 3: `CHANGELOG.md`의 `Unreleased`에 추가**

```markdown
### Changed
- **공유대상 선택 UI — 체크박스 17개 → 검색 + 칩** (`src/features/requests/SharingTargetPicker.tsx` 신규, `SharingEditor.tsx`): 340px 사이드바에 체크박스 17개(직무 6 + 세부부서 11)를 격자로 펼치다 보니 줄바꿈이 제멋대로 나고 `배움_교학팀` 같은 밑줄 라벨이 반복돼 읽기 어려웠다. 더 근본적으로는 **구조가 사용 빈도와 거꾸로**였다 — 공개범위 select가 흔한 경우를 이미 덮으므로 공유대상은 예외용이고 실제 선택은 대부분 0개인데, 거의 쓰지 않는 선택지 17개를 항상 펼쳐두고 있었다.
  - 기본 상태는 입력칸 한 줄("+ 공유대상 추가" 접힘 토글 제거). 타이핑하면 후보가 좁혀지고, 고른 것만 칩으로 남는다. 이미 고른 항목은 후보에서 빠진다.
  - 표기를 정리했다: 직무는 "○○팀 전체", 세부부서는 "기관 › 팀"(예: `배론 › 상담영업팀`). 밑줄 표기(`배움_교학팀`)는 쓰지 않는다.
  - 키보드 지원(↑↓·Enter·Esc·빈 입력칸에서 Backspace) + WAI-ARIA combobox/listbox 패턴. 선택 결과는 `aria-live`로 알린다.
  - 공유대상 선택을 `SharingTargetPicker`로 분리했다. `SharingEditor`의 props는 불변이라 호출부(접수 폼·요청 상세)는 바뀌지 않는다.
  - **데이터·API·권한은 불변**이다. 서버로 보내는 값(`target_type`·`target_value`)과 화이트리스트 검증은 그대로다.
```

- [ ] **Step 4: 전체 검증**

```bash
npx tsc -p tsconfig.app.json --noEmit
cd server && npm run typecheck && npm run test:sharing && npm run test:intake && npm run test:api && npm run db:smoke
```

Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add docs/reference/requirements.md CHANGELOG.md
git commit -m "docs: 공유대상 선택 UI 재설계 문서 동기화"
```

---

## 검증 요약

| 대상 | 방법 | 기대 |
|------|------|------|
| 웹 타입 | `npx tsc -p tsconfig.app.json --noEmit` | 오류 없음 |
| 접수 폼(좁은 사이드바) | 브라우저 `/requests/new` | 입력칸 한 줄 · 검색 · 칩 · 키보드 |
| 요청 상세(넓은 폭) | 브라우저 `/requests/<id>` → 공유 범위 수정 | 같은 동작 |
| 제출 값 불변 | DB `request_shared_targets` 조회 | `function \| 교학팀` · `dept \| 배움\|교학팀` |
| 서버 회귀 | `cd server && npm run test:sharing && npm run test:intake && npm run test:api && npm run db:smoke` | 전부 PASS |
