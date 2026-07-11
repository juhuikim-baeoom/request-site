import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { Badge } from '../../components/Badge'
import { VisibilityBadge } from '../../components/VisibilityBadge'
import {
  ORG_OPTIONS,
  STATUS_OPTIONS,
  STATUS_BADGE,
  PRIORITY_BADGE,
  dueBadgeClass,
} from '../../lib/constants'
import { fmtDateTime } from '../../lib/format'
import type { RequestOrg, RequestStatus, RequestVisibility } from '../../types/database'
import { useRequestTypes, useRequestViews, useVisibleSharedTargets } from './api'

type Tab = 'mine' | 'others'
type Sort = 'recent' | 'due'

// 기한 우선 정렬 순위 (작을수록 위)
const DUE_RANK: Record<string, number> = {
  기한초과: 0,
  지연: 1,
  임박: 2,
  여유: 3,
}
function dueRank(due: string | null): number {
  return due != null && due in DUE_RANK ? DUE_RANK[due] : 9
}

const selectCls =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

export function MyRequests() {
  const { profile } = useAuth()
  const { data: rows, isLoading } = useRequestViews()
  const { data: sharedMap } = useVisibleSharedTargets()
  const { data: types } = useRequestTypes()

  const [tab, setTab] = useState<Tab>('mine')
  const [status, setStatus] = useState<RequestStatus | ''>('')
  const [typeCode, setTypeCode] = useState<string>('')
  const [org, setOrg] = useState<RequestOrg | ''>('')
  const [sort, setSort] = useState<Sort>('recent')

  const filtered = useMemo(() => {
    const list = (rows ?? []).filter((r) => {
      const isMine = r.requester_id === profile?.id
      if (tab === 'mine' ? !isMine : isMine) return false
      if (status && r.status !== status) return false
      if (typeCode && r.type_code !== typeCode) return false
      if (org && r.org !== org) return false
      return true
    })

    list.sort((a, b) => {
      if (sort === 'due') {
        const d = dueRank(a.due_status) - dueRank(b.due_status)
        if (d !== 0) return d
      }
      // 최신순 (created_at desc)
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })
    return list
  }, [rows, profile?.id, tab, status, typeCode, org, sort])

  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        tab === t ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {label}
    </button>
  )

  return (
    <section>
      <h1 className="text-xl font-bold text-gray-900">내 요청 목록</h1>

      {/* 탭 */}
      <div className="mt-4 flex gap-1">
        {tabBtn('mine', '내 요청')}
        {tabBtn('others', '부서·공유 요청')}
      </div>

      {/* 필터 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as RequestStatus | '')}>
          <option value="">상태 전체</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className={selectCls} value={typeCode} onChange={(e) => setTypeCode(e.target.value)}>
          <option value="">유형 전체</option>
          {types?.map((t) => (
            <option key={t.code} value={t.code}>
              {t.label}
            </option>
          ))}
        </select>
        <select className={selectCls} value={org} onChange={(e) => setOrg(e.target.value as RequestOrg | '')}>
          <option value="">기관 전체</option>
          {ORG_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="recent">최신순</option>
            <option value="due">기한 우선</option>
          </select>
        </div>
      </div>

      {/* 목록 */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-[880px] w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
              <th className="px-3 py-2 font-medium">접수번호</th>
              <th className="px-3 py-2 font-medium">제목</th>
              <th className="px-3 py-2 font-medium">기관</th>
              <th className="px-3 py-2 font-medium">유형</th>
              <th className="px-3 py-2 font-medium">우선</th>
              <th className="px-3 py-2 font-medium">상태</th>
              <th className="px-3 py-2 font-medium">기한</th>
              <th className="px-3 py-2 font-medium">담당</th>
              <th className="px-3 py-2 font-medium">희망완료일</th>
              <th className="px-3 py-2 font-medium">접수일</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-gray-400">
                  불러오는 중…
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-gray-400">
                  표시할 요청이 없습니다.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id ?? r.seq} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">
                  {r.seq}
                </td>
                <td className="px-3 py-2">
                  <Link
                    to={`/requests/${r.id}`}
                    className="font-medium text-gray-900 hover:text-brand hover:underline"
                  >
                    {r.title}
                  </Link>
                  <div className="mt-0.5">
                    {r.visibility && (
                      <VisibilityBadge
                        visibility={r.visibility as RequestVisibility}
                        sharedTargets={r.id != null ? sharedMap?.get(r.id) : undefined}
                      />
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.org}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.type_label}</td>
                <td className="px-3 py-2">
                  {r.priority && <Badge className={PRIORITY_BADGE[r.priority]}>{r.priority}</Badge>}
                </td>
                <td className="px-3 py-2">
                  {r.status && <Badge className={STATUS_BADGE[r.status]}>{r.status}</Badge>}
                </td>
                <td className="px-3 py-2">
                  <Badge className={dueBadgeClass(r.due_status)}>{r.due_status}</Badge>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                  {r.assignee_id ? '배정됨' : '미배정'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.desired_due ?? '-'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-400">
                  {fmtDateTime(r.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
