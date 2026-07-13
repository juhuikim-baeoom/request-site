import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './client.js'
import { backfillRoles } from './backfill-roles.js'
import { countSystemAdmins } from './admin-check.js'

await migrate(db, { migrationsFolder: './drizzle' })
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
