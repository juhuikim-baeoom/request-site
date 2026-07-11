import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../../components/Badge'
import {
  ORG_OPTIONS,
  PRIORITY_OPTIONS,
  PRIORITY_BADGE,
  BOARD_STATUSES,
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

type ViewMode = 'board' | 'list'
const DUE_FILTERS = ['기한초과', '지연', '임박', '여유'] as const

const selectCls =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const miniSelectCls =
  'w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-xs focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

// 기한초과·지연 카드 강조 스타일
function dueCardClass(due: string | null): string {
  if (due === '기한초과') return 'border-red-300 bg-red-50/70'
  if (due === '지연') return 'border-amber-300 bg-amber-50/70'
  return 'border-gray-200 bg-white'
}

export function ManageBoard() {
  const { data: rows, isLoading } = useRequestViews()
  const { data: profiles } = useAllProfiles()
  const { data: types } = useRequestTypes()
  const boardUpdate = useBoardUpdate()

  const [view, setView] = useState<ViewMode>('board')
  const [q, setQ] = useState('')
  const [org, setOrg] = useState<RequestOrg | ''>('')
  const [typeCode, setTypeCode] = useState('')
  const [assignee, setAssignee] = useState('') // '' | 'unassigned' | id
  const [priority, setPriority] = useState<RequestPriority | ''>('')
  const [due, setDue] = useState('')

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of profiles ?? []) m.set(p.id, p.name ?? p.email)
    return m
  }, [profiles])
  const assigneeOptions = useMemo(
    () => (profiles ?? []).filter((p) => p.role === 'system'),
    [profiles],
  )

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return (rows ?? []).filter((r) => {
      if (org && r.org !== org) return false
      if (typeCode && r.type_code !== typeCode) return false
      if (priority && r.priority !== priority) return false
      if (due && r.due_status !== due) return false
      if (assignee === 'unassigned' && r.assignee_id) return false
      if (assignee && assignee !== 'unassigned' && r.assignee_id !== assignee) return false
      if (query) {
        // 통합 검색: 본문 포함 전 필드
        const idx = [
          r.seq, r.title, r.body, r.org, r.type_label, r.status, r.priority, r.due_status,
          r.assignee_id ? nameById.get(r.assignee_id) : '미배정',
        ].join(' ').toLowerCase()
        if (!idx.includes(query)) return false
      }
      return true
    })
  }, [rows, q, org, typeCode, priority, due, assignee, nameById])

  const byStatus = useMemo(() => {
    const m = new Map<RequestStatus, typeof filtered>()
    for (const s of BOARD_STATUSES) m.set(s, [])
    for (const r of filtered) if (r.status && m.has(r.status)) m.get(r.status)!.push(r)
    return m
  }, [filtered])

  function changeStatus(id: number, status: RequestStatus) {
    boardUpdate.mutate({ id, patch: { status } })
  }
  function changeAssignee(id: number, value: string) {
    boardUpdate.mutate({ id, patch: { assignee_id: value || null } })
  }

  // ---- 칸반 드래그 팬 ----
  const colsRef = useRef<HTMLDivElement>(null)
  const drag = useRef({ down: false, sx: 0, sl: 0, moved: false })
  const [dragging, setDragging] = useState(false)

  function onPointerDown(e: React.PointerEvent) {
    const el = colsRef.current
    if (!el || e.button !== 0) return
    if ((e.target as HTMLElement).closest('a,button,select,input,textarea')) return
    drag.current = { down: true, sx: e.clientX, sl: el.scrollLeft, moved: false }
    setDragging(true)
  }
  function onPointerMove(e: React.PointerEvent) {
    const el = colsRef.current
    if (!drag.current.down || !el) return
    const dx = e.clientX - drag.current.sx
    if (Math.abs(dx) > 4) drag.current.moved = true
    el.scrollLeft = drag.current.sl - dx
  }
  function endDrag() {
    if (!drag.current.down) return
    drag.current.down = false
    setDragging(false)
  }
  function onClickCapture(e: React.MouseEvent) {
    if (drag.current.moved) {
      e.preventDefault()
      e.stopPropagation()
      drag.current.moved = false
    }
  }

  const statusSelect = (id: number, current: RequestStatus | null) => (
    <select className={miniSelectCls} value={current ?? ''} onChange={(e) => changeStatus(id, e.target.value as RequestStatus)}>
      {STATUS_OPTIONS.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  )
  const assigneeSelect = (id: number, current: string | null) => (
    <select className={miniSelectCls} value={current ?? ''} onChange={(e) => changeAssignee(id, e.target.value)}>
      <option value="">미배정</option>
      {assigneeOptions.map((p) => (
        <option key={p.id} value={p.id}>{p.name ?? p.email}</option>
      ))}
    </select>
  )

  return (
    <section className="flex flex-col gap-4">
      {/* 헤더: 제목 + 통합 검색 + 뷰 토글 */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900">관리 보드</h1>
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
          <span className="text-gray-400">⌕</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="전체 검색 — 제목·본문·기관·담당·상태까지 즉시 조회"
            className="w-full border-0 bg-transparent text-sm outline-none placeholder:text-gray-400"
            aria-label="전체 검색"
          />
          {q && <span className="whitespace-nowrap text-xs text-gray-400 tabular-nums">{filtered.length}건</span>}
        </div>
        <div className="flex gap-1">
          {(['board', 'list'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${view === v ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {v === 'board' ? '보드' : '리스트'}
            </button>
          ))}
        </div>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <select className={selectCls} value={org} onChange={(e) => setOrg(e.target.value as RequestOrg | '')}>
          <option value="">기관 전체</option>
          {ORG_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select className={selectCls} value={typeCode} onChange={(e) => setTypeCode(e.target.value)}>
          <option value="">유형 전체</option>
          {types?.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
        </select>
        <select className={selectCls} value={priority} onChange={(e) => setPriority(e.target.value as RequestPriority | '')}>
          <option value="">우선순위 전체</option>
          {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className={selectCls} value={due} onChange={(e) => setDue(e.target.value)}>
          <option value="">기한 전체</option>
          {DUE_FILTERS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className={selectCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">담당 전체</option>
          <option value="unassigned">미배정만</option>
          {assigneeOptions.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.email}</option>)}
        </select>
      </div>

      {isLoading ? (
        <p className="py-16 text-center text-gray-400">불러오는 중…</p>
      ) : view === 'board' ? (
        /* ---------- 칸반 (드래그 팬) ---------- */
        <div
          ref={colsRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onPointerCancel={endDrag}
          onClickCapture={onClickCapture}
          className={`animate-view-enter flex gap-3 overflow-x-auto pb-4 ${dragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
        >
          {BOARD_STATUSES.map((status) => {
            const cards = byStatus.get(status) ?? []
            return (
              <div key={status} className="w-64 shrink-0">
                <div className="flex items-center gap-2 px-1 pb-2">
                  <Badge className={STATUS_BADGE[status]}>{status}</Badge>
                  <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500 tabular-nums">
                    {cards.length}
                  </span>
                </div>
                <div className="flex min-h-[80px] flex-col gap-2 rounded-xl border border-gray-200 bg-gray-100/70 p-2">
                  {cards.length === 0 && <p className="py-6 text-center text-xs text-gray-300">없음</p>}
                  {cards.map((r, i) => (
                    <div
                      key={r.id}
                      style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                      className={`animate-card-pop relative rounded-lg border p-2.5 pl-3 shadow-sm transition hover:-translate-y-1 hover:shadow-lg ${dueCardClass(r.due_status)}`}
                    >
                      {(r.due_status === '기한초과' || r.due_status === '지연') && (
                        <span
                          className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r ${r.due_status === '기한초과' ? 'bg-red-500 rail-pulse' : 'bg-amber-500'}`}
                          aria-hidden="true"
                        />
                      )}
                      <div className="flex items-center justify-between gap-2">
                        {r.priority && <Badge className={PRIORITY_BADGE[r.priority]}>{r.priority}</Badge>}
                        <span className="font-mono text-[11px] text-gray-400 tabular-nums">{r.seq}</span>
                      </div>
                      <Link
                        to={`/requests/${r.id}`}
                        className="mt-1 block truncate text-sm font-semibold text-gray-900 hover:text-brand hover:underline"
                        title={r.title ?? ''}
                      >
                        {r.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">{r.org}</span>
                        <span>{r.type_label}</span>
                        <Badge className={dueBadgeClass(r.due_status)}>{r.due_status}</Badge>
                        {r.rework_count != null && r.rework_count > 0 && (
                          <Badge className="bg-orange-100 text-orange-700">재{r.rework_count}</Badge>
                        )}
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
        /* ---------- 리스트 ---------- */
        <div className="animate-view-enter overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[960px] text-sm">
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
                <tr><td colSpan={9} className="px-3 py-12 text-center text-gray-400">표시할 요청이 없습니다.</td></tr>
              )}
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${r.due_status === '기한초과' ? 'bg-red-50/50' : r.due_status === '지연' ? 'bg-amber-50/40' : ''}`}
                >
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">{r.seq}</td>
                  <td className="px-3 py-2">
                    <Link to={`/requests/${r.id}`} className="font-medium text-gray-900 hover:text-brand hover:underline">{r.title}</Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.org}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.type_label}</td>
                  <td className="px-3 py-2">{r.priority && <Badge className={PRIORITY_BADGE[r.priority]}>{r.priority}</Badge>}</td>
                  <td className="px-3 py-2"><Badge className={dueBadgeClass(r.due_status)}>{r.due_status}</Badge></td>
                  <td className="w-32 px-3 py-2">{r.id != null && statusSelect(r.id, r.status)}</td>
                  <td className="w-36 px-3 py-2">{r.id != null && assigneeSelect(r.id, r.assignee_id)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-400">{fmtDateTime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400">
        상태·담당자는 카드에서 바로 변경됩니다. 이력·완료일은 자동 기록. 보드는 빈 공간을 마우스로 잡아 좌우로 끌 수 있습니다.
      </p>
    </section>
  )
}
