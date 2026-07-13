import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { Badge } from '../../components/Badge'
import { VisibilityBadge } from '../../components/VisibilityBadge'
import {
  ORG_OPTIONS,
  STATUS_OPTIONS,
  STATUS_BADGE,
  PRIORITY_LEVEL_BADGE,
  CLOSED_STATUSES,
  dueBadgeClass,
} from '../../lib/constants'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { canSeeAllRequests } from '../../lib/permissions'
import type { RequestOrg, RequestStatus, RequestVisibility } from '../../types/database'
import { useRequestTypes, useRequestViews, useVisibleSharedTargets } from './api'

type Tab = 'mine' | 'others'
type Sort = 'recent' | 'due'

// localStorage 저장 키
const STORAGE_KEY = 'my_requests_view_v1'

interface SavedView {
  tab: Tab
  status: RequestStatus | ''
  typeCode: string
  org: RequestOrg | ''
  sort: Sort
  showClosed: boolean
}

function loadSavedView(): SavedView {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SavedView>
      return {
        tab: parsed.tab === 'others' ? 'others' : 'mine',
        status: (STATUS_OPTIONS as string[]).includes(parsed.status ?? '')
          ? (parsed.status as RequestStatus)
          : '',
        typeCode: typeof parsed.typeCode === 'string' ? parsed.typeCode : '',
        org: (ORG_OPTIONS as string[]).includes(parsed.org ?? '')
          ? (parsed.org as RequestOrg)
          : '',
        sort: parsed.sort === 'due' ? 'due' : 'recent',
        showClosed: parsed.showClosed === true,
      }
    }
  } catch {
    // 파싱 실패 — 기본값 사용
  }
  return { tab: 'mine', status: '', typeCode: '', org: '', sort: 'recent', showClosed: false }
}

// 기한 우선 정렬 순위 (작을수록 위)
const DUE_RANK: Record<string, number> = {
  기한초과: 0,
  임박: 1,
  여유: 2,
}
function dueRank(due: string | null): number {
  return due != null && due in DUE_RANK ? DUE_RANK[due] : 9
}

/**
 * resolution_due_at(timestamptz)을 기준으로 D-N / 초과 상대 표기를 반환.
 * null이면 '-' 반환.
 */
function fmtRelativeDue(dueDateStr: string | null): string {
  if (!dueDateStr) return '-'
  const due = new Date(dueDateStr)
  if (Number.isNaN(due.getTime())) return fmtDate(dueDateStr)
  const diffMs = due.getTime() - Date.now()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return `${Math.abs(diffDays)}일 초과`
  if (diffDays === 0) return '오늘 마감'
  return `D-${diffDays}`
}

/** due_status 에 대응하는 아이콘(텍스트) */
function dueIcon(due: string | null): string {
  switch (due) {
    case '기한초과':
      return '!'
    case '임박':
      return '~'
    case '여유':
      return ''
    case '완료':
      return ''
    default:
      return ''
  }
}

const selectCls =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

export function MyRequests() {
  const { profile } = useAuth()
  const { data: rows, isLoading } = useRequestViews()
  const { data: sharedMap } = useVisibleSharedTargets()
  const { data: types } = useRequestTypes()

  // 저장뷰 초기화 (마운트 1회)
  const initial = useRef(loadSavedView())

  const [tab, setTab] = useState<Tab>(initial.current.tab)
  const [status, setStatus] = useState<RequestStatus | ''>(initial.current.status)
  const [typeCode, setTypeCode] = useState<string>(initial.current.typeCode)
  const [org, setOrg] = useState<RequestOrg | ''>(initial.current.org)
  const [sort, setSort] = useState<Sort>(initial.current.sort)
  const [showClosed, setShowClosed] = useState<boolean>(initial.current.showClosed)

  // 필터 상태 변경 시마다 localStorage 자동 저장
  useEffect(() => {
    const view: SavedView = { tab, status, typeCode, org, sort, showClosed }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(view))
    } catch {
      // 스토리지 꽉 참 등 무시
    }
  }, [tab, status, typeCode, org, sort, showClosed])

  const filtered = useMemo(() => {
    const list = (rows ?? []).filter((r) => {
      const isMine = r.requester_id === profile?.id
      if (tab === 'mine' ? !isMine : isMine) return false

      // 종결 포함 토글 — 꺼져 있으면 열린 상태만
      const rowStatus = r.status as RequestStatus | null
      if (!showClosed && rowStatus && CLOSED_STATUSES.includes(rowStatus)) return false

      // 상태 필터 (명시적으로 선택한 경우)
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
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })
    return list
  }, [rows, profile?.id, tab, status, typeCode, org, sort, showClosed])

  // 탭은 '장소'가 아니라 '범위'를 가리킨다 — 페이지 제목(요청 목록)과 단어가 겹치지 않게 한다.
  // 두 번째 탭의 범위는 역할에 따라 달라진다 — 서버 visibilityFilter가 실제 범위를 정한다.
  const othersLabel = canSeeAllRequests(profile?.role)
    ? '전체'
    : profile?.role === 'org_monitor'
      ? '우리 기관'
      : profile?.role === 'dept_monitor'
        ? '우리 부서'
        : '공유받은 요청'

  function tabBtn(t: Tab, label: string) {
    const active = tab === t
    return (
      <button
        role="tab"
        onClick={() => setTab(t)}
        aria-selected={active}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          active ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        {label}
      </button>
    )
  }

  return (
    <section aria-label="요청 목록">
      <h1 className="text-xl font-bold text-gray-900">요청 목록</h1>

      {/* 탭 */}
      <div className="mt-4 flex gap-1" role="tablist" aria-label="요청 범위 탭">
        {tabBtn('mine', '나의 요청')}
        {tabBtn('others', othersLabel)}
      </div>

      {/* 필터 행 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* 종결 포함 토글 */}
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-600 select-none">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 accent-brand"
            aria-label="완료·반려·철회 포함"
          />
          종결 포함
        </label>

        <select
          className={selectCls}
          value={status}
          onChange={(e) => setStatus(e.target.value as RequestStatus | '')}
          aria-label="상태 필터"
        >
          <option value="">상태 전체</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          className={selectCls}
          value={typeCode}
          onChange={(e) => setTypeCode(e.target.value)}
          aria-label="유형 필터"
        >
          <option value="">유형 전체</option>
          {types?.map((t) => (
            <option key={t.code} value={t.code}>
              {t.label}
            </option>
          ))}
        </select>

        <select
          className={selectCls}
          value={org}
          onChange={(e) => setOrg(e.target.value as RequestOrg | '')}
          aria-label="기관 필터"
        >
          <option value="">기관 전체</option>
          {ORG_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>

        <div className="ml-auto">
          <select
            className={selectCls}
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="정렬 기준"
          >
            <option value="recent">최신순</option>
            <option value="due">기한 우선</option>
          </select>
        </div>
      </div>

      {/* ---- 데스크톱 표 (sm 이상) ---- */}
      <div className="mt-4 hidden overflow-x-auto rounded-lg border border-gray-200 bg-white sm:block">
        <table className="min-w-[900px] w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
              <th scope="col" className="px-3 py-2 font-medium">접수번호</th>
              <th scope="col" className="px-3 py-2 font-medium">제목</th>
              <th scope="col" className="px-3 py-2 font-medium">기관</th>
              <th scope="col" className="px-3 py-2 font-medium">유형</th>
              <th scope="col" className="px-3 py-2 font-medium">우선순위</th>
              <th scope="col" className="px-3 py-2 font-medium">상태</th>
              <th scope="col" className="px-3 py-2 font-medium">SLA 기한</th>
              <th scope="col" className="px-3 py-2 font-medium">담당</th>
              <th scope="col" className="px-3 py-2 font-medium">접수일</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-gray-400">
                  불러오는 중...
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-gray-400">
                  표시할 요청이 없습니다.
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const priorityLevel = r.priority_level as string | null
              const dueLabel =
                r.due_status === '완료' || r.due_status === '반려' || r.due_status === '철회'
                  ? (r.due_status as string)
                  : r.due_status ?? '-'
              const icon = dueIcon(r.due_status)
              const relativeDue = fmtRelativeDue(r.resolution_due_at)

              return (
                <tr
                  key={r.id ?? r.seq}
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                >
                  <th scope="row" className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500 font-normal text-left">
                    {r.seq}
                  </th>
                  <td className="px-3 py-2">
                    <Link
                      to={`/requests/${r.id}?from=mine`}
                      className="font-medium text-gray-900 hover:text-brand hover:underline"
                    >
                      {r.title}
                    </Link>
                    {r.visibility && (
                      <div className="mt-0.5">
                        <VisibilityBadge
                          visibility={r.visibility as RequestVisibility}
                          sharedTargets={r.id != null ? sharedMap?.get(r.id) : undefined}
                        />
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.org}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{r.type_label}</td>
                  <td className="px-3 py-2">
                    {priorityLevel ? (
                      <Badge
                        className={
                          PRIORITY_LEVEL_BADGE[priorityLevel as keyof typeof PRIORITY_LEVEL_BADGE] ??
                          'bg-gray-200 text-gray-700'
                        }
                      >
                        {priorityLevel}
                      </Badge>
                    ) : (
                      <span className="text-xs text-gray-400">미정</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.status && (
                      <Badge className={STATUS_BADGE[r.status as RequestStatus]}>
                        {r.status}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge className={dueBadgeClass(r.due_status)}>
                      {icon ? `${icon} ` : ''}{dueLabel}
                    </Badge>
                    {r.resolution_due_at && relativeDue !== '-' && (
                      <div className="mt-0.5 text-xs text-gray-400">{relativeDue}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                    {r.assignee_id ? '배정됨' : '미배정'}
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

      {/* ---- 모바일 카드 뷰 (sm 미만) ---- */}
      <div className="mt-4 flex flex-col gap-3 sm:hidden">
        {isLoading && (
          <p className="py-10 text-center text-sm text-gray-400">불러오는 중...</p>
        )}
        {!isLoading && filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-400">표시할 요청이 없습니다.</p>
        )}
        {filtered.map((r) => {
          const priorityLevel = r.priority_level as string | null
          const dueLabel =
            r.due_status === '완료' || r.due_status === '반려' || r.due_status === '철회'
              ? (r.due_status as string)
              : r.due_status ?? '-'
          const icon = dueIcon(r.due_status)
          const relativeDue = fmtRelativeDue(r.resolution_due_at)

          return (
            <article
              key={r.id ?? r.seq}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
              aria-label={`요청 ${r.seq ?? ''}: ${r.title ?? ''}`}
            >
              {/* 접수번호 + 상태 */}
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-gray-400">{r.seq}</span>
                {r.status && (
                  <Badge className={STATUS_BADGE[r.status as RequestStatus]}>
                    {r.status}
                  </Badge>
                )}
              </div>

              {/* 제목 */}
              <Link
                to={`/requests/${r.id}?from=mine`}
                className="block font-medium text-gray-900 hover:text-brand hover:underline"
              >
                {r.title}
              </Link>

              {/* 부가 정보 행 */}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                {/* 우선순위 */}
                {priorityLevel ? (
                  <Badge
                    className={
                      PRIORITY_LEVEL_BADGE[priorityLevel as keyof typeof PRIORITY_LEVEL_BADGE] ??
                      'bg-gray-200 text-gray-700'
                    }
                  >
                    {priorityLevel}
                  </Badge>
                ) : (
                  <span className="text-gray-400">미정</span>
                )}

                {/* SLA 기한 */}
                <Badge className={dueBadgeClass(r.due_status)}>
                  {icon ? `${icon} ` : ''}{dueLabel}
                </Badge>
                {r.resolution_due_at && relativeDue !== '-' && (
                  <span className="text-gray-400">{relativeDue}</span>
                )}

                {/* 담당 */}
                <span>{r.assignee_id ? '배정됨' : '미배정'}</span>
              </div>

              {/* 기관·유형 */}
              <div className="mt-1 text-xs text-gray-400">
                {[r.org, r.type_label].filter(Boolean).join(' · ')}
              </div>

              {/* 공개범위 뱃지 */}
              {r.visibility && (
                <div className="mt-1">
                  <VisibilityBadge
                    visibility={r.visibility as RequestVisibility}
                    sharedTargets={r.id != null ? sharedMap?.get(r.id) : undefined}
                  />
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
