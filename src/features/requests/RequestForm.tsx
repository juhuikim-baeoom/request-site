import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import {
  URGENCY_OPTIONS,
  TYPE_FIELDS,
  VISIBILITY_OPTIONS,
  TYPE_HINTS,
  FUNCTION_TARGETS,
  deptTargetValue,
  deptTargetLabel,
} from '../../lib/constants'
import type { RequestTypeCode, RequestVisibility } from '../../types/database'
import type { Urgency } from '../../lib/constants'
import { useCreateRequest, useDeptOptions, useRequestTypes, type SharedTargetInput } from './api'

const labelCls = 'block text-sm font-medium text-gray-700'
const fieldCls =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const errorCls = 'mt-1 text-xs text-red-600'

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

type FieldErrors = Record<string, string>

export function RequestForm() {
  const { profile } = useAuth()
  const { data: types } = useRequestTypes()
  const { data: deptOptions } = useDeptOptions()
  const createRequest = useCreateRequest()

  const [typeCode, setTypeCode] = useState<RequestTypeCode | ''>('')
  const [urgency, setUrgency] = useState<Urgency>('보통')
  const [visibility, setVisibility] = useState<RequestVisibility>('dept')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [desiredDue, setDesiredDue] = useState('')
  const [intakeValues, setIntakeValues] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<File[]>([])
  const [fnTargets, setFnTargets] = useState<Set<string>>(new Set())
  const [deptTargets, setDeptTargets] = useState<Set<string>>(new Set())
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [createdSeq, setCreatedSeq] = useState<string | null>(null)

  // 요청 대상 기관 = 내 소속기관 (자동). 프로필에 없으면 접수 불가.
  const myOrg = profile?.org_affil ?? null

  const typeHint = useMemo(() => (typeCode ? TYPE_HINTS[typeCode] : null), [typeCode])
  const visibilityDesc = useMemo(
    () => VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.description,
    [visibility],
  )

  // 현재 선택된 유형의 intake 필드 목록
  const activeIntakeFields = useMemo(
    () => (typeCode ? TYPE_FIELDS[typeCode] : []),
    [typeCode],
  )

  // 세부부서 옵션을 기관별로 그룹핑
  const deptGroups = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>()
    for (const o of deptOptions ?? []) {
      if (!o.dept_function) continue
      const list = groups.get(o.org_affil) ?? []
      list.push({
        value: deptTargetValue(o.org_affil, o.dept_function),
        label: deptTargetLabel(o.org_affil, o.dept_function),
      })
      groups.set(o.org_affil, list)
    }
    return [...groups.entries()]
  }, [deptOptions])

  function handleTypeChange(code: RequestTypeCode | '') {
    setTypeCode(code)
    setIntakeValues({}) // 유형 변경 시 intake 값 초기화
    setFieldErrors({})
  }

  function setIntakeField(key: string, value: string) {
    setIntakeValues((prev) => ({ ...prev, [key]: value }))
    // 값 입력 시 해당 필드 오류 제거 — 오류 키는 'intake_' + key 형태
    const errorKey = `intake_${key}`
    if (fieldErrors[errorKey]) {
      setFieldErrors((prev) => {
        const next = { ...prev }
        delete next[errorKey]
        return next
      })
    }
  }

  function clearFieldError(key: string) {
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {}

    if (!myOrg) errors['org'] = '소속기관 정보가 없습니다. 시스템팀에 문의하세요.'
    if (!typeCode) errors['type_code'] = '유형을 선택해주세요.'
    if (!title.trim()) errors['title'] = '제목을 입력해주세요.'
    if (!desiredDue) {
      errors['desired_due'] = '희망완료일을 선택해주세요.'
    } else if (desiredDue < new Date().toISOString().slice(0, 10)) {
      errors['desired_due'] = '희망완료일은 오늘 이후여야 합니다.'
    }
    if (!urgency) errors['urgency'] = '긴급도를 선택해주세요.'
    if (!visibility) errors['visibility'] = '공개범위를 선택해주세요.'

    // 선택된 유형의 intake 필드 검증
    for (const field of activeIntakeFields) {
      if (field.required && !intakeValues[field.key]?.trim()) {
        errors[`intake_${field.key}`] = `${field.label}을(를) 입력해주세요.`
      }
    }

    return errors
  }

  function resetForm() {
    setTypeCode('')
    setUrgency('보통')
    setVisibility('dept')
    setTitle('')
    setBody('')
    setDesiredDue('')
    setIntakeValues({})
    setFiles([])
    setFnTargets(new Set())
    setDeptTargets(new Set())
    setFieldErrors({})
    setSubmitError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    const errors = validate()
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    if (!myOrg || !typeCode) return // 타입 가드 (validate에서 이미 걸림)

    const sharedTargets: SharedTargetInput[] = [
      ...[...fnTargets].map((v) => ({ target_type: 'function' as const, target_value: v })),
      ...[...deptTargets].map((v) => ({ target_type: 'dept' as const, target_value: v })),
    ]

    // intake_detail: 현재 유형의 필드만 포함
    const intake_detail: Record<string, string> = {}
    for (const field of activeIntakeFields) {
      intake_detail[field.key] = intakeValues[field.key]?.trim() ?? ''
    }

    try {
      const request = await createRequest.mutateAsync({
        org: myOrg,
        type_code: typeCode,
        urgency,
        visibility,
        title,
        body: body || undefined,
        desired_due: desiredDue,
        intake_detail,
        files,
        sharedTargets,
      })
      setCreatedSeq(request.seq ?? `#${request.id}`)
      resetForm()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '접수 중 오류가 발생했습니다.')
    }
  }

  // 접수 완료 화면
  if (createdSeq) {
    return (
      <section className="mx-auto max-w-lg">
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <h1 className="text-lg font-bold text-green-800">접수가 완료되었습니다</h1>
          <p className="mt-2 text-sm text-green-700">
            접수번호 <span className="font-mono font-semibold">{createdSeq}</span>
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => setCreatedSeq(null)}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              새 요청 작성
            </button>
            <Link
              to="/requests/mine"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              내 요청 보기
            </Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="요청 접수">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">요청 접수</h1>
        <span className="text-xs text-gray-500">
          소속기관{' '}
          <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">
            {myOrg ?? '미설정'}
          </span>
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-500">업무요청을 작성해 제출하세요.</p>

      {fieldErrors['org'] && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {fieldErrors['org']}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        {/* 유형 (타입 우선) */}
        <div>
          <label htmlFor="field-type_code" className={labelCls}>
            유형 <span className="text-red-500">*</span>
          </label>
          <select
            id="field-type_code"
            className={`${fieldCls} ${fieldErrors['type_code'] ? 'border-red-400' : ''}`}
            value={typeCode}
            onChange={(e) => handleTypeChange(e.target.value as RequestTypeCode | '')}
          >
            <option value="">선택하세요</option>
            {types?.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
          {fieldErrors['type_code'] && <p className={errorCls}>{fieldErrors['type_code']}</p>}
          {typeHint && !fieldErrors['type_code'] && (
            <p className="mt-1 text-xs text-brand">{typeHint}</p>
          )}
        </div>

        {/* 유형별 intake_detail 필드 (유형 선택 후에만 노출) */}
        {typeCode && activeIntakeFields.length > 0 && (
          <div className="space-y-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
            <p className="text-xs font-semibold text-blue-700">유형별 필수 정보</p>
            {activeIntakeFields.map((field) => (
              <div key={field.key}>
                <label htmlFor={`field-intake_${field.key}`} className={`${labelCls} text-blue-900`}>
                  {field.label} <span className="text-red-500">*</span>
                </label>
                <input
                  id={`field-intake_${field.key}`}
                  type="text"
                  className={`${fieldCls} ${fieldErrors[`intake_${field.key}`] ? 'border-red-400' : 'border-blue-200 focus:border-brand'}`}
                  value={intakeValues[field.key] ?? ''}
                  onChange={(e) => setIntakeField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                />
                {fieldErrors[`intake_${field.key}`] && (
                  <p className={errorCls}>{fieldErrors[`intake_${field.key}`]}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 제목 */}
        <div>
          <label htmlFor="field-title" className={labelCls}>
            제목 <span className="text-red-500">*</span>
          </label>
          <input
            id="field-title"
            type="text"
            className={`${fieldCls} ${fieldErrors['title'] ? 'border-red-400' : ''}`}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              clearFieldError('title')
            }}
            placeholder="요청 제목을 입력하세요"
            maxLength={200}
          />
          {fieldErrors['title'] && <p className={errorCls}>{fieldErrors['title']}</p>}
        </div>

        {/* 상세내용 */}
        <div>
          <label htmlFor="field-body" className={labelCls}>상세내용</label>
          <textarea
            id="field-body"
            className={`${fieldCls} min-h-[140px] resize-y`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={typeHint ?? '추가로 전달할 내용을 적어주세요 (선택)'}
          />
        </div>

        {/* 긴급도 · 희망완료일 */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="field-urgency" className={labelCls}>
              긴급도 <span className="text-red-500">*</span>
            </label>
            <select
              id="field-urgency"
              className={`${fieldCls} ${fieldErrors['urgency'] ? 'border-red-400' : ''}`}
              value={urgency}
              onChange={(e) => {
                setUrgency(e.target.value as Urgency)
                clearFieldError('urgency')
              }}
            >
              {URGENCY_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            {fieldErrors['urgency'] && <p className={errorCls}>{fieldErrors['urgency']}</p>}
          </div>
          <div>
            <label htmlFor="field-desired_due" className={labelCls}>
              희망완료일 <span className="text-red-500">*</span>
            </label>
            <input
              id="field-desired_due"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              className={`${fieldCls} ${fieldErrors['desired_due'] ? 'border-red-400' : ''}`}
              value={desiredDue}
              onChange={(e) => {
                setDesiredDue(e.target.value)
                clearFieldError('desired_due')
              }}
            />
            {fieldErrors['desired_due'] && (
              <p className={errorCls}>{fieldErrors['desired_due']}</p>
            )}
          </div>
        </div>

        {/* 공개범위 */}
        <div>
          <label htmlFor="field-visibility" className={labelCls}>
            공개범위 <span className="text-red-500">*</span>
          </label>
          <select
            id="field-visibility"
            className={`${fieldCls} sm:w-72 ${fieldErrors['visibility'] ? 'border-red-400' : ''}`}
            value={visibility}
            onChange={(e) => {
              setVisibility(e.target.value as RequestVisibility)
              clearFieldError('visibility')
            }}
          >
            {VISIBILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {fieldErrors['visibility'] && <p className={errorCls}>{fieldErrors['visibility']}</p>}
          {visibilityDesc && !fieldErrors['visibility'] && (
            <p className="mt-1 text-xs text-gray-500">{visibilityDesc}</p>
          )}
        </div>

        {/* 추가 공유 (선택) */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-700">추가 공유 (선택)</p>
          <p className="mt-0.5 text-xs text-gray-500">
            공개범위에 더해 특정 직무·부서에도 이 요청을 공유합니다. 여러 개 선택할 수 있습니다.
          </p>

          {/* 직무 단위 */}
          <div className="mt-3">
            <p className="text-xs font-semibold text-gray-500">직무 단위</p>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {FUNCTION_TARGETS.map((fn) => (
                <label key={fn} className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-brand focus:ring-brand"
                    checked={fnTargets.has(fn)}
                    onChange={() => setFnTargets((s) => toggle(s, fn))}
                  />
                  {fn} 전체
                </label>
              ))}
            </div>
          </div>

          {/* 세부부서 (기관 × 직무) */}
          {deptGroups.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-gray-500">세부부서</p>
              <div className="mt-1.5 space-y-2">
                {deptGroups.map(([orgName, items]) => (
                  <div key={orgName} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <span className="w-10 shrink-0 text-xs font-medium text-gray-400">
                      {orgName}
                    </span>
                    {items.map((it) => (
                      <label
                        key={it.value}
                        className="inline-flex items-center gap-1.5 text-sm text-gray-700"
                      >
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 text-brand focus:ring-brand"
                          checked={deptTargets.has(it.value)}
                          onChange={() => setDeptTargets((s) => toggle(s, it.value))}
                        />
                        {it.label}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 첨부파일 */}
        <div>
          <label htmlFor="field-files" className={labelCls}>첨부파일</label>
          <input
            id="field-files"
            type="file"
            multiple
            className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          {files.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-gray-500">
              {files.map((f) => (
                <li key={f.name}>
                  {f.name} ({Math.ceil(f.size / 1024)} KB)
                </li>
              ))}
            </ul>
          )}
        </div>

        {submitError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {submitError}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-gray-200 pt-5">
          <button
            type="submit"
            disabled={createRequest.isPending}
            className="rounded-md bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {createRequest.isPending ? '접수 중…' : '접수하기'}
          </button>
        </div>
      </form>
    </section>
  )
}
