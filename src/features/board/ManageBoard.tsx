import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../../components/Badge'
import {
  ORG_OPTIONS,
  PRIORITY_OPTIONS,
  PRIORITY_BADGE,
  STATUS_OPTIONS,
  STATUS_BADGE,
  dueBadgeClass,
} from '../../lib/constants'
import { fmtDateTime } from '../../lib/format'
import type { RequestOrg, RequestPriority, RequestStatus } from '../../types/database'
import {
  useAllProfiles,
  useBoardUpdate,
  useRequestTypes,
  useRequestViews,
} from '../requests/api'

type View = 'board' | 'list'
const DUE_FILTERS = ['기한초과', '지연', '임박', '여유'] as const

const selectCls =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const miniSelectCls =
  'w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-xs focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

export function ManageBoard() {
  const { data: rows, isLoading } = useRequestViews()
  const { data: profiles } = useAllProfiles()
  const { data: types } = useRequestTypes()
  const boardUpdate = useBoardUpdate()

  const [view, setView] = useState<View>('board')
  const [org, setOrg] = useState<RequestOrg | ''>('')
  const [typeCode, setTypeCode] = useState('')
  const [assignee, setAssignee] = useState<string>('') // '' | 'unassigned' | id
  const [priority, setPriority] = useState<RequestPriority | ''>('')
  const [due, setDue] = useState<string>('')

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of profiles ?? []) m.set(p.id, p.name ?? p.email)
    return m
  }, [profiles])

  // 담당자 후보 = 시스템팀
  const assigneeOptions = useMemo(
    () => (profiles ?? []).filter((p) => p.role === 'system'),
    [profiles],
  )

  const filtered = useMemo(() => {
    return (rows ?? []).filter((r) => {
      if (org && r.org !== org) return false
      if (typeCode && r.type_code !== typeCode) return false
      if (priority && r.priority !== priority) return false
      if (due && r.due_status !== due) return false
      if (assignee === 'unassigned' && r.assignee_id) return false
      if (assignee && assignee !== 'unassigned' && r.assignee_id !== assignee) return false
      return true
    })
  }, [rows, org, typeCode, priority, due, assignee])

  const byStatus = useMemo(() => {
    const m = new Map<RequestStatus, typeof filtered>()
    for (const s of STATUS_OPTIONS) m.set(s, [])
    for (const r of filtered) {
      if (r.status) m.get(r.status)?.push(r)
    }
    return m
  }, [filtered])

  function changeStatus(id: number, status: RequestStatus) {
    boardUpdate.mutate({ id, patch: { status } })
  }
  function changeAssignee(id: number, value: string) {
    boardUpdate.mutate({ id, patch: { assignee_id: value || null } })
  }

  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <select className={selectCls} value={org} onChange={(e) => setOrg(e.target.value as RequestOrg | '')}>
        <option value="">기관 전체</option>
        {ORG_OPTIONS.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <select className={selectCls} value={typeCode} onChange={(e) => setTypeCode(e.target.value)}>
        <option value="">유형 전체</option>
        {types?.map((t) => (
          <option key={t.code} value={t.code}>{t.label}</option>
        ))}
      </select>
      <select className={selectCls} value={priority} onChange={(e) => setPriority(e.target.value as RequestPriority | '')}>
        <option value="">우선순위 전체</option>
        {PRIORITY_OPTIONS.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <select className={selectCls} value={due} onChange={(e) => setDue(e.target.value)}>
        <option value="">기한 전체</option>
        {DUE_FILTERS.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <select className={selectCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
        <option value="">담당 전체</option>
        <option value="unassigned">미배정만</option>
        {assigneeOptions.map((p) => (
          <option key={p.id} value={p.id}>{p.name ?? p.email}</option>
        ))}
      </select>
    </div>
  )

  const statusSelect = (id: number, current: RequestStatus | null) => (
    <select
      className={miniSelectCls}
      value={current ?? ''}
      onChange={(e) => changeStatus(id, e.target.value as RequestStatus)}
    >
      {STATUS_OPTIONS.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  )
  const assigneeSelect = (id: number, current: string | null) => (
    <select
      className={miniSelectCls}
      value={current ?? ''}
      onChange={(e) => changeAssignee(id, e.target.value)}
    >
      <option value="">미배정</option>
      {assigneeOptions.map((p) => (
        <option key={p.id} value={p.id}>{p.name ?? p.email}</option>
      ))}
    </select>
  )

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">관리 보드</h1>
        <div className="flex gap-1">
          <button
            onClick={() => setView('board')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === 'board' ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            보드
          </button>
          <button
            onClick={() => setView('list')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === 'list' ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            리스트
          </button>
        </div>
      </div>

      <div className="mt-3">{filters}</div>

      {isLoading ? (
        <p className="mt-8 text-center text-gray-400">불러오는 중…</p>
      ) : view === 'board' ? (
        /* ---------- 칸반 보드 ---------- */
        <div className="mt-4 flex gap-3 overflow-x-auto pb-4">
          {STATUS_OPTIONS.map((status) => {
            const cards = byStatus.get(status) ?? []
            return (
              <div key={status} className="w-64 shrink-0">
                <div className="flex items-center justify-between px-1 pb-2">
                  <Badge className={STATUS_BADGE[status]}>{status}</Badge>
                  <span className="text-xs text-gray-400">{cards.length}</span>
                </div>
                <div className="space-y-2 rounded-lg bg-gray-100 p-2">
                  {cards.length === 0 && (
                    <p className="py-6 text-center text-xs text-gray-300">없음</p>
                  )}
                  {cards.map((r) => (
                    <div key={r.id} className="rounded-md border border-gray-200 bg-white p-2.5 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-gray-400">{r.seq}</span>
                        <div className="flex items-center gap-1">
                          {r.priority && (
                            <Badge className={PRIORITY_BADGE[r.priority]}>{r.priority}</Badge>
                          )}
                          {r.rework_count != null && r.rework_count > 0 && (
                            <Badge className="bg-orange-100 text-orange-700">재{r.rework_count}</Badge>
                          )}
                        </div>
                      </div>
                      <Link
                        to={`/requests/${r.id}`}
                        className="mt-1 block truncate text-sm font-medium text-gray-900 hover:text-brand hover:underline"
                        title={r.title ?? ''}
                      >
                        {r.title}
                      </Link>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                        <span>{r.org}</span>
                        <span>·</span>
                        <span>{r.type_label}</span>
                        <Badge className={dueBadgeClass(r.due_status)}>{r.due_status}</Badge>
                      </div>
                      <div className="mt-2 space-y-1">
                        {r.id != null && statusSelect(r.id, r.status)}
                        {r.id != null && assigneeSelect(r.id, r.assignee_id)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* ---------- 리스트 뷰 ---------- */
        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-[960px] w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-3 py-2 font-medium">접수번호</th>
                <th className="px-3 py-2 font-medium">제목</th>
                <th className="px-3 py-2 font-medium">기관</th>
                <th className="px-3 py-2 font-medium">유형</th>
                <th className="px-3 py-2 font-medium">우선</th>
                <th className="px-3 py-2 font-medium">기한</th>
                <th className="px-3 py-2 font-medium">상태</th>
                <th className="px-3 py-2 font-medium">담당</th>
                <th className="px-3 py-2 font-medium">접수일</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-gray-400">
                    표시할 요청이 없습니다.
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">{r.seq}</td>
                  <td className="px-3 py-2">
                    <Link to={`/requests/${r.id}`} className="font-medium text-gray-900 hover:text-brand hover:underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.org}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.type_label}</td>
                  <td className="px-3 py-2">
                    {r.priority && <Badge className={PRIORITY_BADGE[r.priority]}>{r.priority}</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge className={dueBadgeClass(r.due_status)}>{r.due_status}</Badge>
                  </td>
                  <td className="px-3 py-2 w-32">{r.id != null && statusSelect(r.id, r.status)}</td>
                  <td className="px-3 py-2 w-36">{r.id != null && assigneeSelect(r.id, r.assignee_id)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-400">{fmtDateTime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-400">
        상태·담당자는 카드에서 바로 변경됩니다. 이력·완료일·재작업은 자동 기록됩니다. (드래그 이동은 추후) ·{' '}
        <span className="text-gray-500">{nameById.size}명 담당 후보</span>
      </p>
    </section>
  )
}
