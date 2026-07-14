import { pool, db } from './client.js'
import { users, orgDirectory, requestTypes, slaPolicy, holidays } from './schema.js'
import { sql } from 'drizzle-orm'
import { countSystemAdmins } from './admin-check.js'

async function seed() {
  // 요청 유형
  await db.insert(requestTypes).values([
    { code: 'error', label: '오류', sortOrder: 1 },
    { code: 'feature', label: '기능요청', sortOrder: 2 },
    { code: 'data', label: '데이터추출', sortOrder: 3 },
    { code: 'file', label: '파일변경', sortOrder: 4 },
  ]).onConflictDoNothing()

  // 조직도 사전등록 — 김주희 (시스템팀 최초 관리자 — role='system_admin'이어야
  // 깨끗한 DB에서도 계정 관리 화면에 처음부터 접근 가능하다. backfill-roles.ts는
  // 이 seed 이전 버전(role='system')으로 이미 배포된 기존 DB를 위한 이전 경로다.)
  await db.insert(orgDirectory).values({
    email: 'juhuikim@baeoom.com',
    name: '김주희',
    dept: '시스템팀',
    orgAffil: '공통',
    deptFunction: '시스템팀',
    role: 'system_admin',
    synced: true,
  }).onConflictDoNothing()

  // 사용자 — 김주희 (dev-login 대상, 최초 system_admin)
  await db.insert(users).values({
    email: 'juhuikim@baeoom.com',
    name: '김주희',
    dept: '시스템팀',
    orgAffil: '공통',
    deptFunction: '시스템팀',
    role: 'system_admin',
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

  // 부트스트랩 사후 점검 — 공식 배포 순서(db:migrate → db:seed)의 마지막 단계.
  // 이 시점에도 system_admin이 0명이면 계정 관리가 앱 안에서 영구히 잠긴다(DB 직접
  // SQL 없이는 복구 불가) — 조용히 넘기지 않고 실패시켜 배포 파이프라인이 잡게 한다.
  const adminCount = await countSystemAdmins()
  if (adminCount < 1) {
    throw new Error(
      `부트스트랩 실패: system_admin이 0명입니다. juhuikim@baeoom.com이 users 테이블에 ` +
      `system_admin으로 존재하는지 확인하세요(onConflictDoNothing으로 인해 기존 행이 다른 ` +
      `role로 이미 있으면 삽입되지 않습니다). 계정 관리 API(PATCH /api/users/:id, ` +
      `조직도 import)가 전부 system_admin 전용이라 이 상태에서는 앱 안에서 복구할 방법이 없습니다.`,
    )
  }
  console.log(`bootstrap check ok — system_admin=${adminCount}`)

  await pool.end()
}

seed().catch((e) => { console.error(e); process.exit(1) })
