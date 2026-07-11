import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import {
  PRIORITY_OPTIONS,
  VISIBILITY_OPTIONS,
  TYPE_HINTS,
  FUNCTION_TARGETS,
  deptTargetValue,
  deptTargetLabel,
} from '../../lib/constants'
import type {
  RequestPriority,
  RequestTypeCode,
  RequestVisibility,
} from '../../types/database'
import { useCreateRequest, useDeptOptions, useRequestTypes, type SharedTargetInput } from './api'

const labelCls = 'block text-sm font-medium text-gray-700'
const fieldCls =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export function RequestForm() {
  const { profile } = useAuth()
  const { data: types } = useRequestTypes()
  const { data: deptOptions } = useDeptOptions()
  const createRequest = useCreateRequest()

  const [typeCode, setTypeCode] = useState<RequestTypeCode | ''>('')
  const [priority, setPriority] = useState<RequestPriority>('보통')
  const [visibility, setVisibility] = useState<RequestVisibility>('dept')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [desiredDue, setDesiredDue] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [fnTargets, setFnTargets] = useState<Set<string>>(new Set())
  const [deptTargets, setDeptTargets] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [createdSeq, setCreatedSeq] = useState<string | null>(null)

  // 요청 대상 기관 = 내 소속기관 (자동). 프로필에 없으면 접수 불가.
  const myOrg = profile?.org_affil ?? null

  const typeHint = useMemo(() => (typeCode ? TYPE_HINTS[typeCode] : null), [typeCode])
  const visibilityDesc = useMemo(
    () => VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.description,
    [visibility],
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

  function resetForm() {
    setTypeCode('')
    setPriority('보통')
    setVisibility('dept')
    setTitle('')
    setBody('')
    setDesiredDue('')
    setFiles([])
    setFnTargets(new Set())
    setDeptTargets(new Set())
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!myOrg) {
      setError('소속기관 정보가 없어 접수할 수 없습니다. 시스템팀에 문의하세요.')
      return
    }
    if (!typeCode || !title.trim() || !body.trim() || !desiredDue) {
      setError('유형·제목·상세내용·희망완료일은 필수입니다.')
      return
    }

    const sharedTargets: SharedTargetInput[] = [
      ...[...fnTargets].map((v) => ({ target_type: 'function' as const, target_value: v })),
      ...[...deptTargets].map((v) => ({ target_type: 'dept' as const, target_value: v })),
    ]

    try {
      const request = await createRequest.mutateAsync({
        org: myOrg,
        type_code: typeCode,
        priority,
        visibility,
        title,
        body,
        desired_due: desiredDue,
        files,
        sharedTargets,
      })
      setCreatedSeq(request.seq ?? `#${request.id}`)
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : '접수 중 오류가 발생했습니다.')
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
    <section className="mx-auto max-w-2xl">
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

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        {/* 제목 */}
        <div>
          <label className={labelCls}>
            제목 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className={fieldCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="요청 제목을 입력하세요"
            maxLength={200}
          />
        </div>

        {/* 유형 */}
        <div>
          <label className={labelCls}>
            유형 <span className="text-red-500">*</span>
          </label>
          <select
            className={fieldCls}
            value={typeCode}
            onChange={(e) => setTypeCode(e.target.value as RequestTypeCode)}
          >
            <option value="">선택하세요</option>
            {types?.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
          {typeHint && <p className="mt-1 text-xs text-brand">{typeHint}</p>}
        </div>

        {/* 상세내용 (우선 textarea, 이후 에디터로 교체) */}
        <div>
          <label className={labelCls}>
            상세내용 <span className="text-red-500">*</span>
          </label>
          <textarea
            className={`${fieldCls} min-h-[180px] resize-y`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={typeHint ?? '요청 내용을 자세히 적어주세요'}
          />
        </div>

        {/* 우선순위 · 희망완료일 */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className={labelCls}>우선순위</label>
            <select
              className={fieldCls}
              value={priority}
              onChange={(e) => setPriority(e.target.value as RequestPriority)}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>
              희망완료일 <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              className={fieldCls}
              value={desiredDue}
              onChange={(e) => setDesiredDue(e.target.value)}
            />
          </div>
        </div>

        {/* 공개범위 */}
        <div>
          <label className={labelCls}>공개범위</label>
          <select
            className={`${fieldCls} sm:w-72`}
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as RequestVisibility)}
          >
            {VISIBILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {visibilityDesc && <p className="mt-1 text-xs text-gray-500">{visibilityDesc}</p>}
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
          <label className={labelCls}>첨부파일</label>
          <input
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

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
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
