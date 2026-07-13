import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './client.js'
import { backfillRoles } from './backfill-roles.js'

await migrate(db, { migrationsFolder: './drizzle' })
console.log('migrations applied')

// 마이그레이션 트랜잭션 커밋 후 별도로 실행 — backfill-roles.ts 상단 주석 참조
// (ALTER TYPE ADD VALUE로 추가한 enum 값은 같은 트랜잭션에서 쓸 수 없음)
await backfillRoles()
console.log('role backfill applied')

await pool.end()
