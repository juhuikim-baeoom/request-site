import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { Badge } from '../../components/Badge'
import { VisibilityBadge } from '../../components/VisibilityBadge'
import {
  STATUS_BADGE,
  PRIORITY_BADGE,
  PRIORITY_OPTIONS,
  VISIBILITY_OPTIONS,
  dueBadgeClass,
} from '../../lib/constants'
import { fmtDateTime } from '../../lib/format'
import type { RequestPriority, RequestVisibility } from '../../types/database'
import {
  getAttachmentUrl,
  useAddComment,
  useCancelRequest,
  useRequestAttachments,
  useRequestComments,
  useRequestDetail,
  useRequestHistory,
  useUpdateRequest,
} from './api'

const fieldCls =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

function personLabel(p: { name: string | null; email?: string } | null): string {
  if (!p) return '-'
  return p.name ?? p.email ?? '-'
}

export function RequestDetail() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = Number(idParam)

  const { profile } = useAuth()
  const { data, isLoading, error } = useRequestDetail(id)
  const { data: attachments } = useRequestAttachments(id)
  const { data: history } = useRequestHistory(id)
  const { data: comments } = useRequestComments(id)
  const addComment = useAddComment(id)
  const updateRequest = useUpdateRequest(id)
  const cancelRequest = useCancelRequest(id)

  const [comment, setComment] = useState('')
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editPriority, setEditPriority] = useState<RequestPriority>('보통')
  const [editVisibility, setEditVisibility] = useState<RequestVisibility>('dept')
  const [editDue, setEditDue] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  function handleDownload(attachmentId: number) {
    window.open(getAttachmentUrl(attachmentId), '_blank', 'noopener')
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault()
    if (!comment.trim()) return
    await addComment.mutateAsync(comment)
    setComment('')
  }

  if (isLoading) {
    return <div className="p-8 text-center text-gray-400">불러오는 중…</div>
  }
  if (error || !data) {
    return (
      <div className="p-8 text-center text-gray-500">
        요청을 찾을 수 없거나 접근 권한이 없습니다.{' '}
        <Link to="/requests/mine" className="text-brand hover:underline">
          목록으로
        </Link>
      </div>
    )
  }

  const { view: v, requester, assignee, sharedTargets } = data
  const canEdit = v.requester_id === profile?.id && v.status === '접수'

  function startEdit() {
    setEditTitle(v.title ?? '')
    setEditBody(v.body ?? '')
    setEditPriority((v.priority as RequestPriority) ?? '보통')
    setEditVisibility((v.visibility as RequestVisibility) ?? 'dept')
    setEditDue(v.desired_due ?? '')
    setActionError(null)
    setEditing(true)
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    setActionError(null)
    if (!editTitle.trim() || !editBody.trim() || !editDue) {
      setActionError('제목·상세내용·희망완료일은 필수입니다.')
      return
    }
    try {
      await updateRequest.mutateAsync({
        title: editTitle.trim(),
        body: editBody,
        priority: editPriority,
        visibility: editVisibility,
        desired_due: editDue,
      })
      setEditing(false)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '수정 중 오류가 발생했습니다.')
    }
  }

  async function handleWithdraw() {
    if (!window.confirm('이 요청을 철회하시겠어요? 철회 후에는 되돌릴 수 없습니다.')) return
    setActionError(null)
    try {
      await cancelRequest.mutateAsync()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '철회 중 오류가 발생했습니다.')
    }
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <Link to="/requests/mine" className="text-sm text-gray-500 hover:text-brand">
        ← 내 요청 목록
      </Link>

      {/* 헤더 */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-gray-400">{v.seq}</span>
          {v.status && <Badge className={STATUS_BADGE[v.status]}>{v.status}</Badge>}
          <Badge className={dueBadgeClass(v.due_status)}>{v.due_status}</Badge>
          {v.priority && <Badge className={PRIORITY_BADGE[v.priority]}>{v.priority}</Badge>}
          {v.rework_count != null && v.rework_count > 0 && (
            <Badge className="bg-orange-100 text-orange-700">재작업 {v.rework_count}</Badge>
          )}
        </div>
        <h1 className="mt-2 text-xl font-bold text-gray-900">{v.title}</h1>
        <div className="mt-2">
          {v.visibility && (
            <VisibilityBadge
              visibility={v.visibility as RequestVisibility}
              sharedTargets={sharedTargets}
            />
          )}
        </div>
      </div>

      {/* 본인 접수건 액션 (수정 / 철회) */}
      {canEdit && !editing && (
        <div className="flex gap-2">
          <button
            onClick={startEdit}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            수정
          </button>
          <button
            onClick={() => void handleWithdraw()}
            disabled={cancelRequest.isPending}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            취소(철회)
          </button>
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {actionError}
        </div>
      )}

      {editing ? (
        /* 수정 폼 (본인 접수건) */
        <form onSubmit={saveEdit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              제목 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className={fieldCls}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">우선순위</label>
              <select
                className={fieldCls}
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value as RequestPriority)}
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">공개범위</label>
              <select
                className={fieldCls}
                value={editVisibility}
                onChange={(e) => setEditVisibility(e.target.value as RequestVisibility)}
              >
                {VISIBILITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                희망완료일 <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                className={fieldCls}
                value={editDue}
                onChange={(e) => setEditDue(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              상세내용 <span className="text-red-500">*</span>
            </label>
            <textarea
              className={`${fieldCls} min-h-[160px] resize-y`}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={updateRequest.isPending}
              className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {updateRequest.isPending ? '저장 중…' : '저장'}
            </button>
          </div>
        </form>
      ) : (
        <>
          {/* 메타 */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-gray-200 bg-white p-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-gray-400">기관</dt>
              <dd className="mt-0.5 text-gray-800">{v.org}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">유형</dt>
              <dd className="mt-0.5 text-gray-800">{v.type_label}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">희망완료일</dt>
              <dd className="mt-0.5 text-gray-800">{v.desired_due ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">요청자</dt>
              <dd className="mt-0.5 text-gray-800">
                {personLabel(requester)}
                {requester?.dept_function && (
                  <span className="ml-1 text-xs text-gray-400">
                    ({requester.org_affil}·{requester.dept_function})
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">담당자</dt>
              <dd className="mt-0.5 text-gray-800">
                {assignee ? personLabel(assignee) : '미배정'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">접수일</dt>
              <dd className="mt-0.5 text-gray-800">{fmtDateTime(v.created_at)}</dd>
            </div>
          </dl>

          {/* 본문 */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700">상세내용</h2>
            <div className="mt-2 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-800">
              {v.body || <span className="text-gray-400">내용 없음</span>}
            </div>
          </div>
        </>
      )}

      {/* 첨부 */}
      {attachments && attachments.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700">첨부파일</h2>
          <ul className="mt-2 space-y-1">
            {attachments.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => handleDownload(a.id)}
                  className="text-sm text-brand hover:underline"
                >
                  {a.file_name ?? a.storage_path}
                </button>
                {a.file_size != null && (
                  <span className="ml-2 text-xs text-gray-400">
                    {Math.ceil(a.file_size / 1024)} KB
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 상태 이력 */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700">상태 변경 이력</h2>
        {history && history.length > 0 ? (
          <ol className="mt-2 space-y-1.5 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 text-gray-600">
                <span className="text-xs text-gray-400">{fmtDateTime(h.changed_at)}</span>
                <span>
                  {h.from_status ?? '—'} → <span className="font-medium">{h.to_status}</span>
                </span>
                <span className="text-xs text-gray-400">{personLabel(h.actor)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-gray-400">변경 이력이 없습니다.</p>
        )}
      </div>

      {/* 코멘트 */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700">코멘트</h2>
        <div className="mt-2 space-y-3">
          {comments && comments.length > 0 ? (
            comments.map((c) => (
              <div key={c.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="font-medium text-gray-600">{personLabel(c.author)}</span>
                  <span>{fmtDateTime(c.created_at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{c.body}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-400">아직 코멘트가 없습니다.</p>
          )}
        </div>

        <form onSubmit={handleAddComment} className="mt-3">
          <textarea
            className="block w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="코멘트를 입력하세요"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              disabled={addComment.isPending || !comment.trim()}
              className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {addComment.isPending ? '등록 중…' : '코멘트 등록'}
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
