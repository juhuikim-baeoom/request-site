import { useState, useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts'
import { useDashboardMetrics } from './api'

// ── 색상 팔레트 ──────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  접수: '#60a5fa',
  진행중: '#818cf8',
  보류: '#fbbf24',
  완료: '#34d399',
  반려: '#f87171',
  철회: '#94a3b8',
}
const PALETTE = ['#6366f1', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e', '#a78bfa', '#fb923c']

// ── 유틸 ─────────────────────────────────────────────────────────────────────

/** 시간(소수) → "N일 M시간" 또는 "N시간" 가독 문자열 */
function fmtHours(hours: number | null): string {
  if (hours == null) return '-'
  if (hours < 1) return `${Math.round(hours * 60)}분`
  const d = Math.floor(hours / 24)
  const h = Math.round(hours % 24)
  if (d === 0) return `${h}시간`
  if (h === 0) return `${d}일`
  return `${d}일 ${h}시간`
}

/** 퍼센트 소수 → "XX.X%" */
function fmtPct(v: number | null): string {
  if (v == null) return '-'
  return `${(v * 100).toFixed(1)}%`
}

// ── 기간 필터 타입 ────────────────────────────────────────────────────────────
type FilterMode = 'year' | 'month' | 'custom'

function buildRange(
  mode: FilterMode,
  year: string,
  month: string,
  customFrom: string,
  customTo: string,
): { from: string | undefined; to: string | undefined } {
  if (mode === 'year') {
    return { from: `${year}-01-01`, to: `${year}-12-31` }
  }
  if (mode === 'month') {
    const y = parseInt(year, 10)
    const m = parseInt(month, 10)
    const lastDay = new Date(y, m, 0).getDate()
    const mm = String(m).padStart(2, '0')
    return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${lastDay}` }
  }
  return {
    from: customFrom || undefined,
    to: customTo || undefined,
  }
}

// ── 서브 컴포넌트: 섹션 래퍼 ──────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const slug = title.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase()
  return (
    <section aria-labelledby={`section-${slug}`} className="mt-8">
      <h2
        id={`section-${slug}`}
        className="mb-3 text-base font-semibold text-gray-800 border-b border-gray-200 pb-2"
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

// ── 서브 컴포넌트: KPI 카드 ───────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string
  value: string
  sub?: string
  highlight?: 'red' | 'amber' | 'green'
}) {
  const colors = {
    red: 'bg-red-50 border-red-200 text-red-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    green: 'bg-green-50 border-green-200 text-green-700',
  }
  const cls = highlight ? colors[highlight] : 'bg-white border-gray-200 text-gray-800'
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <p className="text-xs font-medium text-current opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs opacity-60">{sub}</p>}
    </div>
  )
}

// ── 서브 컴포넌트: 빈 상태 ────────────────────────────────────────────────────
function Empty({ text = '데이터 없음' }: { text?: string }) {
  return (
    <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-gray-300 text-sm text-gray-400">
      {text}
    </div>
  )
}

// ── 서브 컴포넌트: SLA 진행바 ─────────────────────────────────────────────────
function SlaBar({ label, pct }: { label: string; pct: number | null }) {
  const val = pct != null ? Math.round(pct * 100) : null
  const color = val == null ? 'bg-gray-300' : val >= 90 ? 'bg-green-500' : val >= 70 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-gray-700 font-medium">{label}</span>
        <span className="font-bold text-gray-900">{val != null ? `${val}%` : '-'}</span>
      </div>
      <div
        className="h-3 w-full rounded-full bg-gray-100 overflow-hidden"
        role="progressbar"
        aria-valuenow={val ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} SLA 준수율`}
      >
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: val != null ? `${val}%` : '0%' }}
        />
      </div>
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export function Dashboard() {
  const currentYear = new Date().getFullYear()
  const [mode, setMode] = useState<FilterMode>('year')
  const [year, setYear] = useState(String(currentYear))
  const [month, setMonth] = useState(String(new Date().getMonth() + 1))
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const { from, to } = buildRange(mode, year, month, customFrom, customTo)
  const { data, isLoading, isError } = useDashboardMetrics(from, to)

  // 유형별 월 추이 — 스택 BarChart 데이터 변환
  const volumeChartData = useMemo(() => {
    if (!data) return { rows: [], types: [] }
    const months = [...new Set(data.volumeByType.map((v) => v.month))].sort()
    const types = [...new Set(data.volumeByType.map((v) => v.type_code))]
    const rows = months.map((m) => {
      const row: Record<string, string | number> = { month: m }
      for (const t of types) {
        const entry = data.volumeByType.find((v) => v.month === m && v.type_code === t)
        row[t] = entry?.count ?? 0
      }
      return row
    })
    return { rows, types }
  }, [data])

  // 연도 옵션 (현재 -3 ~ 현재)
  const yearOptions = Array.from({ length: 4 }, (_, i) => String(currentYear - 3 + i))

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-bold text-gray-900">통계 대시보드</h1>

        {/* 기간 필터 */}
        <fieldset className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
          <legend className="sr-only">기간 필터</legend>

          <span className="text-xs text-gray-500 font-medium">기간</span>

          {(['year', 'month', 'custom'] as FilterMode[]).map((m) => (
            <label key={m} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="filterMode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="accent-indigo-600"
              />
              <span>{m === 'year' ? '연도' : m === 'month' ? '월' : '직접 입력'}</span>
            </label>
          ))}

          {(mode === 'year' || mode === 'month') && (
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="rounded border border-gray-200 px-2 py-1 text-xs"
              aria-label="연도"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          )}

          {mode === 'month' && (
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded border border-gray-200 px-2 py-1 text-xs"
              aria-label="월"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{m}월</option>
              ))}
            </select>
          )}

          {mode === 'custom' && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded border border-gray-200 px-2 py-1 text-xs"
                aria-label="시작일"
              />
              <span className="text-gray-400">~</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded border border-gray-200 px-2 py-1 text-xs"
                aria-label="종료일"
              />
            </>
          )}
        </fieldset>
      </div>

      {/* 로딩 */}
      {isLoading && (
        <div className="flex h-40 items-center justify-center text-gray-400 text-sm animate-pulse">
          데이터를 불러오는 중...
        </div>
      )}

      {/* 오류 */}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </div>
      )}

      {data && (
        <>
          {/* ── 열린 이의 배너 ── */}
          {data.kpis.openDisputeCount > 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">
                심사 대기 중인 이의 {data.kpis.openDisputeCount}건
              </p>
              <p className="mt-0.5 text-xs text-amber-800">
                완료 처리된 요청에 요청자가 이의를 제기했습니다. 상세 화면에서 수락 또는 기각해주세요.
              </p>
            </div>
          )}

          {/* ── KPI 카드 ── */}
          <Section title="KPI 현황">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <KpiCard label="미완료" value={String(data.kpis.open)} sub="건" />
              <KpiCard
                label="기한초과+임박"
                value={String(data.kpis.overdueImminent)}
                sub="미완료 중"
                highlight={data.kpis.overdueImminent > 0 ? 'red' : undefined}
              />
              <KpiCard
                label="P1/P2 미완료"
                value={String(data.kpis.p1p2Open)}
                sub="긴급·높음 우선순위"
                highlight={data.kpis.p1p2Open > 0 ? 'amber' : undefined}
              />
              <KpiCard
                label="재작업율"
                value={fmtPct(data.kpis.reworkRate)}
                sub="완료 건 대비"
                highlight={
                  data.kpis.reworkRate != null && data.kpis.reworkRate >= 0.1
                    ? 'amber'
                    : undefined
                }
              />
              <KpiCard
                label="만족도"
                value={fmtPct(data.kpis.csatPositivePct)}
                sub="CSAT 긍정 비율"
                highlight={
                  data.kpis.csatPositivePct != null && data.kpis.csatPositivePct >= 0.8
                    ? 'green'
                    : undefined
                }
              />
              <KpiCard
                label="이의제기율"
                value={fmtPct(data.kpis.disputeRate)}
                sub="완료 건 대비"
                highlight={
                  data.kpis.disputeRate != null && data.kpis.disputeRate >= 0.1
                    ? 'amber'
                    : undefined
                }
              />
              <KpiCard
                label="이의 수락률"
                value={fmtPct(data.kpis.disputeAcceptRate)}
                sub="수락이 높으면 구현 품질, 기각이 높으면 요건 정의 문제"
              />
              <KpiCard
                label="평균 검수 소요일"
                value={data.kpis.avgInspectionDays != null ? `${data.kpis.avgInspectionDays.toFixed(1)}일` : '-'}
                sub="요청자가 확인에 걸리는 시간"
              />
            </div>
            <p className="mt-2 text-xs text-gray-400">
              미완료: 접수·진행중·보류 상태 합계 / 기한초과+임박: due_status 기준 / 재작업율: 완료 건 중 rework_count&gt;0 / 만족도: csat_rating=1 비율 / 이의제기율·수락률: 완료 건 대비 이의제기·수락 비율 / 평균 검수 소요일: 팀 처리 완료 후 최종 확정까지
            </p>
          </Section>

          {/* ── 리드타임 ── */}
          <Section title="리드타임 (중앙값)">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 max-w-sm">
              <KpiCard
                label="1차 응답"
                value={fmtHours(data.leadtime.medianFirstResponseHours)}
                sub="접수→최초 응답"
              />
              <KpiCard
                label="최종 해결"
                value={fmtHours(data.leadtime.medianResolutionHours)}
                sub="접수→완료"
              />
            </div>
            <p className="mt-2 text-xs text-gray-400">
              1차 응답: created_at → first_response_at 중앙값 / 최종 해결: created_at → final_resolved_at 중앙값
            </p>
          </Section>

          {/* ── 노화 히스토그램 ── */}
          <Section title="미완료 건 노화 분포">
            {data.aging.every((b) => b.count === 0) ? (
              <Empty text="미완료 건 없음" />
            ) : (
              <>
                <p className="mb-2 text-xs text-gray-500">
                  미완료 요청의 생성 후 경과일 버켓별 건수 (현재 시각 기준)
                </p>
                <div aria-label="노화 분포 막대 그래프" role="img">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.aging} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(v) => [`${v}건`, '미완료']}
                        labelFormatter={(l) => `경과일: ${l}`}
                      />
                      <Bar dataKey="count" name="미완료 건수" fill="#818cf8" radius={[4, 4, 0, 0]}>
                        {data.aging.map((entry) => (
                          <Cell
                            key={entry.bucket}
                            fill={
                              entry.bucket === '>14d'
                                ? '#f87171'
                                : entry.bucket === '7-14d'
                                ? '#fbbf24'
                                : '#818cf8'
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* 접근성 요약 텍스트 */}
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  {data.aging.map((b) => (
                    <li key={b.bucket}>
                      {b.bucket}: <strong>{b.count}건</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>

          {/* ── SLA 준수율 ── */}
          <Section title="SLA 준수율">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 max-w-lg">
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <SlaBar label="응답 SLA" pct={data.sla.responseCompliancePct} />
                <p className="mt-2 text-xs text-gray-400">
                  response_due_at 내 first_response_at 기록 비율
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <SlaBar label="해결 SLA" pct={data.sla.resolutionCompliancePct} />
                <p className="mt-2 text-xs text-gray-400">
                  resolution_due_at 내 완료 처리 비율
                </p>
              </div>
            </div>
            {data.sla.responseCompliancePct == null && data.sla.resolutionCompliancePct == null && (
              <p className="mt-2 text-xs text-gray-400">SLA 기한이 설정된 요청이 없습니다.</p>
            )}
          </Section>

          {/* ── 분포 차트 ── */}
          <Section title="분포">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
              {/* 상태별 */}
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">상태별</h3>
                {data.distribution.byStatus.length === 0 ? (
                  <Empty />
                ) : (
                  <>
                    <div aria-label="상태별 분포 막대 그래프" role="img">
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart
                          data={data.distribution.byStatus}
                          layout="vertical"
                          margin={{ top: 0, right: 24, left: 8, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                          <YAxis dataKey="status" type="category" width={52} tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(v) => [`${v}건`]} />
                          <Bar dataKey="count" name="건수" radius={[0, 4, 4, 0]}>
                            {data.distribution.byStatus.map((entry) => (
                              <Cell
                                key={entry.status}
                                fill={STATUS_COLORS[entry.status] ?? '#94a3b8'}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                      {data.distribution.byStatus.map((e) => (
                        <li key={e.status}>{e.status}: <strong>{e.count}</strong></li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {/* 기관별 */}
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">기관별</h3>
                {data.distribution.byOrg.length === 0 ? (
                  <Empty />
                ) : (
                  <>
                    <div aria-label="기관별 분포 원형 그래프" role="img">
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie
                            data={data.distribution.byOrg}
                            dataKey="count"
                            nameKey="org"
                            cx="50%"
                            cy="50%"
                            outerRadius={70}
                            label={(props) => {
                              const p = props as { org?: string; percent?: number }
                              return `${p.org ?? ''} ${(((p.percent) ?? 0) * 100).toFixed(0)}%`
                            }}
                            labelLine={false}
                          >
                            {data.distribution.byOrg.map((entry, i) => (
                              <Cell key={entry.org} fill={PALETTE[i % PALETTE.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v) => [`${v}건`]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                      {data.distribution.byOrg.map((e) => (
                        <li key={e.org}>{e.org}: <strong>{e.count}</strong></li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {/* 유형별 */}
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">유형별</h3>
                {data.distribution.byType.length === 0 ? (
                  <Empty />
                ) : (
                  <>
                    <div aria-label="유형별 분포 막대 그래프" role="img">
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart
                          data={data.distribution.byType}
                          layout="vertical"
                          margin={{ top: 0, right: 24, left: 8, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                          <YAxis dataKey="label" type="category" width={72} tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(v) => [`${v}건`]} />
                          <Bar dataKey="count" name="건수" fill="#22d3ee" radius={[0, 4, 4, 0]}>
                            {data.distribution.byType.map((_, i) => (
                              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                      {data.distribution.byType.map((e) => (
                        <li key={e.type_code}>{e.label}: <strong>{e.count}</strong></li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {/* 완료 경로 */}
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-gray-900">완료 경로</h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  자동완료 비중이 크면 요청자가 검수를 하지 않고 있다는 신호입니다.
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  <li className="flex justify-between">
                    <span className="text-gray-700">요청자 확인</span>
                    <span className="font-medium text-green-700">{data.kpis.completionRoutes.REQUESTER}건</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-gray-700">자동 완료 (무응답)</span>
                    <span className="font-medium text-amber-700">{data.kpis.completionRoutes.AUTO}건</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-gray-700">시스템팀 강제 완료</span>
                    <span className="font-medium text-gray-700">{data.kpis.completionRoutes.SYSTEM_FORCED}건</span>
                  </li>
                </ul>
              </div>
            </div>
          </Section>

          {/* ── 유형별 월 추이 ── */}
          <Section title="유형별 월 추이">
            {volumeChartData.rows.length === 0 ? (
              <Empty text="기간 내 데이터 없음" />
            ) : (
              <>
                <p className="mb-2 text-xs text-gray-500">월별 유형 접수 건수 (스택)</p>
                <div aria-label="유형별 월 추이 스택 막대 그래프" role="img">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart
                      data={volumeChartData.rows}
                      margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      {volumeChartData.types.map((type, i) => (
                        <Bar
                          key={type}
                          dataKey={type}
                          stackId="a"
                          fill={PALETTE[i % PALETTE.length]}
                          radius={i === volumeChartData.types.length - 1 ? [4, 4, 0, 0] : undefined}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* 접근성 요약: 최근 3개월 */}
                <p className="mt-2 text-xs text-gray-400">
                  유형 범례: {volumeChartData.types.join(' / ')}
                </p>
              </>
            )}
          </Section>

          {/* ── 담당자별 처리 현황 ── */}
          <Section title="담당자별 처리 현황">
            {data.byAssignee.length === 0 ? (
              <Empty text="배정된 요청 없음" />
            ) : (
              <>
                <p className="mb-2 text-xs text-gray-500">
                  기간 내 배정 건 기준 — 열린 건(미완료) / 완료 건
                </p>

                {/* 막대 그래프 */}
                <div aria-label="담당자별 처리 현황 막대 그래프" role="img">
                  <ResponsiveContainer width="100%" height={Math.max(160, data.byAssignee.length * 36)}>
                    <BarChart
                      data={data.byAssignee.map((a) => ({
                        name: a.name ?? a.assignee_id,
                        열린건: a.openCount,
                        완료: a.resolvedCount,
                      }))}
                      layout="vertical"
                      margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" width={72} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="열린건" fill="#818cf8" radius={[0, 2, 2, 0]} />
                      <Bar dataKey="완료" fill="#34d399" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* 접근성: 표 */}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm border-collapse" aria-label="담당자별 처리 현황 표">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th scope="col" className="py-2 px-3 text-left font-medium text-gray-600">담당자</th>
                        <th scope="col" className="py-2 px-3 text-right font-medium text-gray-600">열린 건</th>
                        <th scope="col" className="py-2 px-3 text-right font-medium text-gray-600">완료</th>
                        <th scope="col" className="py-2 px-3 text-right font-medium text-gray-600">합계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byAssignee.map((a) => (
                        <tr key={a.assignee_id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 text-gray-800">{a.name ?? a.assignee_id}</td>
                          <td className="py-2 px-3 text-right text-indigo-600 font-medium">{a.openCount}</td>
                          <td className="py-2 px-3 text-right text-green-600 font-medium">{a.resolvedCount}</td>
                          <td className="py-2 px-3 text-right text-gray-700">{a.openCount + a.resolvedCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
