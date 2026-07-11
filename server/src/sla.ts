/**
 * SLA 업무시간 헬퍼 및 우선순위 격자
 * KST(Asia/Seoul) 기준 근무일 월~금 09:00~18:00
 */

export type Urgency = '높음' | '보통' | '낮음'
export type Impact = '높음' | '보통' | '낮음'
export type PriorityLevel = 'P1' | 'P2' | 'P3' | 'P4'

/**
 * 우선순위 격자 (곱셈 아님):
 * impact 높음 & urgency 높음 = P1
 * impact 높음 & urgency 보통 = P2
 * impact 높음 & urgency 낮음 = P3
 * impact 보통 & urgency 높음 = P2
 * impact 보통 & urgency 보통 = P3
 * impact 보통 & urgency 낮음 = P4
 * impact 낮음 & urgency 높음 = P3
 * 그 외 (낮음 & 보통, 낮음 & 낮음) = P4
 */
export function derivePriority(urgency: Urgency, impact: Impact): PriorityLevel {
  if (impact === '높음' && urgency === '높음') return 'P1'
  if (impact === '높음' && urgency === '보통') return 'P2'
  if (impact === '높음' && urgency === '낮음') return 'P3'
  if (impact === '보통' && urgency === '높음') return 'P2'
  if (impact === '보통' && urgency === '보통') return 'P3'
  if (impact === '보통' && urgency === '낮음') return 'P4'
  if (impact === '낮음' && urgency === '높음') return 'P3'
  return 'P4'
}

/**
 * 응답 SLA 정책 선택용 레벨 (urgency 단독)
 * 높음 → P2, 보통 → P3, 낮음 → P4
 */
export function urgencyResponseLevel(urgency: Urgency): 'P2' | 'P3' | 'P4' {
  if (urgency === '높음') return 'P2'
  if (urgency === '보통') return 'P3'
  return 'P4'
}

// KST offset: UTC+9
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** Date를 KST 기준 { year, month(1-based), day, hour, minute, weekday(0=일) }로 분해 */
function toKST(d: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const kst = new Date(d.getTime() + KST_OFFSET_MS)
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,
    day: kst.getUTCDate(),
    hour: kst.getUTCHours(),
    minute: kst.getUTCMinutes(),
    weekday: kst.getUTCDay(), // 0=일, 1=월, ..., 6=토
  }
}

/** KST 날짜·시각을 UTC Date로 변환 */
function fromKST(year: number, month: number, day: number, hour: number, minute: number): Date {
  // UTC Date for KST time = KST time - 9h
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - KST_OFFSET_MS)
}

/** 'YYYY-MM-DD' 포맷 문자열 생성 (KST 기준) */
function toDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** KST 기준으로 날짜를 하루 앞으로 */
function nextDay(year: number, month: number, day: number): { year: number; month: number; day: number; weekday: number } {
  const d = new Date(Date.UTC(year, month - 1, day + 1))
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
  }
}

const WORK_START_HOUR = 9
const WORK_END_HOUR = 18
const WORK_MINUTES_PER_DAY = (WORK_END_HOUR - WORK_START_HOUR) * 60 // 540

/**
 * KST 근무시간(월~금 09:00~18:00)에서 minutes 근무분을 더한 시각 반환.
 * 주말·holidays('YYYY-MM-DD' 문자열 집합) 스킵.
 * 근무시간 밖이면 다음 근무일 09:00로 이동 후 가산.
 */
export function addBusinessMinutes(from: Date, minutes: number, holidays: Set<string>): Date {
  let { year, month, day, hour, minute, weekday } = toKST(from)

  /** 현재 (year, month, day, weekday)가 근무일인지 확인 */
  function isWorkday(y: number, m: number, d: number, wd: number): boolean {
    if (wd === 0 || wd === 6) return false // 일,토
    const ds = toDateString(y, m, d)
    if (holidays.has(ds)) return false
    return true
  }

  /** 현재 위치가 근무시간 범위 내인지, 아니면 다음 근무일 09:00로 이동 */
  function moveToWorkTime(y: number, m: number, d: number, wd: number, h: number, min: number): { year: number; month: number; day: number; weekday: number; hour: number; minute: number } {
    // 근무일이 아니거나 근무 시작 전이면 다음 근무일 09:00
    // 근무 종료 후(18:00 이후)이면 다음 근무일 09:00
    while (true) {
      if (isWorkday(y, m, d, wd)) {
        if (h < WORK_START_HOUR) {
          // 오전: 당일 09:00로 이동
          return { year: y, month: m, day: d, weekday: wd, hour: WORK_START_HOUR, minute: 0 }
        }
        if (h < WORK_END_HOUR) {
          // 근무 중
          return { year: y, month: m, day: d, weekday: wd, hour: h, minute: min }
        }
        // 18:00 이후: 다음 날로
      }
      // 다음 날 09:00로
      const nd = nextDay(y, m, d)
      y = nd.year; m = nd.month; d = nd.day; wd = nd.weekday
      h = WORK_START_HOUR; min = 0
    }
  }

  // 시작 위치를 근무시간 내로 정규화
  const pos = moveToWorkTime(year, month, day, weekday, hour, minute)
  year = pos.year; month = pos.month; day = pos.day; weekday = pos.weekday
  hour = pos.hour; minute = pos.minute

  let remaining = minutes

  while (remaining > 0) {
    // 당일 남은 근무 분
    const minutesLeftToday = (WORK_END_HOUR * 60) - (hour * 60 + minute)

    if (remaining <= minutesLeftToday) {
      const totalMin = hour * 60 + minute + remaining
      hour = Math.floor(totalMin / 60)
      minute = totalMin % 60
      remaining = 0
    } else {
      remaining -= minutesLeftToday
      // 다음 근무일 09:00로 이동
      const nd = nextDay(year, month, day)
      year = nd.year; month = nd.month; day = nd.day; weekday = nd.weekday
      hour = WORK_START_HOUR; minute = 0

      // 근무일이 될 때까지 스킵
      while (!isWorkday(year, month, day, weekday)) {
        const nd2 = nextDay(year, month, day)
        year = nd2.year; month = nd2.month; day = nd2.day; weekday = nd2.weekday
      }
    }
  }

  return fromKST(year, month, day, hour, minute)
}
