import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { FUNCTION_TARGETS, deptTargetValue, sharedTargetLabel } from '../../lib/constants'
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
 * 고른 것만 칩으로 남는다. 체크박스 17개를 항상 펼치던 이전 구조는
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
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const optionId = (i: number) => `${listId}-opt-${i}`

  // 후보 전체 — 직무 6종 + 세부부서(dept-options)
  const allCandidates = useMemo<Candidate[]>(() => {
    const fns: Candidate[] = FUNCTION_TARGETS.map((fn) => ({
      kind: 'function',
      value: fn,
      label: sharedTargetLabel({ target_type: 'function', target_value: fn }),
    }))
    const depts: Candidate[] = (deptOptions ?? [])
      .filter((o) => o.dept_function) // 빈 문자열 방어 — 서버가 이미 걸러내지만 한 번 더
      .map((o) => {
        const value = deptTargetValue(o.org_affil, o.dept_function)
        return {
          kind: 'dept' as const,
          value,
          label: sharedTargetLabel({ target_type: 'dept', target_value: value }),
        }
      })
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

  // 선택된 것 — 칩으로 표시.
  // 부모 Set(fnTargets·deptTargets)이 SSOT다. 후보 목록(allCandidates)에서 라벨을 찾되,
  // 후보에 없는 값(조직도에서 빠졌거나 useDeptOptions()가 아직 로딩/실패 중인 경우)도
  // 반드시 칩으로 만든다 — 그러지 않으면 "칩은 없는데 저장하면 되살아나는" 유령 공유가 된다.
  // 값 자체(target_value)는 절대 새로 만들지 않고, 사람이 읽을 라벨만 만든다.
  const selected = useMemo<Candidate[]>(() => {
    const matched = allCandidates.filter((c) => selectedValues.has(c.value))
    const matchedValues = new Set(matched.map((c) => c.value))
    const extraFn: Candidate[] = [...fnTargets]
      .filter((v) => !matchedValues.has(v))
      .map((value) => ({
        kind: 'function' as const,
        value,
        label: sharedTargetLabel({ target_type: 'function', target_value: value }),
      }))
    const extraDept: Candidate[] = [...deptTargets]
      .filter((v) => !matchedValues.has(v))
      .map((value) => ({
        kind: 'dept' as const,
        value,
        label: sharedTargetLabel({ target_type: 'dept', target_value: value }),
      }))
    return [...matched, ...extraFn, ...extraDept]
  }, [allCandidates, selectedValues, fnTargets, deptTargets])

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

  // 목록이 max-h-56(약 7개 높이)로 잘려 있어, 검색어 없이 17개가 뜬 상태에서
  // ArrowDown으로 8번째 이후로 내려가면 activeIndex만 바뀌고 화면 밖으로 나간다.
  // 활성 항목이 항상 보이도록 스크롤을 따라가게 한다.
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIndex))}`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, candidates])

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
      if (open) {
        // 콤보박스가 열린 동안에는 검색어가 후보와 매칭되지 않아도 폼 제출로 새면 안 된다.
        e.preventDefault()
        if (candidates[activeIndex]) {
          add(candidates[activeIndex])
        }
      } else if (query !== '') {
        // Esc로 목록만 닫은 뒤에도 입력칸에 검색어가 남아 있으면, 그 Enter가
        // 부모 폼(접수 폼) 제출로 새면 안 된다. 매칭되는 후보를 고르는 게 아니라
        // 그냥 제출을 막기만 한다 — 활성 후보를 고르는 건 목록이 열려 있을 때만.
        e.preventDefault()
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

        {/*
          닫힌 상태에서도 항상 마운트한다 — aria-controls={listId}가 입력칸에 항상 붙어 있으므로,
          조건부 렌더로 요소를 없애면 존재하지 않는 id를 가리키게 된다(SharingEditor의
          hidden={!open} 관례를 따름). hidden 속성은 렌더 트리에서 display:none으로 빠지므로
          보조기기 접근성 트리에서도 제외되어, 닫힌 listbox가 노출되는 문제도 함께 막는다.
        */}
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          hidden={!open || disabled}
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {candidates.length === 0 ? (
            // listbox의 자식은 option/group만 허용된다 — 빈 상태 문구도 role="option"으로 두되
            // 고를 수 없는 항목임을 aria-disabled로 알린다(선택 불가이므로 id·onClick 없음).
            <li role="option" aria-disabled="true" className="px-3 py-2 text-xs text-gray-400">
              일치하는 팀·부서가 없습니다.
            </li>
          ) : (
            candidates.map((c, i) => (
              <li
                key={c.value}
                id={optionId(i)}
                role="option"
                // aria-selected는 "선택됨"을 뜻한다 — 이 목록의 항목은 선택되는 순간 후보에서
                // 빠지므로 여기 남은 항목은 정의상 전부 미선택이다. "지금 활성(포커스)"는
                // aria-activedescendant(입력칸에 지정)가 이미 전달하므로 여기서는 생략한다.
                onMouseDown={(e) => e.preventDefault()} // blur보다 먼저 클릭이 처리되게
                onClick={() => add(c)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`cursor-pointer border-l-2 px-3 py-1.5 text-sm ${
                  i === activeIndex
                    ? 'border-brand bg-brand/10 font-medium text-brand'
                    : 'border-transparent text-gray-700'
                }`}
              >
                {c.label}
              </li>
            ))
          )}
        </ul>
      </div>

      {/* 선택된 공유대상 — 0개면 렌더하지 않는다 */}
      {selected.length > 0 && (
        <ul aria-label="선택된 공유대상" className="mt-2 flex flex-wrap gap-1.5">
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
