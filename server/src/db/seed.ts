import { pool, db } from './client.js'
import { users, orgDirectory, requestTypes } from './schema.js'
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

  const res = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from users`,
  )
  console.log(`seed done. users=${res.rows[0]?.count}`)
  await pool.end()
}

seed().catch((e) => { console.error(e); process.exit(1) })
