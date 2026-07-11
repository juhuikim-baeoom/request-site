import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ORG_OPTIONS,
  PRIORITY_OPTIONS,
  VISIBILITY_OPTIONS,
  TYPE_HINTS,
} from '../../lib/constants'
import type {
  RequestOrg,
  RequestPriority,
  RequestTypeCode,
  RequestVisibility,
} from '../../types/database'
import { useCreateRequest, useRequestTypes } from './api'

const labelCls = 'block text-sm font-medium text-gray-700'
const fieldCls =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

export function RequestForm() {
  const { data: types } = useRequestTypes()
  const createRequest = useCreateRequest()

  const [org, setOrg] = useState<RequestOrg | ''>('')
  const [typeCode, setTypeCode] = useState<RequestTypeCode | ''>('')
  const [priority, setPriority] = useState<RequestPriority>('보통')
  const [visibility, setVisibility] = useState<RequestVisibility>('dept')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [desiredDue, setDesiredDue] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [createdSeq, setCreatedSeq] = useState<string | null>(null)

  const typeHint = useMemo(
    () => (typeCode ? TYPE_HINTS[typeCode] : null),
    [typeCode],
  )
  const visibilityDesc = useMemo(
    () => VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.description,
    [visibility],
  )

  function resetForm() {
    setOrg('')
    setTypeCode('')
    setPriority('보통')
    setVisibility('dept')
    setTitle('')
    setBody('')
    setDesiredDue('')
    setFiles([])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!org || !typeCode || !title.trim() || !body.trim() || !desiredDue) {
      setError('기관·유형·제목·상세내용·희망완료일은 필수입니다.')
      return
    }

    try {
      const request = await createRequest.mutateAsync({
        org,
        type_code: typeCode,
        priority,
        visibility,
        title,
        body,
        desired_due: desiredDue,
        files,
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
      <h1 className="text-xl font-bold text-gray-900">요청 접수</h1>
      <p className="mt-1 text-sm text-gray-500">업무요청을 작성해 제출하세요.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {/* 기관 */}
          <div>
            <label className={labelCls}>
              기관 <span className="text-red-500">*</span>
            </label>
            <select
              className={fieldCls}
              value={org}
              onChange={(e) => setOrg(e.target.value as RequestOrg)}
            >
              <option value="">선택하세요</option>
              {ORG_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
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

          {/* 우선순위 */}
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

          {/* 공개범위 */}
          <div>
            <label className={labelCls}>공개범위</label>
            <select
              className={fieldCls}
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as RequestVisibility)}
            >
              {VISIBILITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {visibilityDesc && (
              <p className="mt-1 text-xs text-gray-500">{visibilityDesc}</p>
            )}
          </div>
        </div>

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

        {/* 상세내용 (우선 textarea, 이후 에디터로 교체) */}
        <div>
          <label className={labelCls}>
            상세내용 <span className="text-red-500">*</span>
          </label>
          <textarea
            className={`${fieldCls} min-h-[160px] resize-y`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={typeHint ?? '요청 내용을 자세히 적어주세요'}
          />
        </div>

        {/* 희망완료일 */}
        <div className="sm:w-56">
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
