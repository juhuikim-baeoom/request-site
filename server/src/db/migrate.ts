import { readMigrationFiles } from 'drizzle-orm/migrator'
import { pool } from './client.js'
import { backfillRoles } from './backfill-roles.js'
import { countSystemAdmins } from './admin-check.js'

/**
 * 마이그레이션을 파일별 개별 트랜잭션으로 적용한다.
 *
 * drizzle 기본 migrate()는 대기 중인 모든 마이그레이션을 하나의 트랜잭션으로 실행한다.
 * 그러면 `ALTER TYPE ... ADD VALUE`(enum 값 추가)와 그 값을 참조하는 뷰·트리거·CHECK가
 * 같은 트랜잭션에 묶여 Postgres가 55P04 "unsafe use of new value of enum type"으로 거부한다
 * (새 enum 값은 커밋된 뒤에야 쓸 수 있다). 예: 0010이 `검수대기`를 추가하고 0011이
 * request_view/트리거에서 그 값을 쓴다.
 *
 * 파일별로 커밋하면 enum 값이 사용 마이그레이션 전에 커밋되므로 문제가 사라진다.
 * drizzle의 __drizzle_migrations 추적 테이블 형식(hash·created_at)과 순서 판정
 * (created_at < folderMillis)을 그대로 따라 호환성을 유지한다.
 */
async function migratePerFile(): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: './drizzle' })

  await pool.query('create schema if not exists drizzle')
  await pool.query(`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `)

  const last = await pool.query<{ created_at: string }>(
    'select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1',
  )
  const lastApplied = last.rows[0] ? Number(last.rows[0].created_at) : 0

  let applied = 0
  for (const migration of migrations) {
    if (migration.folderMillis <= lastApplied) continue
    const client = await pool.connect()
    try {
      await client.query('begin')
      for (const stmt of migration.sql) {
        await client.query(stmt)
      }
      await client.query(
        'insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)',
        [migration.hash, migration.folderMillis],
      )
      await client.query('commit')
      applied++
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
  }
  console.log(`migrations applied (파일별 트랜잭션): ${applied}건`)
}

await migratePerFile()
console.log('migrations applied')

// 마이그레이션 트랜잭션 커밋 후 별도로 실행 — backfill-roles.ts 상단 주석 참조
// (ALTER TYPE ADD VALUE로 추가한 enum 값은 같은 트랜잭션에서 쓸 수 없음)
// backfillRoles()가 적용/스킵 여부를 자체적으로 로그로 남긴다(최초 1회만 적용).
await backfillRoles()

// 부트스트랩 사후 점검(경고만) — 공식 배포 순서는 db:migrate → db:seed이므로, 깨끗한 DB에서는
// 이 시점에 users가 아직 비어 있어(seed 전) system_admin=0이 정상이다. 여기서는 실패시키지
// 않고 눈에 띄는 경고만 남긴다 — 확정적 점검(실패 처리)은 db:seed 완료 후(seed.ts)에서 한다.
// 이미 seed까지 끝난 기존 DB에서 migrate만 재실행했는데 0명이면(예: 누군가 관리자를 실수로
// 강등해 role_backfill_history도 이미 claim된 상태) 여기서 바로 알아챌 수 있다.
const adminCountAfterMigrate = await countSystemAdmins()
if (adminCountAfterMigrate < 1) {
  console.warn(
    '⚠️  system_admin이 0명입니다. 깨끗한 DB라면 곧 실행할 npm run db:seed가 juhuikim@baeoom.com을 ' +
    'system_admin으로 만듭니다. 이미 seed까지 마친 DB인데도 이 경고가 보이면 계정 관리(PATCH ' +
    '/api/users/:id, 조직도 import)가 전부 막혀 있다는 뜻이니 DB에서 직접 확인하세요.',
  )
}

await pool.end()
