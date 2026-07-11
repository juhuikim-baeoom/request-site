import assert from 'node:assert/strict'
import { derivePriority, addBusinessMinutes, urgencyResponseLevel } from '../src/sla.js'

// ────────────────────────────────────────
// (1) derivePriority 격자 테스트
// ────────────────────────────────────────
assert.equal(derivePriority('높음', '높음'), 'P1', 'impact 높음 & urgency 높음 = P1')
assert.equal(derivePriority('보통', '높음'), 'P2', 'impact 높음 & urgency 보통 = P2')
assert.equal(derivePriority('낮음', '높음'), 'P3', 'impact 높음 & urgency 낮음 = P3')
assert.equal(derivePriority('높음', '보통'), 'P2', 'impact 보통 & urgency 높음 = P2')
assert.equal(derivePriority('보통', '보통'), 'P3', 'impact 보통 & urgency 보통 = P3')
assert.equal(derivePriority('낮음', '보통'), 'P4', 'impact 보통 & urgency 낮음 = P4')
assert.equal(derivePriority('높음', '낮음'), 'P3', 'impact 낮음 & urgency 높음 = P3')
assert.equal(derivePriority('보통', '낮음'), 'P4', 'impact 낮음 & urgency 보통 = P4')
assert.equal(derivePriority('낮음', '낮음'), 'P4', 'impact 낮음 & urgency 낮음 = P4')
console.log('derivePriority 격자 OK')

// urgencyResponseLevel
assert.equal(urgencyResponseLevel('높음'), 'P2')
assert.equal(urgencyResponseLevel('보통'), 'P3')
assert.equal(urgencyResponseLevel('낮음'), 'P4')
console.log('urgencyResponseLevel OK')

// ────────────────────────────────────────
// (2) addBusinessMinutes 테스트
// KST = UTC+9 이므로 KST 09:00 = UTC 00:00
// ────────────────────────────────────────

const noHolidays = new Set<string>()

// 케이스 1: 화요일 KST 09:00 + 60분 = 화요일 KST 10:00
// 2026-07-07 화요일 (2026-07-07)
const tue0900kst = new Date('2026-07-07T00:00:00Z') // KST 09:00
const tue1000kst = addBusinessMinutes(tue0900kst, 60, noHolidays)
const expected1 = new Date('2026-07-07T01:00:00Z') // KST 10:00
assert.equal(tue1000kst.getTime(), expected1.getTime(),
  `화 09:00+60분 = 화 10:00 (KST). got=${tue1000kst.toISOString()}`)
console.log('케이스1 화 09:00+60분 = 화 10:00 OK')

// 케이스 2: 금요일 KST 17:00 + 120분 → 월요일 KST 10:00
// 2026-07-10 금요일 17:00 KST = UTC 08:00
// 남은 근무분: 18:00-17:00 = 60분, 그 후 60분은 월요일 09:00부터
// → 월요일 10:00 KST
const fri1700kst = new Date('2026-07-10T08:00:00Z') // KST 17:00
const mon1000kst = addBusinessMinutes(fri1700kst, 120, noHolidays)
// 2026-07-13 월요일 10:00 KST = UTC 01:00
const expected2 = new Date('2026-07-13T01:00:00Z')
assert.equal(mon1000kst.getTime(), expected2.getTime(),
  `금 17:00+120분 = 월 10:00 (KST). got=${mon1000kst.toISOString()}`)
console.log('케이스2 금 17:00+120분 = 월 10:00 OK')

// 케이스 3: 공휴일(2026-01-01 목요일) 스킵
// 2025-12-31 수요일 17:00 KST + 120분
// 남은 60분으로 당일 18:00, 남은 60분 → 다음 근무일 = 2026-01-02 금요일 09:00+60분 = 10:00
const holidays = new Set(['2026-01-01'])
// 2025-12-31 수요일 17:00 KST = UTC 08:00
const wed1700kst = new Date('2025-12-31T08:00:00Z')
const afterHoliday = addBusinessMinutes(wed1700kst, 120, holidays)
// 2026-01-02 금요일 10:00 KST = UTC 01:00
const expected3 = new Date('2026-01-02T01:00:00Z')
assert.equal(afterHoliday.getTime(), expected3.getTime(),
  `공휴일(2026-01-01) 스킵: 수 17:00+120분 = 금 10:00 (KST). got=${afterHoliday.toISOString()}`)
console.log('케이스3 공휴일 스킵 OK')

console.log('\ntest:sla ALL PASSED')
