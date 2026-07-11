import { pool, db } from './client.js'
import { users, orgDirectory, requestTypes, slaPolicy, holidays } from './schema.js'
import { sql } from 'drizzle-orm'

async function seed() {
  // 요청 유형
  await db.insert(requestTypes).values([
    { code: 'error', label: '오류', sortOrder: 1 },
    { code: 'feature', label: '기능요청', sortOrder: 2 },
    { code: 'data', label: '데이터추출', sortOrder: 3 },
    { code: 'file', label: '파일변경', sortOrder: 4 },
  ]).onConflictDoNothing()

  // 조직도 사전등록 — 김주희
  await db.insert(orgDirectory).values({
    email: 'juhuikim@baeoom.com',
    name: '김주희',
    dept: '시스템팀',
    orgAffil: '공통',
    deptFunction: '시스템팀',
    role: 'system',
    synced: true,
  }).onConflictDoNothing()

  // 사용자 — 김주희 (dev-login 대상)
  await db.insert(users).values({
    email: 'juhuikim@baeoom.com',
    name: '김주희',
    dept: '시스템팀',
    orgAffil: '공통',
    deptFunction: '시스템팀',
    role: 'system',
  }).onConflictDoNothing()

  // SLA 정책 4행
  await db.insert(slaPolicy).values([
    { priorityLevel: 'P1', responseMinutes: 120, resolutionMinutes: 480 },
    { priorityLevel: 'P2', responseMinutes: 240, resolutionMinutes: 960 },
    { priorityLevel: 'P3', responseMinutes: 480, resolutionMinutes: 1920 },
    { priorityLevel: 'P4', responseMinutes: 960, resolutionMinutes: null },
  ]).onConflictDoNothing()

  // 공휴일 1행
  await db.insert(holidays).values([
    { holidayOn: '2026-01-01', label: '신정' },
  ]).onConflictDoNothing()

  const res = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from users`,
  )
  console.log(`seed done. users=${res.rows[0]?.count}`)
  await pool.end()
}

seed().catch((e) => { console.error(e); process.exit(1) })
