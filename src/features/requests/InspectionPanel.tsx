import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { RequestView } from '../../types/database'
import { approveInspection, requestRework, forceComplete } from './api'

interface Props {
  /** request_view 행 (RequestDetail의 `v`) */
  request: RequestView
  /** 라우트 파라미터로부터 얻은 요청 id (request_view.id 는 nullable이라 별도로 받는다) */
  requestId: number
  isOwner: boolean
  isSystem: boolean
}

/** 자동완료 예정일을 'M월 D일' 로 */
function formatDue(iso: string | null): string {
  if (iso === null) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

export function InspectionPanel({ request, requestId, isOwner, isSystem }: Props) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'idle' | 'approve' | 'rework' | 'force'>('idle')
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['requests', 'detail', requestId] })
    void qc.invalidateQueries({ queryKey: ['requests', 'view'] })
    void qc.invalidateQueries({ queryKey: ['requests', 'history', requestId] })
    setMode('idle')
    setReason('')
    setComment('')
  }

  const approve = useMutation({
    mutationFn: () => approveInspection(requestId, { rating, comment: comment || undefined }),
    onSuccess: invalidate,
  })
  const rework = useMutation({
    mutationFn: () => requestRework(requestId, reason),
    onSuccess: invalidate,
  })
  const force = useMutation({
    mutationFn: () => forceComplete(requestId, reason),
    onSuccess: invalidate,
  })

  if (request.status !== '검수대기') return null

  // 요청자도 시스템팀도 아니면 안내만 보여준다
  if (!isOwner && !isSystem) {
    return (
      <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 text-sm text-purple-900">
        작업이 완료되어 요청자 확인을 기다리는 중입니다.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
      {isOwner ? (
        <>
          <h3 className="font-semibold text-purple-900">작업이 완료되었습니다. 확인해주세요</h3>
          <p className="mt-1 text-sm text-purple-800">
            처리된 내용을 확인하고 알려주세요.
            {request.inspection_due_at !== null && (
              <> {formatDue(request.inspection_due_at)}까지 응답이 없으면 자동으로 완료됩니다.</>
            )}
          </p>
        </>
      ) : (
        <>
          <h3 className="font-semibold text-purple-900">요청자 확인 대기 중</h3>
          <p className="mt-1 text-sm text-purple-800">
            요청자 확인 없이 완료하려면 사유를 남겨야 합니다.
            {request.inspection_due_at !== null && (
              <> 미응답 시 {formatDue(request.inspection_due_at)}에 자동 완료됩니다.</>
            )}
          </p>
        </>
      )}

      {mode === 'idle' && (
        <div className="mt-3 flex gap-2">
          {isOwner && (
            <>
              <button
                type="button"
                onClick={() => setMode('approve')}
                className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
              >
                확인했습니다
              </button>
              <button
                type="button"
                onClick={() => setMode('rework')}
                className="rounded border border-purple-300 bg-white px-4 py-2 text-sm font-medium text-purple-800 hover:bg-purple-100"
              >
                다시 봐주세요
              </button>
            </>
          )}
          {isSystem && !isOwner && (
            <button
              type="button"
              onClick={() => setMode('force')}
              className="rounded border border-purple-300 bg-white px-4 py-2 text-sm font-medium text-purple-800 hover:bg-purple-100"
            >
              강제 완료
            </button>
          )}
        </div>
      )}

      {mode === 'approve' && (
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-medium text-purple-900">
            처리 결과에 얼마나 만족하시나요?
          </label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                aria-label={`${n}점`}
                className={`h-9 w-9 rounded text-lg ${
                  n <= rating ? 'bg-amber-400 text-white' : 'bg-white text-gray-300 border border-gray-200'
                }`}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="남기실 말씀이 있다면 적어주세요 (선택)"
            rows={2}
            className="w-full rounded border border-gray-300 p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={approve.isPending}
              onClick={() => approve.mutate()}
              className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {approve.isPending ? '처리 중…' : '완료 확인'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="px-3 py-2 text-sm text-gray-600">
              취소
            </button>
          </div>
          {approve.isError && (
            <p className="text-sm text-red-600">확인 처리에 실패했습니다. 잠시 후 다시 시도해주세요.</p>
          )}
        </div>
      )}

      {(mode === 'rework' || mode === 'force') && (
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-medium text-purple-900">
            {mode === 'rework'
              ? '어떤 점이 잘못되었나요? (필수)'
              : '요청자 확인 없이 완료하는 사유 (필수)'}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              mode === 'rework'
                ? '예: 요청한 기간이 아니라 전월 데이터가 왔습니다'
                : '예: 요청자와 구두로 확인 완료'
            }
            rows={3}
            className="w-full rounded border border-gray-300 p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={reason.trim() === '' || rework.isPending || force.isPending}
              onClick={() => (mode === 'rework' ? rework.mutate() : force.mutate())}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {mode === 'rework' ? '재작업 요청' : '강제 완료'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="px-3 py-2 text-sm text-gray-600">
              취소
            </button>
          </div>
          {(rework.isError || force.isError) && (
            <p className="text-sm text-red-600">처리에 실패했습니다. 잠시 후 다시 시도해주세요.</p>
          )}
        </div>
      )}
    </div>
  )
}
