import { useState } from 'react'
import { useUsers } from '../accounts/api'
import { ALLOWED_TRANSITIONS, CLOSED_STATUSES, PRIORITY_LEVEL_BADGE } from '../../lib/constants'
import type { PriorityLevel, RequestStatus } from '../../types/database'
import { useChangeAssignee, useChangeStatus, useChangeImpact, type ImpactLevel } from './api'

const IMPACTS: ImpactLevel[] = ['높음', '보통', '낮음']

/** 사유 입력이 필요한 대상 상태 */
const NEEDS_REASON: RequestStatus[] = ['보류', '반려']

interface AdminPanelProps {
  requestId: number
  status: RequestStatus
  assigneeId: string | null
  impact: ImpactLevel | null
  priorityLevel: string | null
}

/**
 * 시스템팀 전용 관리 패널 — 담당자·상태·영향도를 상세 화면에서 바로 바꾼다.
 * 필드 편집(제목·본문·긴급도·희망완료일)은 RequestDetail의 기존 편집 폼이 담당한다.
 */
export function AdminPanel({
  requestId,
  status,
  assigneeId,
  impact,
  priorityLevel,
}: AdminPanelProps) {
  const { data: allUsers } = useUsers()
  // 담당자 후보는 시스템팀만 — ManageBoard.tsx의 assigneeOptions와 규칙을 일치시킨다.
  // (일반 staff를 배정하면 공개범위 필터가 assignee_id를 열람 근거로 쓰지 않아 본인이 못 볼 수 있음)
  const users = (allUsers ?? []).filter((u) => u.role === 'system')
  const changeAssignee = useChangeAssignee()
  const changeStatus = useChangeStatus()
  const changeImpact = useChangeImpact(requestId)

  const [error, setError] = useState<string | null>(null)
  const [reasonFor, setReasonFor] = useState<RequestStatus | null>(null)
  const [reason, setReason] = useState('')

  const allowed = ALLOWED_TRANSITIONS[status] ?? []
  // 종결(완료·반려·철회) 요청은 영향도를 소급 조정할 수 없다 (server/src/services/impact.ts CLOSED와 동일 기준)
  const isClosed = CLOSED_STATUSES.includes(status)

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : String(err))
  }

  function onAssignee(value: string) {
    setError(null)
    changeAssignee.mutate(
      { id: requestId, assignee_id: value || null },
      { onError: fail },
    )
  }

  function onStatus(to: RequestStatus) {
    setError(null)
    if (NEEDS_REASON.includes(to)) {
      setReasonFor(to)
      return
    }
    changeStatus.mutate({ id: requestId, status: to }, { onError: fail })
  }

  function submitReason() {
    if (!reasonFor) return
    changeStatus.mutate(
      { id: requestId, status: reasonFor, reason: reason.trim() || undefined },
      {
        onError: fail,
        onSuccess: () => {
          setReasonFor(null)
          setReason('')
        },
      },
    )
  }

  function onImpact(value: ImpactLevel) {
    setError(null)
    changeImpact.mutate({ impact: value }, { onError: fail })
  }

  const selectCls =
    'mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

  return (
    <section
      aria-label="관리 패널"
      className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4"
    >
      <h2 className="text-sm font-bold text-indigo-900">관리</h2>

      {error && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        {/* 담당자 */}
        <div>
          <label htmlFor="admin-assignee" className="block text-xs font-medium text-gray-700">
            담당자
          </label>
          <select
            id="admin-assignee"
            className={selectCls}
            value={assigneeId ?? ''}
            onChange={(e) => onAssignee(e.target.value)}
            disabled={changeAssignee.isPending}
          >
            <option value="">미배정</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </select>
        </div>

        {/* 상태 */}
        <div>
          <label htmlFor="admin-status" className="block text-xs font-medium text-gray-700">
            상태
          </label>
          <select
            id="admin-status"
            className={selectCls}
            value={status}
            onChange={(e) => onStatus(e.target.value as RequestStatus)}
            disabled={changeStatus.isPending}
          >
            <option value={status}>{status} (현재)</option>
            {(['접수', '진행중', '보류', '완료', '반려', '철회'] as RequestStatus[])
              .filter((s) => s !== status)
              .map((s) => (
                <option key={s} value={s} disabled={!allowed.includes(s)}>
                  {s}
                  {allowed.includes(s) ? '' : ' (불가)'}
                </option>
              ))}
          </select>
        </div>

        {/* 영향도 */}
        <div>
          <label htmlFor="admin-impact" className="block text-xs font-medium text-gray-700">
            영향도{' '}
            {priorityLevel && (
              <span
                className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${PRIORITY_LEVEL_BADGE[priorityLevel as PriorityLevel] ?? ''}`}
              >
                {priorityLevel}
              </span>
            )}
          </label>
          <select
            id="admin-impact"
            className={selectCls}
            value={impact ?? ''}
            onChange={(e) => onImpact(e.target.value as ImpactLevel)}
            disabled={changeImpact.isPending || !assigneeId || isClosed}
          >
            <option value="" disabled>
              미정
            </option>
            {IMPACTS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          {isClosed ? (
            <p className="mt-1 text-[11px] text-gray-500">
              종결({status})된 요청은 영향도를 조정할 수 없습니다.
            </p>
          ) : (
            !assigneeId && (
              <p className="mt-1 text-[11px] text-gray-500">배정 후 조정할 수 있습니다.</p>
            )
          )}
        </div>
      </div>

      {/* 사유 입력 모달 (보류·반려) */}
      {reasonFor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${reasonFor} 사유 입력`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
            <h3 className="text-sm font-bold text-gray-900">{reasonFor} 사유</h3>
            <textarea
              className="mt-3 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label={`${reasonFor} 사유`}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setReasonFor(null)
                  setReason('')
                }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitReason}
                disabled={changeStatus.isPending}
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
