import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import {
  URGENCY_OPTIONS,
  TYPE_FIELDS,
  VISIBILITY_OPTIONS,
  TYPE_HINTS,
  TYPE_ICON,
  FUNCTION_TARGETS,
  deptTargetValue,
  deptTargetLabel,
} from '../../lib/constants'
import type { RequestTypeCode, RequestVisibility } from '../../types/database'
import type { Urgency } from '../../lib/constants'
import {
  useCreateRequest,
  useRetryAttachments,
  useDeptOptions,
  useRequestTypes,
  type SharedTargetInput,
  type CreateRequestResult,
} from './api'
import { BodyEditorSlot } from './BodyEditorSlot'

// ── 서버와 일치하는 첨부 제한 (server/src/app.ts @fastify/multipart limits.fileSize) ──
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

const labelCls = 'block text-sm font-medium text-gray-700'
const sidebarLabelCls = 'block text-xs font-medium text-gray-700'
const fieldCls =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-gray-50 disabled:text-gray-400'
const errorCls = 'mt-1 text-xs text-red-600'

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

type FieldErrors = Record<string, string>

// 첫 오류 필드 id 우선순위 (DOM 순서와 일치)
const FIELD_ORDER = [
  'field-type_code',
  'field-title',
  'field-urgency',
  'field-desired_due',
  'field-visibility',
]

function focusFirstError(errors: FieldErrors) {
  // intake 필드 id 포함해 탐색
  const intakeIds = Object.keys(errors)
    .filter((k) => k.startsWith('intake_'))
    .map((k) => `field-${k}`)

  const allIds = [FIELD_ORDER[0], ...intakeIds, ...FIELD_ORDER.slice(1)]

  for (const id of allIds) {
    const el = document.getElementById(id)
    if (el && errors[id.replace('field-', '')] !== undefined) {
      el.focus()
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
  }

  // fallback: 오류가 있는 첫 번째 요소
  for (const key of Object.keys(errors)) {
    const el = document.getElementById(`field-${key}`)
    if (el) {
      el.focus()
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
  }
}

export function RequestForm() {
  const { profile } = useAuth()
  const { data: types, isLoading: typesLoading } = useRequestTypes()
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
  const [shareOpen, setShareOpen] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateRequestResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const myOrg = profile?.org_affil ?? null

  const typeHint = useMemo(() => (typeCode ? TYPE_HINTS[typeCode] : null), [typeCode])
  const visibilityDesc = useMemo(
    () => VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.description,
    [visibility],
  )
  const activeIntakeFields = useMemo(
    () => (typeCode ? TYPE_FIELDS[typeCode] : []),
    [typeCode],
  )
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

  const sharedCount = fnTargets.size + deptTargets.size
  const isPending = createRequest.isPending

  function handleTypeChange(code: RequestTypeCode | '') {
    setTypeCode(code)
    setIntakeValues({})
    setFieldErrors({})
  }

  function setIntakeField(key: string, value: string) {
    setIntakeValues((prev) => ({ ...prev, [key]: value }))
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
    setShareOpen(false)
    setFieldErrors({})
    setSubmitError(null)
  }

  // ── 첨부 파일 추가 (클라이언트 사전 검증: 20MB)
  function addFiles(incoming: File[]) {
    const valid: File[] = []
    const oversized: string[] = []
    for (const f of incoming) {
      if (f.size > MAX_FILE_SIZE) {
        oversized.push(f.name)
      } else {
        valid.push(f)
      }
    }
    if (oversized.length > 0) {
      setSubmitError(`파일 크기 초과(최대 20MB): ${oversized.join(', ')}`)
    }
    if (valid.length > 0) {
      setFiles((prev) => {
        const names = new Set(prev.map((f) => f.name))
        return [...prev, ...valid.filter((f) => !names.has(f.name))]
      })
    }
  }

  function removeFile(name: string) {
    setFiles((prev) => prev.filter((f) => f.name !== name))
  }

  // ── 드롭존 핸들러
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }
  function handleDragLeave() {
    setDragOver(false)
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    const errors = validate()
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      focusFirstError(errors)
      return
    }

    if (!myOrg || !typeCode) return

    const sharedTargets: SharedTargetInput[] = [
      ...[...fnTargets].map((v) => ({ target_type: 'function' as const, target_value: v })),
      ...[...deptTargets].map((v) => ({ target_type: 'dept' as const, target_value: v })),
    ]

    const intake_detail: Record<string, string> = {}
    for (const field of activeIntakeFields) {
      intake_detail[field.key] = intakeValues[field.key]?.trim() ?? ''
    }

    try {
      const res = await createRequest.mutateAsync({
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
      setResult(res)
      resetForm()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '접수 중 오류가 발생했습니다.')
    }
  }

  // ── 접수 완료 화면
  if (result) {
    return (
      <CompletionCard
        result={result}
        onNewRequest={() => setResult(null)}
      />
    )
  }

  return (
    <section aria-label="요청 접수" className="max-w-[1600px]">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">요청 접수</h1>
          <p className="mt-1 text-sm text-gray-500">업무요청을 작성해 제출하세요.</p>
        </div>
        <span className="text-xs text-gray-500">
          소속기관{' '}
          <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">
            {myOrg ?? '미설정'}
          </span>
        </span>
      </div>

      {fieldErrors['org'] && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {fieldErrors['org']}
        </div>
      )}

      {/* 2-페인 그리드 */}
      <form
        onSubmit={handleSubmit}
        className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
        aria-label="요청 접수 폼"
      >
        {/* ───────── 작성 컬럼 ───────── */}
        <section aria-label="요청 작성" className="min-w-0 space-y-6">

          {/* 유형: 카드형 네이티브 radio */}
          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-gray-700">
              유형 <span className="text-red-500" aria-hidden="true">*</span>
            </legend>
            {typesLoading ? (
              <p className="text-sm text-gray-400">유형 목록 로딩 중…</p>
            ) : !types || types.length === 0 ? (
              <p className="text-sm text-gray-400">유형 목록이 없습니다.</p>
            ) : (
              <div
                className="grid grid-cols-2 gap-3 sm:grid-cols-4"
                role="radiogroup"
                aria-label="요청 유형"
              >
                {types.map((t) => {
                  const isSelected = typeCode === t.code
                  const icon = TYPE_ICON[t.code as RequestTypeCode] ?? '📋'
                  const hint = TYPE_HINTS[t.code as RequestTypeCode] ?? ''
                  return (
                    <label
                      key={t.code}
                      className={[
                        'relative flex cursor-pointer flex-col rounded-xl border-2 p-3 transition-colors',
                        isSelected
                          ? 'border-brand bg-blue-50'
                          : 'border-gray-200 bg-white hover:border-gray-300',
                        isPending ? 'pointer-events-none opacity-60' : '',
                      ].join(' ')}
                    >
                      <input
                        type="radio"
                        name="type_code"
                        id={t.code === types[0]?.code ? 'field-type_code' : undefined}
                        value={t.code}
                        checked={isSelected}
                        onChange={() => handleTypeChange(t.code as RequestTypeCode)}
                        disabled={isPending}
                        className="sr-only"
                        aria-describedby={fieldErrors['type_code'] ? 'error-type_code' : undefined}
                      />
                      <span className="text-lg" aria-hidden="true">{icon}</span>
                      <span className="mt-1 text-sm font-semibold text-gray-900">{t.label}</span>
                      <span className="mt-0.5 text-xs text-gray-500 leading-snug">{hint}</span>
                    </label>
                  )
                })}
              </div>
            )}
            {fieldErrors['type_code'] && (
              <p id="error-type_code" className={errorCls} role="alert">
                {fieldErrors['type_code']}
              </p>
            )}
          </fieldset>

          {/* 유형별 상세 (조건부) */}
          {typeCode && activeIntakeFields.length > 0 && (
            <div className="space-y-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
              <p className="text-xs font-semibold text-blue-700">유형별 필수 정보</p>
              {activeIntakeFields.map((field) => {
                const errorId = `error-intake_${field.key}`
                const hasError = !!fieldErrors[`intake_${field.key}`]
                return (
                  <div key={field.key}>
                    <label
                      htmlFor={`field-intake_${field.key}`}
                      className={`${labelCls} text-blue-900`}
                    >
                      {field.label}{' '}
                      <span className="text-red-500" aria-hidden="true">*</span>
                    </label>
                    <input
                      id={`field-intake_${field.key}`}
                      type="text"
                      className={[
                        fieldCls,
                        hasError
                          ? 'border-red-400'
                          : 'border-blue-200 focus:border-brand',
                      ].join(' ')}
                      value={intakeValues[field.key] ?? ''}
                      onChange={(e) => setIntakeField(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      disabled={isPending}
                      aria-invalid={hasError || undefined}
                      aria-describedby={hasError ? errorId : undefined}
                      aria-required="true"
                    />
                    {hasError && (
                      <p id={errorId} className={errorCls} role="alert">
                        {fieldErrors[`intake_${field.key}`]}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* 제목 */}
          <div>
            <label htmlFor="field-title" className={labelCls}>
              제목 <span className="text-red-500" aria-hidden="true">*</span>
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
              disabled={isPending}
              aria-invalid={!!fieldErrors['title'] || undefined}
              aria-describedby={fieldErrors['title'] ? 'error-title' : undefined}
              aria-required="true"
            />
            {fieldErrors['title'] && (
              <p id="error-title" className={errorCls} role="alert">
                {fieldErrors['title']}
              </p>
            )}
          </div>

          {/* 상세내용 — 에디터 슬롯 (향후 서상연 팀장 에디터로 교체 예정) */}
          <div>
            <label id="label-body" htmlFor="field-body" className={labelCls}>
              상세내용
            </label>
            <BodyEditorSlot
              id="field-body"
              ariaLabelledby="label-body"
              value={body}
              onChange={setBody}
              disabled={isPending}
              placeholder={typeHint ?? '추가로 전달할 내용을 적어주세요 (선택)'}
            />
          </div>

          {/* 첨부 드롭존 */}
          <div>
            <p className={labelCls} id="label-files">
              첨부파일
            </p>
            <div
              role="button"
              tabIndex={0}
              aria-labelledby="label-files"
              aria-describedby="files-hint"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              className={[
                'mt-1 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm transition-colors',
                dragOver
                  ? 'border-brand bg-blue-50 text-brand'
                  : 'border-gray-300 bg-white text-gray-500 hover:border-brand hover:text-brand',
                isPending ? 'pointer-events-none opacity-60' : '',
              ].join(' ')}
            >
              <span className="text-2xl" aria-hidden="true">📎</span>
              <p className="mt-2">
                파일을 끌어다 놓거나{' '}
                <span className="font-medium text-brand">클릭해 선택</span>
              </p>
              <p id="files-hint" className="mt-1 text-xs text-gray-400">
                파일당 최대 20MB
              </p>
            </div>
            {/* 숨김 file input — 드롭존 label과 연결 */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              disabled={isPending}
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []))
                // 같은 파일 재선택 허용
                e.target.value = ''
              }}
            />
            {/* 파일 칩 */}
            {files.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="첨부된 파일 목록">
                {files.map((f) => (
                  <li
                    key={f.name}
                    className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
                  >
                    <span>{f.name}</span>
                    <span className="text-gray-400">
                      ({Math.ceil(f.size / 1024)} KB)
                    </span>
                    <button
                      type="button"
                      aria-label={`${f.name} 제거`}
                      onClick={() => removeFile(f.name)}
                      disabled={isPending}
                      className="ml-0.5 text-gray-400 hover:text-red-500 disabled:opacity-50"
                    >
                      ✕
                    </button>
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

          {/* 모바일(<lg) 하단 고정 제출바 — lg 이상에서 숨김 */}
          <div
            className="lg:hidden"
            style={{ paddingBottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}
            aria-hidden="true"
          />
        </section>

        {/* ───────── 속성·공유 사이드바 ───────── */}
        <aside
          aria-label="속성 및 공유"
          className="lg:sticky lg:top-6 lg:self-start"
        >
          <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-gray-900">속성 · 공유</p>

            {/* 긴급도 · 희망완료일 — 2열, 좁은 폭에서 1열 fallback */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="field-urgency" className={sidebarLabelCls}>
                  긴급도 <span className="text-red-500" aria-hidden="true">*</span>
                </label>
                <select
                  id="field-urgency"
                  className={`${fieldCls} ${fieldErrors['urgency'] ? 'border-red-400' : ''}`}
                  value={urgency}
                  onChange={(e) => {
                    setUrgency(e.target.value as Urgency)
                    clearFieldError('urgency')
                  }}
                  disabled={isPending}
                  aria-invalid={!!fieldErrors['urgency'] || undefined}
                  aria-describedby={fieldErrors['urgency'] ? 'error-urgency' : undefined}
                  aria-required="true"
                >
                  {URGENCY_OPTIONS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                {fieldErrors['urgency'] && (
                  <p id="error-urgency" className={errorCls} role="alert">
                    {fieldErrors['urgency']}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="field-desired_due" className={sidebarLabelCls}>
                  희망완료일 <span className="text-red-500" aria-hidden="true">*</span>
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
                  disabled={isPending}
                  aria-invalid={!!fieldErrors['desired_due'] || undefined}
                  aria-describedby={fieldErrors['desired_due'] ? 'error-desired_due' : undefined}
                  aria-required="true"
                />
                {fieldErrors['desired_due'] && (
                  <p id="error-desired_due" className={errorCls} role="alert">
                    {fieldErrors['desired_due']}
                  </p>
                )}
              </div>
            </div>

            {/* 공개범위 */}
            <div>
              <label htmlFor="field-visibility" className={sidebarLabelCls}>
                공개범위 <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <select
                id="field-visibility"
                className={`${fieldCls} ${fieldErrors['visibility'] ? 'border-red-400' : ''}`}
                value={visibility}
                onChange={(e) => {
                  setVisibility(e.target.value as RequestVisibility)
                  clearFieldError('visibility')
                }}
                disabled={isPending}
                aria-invalid={!!fieldErrors['visibility'] || undefined}
                aria-describedby={
                  fieldErrors['visibility']
                    ? 'error-visibility'
                    : visibilityDesc
                    ? 'hint-visibility'
                    : undefined
                }
                aria-required="true"
              >
                {VISIBILITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {fieldErrors['visibility'] && (
                <p id="error-visibility" className={errorCls} role="alert">
                  {fieldErrors['visibility']}
                </p>
              )}
              {visibilityDesc && !fieldErrors['visibility'] && (
                <p id="hint-visibility" className="mt-1 text-xs text-gray-500">
                  {visibilityDesc}
                </p>
              )}
            </div>

            {/* 공유대상 — 기본 접힘, 선택 수 뱃지 */}
            <div>
              <button
                type="button"
                onClick={() => setShareOpen((v) => !v)}
                className="flex w-full items-center justify-between text-xs font-medium text-brand"
                aria-expanded={shareOpen}
                aria-controls="share-panel"
              >
                <span>+ 공유대상 추가</span>
                <span className="flex items-center gap-1">
                  {sharedCount > 0 && !shareOpen && (
                    <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {sharedCount}
                    </span>
                  )}
                  <span aria-hidden="true">{shareOpen ? '▴' : '▾'}</span>
                </span>
              </button>

              {shareOpen && (
                <div
                  id="share-panel"
                  className="mt-2 space-y-3 rounded-lg bg-gray-50 p-3"
                >
                  <p className="text-xs text-gray-500">
                    공개범위에 더해 특정 직무·부서에도 이 요청을 공유합니다.
                  </p>

                  {/* 직무 단위 */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500">직무 단위</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                      {FUNCTION_TARGETS.map((fn) => (
                        <label
                          key={fn}
                          className="inline-flex items-center gap-1.5 text-sm text-gray-700"
                        >
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 text-brand focus:ring-brand"
                            checked={fnTargets.has(fn)}
                            onChange={() => setFnTargets((s) => toggle(s, fn))}
                            disabled={isPending}
                          />
                          {fn} 전체
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* 세부부서 */}
                  {deptGroups.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500">세부부서</p>
                      <div className="mt-1.5 space-y-2">
                        {deptGroups.map(([orgName, items]) => (
                          <div
                            key={orgName}
                            className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
                          >
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
                                  disabled={isPending}
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
              )}
            </div>

            {/* 제출 버튼 (데스크톱 — lg 이상) */}
            <div className="hidden border-t border-gray-100 pt-4 lg:block">
              <button
                type="submit"
                disabled={isPending}
                className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
              >
                {isPending ? '접수 중…' : '접수하기'}
              </button>
              <p className="mt-2 text-center text-xs text-gray-400">
                제출 시 접수번호가 자동 발급됩니다.
              </p>
            </div>
          </div>
        </aside>
      </form>

      {/* 모바일 하단 고정 제출바 (<lg) */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white px-4 py-3 lg:hidden"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        aria-hidden="true"
      >
        <button
          type="submit"
          form="request-form-hidden"
          disabled={isPending}
          onClick={handleSubmit}
          className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {isPending ? '접수 중…' : '접수하기'}
        </button>
      </div>
    </section>
  )
}

// ── 접수 완료 카드 (중앙 정렬 유지) ──────────────────────────────────────────

interface CompletionCardProps {
  result: CreateRequestResult
  onNewRequest: () => void
}

function CompletionCard({ result, onNewRequest }: CompletionCardProps) {
  const retryAttachments = useRetryAttachments(result.id)
  const [retryResult, setRetryResult] = useState<{ failedFiles: File[] } | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)

  const displaySeq = result.seq ?? `#${result.id}`
  const failedFiles = retryResult?.failedFiles ?? result.failedFiles
  const hasFailures = failedFiles.length > 0

  async function handleRetry() {
    setIsRetrying(true)
    try {
      const res = await retryAttachments.mutateAsync(failedFiles)
      setRetryResult(res)
    } finally {
      setIsRetrying(false)
    }
  }

  return (
    <section className="mx-auto max-w-lg">
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <h1 className="text-lg font-bold text-green-800">접수가 완료되었습니다</h1>
        <p className="mt-2 text-sm text-green-700">
          접수번호{' '}
          <span className="font-mono font-semibold">{displaySeq}</span>
        </p>

        {/* 부분 실패 안내 */}
        {hasFailures && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-semibold">
              접수됨 · 첨부 {result.failedFiles.length}건 중{' '}
              {failedFiles.length}건 실패
            </p>
            <ul className="mt-1 list-inside list-disc text-xs text-amber-700">
              {failedFiles.map((f) => (
                <li key={f.name}>{f.name}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={handleRetry}
              disabled={isRetrying}
              className="mt-3 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {isRetrying ? '재시도 중…' : '실패 파일 재업로드'}
            </button>
          </div>
        )}

        {/* 전부 성공으로 전환된 경우 */}
        {retryResult && retryResult.failedFiles.length === 0 && (
          <p className="mt-3 text-sm font-medium text-green-700">
            모든 첨부파일이 업로드되었습니다.
          </p>
        )}

        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={onNewRequest}
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
