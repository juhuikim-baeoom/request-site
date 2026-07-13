import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { Badge } from '../../components/Badge'
import { VisibilityBadge } from '../../components/VisibilityBadge'
import {
  ALLOWED_TRANSITIONS,
  STATUS_BADGE,
  PRIORITY_LEVEL_BADGE,
  URGENCY_OPTIONS,
  VISIBILITY_OPTIONS,
  dueBadgeClass,
} from '../../lib/constants'
import { fmtDateTime } from '../../lib/format'
import type { PriorityLevel, RequestStatus, RequestVisibility } from '../../types/database'
import type { Urgency } from '../../lib/constants'
import { AdminPanel } from './AdminPanel'
import {
  getAttachmentUrl,
  useAddComment,
  useCancelRequest,
  useCsat,
  useRequestAttachments,
  useRequestComments,
  useRequestDetail,
  useRequestHistory,
  useRework,
  useUpdateRequest,
  useUploadCommentAttachment,
  type ImpactLevel,
} from './api'

const fieldCls =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

function personLabel(p: { name: string | null; email?: string } | null): string {
  if (!p) return '-'
  return p.name ?? p.email ?? '-'
}

/** D-N / 초과 / 오늘 형태의 상대 기한 표기 */
function relDue(isoOrNull: string | null | undefined): string {
  if (!isoOrNull) return ''
  const due = new Date(isoOrNull)
  if (Number.isNaN(due.getTime())) return ''
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return `D+${Math.abs(diffDays)} 초과`
  if (diffDays === 0) return 'D-Day'
  return `D-${diffDays}`
}

// ---------- 타임라인 병합 ----------

type TimelineKind = 'history' | 'comment' | 'attachment'

interface TimelineItem {
  kind: TimelineKind
  id: number
  at: string
  actorName: string | null
  isSystem: boolean
  // history
  fromStatus?: string | null
  toStatus?: string
  // comment
  body?: string
  isInternal?: boolean
  // attachment
  fileName?: string | null
  fileSize?: number | null
  attachmentId?: number
}

export function RequestDetail() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = Number(idParam)

  const { profile } = useAuth()
  const isSystemUser = profile?.role === 'system'

  const { data, isLoading, error } = useRequestDetail(id)
  const { data: attachments } = useRequestAttachments(id)
  const { data: history } = useRequestHistory(id)
  const { data: comments } = useRequestComments(id)
  const addComment = useAddComment(id)
  const uploadCommentAttachment = useUploadCommentAttachment(id)
  const updateRequest = useUpdateRequest(id)
  const cancelRequest = useCancelRequest(id)
  const csatMutation = useCsat(id)
  const reworkMutation = useRework(id)

  // 편집 상태
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editUrgency, setEditUrgency] = useState<Urgency>('보통')
  const [editVisibility, setEditVisibility] = useState<RequestVisibility>('dept')
  const [editDue, setEditDue] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  // 댓글 작성기
  const [commentBody, setCommentBody] = useState('')
  const [commentInternal, setCommentInternal] = useState(true)
  const [commentFiles, setCommentFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 재작업
  const [showReworkModal, setShowReworkModal] = useState(false)
  const [reworkReason, setReworkReason] = useState('')

  // CSAT
  const [csatComment, setCsatComment] = useState('')
  const [csatPending, setCsatPending] = useState<-1 | 1 | null>(null)

  function handleDownload(attachmentId: number) {
    window.open(getAttachmentUrl(attachmentId), '_blank', 'noopener')
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault()
    if (!commentBody.trim()) return
    try {
      const result = await addComment.mutateAsync({
        body: commentBody,
        is_internal: isSystemUser ? commentInternal : false,
      })
      const commentId = result.id
      // 첨부 업로드 (comment_id 링크)
      for (const file of commentFiles) {
        await uploadCommentAttachment.mutateAsync({ file, commentId })
      }
      setCommentBody('')
      setCommentFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch {
      // 오류는 mutation 상태로 처리
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

  function startEdit() {
    if (!data) return
    const v = data.view
    setEditTitle(v.title ?? '')
    setEditBody(v.body ?? '')
    setEditUrgency((v.urgency as Urgency) ?? '보통')
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
        urgency: editUrgency,
        visibility: editVisibility,
        desired_due: editDue,
      })
      setEditing(false)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '수정 중 오류가 발생했습니다.')
    }
  }

  async function handleRework() {
    try {
      await reworkMutation.mutateAsync({ reason: reworkReason.trim() || undefined })
      setShowReworkModal(false)
      setReworkReason('')
    } catch {
      // 오류는 mutation 상태로 처리
    }
  }

  async function handleCsat(rating: -1 | 1) {
    setCsatPending(rating)
    try {
      await csatMutation.mutateAsync({
        rating,
        comment: csatComment.trim() || undefined,
      })
      setCsatComment('')
    } finally {
      setCsatPending(null)
    }
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
  const canEdit = isSystemUser || (v.requester_id === profile?.id && v.status === '접수')
  // 철회는 전이 매트릭스상 '접수' 상태에서만 유효 (server/src/services/transition.ts ALLOWED와 동일 기준)
  const canWithdraw = canEdit && (ALLOWED_TRANSITIONS[v.status as RequestStatus] ?? []).includes('철회')
  const isRequester = v.requester_id === profile?.id
  const canRework = isSystemUser && v.status === '완료'
  const canCsat =
    isRequester && v.status === '완료' && (v.csat_rating == null || v.csat_rating === undefined)
  const csatSubmitted =
    isRequester && v.status === '완료' && v.csat_rating != null && v.csat_rating !== undefined

  // ---------- 타임라인 병합 ----------
  const timeline: TimelineItem[] = []

  if (history) {
    for (const h of history) {
      timeline.push({
        kind: 'history',
        id: h.id,
        at: h.changed_at,
        actorName: h.actor?.name ?? null,
        isSystem: !h.changed_by,
        fromStatus: h.from_status,
        toStatus: h.to_status,
      })
    }
  }

  if (comments) {
    for (const c of comments) {
      timeline.push({
        kind: 'comment',
        id: c.id,
        at: c.created_at,
        actorName: c.author?.name ?? null,
        isSystem: !c.author_id,
        body: c.body,
        isInternal: c.is_internal,
      })
    }
  }

  // 첨부 중 댓글과 연결되지 않은 것만 타임라인에 별도 표시
  if (attachments) {
    for (const a of attachments) {
      if (a.comment_id == null) {
        // 다운로드 허용 여부: 해당 요청 상세를 열람할 수 있으면 첨부도 다운로드 가능
        // (서버 /api/attachments/:id/download 도 canSeeRequest 통과 시 허용)
        const canDownload = true
        timeline.push({
          kind: 'attachment',
          id: a.id,
          at: a.created_at,
          actorName: null,
          isSystem: false,
          fileName: a.file_name,
          fileSize: a.file_size,
          attachmentId: canDownload ? a.id : undefined,
        })
      }
    }
  }

  timeline.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

  return (
    <section className="space-y-6 pb-12">
      <Link to="/requests/mine" className="text-sm text-gray-500 hover:text-brand">
        ← 내 요청 목록
      </Link>

      {/* 헤더 */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-gray-400">{v.seq}</span>
          {v.status && <Badge className={STATUS_BADGE[v.status]}>{v.status}</Badge>}
          {v.due_status && (
            <Badge className={dueBadgeClass(v.due_status)}>{v.due_status}</Badge>
          )}
          {v.priority_level && (
            <Badge className={PRIORITY_LEVEL_BADGE[v.priority_level as PriorityLevel]}>
              {v.priority_level}
            </Badge>
          )}
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

      {/* SLA + 담당자·우선순위 요약 */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
        <div>
          <span className="text-xs text-gray-400">담당자</span>
          <span className="ml-1.5 font-medium text-gray-800">
            {assignee ? personLabel(assignee) : '미배정'}
          </span>
        </div>
        <div>
          <span className="text-xs text-gray-400">우선순위</span>
          <span className="ml-1.5 font-medium text-gray-800">
            {v.priority_level ?? '미정'}
          </span>
        </div>
        {v.resolution_due_at && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">처리기한</span>
            <span className="font-medium text-gray-800">
              {fmtDateTime(v.resolution_due_at)}
            </span>
            <Badge className={dueBadgeClass(v.due_status)}>{relDue(v.resolution_due_at)}</Badge>
          </div>
        )}
      </div>

      {/* 시스템팀 전용 관리 패널 — 담당자·상태·영향도를 상세 화면에서 바로 변경 */}
      {isSystemUser && (
        <AdminPanel
          requestId={id}
          status={v.status as RequestStatus}
          assigneeId={v.assignee_id ?? null}
          impact={(v.impact as ImpactLevel) ?? null}
          priorityLevel={v.priority_level ?? null}
          urgency={(v.urgency as Urgency) ?? null}
        />
      )}

      {/* 액션 버튼 영역 */}
      {(canEdit || canRework) && !editing && (
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <>
              <button
                onClick={startEdit}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                수정
              </button>
              {canWithdraw && (
                <button
                  onClick={() => void handleWithdraw()}
                  disabled={cancelRequest.isPending}
                  className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  철회
                </button>
              )}
            </>
          )}
          {canRework && (
            <button
              onClick={() => setShowReworkModal(true)}
              className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
            >
              재작업 요청
            </button>
          )}
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

      {/* 재작업 모달 */}
      {showReworkModal && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 space-y-3">
          <p className="text-sm font-medium text-indigo-800">재작업 사유 (선택)</p>
          <textarea
            className={`${fieldCls} min-h-[80px]`}
            value={reworkReason}
            onChange={(e) => setReworkReason(e.target.value)}
            placeholder="재작업이 필요한 이유를 입력하세요 (생략 가능)"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowReworkModal(false); setReworkReason('') }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void handleRework()}
              disabled={reworkMutation.isPending}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {reworkMutation.isPending ? '처리 중…' : '재작업 확정'}
            </button>
          </div>
          {reworkMutation.isError && (
            <p className="text-xs text-red-600">
              {reworkMutation.error instanceof Error
                ? reworkMutation.error.message
                : '오류가 발생했습니다.'}
            </p>
          )}
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
              <label className="block text-sm font-medium text-gray-700">긴급도</label>
              <select
                className={fieldCls}
                value={editUrgency}
                onChange={(e) => setEditUrgency(e.target.value as Urgency)}
              >
                {URGENCY_OPTIONS.map((u) => (
                  <option key={u} value={u}>
                    {u}
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
              <dt className="text-xs text-gray-400">긴급도</dt>
              <dd className="mt-0.5 text-gray-800">{v.urgency ?? '-'}</dd>
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

      {/* CSAT */}
      {canCsat && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-green-800">
            처리 결과에 만족하셨나요?
          </p>
          <p className="text-xs text-green-700">
            완료된 요청의 처리 품질 개선을 위해 간단한 평가를 남겨주세요.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => void handleCsat(1)}
              disabled={csatMutation.isPending}
              className="flex items-center gap-1.5 rounded-md border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100 disabled:opacity-60"
            >
              👍 만족
            </button>
            <button
              onClick={() => void handleCsat(-1)}
              disabled={csatMutation.isPending}
              className="flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              👎 불만족
            </button>
          </div>
          <textarea
            className={`${fieldCls} min-h-[60px] resize-none`}
            value={csatComment}
            onChange={(e) => setCsatComment(e.target.value)}
            placeholder="추가 의견 (선택)"
          />
          {csatPending !== null && (
            <p className="text-xs text-green-700">
              {csatPending === 1 ? '만족' : '불만족'} 평가를 제출 중…
            </p>
          )}
          {csatMutation.isError && (
            <p className="text-xs text-red-600">
              {csatMutation.error instanceof Error
                ? csatMutation.error.message
                : '평가 제출 중 오류가 발생했습니다.'}
            </p>
          )}
        </div>
      )}
      {csatSubmitted && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <span className="font-medium">만족도 평가:</span>{' '}
          {v.csat_rating === 1 ? '👍 만족' : '👎 불만족'}
          {v.csat_comment && (
            <p className="mt-1 text-xs text-gray-500">{v.csat_comment}</p>
          )}
        </div>
      )}

      {/* 통합 타임라인 */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700">활동 타임라인</h2>
        {v.status === '완료' && (
          <p className="mt-1 text-xs text-gray-500">
            처리 완료된 요청입니다. 결과 코멘트와 첨부를 확인하세요.
          </p>
        )}
        {timeline.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">아직 활동이 없습니다.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {timeline.map((item) => (
              <li
                key={`${item.kind}-${item.id}`}
                className={[
                  'relative rounded-lg border p-3 text-sm',
                  item.kind === 'comment' && item.isInternal
                    ? 'border-amber-200 bg-amber-50'
                    : item.kind === 'history'
                      ? 'border-gray-200 bg-white'
                      : 'border-gray-200 bg-white',
                ].join(' ')}
              >
                {/* 헤더 */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                  {item.kind === 'history' && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-500">
                      상태변경
                    </span>
                  )}
                  {item.kind === 'comment' && item.isInternal && (
                    <span className="rounded bg-amber-200 px-1.5 py-0.5 font-medium text-amber-800">
                      내부메모
                    </span>
                  )}
                  {item.kind === 'comment' && !item.isInternal && (
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-700">
                      코멘트
                    </span>
                  )}
                  {item.kind === 'attachment' && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-500">
                      첨부
                    </span>
                  )}
                  <span className="font-medium text-gray-600">
                    {item.isSystem ? '시스템' : (item.actorName ?? '알 수 없음')}
                  </span>
                  <span>{fmtDateTime(item.at)}</span>
                </div>

                {/* 본문 */}
                {item.kind === 'history' && (
                  <p className="mt-1 text-gray-700">
                    {item.fromStatus ?? '—'} →{' '}
                    <span className="font-semibold">{item.toStatus}</span>
                  </p>
                )}
                {item.kind === 'comment' && item.body && (
                  <p className="mt-1 whitespace-pre-wrap text-gray-800">{item.body}</p>
                )}
                {item.kind === 'attachment' && (
                  <button
                    onClick={() => item.attachmentId && handleDownload(item.attachmentId)}
                    className="mt-1 text-brand hover:underline"
                  >
                    {item.fileName ?? '첨부파일'}
                    {item.fileSize != null && (
                      <span className="ml-1.5 text-xs text-gray-400">
                        {Math.ceil(item.fileSize / 1024)} KB
                      </span>
                    )}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* 댓글 작성기 */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700">코멘트 작성</h2>
        {v.status === '완료' && (
          <p className="mt-1 text-xs text-gray-500">
            완료된 요청에 결과 코멘트나 추가 첨부를 남길 수 있습니다.
          </p>
        )}
        <form onSubmit={(e) => void handleAddComment(e)} className="mt-3 space-y-3">
          {/* 시스템팀: 내부메모/공개 토글 */}
          {isSystemUser && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCommentInternal(true)}
                className={[
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  commentInternal
                    ? 'bg-amber-200 text-amber-800'
                    : 'border border-gray-200 text-gray-500 hover:bg-gray-50',
                ].join(' ')}
              >
                내부메모
              </button>
              <button
                type="button"
                onClick={() => setCommentInternal(false)}
                className={[
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  !commentInternal
                    ? 'bg-blue-100 text-blue-700'
                    : 'border border-gray-200 text-gray-500 hover:bg-gray-50',
                ].join(' ')}
              >
                공개
              </button>
            </div>
          )}
          <textarea
            className={[
              'block w-full resize-y rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1',
              isSystemUser && commentInternal
                ? 'border-amber-300 bg-amber-50 focus:border-amber-400 focus:ring-amber-300'
                : 'border-gray-300 bg-white focus:border-brand focus:ring-brand',
            ].join(' ')}
            rows={3}
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder={
              isSystemUser && commentInternal
                ? '내부 메모 (요청자에게 노출되지 않습니다)'
                : '코멘트를 입력하세요'
            }
          />
          {/* 파일 첨부 */}
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
              파일 첨부
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                onChange={(e) => {
                  setCommentFiles(Array.from(e.target.files ?? []))
                }}
              />
            </label>
            {commentFiles.length > 0 && (
              <span className="text-xs text-gray-500">
                {commentFiles.map((f) => f.name).join(', ')}
              </span>
            )}
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={
                addComment.isPending ||
                uploadCommentAttachment.isPending ||
                !commentBody.trim()
              }
              className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {addComment.isPending || uploadCommentAttachment.isPending
                ? '등록 중…'
                : '코멘트 등록'}
            </button>
          </div>
          {addComment.isError && (
            <p className="text-xs text-red-600">
              {addComment.error instanceof Error
                ? addComment.error.message
                : '코멘트 등록 중 오류가 발생했습니다.'}
            </p>
          )}
        </form>
      </div>
    </section>
  )
}
