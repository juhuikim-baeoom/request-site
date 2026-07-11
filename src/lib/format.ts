// 날짜/시간 포맷 유틸
// timestamptz(created_at 등)는 UTC로 오므로 한국표준시(Asia/Seoul)로 변환해 표시.
// date 컬럼(desired_due 등)은 달력 날짜라 변환 없이 그대로 사용.

const KST = 'Asia/Seoul'

/** date 컬럼용: 'YYYY-MM-DD' (타임존 변환 없음) */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return '-'
  return s.slice(0, 10)
}

/** timestamptz용: 한국표준시 기준 'YYYY-MM-DD HH:MM' */
export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '-'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s.slice(0, 16).replace('T', ' ')

  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}
