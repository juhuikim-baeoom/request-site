import { sql } from 'drizzle-orm'
import { db } from './client.js'

/**
 * system_admin 부트스트랩 사후 점검.
 *
 * PATCH /api/users/:id(계정·역할 변경)와 조직도 import는 모두 canManageAccounts
 * (=system_admin 전용)로 게이트되어 있다 — 즉 system_admin이 0명이면 **앱 안에서
 * 첫 관리자를 만들 방법이 없다**(DB 직접 SQL 말고는 복구 불가). 배포 순서(db:migrate →
 * db:seed)가 조금이라도 어긋나거나, seed.ts의 onConflictDoNothing이 예상과 다르게
 * 동작하거나(예: 기존 행이 이미 다른 role로 존재), backfill이 스킵되는 등으로 이 상태에
 * 조용히 빠지는 것을 막기 위해 각 부트스트랩 단계 뒤에 호출한다.
 */
export async function countSystemAdmins(): Promise<number> {
  const res = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from users where role = 'system_admin'`,
  )
  return res.rows[0]?.count ?? 0
}
