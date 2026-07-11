import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  useCallback,
  useEffect,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Badge } from '../../components/Badge'
import {
  ORG_OPTIONS,
  PRIORITY_LEVEL_BADGE,
  BOARD_STATUSES,
  STATUS_OPTIONS,
  STATUS_BADGE,
  ALLOWED_TRANSITIONS,
  WIP_LIMIT,
  dueBadgeClass,
} from '../../lib/constants'
import { fmtDateTime } from '../../lib/format'
import type { PriorityLevel, RequestOrg, RequestStatus, RequestView } from '../../types/database'
import {
  useAllProfiles,
  useRequestTypes,
  useRequestViews,
  useChangeStatus,
  useChangeAssignee,
  useAssignRequest,
  useBulkUpdate,
  type ImpactLevel,
} from '../requests/api'
import { useAuth } from '../../auth/useAuth'

// ---- 타입 ----
type ViewMode = 'board' | 'list'

// ---- 상수 ----
const DUE_FILTERS = ['기한초과', '임박', '여유'] as const
const IMPACT_OPTIONS: ImpactLevel[] = ['높음', '보통', '낮음']
const IMPACT_PRIORITY_PREVIEW: Record<ImpactLevel, string> = {
  높음: 'P1',
  보통: 'P2',
  낮음: 'P3/P4',
}
const CLOSED_STATUSES: RequestStatus[] = ['완료', '반려', '철회']

// 저장뷰 localStorage 키
const FILTER_STORAGE_KEY = 'manage_board_filters_v1'

// ---- CSS 헬퍼 ----
const selectCls =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const miniSelectCls =
  'w-full rounded border border-gray-200 bg-white px-1.5 py-1 text-xs focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

function dueCardClass(due: string | null): string {
  if (due === '기한초과') return 'border-red-300 bg-red-50/70'
  return 'border-gray-200 bg-white'
}

// 기한 D-N 상대 표기
function relativeDue(dueAt: string | null): string | null {
  if (!dueAt) return null
  const now = Date.now()
  const due = new Date(dueAt).getTime()
  if (Number.isNaN(due)) return null
  const diffDays = Math.round((due - now) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return `D+${Math.abs(diffDays)}`
  if (diffDays === 0) return 'D-Day'
  return `D-${diffDays}`
}

// ---- 토스트 ----
interface Toast {
  id: number
  message: string
  undo?: () => void
}
let toastIdSeq = 0
function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const add = useCallback((message: string, undo?: () => void) => {
    const id = ++toastIdSeq
    setToasts((prev) => [...prev, { id, message, undo }])
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
    return () => clearTimeout(timer)
  }, [])
  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])
  return { toasts, add, remove }
}

// ---- 배정 모달 ----
interface AssignModalProps {
  requestId: number
  title: string
  selfId: string | null
  assigneeOptions: { id: string; name: string | null; email: string }[]
  onClose: () => void
  onAssigned: () => void
  addToast: (msg: string, undo?: () => void) => void
}
function AssignModal({
  requestId,
  title,
  selfId,
  assigneeOptions,
  onClose,
  onAssigned,
  addToast,
}: AssignModalProps) {
  const [assigneeId, setAssigneeId] = useState(selfId ?? (assigneeOptions[0]?.id ?? ''))
  const [impact, setImpact] = useState<ImpactLevel>('보통')
  const assignMut = useAssignRequest()

  function submit() {
    if (!assigneeId) return
    assignMut.mutate(
      { id: requestId, assigneeId, impact },
      {
        onSuccess: () => {
          addToast(`#${requestId} 배정 완료`)
          onAssigned()
          onClose()
        },
        onError: (err) => {
          addToast(`배정 실패: ${err instanceof Error ? err.message : String(err)}`)
        },
      },
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="배정 모달"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-80 rounded-xl bg-white p-5 shadow-2xl">
        <h2 className="mb-1 text-base font-bold text-gray-900">배정</h2>
        <p className="mb-4 truncate text-xs text-gray-500">{title}</p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">담당자</label>
            <select
              className={selectCls + ' w-full'}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              {assigneeOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.email}
                  {p.id === selfId ? ' (나)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">영향도</label>
            <div className="flex gap-2">
              {IMPACT_OPTIONS.map((imp) => (
                <button
                  key={imp}
                  onClick={() => setImpact(imp)}
                  className={`flex-1 rounded-md border py-1.5 text-xs font-medium transition ${
                    impact === imp
                      ? 'border-brand bg-brand text-white'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {imp}
                </button>
              ))}
            </div>
            <p className="mt-1 text-right text-[11px] text-gray-400">
              예상 우선순위: <strong>{IMPACT_PRIORITY_PREVIEW[impact]}</strong>
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            취소
          </button>
          <button
            onClick={submit}
            disabled={!assigneeId || assignMut.isPending}
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {assignMut.isPending ? '처리중…' : '배정'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- 저장 필터 타입 ----
interface SavedFilters {
  org: string
  typeCode: string
  due: string
  assignee: string
  showClosed: boolean
}
function loadSavedFilters(): Partial<SavedFilters> {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<SavedFilters>) : {}
  } catch {
    return {}
  }
}
function saveFilters(f: SavedFilters) {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(f))
  } catch { /* noop */ }
}

// ---- 메인 컴포넌트 ----
export function ManageBoard() {
  const { data: rows, isLoading } = useRequestViews()
  const { data: profiles } = useAllProfiles()
  const { data: types } = useRequestTypes()
  const queryClient = useQueryClient()
  const changeStatus = useChangeStatus()
  const changeAssignee = useChangeAssignee()
  const bulkUpdate = useBulkUpdate()
  const { profile } = useAuth()
  const { toasts, add: addToast, remove: removeToast } = useToasts()

  // 필터 상태 (localStorage에서 복원)
  const saved = useMemo(() => loadSavedFilters(), [])
  const [view, setView] = useState<ViewMode>('board')
  const [q, setQ] = useState('')
  const [org, setOrg] = useState<RequestOrg | ''>(
    (saved.org as RequestOrg | undefined) ?? '',
  )
  const [typeCode, setTypeCode] = useState(saved.typeCode ?? '')
  const [assignee, setAssignee] = useState(saved.assignee ?? '')
  const [due, setDue] = useState(saved.due ?? '')
  const [showClosed, setShowClosed] = useState(saved.showClosed ?? false)

  // 필터 변경 시 저장
  useEffect(() => {
    saveFilters({ org, typeCode, due, assignee, showClosed })
  }, [org, typeCode, due, assignee, showClosed])

  // 배정 모달
  const [assignModal, setAssignModal] = useState<{
    id: number
    title: string
  } | null>(null)

  // 벌크 선택
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkStatus, setBulkStatus] = useState<RequestStatus | ''>('')
  // '__unassigned__' = 미배정 선택, '' = 플레이스홀더(미선택)
  const [bulkAssignee, setBulkAssignee] = useState('')

  // 드래그 드롭 상태 (HTML5 dragover/drop API)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<RequestStatus | null>(null)

  // 칸반 가로 팬
  const colsRef = useRef<HTMLDivElement>(null)
  const pan = useRef({ down: false, sx: 0, sl: 0, moved: false })
  const [panning, setPanning] = useState(false)

  // ---- 파생 데이터 ----
  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of profiles ?? []) m.set(p.id, p.name ?? p.email)
    return m
  }, [profiles])
  const assigneeOptions = useMemo(
    () => (profiles ?? []).filter((p) => p.role === 'system'),
    [profiles],
  )

  const deferredQ = useDeferredValue(q)

  const triageQueue = useMemo(
    () =>
      (rows ?? []).filter(
        (r) => r.status === '접수' && !r.assignee_id,
      ),
    [rows],
  )

  const filtered = useMemo(() => {
    const query = deferredQ.trim().toLowerCase()
    return (rows ?? []).filter((r) => {
      // 종결 필터 — 기본적으로 완료/반려/철회 제외
      if (!showClosed && r.status && CLOSED_STATUSES.includes(r.status as RequestStatus)) return false
      if (org && r.org !== org) return false
      if (typeCode && r.type_code !== typeCode) return false
      if (due && r.due_status !== due) return false
      if (assignee === 'unassigned' && r.assignee_id) return false
      if (assignee && assignee !== 'unassigned' && r.assignee_id !== assignee) return false
      if (query) {
        const idx = [
          r.seq,
          r.title,
          r.body,
          r.org,
          r.type_label,
          r.status,
          r.priority_level,
          r.due_status,
          r.assignee_id ? nameById.get(r.assignee_id) : '미배정',
        ]
          .join(' ')
          .toLowerCase()
        if (!idx.includes(query)) return false
      }
      return true
    })
  }, [rows, deferredQ, org, typeCode, due, assignee, showClosed, nameById])

  const byStatus = useMemo(() => {
    const m = new Map<RequestStatus, typeof filtered>()
    for (const s of BOARD_STATUSES) m.set(s, [])
    for (const r of filtered) {
      if (r.status && m.has(r.status as RequestStatus)) {
        m.get(r.status as RequestStatus)!.push(r)
      }
    }
    return m
  }, [filtered])

  // ---- 드래그 드롭 핸들러 ----
  function onDragStart(e: React.DragEvent, id: number) {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(id))
  }

  function onDragOver(e: React.DragEvent, status: RequestStatus) {
    e.preventDefault()
    const row = (rows ?? []).find((r) => r.id === dragId)
    if (!row || !row.status) return
    const allowed = ALLOWED_TRANSITIONS[row.status as RequestStatus] ?? []
    if (status === row.status || allowed.includes(status)) {
      e.dataTransfer.dropEffect = 'move'
      setDragOverStatus(status)
    } else {
      e.dataTransfer.dropEffect = 'none'
    }
  }

  function onDrop(e: React.DragEvent, toStatus: RequestStatus) {
    e.preventDefault()
    setDragOverStatus(null)
    if (dragId == null) return
    const row = (rows ?? []).find((r) => r.id === dragId)
    if (!row || !row.status) return
    const fromStatus = row.status as RequestStatus
    if (fromStatus === toStatus) return
    const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? []
    if (!allowed.includes(toStatus)) {
      addToast(`${fromStatus} → ${toStatus} 전이는 허용되지 않습니다.`)
      return
    }
    // 접수 → 진행중 드롭: 배정 필요
    if (fromStatus === '접수' && toStatus === '진행중') {
      setAssignModal({ id: dragId, title: row.title ?? '' })
      return
    }
    // 낙관적 업데이트
    changeStatus.mutate(
      { id: dragId, status: toStatus },
      {
        onError: (err) => {
          addToast(`상태 변경 실패: ${err instanceof Error ? err.message : String(err)}`)
        },
      },
    )
  }

  function onDragEnd() {
    setDragId(null)
    setDragOverStatus(null)
  }

  // ---- 칸반 팬 핸들러 ----
  function onPointerDown(e: React.PointerEvent) {
    const el = colsRef.current
    if (!el || e.button !== 0) return
    if ((e.target as HTMLElement).closest('a,button,select,input,textarea,[draggable]')) return
    pan.current = { down: true, sx: e.clientX, sl: el.scrollLeft, moved: false }
    try {
      el.setPointerCapture(e.pointerId)
    } catch { /* noop */ }
    setPanning(true)
  }
  function onPointerMove(e: React.PointerEvent) {
    const el = colsRef.current
    if (!pan.current.down || !el) return
    const dx = e.clientX - pan.current.sx
    if (Math.abs(dx) > 4) pan.current.moved = true
    el.scrollLeft = pan.current.sl - dx
  }
  function endPan() {
    if (!pan.current.down) return
    pan.current.down = false
    setPanning(false)
  }
  function onClickCapture(e: React.MouseEvent) {
    if (pan.current.moved) {
      e.preventDefault()
      e.stopPropagation()
      pan.current.moved = false
    }
  }

  // ---- 인라인 담당 변경 ----
  function handleAssigneeChange(id: number, value: string) {
    changeAssignee.mutate(
      { id, assignee_id: value || null },
      {
        onError: (err) => {
          addToast(`담당자 변경 실패: ${err instanceof Error ? err.message : String(err)}`)
        },
      },
    )
  }

  // ---- 벌크 선택 ----
  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function selectAll() {
    setSelectedIds(new Set(filtered.map((r) => r.id).filter((id): id is number => id != null)))
  }
  function clearSelection() {
    setSelectedIds(new Set())
  }

  function applyBulkStatus() {
    if (!bulkStatus || selectedIds.size === 0) return
    const ids = [...selectedIds].filter((id): id is number => id != null)
    bulkUpdate.mutate(
      { ids, patch: { status: bulkStatus } },
      {
        onSuccess: (result) => {
          const msg =
            result.failed.length > 0
              ? `${result.succeeded.length}건 완료, ${result.failed.length}건 실패`
              : `${result.succeeded.length}건 상태 변경 완료`
          addToast(msg, () => {
            // undo: 직전 캐시 스냅샷으로 즉시 복원
            if (result.previous) {
              queryClient.setQueryData(['requests', 'view'], result.previous)
              addToast('상태 변경을 되돌렸습니다.')
            }
          })
          clearSelection()
          setBulkStatus('')
        },
        onError: (err) => {
          addToast(`일괄 변경 실패: ${err instanceof Error ? err.message : String(err)}`)
        },
      },
    )
  }

  function applyBulkAssignee() {
    if (selectedIds.size === 0) return
    const ids = [...selectedIds].filter((id): id is number => id != null)
    // '__unassigned__' 은 미배정 선택을 의미 → assignee_id: null
    const assignee_id = bulkAssignee === '__unassigned__' ? null : bulkAssignee || null
    bulkUpdate.mutate(
      { ids, patch: { assignee_id } },
      {
        onSuccess: (result) => {
          addToast(`${result.succeeded.length}건 담당자 변경 완료`)
          clearSelection()
          setBulkAssignee('')
        },
        onError: (err) => {
          addToast(`일괄 담당자 변경 실패: ${err instanceof Error ? err.message : String(err)}`)
        },
      },
    )
  }

  // ---- 카드 공통 렌더 ----
  const renderCard = (r: RequestView, i: number, draggable = false) => {
    const isSelected = r.id != null && selectedIds.has(r.id)
    const relDue = relativeDue(r.resolution_due_at)
    const priorityLevel = r.priority_level as PriorityLevel | null
    return (
      <div
        key={r.id}
        draggable={draggable}
        onDragStart={draggable && r.id != null ? (e) => onDragStart(e, r.id!) : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
        style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
        className={`animate-card-pop relative rounded-lg border p-2.5 pl-3 shadow-sm transition
          hover:-translate-y-0.5 hover:shadow-md
          ${dueCardClass(r.due_status)}
          ${isSelected ? 'ring-2 ring-brand ring-offset-1' : ''}
          ${dragId === r.id ? 'opacity-40' : ''}
        `}
      >
        {r.due_status === '기한초과' && (
          <span
            className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r bg-red-500"
            aria-hidden="true"
          />
        )}
        <div className="flex items-center gap-1.5">
          {/* 선택 체크박스 */}
          {r.id != null && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => r.id != null && toggleSelect(r.id)}
              onClick={(e) => e.stopPropagation()}
              className="h-3 w-3 shrink-0 rounded border-gray-300 accent-brand"
              aria-label="카드 선택"
            />
          )}
          {/* 우선순위 레벨 */}
          {priorityLevel ? (
            <Badge className={PRIORITY_LEVEL_BADGE[priorityLevel as PriorityLevel]}>
              {priorityLevel}
            </Badge>
          ) : (
            <Badge className="bg-gray-100 text-gray-400">미정</Badge>
          )}
          <span className="ml-auto font-mono text-[11px] text-gray-400 tabular-nums">
            {r.seq}
          </span>
        </div>
        <Link
          to={`/requests/${r.id}`}
          className="mt-1 block truncate text-sm font-semibold text-gray-900 hover:text-brand hover:underline"
          title={r.title ?? ''}
        >
          {r.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">
            {r.org}
          </span>
          <span>{r.type_label}</span>
          {r.rework_count != null && r.rework_count > 0 && (
            <Badge className="bg-orange-100 text-orange-700">재{r.rework_count}</Badge>
          )}
        </div>
        {/* SLA/기한 */}
        <div className="mt-1 flex items-center gap-1.5">
          <Badge className={dueBadgeClass(r.due_status)}>{r.due_status ?? '-'}</Badge>
          {relDue && (
            <span
              className={`text-[11px] font-semibold tabular-nums ${
                r.due_status === '기한초과'
                  ? 'text-red-600'
                  : r.due_status === '임박'
                    ? 'text-amber-600'
                    : 'text-gray-400'
              }`}
            >
              {relDue}
            </span>
          )}
          {r.sla_resolution_breached && (
            <span className="text-[10px] font-semibold text-red-500">SLA</span>
          )}
        </div>
        {/* 담당자 인라인 */}
        <div className="mt-2">
          <select
            aria-label="담당자"
            className={miniSelectCls}
            value={r.assignee_id ?? ''}
            onChange={(e) => r.id != null && handleAssigneeChange(r.id, e.target.value)}
          >
            <option value="">미배정</option>
            {assigneeOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.email}
              </option>
            ))}
          </select>
        </div>
      </div>
    )
  }

  return (
    <section className="flex h-full flex-col gap-4">
      {/* ---- 토스트 ---- */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg"
          >
            <span>{t.message}</span>
            {t.undo && (
              <button
                onClick={() => {
                  t.undo?.()
                  removeToast(t.id)
                }}
                className="ml-2 rounded px-2 py-0.5 text-xs font-semibold text-brand hover:bg-white/10"
              >
                되돌리기
              </button>
            )}
            <button
              onClick={() => removeToast(t.id)}
              className="ml-auto text-gray-400 hover:text-white"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* ---- 헤더 ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900">관리 보드</h1>
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
          <span className="text-gray-400" aria-hidden="true">⌕</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="전체 검색 — 제목·본문·기관·담당·상태까지 즉시 조회"
            className="w-full border-0 bg-transparent text-sm outline-none placeholder:text-gray-400"
            aria-label="전체 검색"
          />
          <span aria-live="polite" className="whitespace-nowrap text-xs text-gray-400 tabular-nums">
            {(q || org || typeCode || due || assignee) ? `${filtered.length}건` : ''}
          </span>
        </div>
        <div className="flex gap-1">
          {(['board', 'list'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                view === v ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {v === 'board' ? '보드' : '리스트'}
            </button>
          ))}
        </div>
      </div>

      {/* ---- 필터 ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="기관 필터"
          className={selectCls}
          value={org}
          onChange={(e) => setOrg(e.target.value as RequestOrg | '')}
        >
          <option value="">기관 전체</option>
          {ORG_OPTIONS.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <select
          aria-label="유형 필터"
          className={selectCls}
          value={typeCode}
          onChange={(e) => setTypeCode(e.target.value)}
        >
          <option value="">유형 전체</option>
          {types?.map((t) => (
            <option key={t.code} value={t.code}>{t.label}</option>
          ))}
        </select>
        <select
          aria-label="기한 필터"
          className={selectCls}
          value={due}
          onChange={(e) => setDue(e.target.value)}
        >
          <option value="">기한 전체</option>
          {DUE_FILTERS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          aria-label="담당자 필터"
          className={selectCls}
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <option value="">담당 전체</option>
          <option value="unassigned">미배정만</option>
          {assigneeOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.name ?? p.email}</option>
          ))}
        </select>
        {/* 종결 포함 토글 */}
        <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm shadow-sm hover:bg-gray-50">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
            className="h-3.5 w-3.5 accent-brand"
          />
          종결 포함
        </label>
      </div>

      {/* ---- 트리아지 존 (미배정 큐) ---- */}
      {triageQueue.length > 0 && (
        <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-bold text-amber-800">미배정 큐</span>
            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-800 tabular-nums">
              {triageQueue.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {triageQueue.map((r) => {
              const priorityLevel = r.priority_level as PriorityLevel | null
              return (
                <div
                  key={r.id}
                  className="flex w-64 shrink-0 flex-col gap-1.5 rounded-lg border border-amber-200 bg-white p-2.5 shadow-sm"
                >
                  <div className="flex items-center gap-1.5">
                    {priorityLevel ? (
                      <Badge className={PRIORITY_LEVEL_BADGE[priorityLevel]}>{priorityLevel}</Badge>
                    ) : (
                      <Badge className="bg-gray-100 text-gray-400">미정</Badge>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-gray-400">{r.seq}</span>
                  </div>
                  <Link
                    to={`/requests/${r.id}`}
                    className="truncate text-sm font-semibold text-gray-900 hover:text-brand hover:underline"
                    title={r.title ?? ''}
                  >
                    {r.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">{r.org}</span>
                    <span>{r.type_label}</span>
                  </div>
                  <button
                    onClick={() => r.id != null && setAssignModal({ id: r.id, title: r.title ?? '' })}
                    className="mt-0.5 w-full rounded-md bg-amber-500 py-1 text-xs font-semibold text-white hover:bg-amber-600"
                  >
                    배정
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ---- 벌크 액션 바 ---- */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2">
          <span className="text-sm font-semibold text-brand">{selectedIds.size}건 선택됨</span>
          <select
            aria-label="일괄 상태 변경"
            className={selectCls}
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as RequestStatus | '')}
          >
            <option value="">상태 일괄 변경…</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {bulkStatus && (
            <button
              onClick={applyBulkStatus}
              disabled={bulkUpdate.isPending}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
            >
              적용
            </button>
          )}
          <select
            aria-label="일괄 담당자 변경"
            className={selectCls}
            value={bulkAssignee}
            onChange={(e) => setBulkAssignee(e.target.value)}
          >
            <option value="">담당자 일괄 변경…</option>
            <option value="__unassigned__">미배정</option>
            {assigneeOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.name ?? p.email}</option>
            ))}
          </select>
          {bulkAssignee !== '' && (
            <button
              onClick={applyBulkAssignee}
              disabled={bulkUpdate.isPending}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
            >
              담당 적용
            </button>
          )}
          <button
            onClick={selectAll}
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            전체 선택
          </button>
          <button
            onClick={clearSelection}
            className="ml-auto rounded-md px-2.5 py-1.5 text-sm text-gray-500 hover:bg-gray-100"
          >
            선택 해제
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="py-16 text-center text-gray-400">불러오는 중…</p>
      ) : view === 'board' ? (
        /* ---- 칸반 보드 ---- */
        <div
          ref={colsRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onClickCapture={onClickCapture}
          className={`animate-view-enter flex gap-3 overflow-x-auto pb-4 ${panning ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
        >
          {BOARD_STATUSES.map((status) => {
            const cards = byStatus.get(status) ?? []
            const overWip = cards.length > WIP_LIMIT
            const isDragTarget = dragOverStatus === status
            return (
              <div
                key={status}
                className="w-64 shrink-0"
                onDragOver={(e) => onDragOver(e, status)}
                onDragLeave={() => setDragOverStatus(null)}
                onDrop={(e) => onDrop(e, status)}
              >
                {/* 컬럼 헤더 */}
                <div className="flex items-center gap-2 px-1 pb-2">
                  <Badge className={STATUS_BADGE[status]}>{status}</Badge>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                      overWip
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {cards.length}
                    {overWip && <span title={`WIP 한도 ${WIP_LIMIT} 초과`}> !</span>}
                  </span>
                </div>
                {/* 컬럼 내용 */}
                <div
                  className={`flex min-h-[80px] flex-col gap-2 rounded-xl border p-2 transition-colors ${
                    isDragTarget
                      ? 'border-brand bg-brand/5'
                      : 'border-gray-200 bg-gray-100/70'
                  }`}
                >
                  {cards.length === 0 && !isDragTarget && (
                    <p className="py-6 text-center text-xs text-gray-400">없음</p>
                  )}
                  {isDragTarget && (
                    <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-brand/40 py-4 text-xs text-brand">
                      여기에 놓기
                    </div>
                  )}
                  {cards.map((r, i) => renderCard(r, i, true))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* ---- 리스트 뷰 ---- */
        <div className="animate-view-enter overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[1020px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    onChange={(e) => (e.target.checked ? selectAll() : clearSelection())}
                    checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
                    className="h-3.5 w-3.5 accent-brand"
                    aria-label="전체 선택"
                  />
                </th>
                <th className="px-3 py-2 font-medium">접수번호</th>
                <th className="px-3 py-2 font-medium">제목</th>
                <th className="px-3 py-2 font-medium">기관</th>
                <th className="px-3 py-2 font-medium">유형</th>
                <th className="px-3 py-2 font-medium">우선</th>
                <th className="px-3 py-2 font-medium">SLA/기한</th>
                <th className="px-3 py-2 font-medium">상태</th>
                <th className="px-3 py-2 font-medium">담당</th>
                <th className="px-3 py-2 font-medium">접수일</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-3 py-12 text-center text-gray-400"
                  >
                    표시할 요청이 없습니다.
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const isSelected = r.id != null && selectedIds.has(r.id)
                const priorityLevel = r.priority_level as PriorityLevel | null
                const relDue = relativeDue(r.resolution_due_at)
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${
                      r.due_status === '기한초과'
                        ? 'bg-red-50/50'
                        : ''
                    } ${isSelected ? 'bg-brand/5' : ''}`}
                  >
                    <td className="px-3 py-2">
                      {r.id != null && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => r.id != null && toggleSelect(r.id)}
                          className="h-3.5 w-3.5 accent-brand"
                          aria-label="선택"
                        />
                      )}
                    </td>
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
                      {r.rework_count != null && r.rework_count > 0 && (
                        <Badge className="ml-1 bg-orange-100 text-orange-700">
                          재{r.rework_count}
                        </Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.org}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.type_label}</td>
                    <td className="px-3 py-2">
                      {priorityLevel ? (
                        <Badge className={PRIORITY_LEVEL_BADGE[priorityLevel]}>{priorityLevel}</Badge>
                      ) : (
                        <span className="text-xs text-gray-400">미정</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Badge className={dueBadgeClass(r.due_status)}>
                          {r.due_status ?? '-'}
                        </Badge>
                        {relDue && (
                          <span
                            className={`text-[11px] font-semibold tabular-nums ${
                              r.due_status === '기한초과'
                                ? 'text-red-600'
                                : 'text-gray-400'
                            }`}
                          >
                            {relDue}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="w-24 px-3 py-2">
                      <select
                        aria-label="상태 변경"
                        className={miniSelectCls}
                        value={r.status ?? ''}
                        onChange={(e) => {
                          if (r.id == null) return
                          const toStatus = e.target.value as RequestStatus
                          const fromStatus = r.status as RequestStatus | undefined
                          if (fromStatus && toStatus !== fromStatus) {
                            const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? []
                            if (!allowed.includes(toStatus)) {
                              addToast(`${fromStatus} → ${toStatus} 전이는 허용되지 않습니다.`)
                              return
                            }
                          }
                          changeStatus.mutate({ id: r.id, status: toStatus })
                        }}
                      >
                        {STATUS_OPTIONS.map((s) => {
                          const fromStatus = r.status as RequestStatus | undefined
                          const allowed = fromStatus
                            ? (ALLOWED_TRANSITIONS[fromStatus] ?? [])
                            : []
                          const isDisallowed =
                            fromStatus != null &&
                            s !== fromStatus &&
                            !allowed.includes(s as RequestStatus)
                          return (
                            <option key={s} value={s} disabled={isDisallowed}>
                              {s}{isDisallowed ? ' (불가)' : ''}
                            </option>
                          )
                        })}
                      </select>
                    </td>
                    <td className="w-32 px-3 py-2">
                      <select
                        aria-label="담당자"
                        className={miniSelectCls}
                        value={r.assignee_id ?? ''}
                        onChange={(e) =>
                          r.id != null && handleAssigneeChange(r.id, e.target.value)
                        }
                      >
                        <option value="">미배정</option>
                        {assigneeOptions.map((p) => (
                          <option key={p.id} value={p.id}>{p.name ?? p.email}</option>
                        ))}
                      </select>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-400">
                      {fmtDateTime(r.created_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400">
        칸반에서 카드를 드래그해 상태를 변경합니다. 미배정 큐에서 배정 후 진행중으로 이동됩니다.
        보드는 빈 공간을 마우스로 잡아 좌우로 끌 수 있습니다.
      </p>

      {/* ---- 배정 모달 ---- */}
      {assignModal && (
        <AssignModal
          requestId={assignModal.id}
          title={assignModal.title}
          selfId={profile?.id ?? null}
          assigneeOptions={assigneeOptions}
          onClose={() => setAssignModal(null)}
          onAssigned={() => setAssignModal(null)}
          addToast={addToast}
        />
      )}
    </section>
  )
}
