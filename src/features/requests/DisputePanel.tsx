import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { RequestView } from '../../types/database'
import { isDisputable, DISPUTE_WINDOW_DAYS } from '../../lib/constants'
import { fetchDisputes, raiseDispute, reviewDispute } from './api'

interface Props {
  /** request_view 행 (RequestDetail의 `v`) */
  request: RequestView
  /** 라우트 파라미터로부터 얻은 요청 id (request_view.id 는 nullable이라 별도로 받는다) */
  requestId: number
  isOwner: boolean
  isSystem: boolean
}

export function DisputePanel({ request, requestId, isOwner, isSystem }: Props) {
  const qc = useQueryClient()
  const [raising, setRaising] = useState(false)
  const [reason, setReason] = useState('')
  const [reviewing, setReviewing] = useState<'ACCEPTED' | 'REJECTED' | null>(null)
  const [comment, setComment] = useState('')

  const { data: disputes = [] } = useQuery({
    queryKey: ['disputes', requestId],
    queryFn: () => fetchDisputes(requestId),
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['disputes', requestId] })
    void qc.invalidateQueries({ queryKey: ['requests', 'detail', requestId] })
    void qc.invalidateQueries({ queryKey: ['requests', 'view'] })
    void qc.invalidateQueries({ queryKey: ['requests', 'history', requestId] })
    setRaising(false)
    setReviewing(null)
    setReason('')
    setComment('')
  }

  const raise = useMutation({
    mutationFn: () => raiseDispute(requestId, reason),
    onSuccess: invalidate,
  })

  const open = disputes.find((d) => d.status_cd === 'OPEN')
  const review = useMutation({
    mutationFn: () => reviewDispute(open!.id, reviewing!, comment),
    onSuccess: invalidate,
  })

  // 완료도 아니고 이의 이력도 없으면 보여줄 게 없다
  if (request.status !== '완료' && disputes.length === 0) return null

  const canRaise =
    isOwner &&
    request.status === '완료' &&
    open === undefined &&
    isDisputable(request.completed_at)
  const windowExpired =
    isOwner && request.status === '완료' && open === undefined && !isDisputable(request.completed_at)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="font-semibold text-gray-900">처리 결과 이의</h3>

      {open !== undefined && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">심사 중인 이의가 있습니다</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-amber-800">{open.reason}</p>
          <p className="mt-1 text-xs text-amber-700">
            {open.raised_by_name ?? '요청자'} · {new Date(open.created_at).toLocaleDateString('ko-KR')}
          </p>

          {isSystem && reviewing === null && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setReviewing('ACCEPTED')}
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                수락 → 재작업
              </button>
              <button
                type="button"
                onClick={() => setReviewing('REJECTED')}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                기각
              </button>
            </div>
          )}

          {isSystem && reviewing !== null && (
            <div className="mt-3 space-y-2">
              <label className="block text-sm font-medium text-amber-900">
                {reviewing === 'ACCEPTED'
                  ? '재작업 착수 안내 (필수)'
                  : '기각 사유 — 요청자에게 그대로 전달됩니다 (필수)'}
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={
                  reviewing === 'ACCEPTED'
                    ? '예: 확인했습니다. 이번 주 내로 다시 처리하겠습니다'
                    : '예: 최초 요청 범위 밖입니다. 새 요청으로 접수해주세요'
                }
                rows={3}
                className="w-full rounded border border-gray-300 p-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={comment.trim() === '' || review.isPending}
                  onClick={() => review.mutate()}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {reviewing === 'ACCEPTED' ? '수락' : '기각'}
                </button>
                <button type="button" onClick={() => setReviewing(null)} className="px-3 py-1.5 text-sm text-gray-600">
                  취소
                </button>
              </div>
              {review.isError && (
                <p className="text-sm text-red-600">심사 처리에 실패했습니다. 잠시 후 다시 시도해주세요.</p>
              )}
            </div>
          )}
        </div>
      )}

      {canRaise && !raising && (
        <div className="mt-2">
          <p className="text-sm text-gray-600">
            처리 결과에 문제가 있다면 알려주세요. 완료 후 {DISPUTE_WINDOW_DAYS}일 이내에 이의를 제기할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={() => setRaising(true)}
            className="mt-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            이의제기
          </button>
        </div>
      )}

      {canRaise && raising && (
        <div className="mt-2 space-y-2">
          <label className="block text-sm font-medium text-gray-900">
            어떤 점이 잘못 처리되었나요? (필수)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 요청한 기간이 아니라 전월 데이터가 왔습니다"
            rows={3}
            className="w-full rounded border border-gray-300 p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={reason.trim() === '' || raise.isPending}
              onClick={() => raise.mutate()}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {raise.isPending ? '접수 중…' : '이의 접수'}
            </button>
            <button type="button" onClick={() => setRaising(false)} className="px-3 py-1.5 text-sm text-gray-600">
              취소
            </button>
          </div>
          {raise.isError && (
            <p className="text-sm text-red-600">이의 접수에 실패했습니다. 잠시 후 다시 시도해주세요.</p>
          )}
        </div>
      )}

      {windowExpired && (
        <p className="mt-2 text-sm text-gray-600">
          이의제기 기간({DISPUTE_WINDOW_DAYS}일)이 지났습니다.{' '}
          <Link to={`/requests/new?parent=${requestId}`} className="text-indigo-600 underline">
            새 요청으로 접수해주세요
          </Link>
        </p>
      )}

      {disputes.filter((d) => d.status_cd !== 'OPEN').length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          {disputes
            .filter((d) => d.status_cd !== 'OPEN')
            .map((d) => (
              <li key={d.id} className="text-sm">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                    d.status_cd === 'ACCEPTED' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {d.status_cd === 'ACCEPTED' ? '수락됨' : '기각됨'}
                </span>{' '}
                <span className="text-gray-700">{d.reason}</span>
                {d.review_comment !== null && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    답변: {d.review_comment} ({d.reviewed_by_name ?? '시스템팀'})
                  </p>
                )}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
