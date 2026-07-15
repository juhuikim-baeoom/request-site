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
import type { RequestOrg, RequestStatus, RequestVisibility } from '../../types/database'
import { useRequestTypes, useRequestViews, useVisibleSharedTargets } from './api'

// 탭 = "이 요청이 왜 나에게 보이는가"(근거)로 목록을 자른다. 서버 authz.ts의 근거 4가지와 1:1.
//   mine    ① 내가 요청자
//   shared  ③ 공개범위·공유대상이 나를 지목 (역할 특권 제외)
//   monitor ② 모니터 역할의 소속 범위 — org_monitor·dept_monitor에게만 노출
//   all     내가 볼 수 있는 전부 (위 탭들의 상위집합)
// 칸막이가 아니라 필터다: 우리 부서 요청이면서 공개범위가 dept면 shared·monitor 양쪽에 나온다.
type Tab = 'mine' | 'shared' | 'monitor' | 'all'
type Sort = 'recent' | 'due'

const TABS: Tab[] = ['mine', 'shared', 'monitor', 'all']

// localStorage 저장 키.
// 탭 값 'others'가 폐기됐지만 키는 올리지 않는다 — 키를 올리면 상태·유형·정렬 같은
// 나머지 필터까지 함께 날아간다. 아래 loadSavedView가 모르는 탭 값만 'mine'으로 떨군다.
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
      // 필드별로 개별 검증한다 — 모르는 값 하나가 저장뷰 전체를 버리게 하지 않는다.
      // 폐기된 탭 값('others')이나 지금 역할에 없는 탭이면 탭만 'mine'으로 돌아가고,
      // 상태·유형·기관·정렬·종결포함은 그대로 복원된다.
      return {
        tab: TABS.includes(parsed.tab as Tab) ? (parsed.tab as Tab) : 'mine',
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
      // 탭 = 열람 근거 필터. shared_to_me·in_monitor_scope는 서버가 계산해 내려준다(api.ts).
      const isMine = r.requester_id === profile?.id
      if (tab === 'mine' && !isMine) return false
      if (tab === 'shared' && !r.shared_to_me) return false
      if (tab === 'monitor' && !r.in_monitor_scope) return false
      // tab === 'all' — 서버가 이미 열람 범위로 걸러줬으므로 추가 조건 없음

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
  // 라벨은 사람마다 뜻이 바뀌지 않는다. 모니터 탭은 그 근거를 가진 역할에게만 보이며,
  // 라벨도 역할별로 하나뿐이라("우리 기관" 또는 "우리 부서") 헷갈리지 않는다.
  // '전체'는 모두에게 노출하되 실제 범위는 서버 visibilityFilter가 정한다
  // — staff에게는 회사 전체가 아니라 '내가 볼 수 있는 전부'(나의+공유받은)다.
  const monitorLabel =
    profile?.role === 'org_monitor' ? '우리 기관' : profile?.role === 'dept_monitor' ? '우리 부서' : null

  const visibleTabs: { tab: Tab; label: string }[] = [
    { tab: 'mine', label: '나의 요청' },
    { tab: 'shared', label: '공유받은 요청' },
    ...(monitorLabel ? [{ tab: 'monitor' as Tab, label: monitorLabel }] : []),
    { tab: 'all', label: '전체' },
  ]

  // 저장뷰에 남아 있던 탭이 지금 역할에 없으면(예: 모니터 역할 해제) 기본 탭으로 되돌린다.
  useEffect(() => {
    if (!visibleTabs.some((t) => t.tab === tab)) setTab('mine')
  }, [tab, monitorLabel])

  function tabBtn(t: Tab, label: string) {
    const active = tab === t
    return (
      <button
        key={t}
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
        {visibleTabs.map((t) => tabBtn(t.tab, t.label))}
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
        <table className="min-w-[1100px] w-full table-fixed text-sm">
          {/*
            컬럼 너비 — 각 열 텍스트 길이 비율로 배정하되 제목은 넉넉하게(22%).
            순서: 접수번호 9 · 제목 22 · 공유범위 13 · 기관 6 · 유형 9 ·
                  우선순위 7 · 상태 7 · SLA 기한 10 · 담당 6 · 접수일 11 (합 100)
            (colgroup 안에는 공백 텍스트 노드가 들어갈 수 없어 주석을 밖에 둔다)
          */}
          <colgroup>
            <col className="w-[9%]" />
            <col className="w-[22%]" />
            <col className="w-[13%]" />
            <col className="w-[6%]" />
            <col className="w-[9%]" />
            <col className="w-[7%]" />
            <col className="w-[7%]" />
            <col className="w-[10%]" />
            <col className="w-[6%]" />
            <col className="w-[11%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
              <th scope="col" className="px-3 py-2 font-medium">접수번호</th>
              <th scope="col" className="px-3 py-2 font-medium">제목</th>
              <th scope="col" className="px-3 py-2 font-medium">공유범위</th>
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
                <td colSpan={10} className="px-3 py-10 text-center text-gray-400">
                  불러오는 중...
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
                      className="block truncate font-medium text-gray-900 hover:text-brand hover:underline"
                      title={r.title ?? undefined}
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {r.visibility ? (
                      <VisibilityBadge
                        visibility={r.visibility as RequestVisibility}
                        sharedTargets={r.id != null ? sharedMap?.get(r.id) : undefined}
                        maxTargets={2}
                      />
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  <td className="truncate px-3 py-2 text-gray-600">{r.org}</td>
                  <td className="truncate px-3 py-2 text-gray-600" title={r.type_label ?? undefined}>
                    {r.type_label}
                  </td>
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
