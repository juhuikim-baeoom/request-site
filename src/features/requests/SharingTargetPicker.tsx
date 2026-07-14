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
      if (open) {
        // 콤보박스가 열린 동안에는 검색어가 후보와 매칭되지 않아도 폼 제출로 새면 안 된다.
        e.preventDefault()
        if (candidates[activeIndex]) {
          add(candidates[activeIndex])
        }
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
          id={listId}
          role="listbox"
          hidden={!open || disabled}
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
