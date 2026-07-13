import { eq } from 'drizzle-orm'
import { db } from './client.js'
import { users, orgDirectory } from './schema.js'

/**
 * 역할 모델 정교화 데이터 이전 — 멱등 백필.
 *
 * `0005_role_model_add_values.sql`이 `ALTER TYPE user_role ADD VALUE`로 dept_monitor·
 * org_monitor·exec·system_admin을 추가했다. Postgres는 이 방식으로 추가한 enum 값을
 * "같은 트랜잭션" 안에서 사용(SELECT/UPDATE 등)할 수 없고, drizzle-orm 마이그레이터는
 * 대기 중인 모든 마이그레이션 파일을 단일 트랜잭션으로 묶어 실행하므로, 새 값을
 * 사용하는 데이터 이전은 마이그레이션 파일이 아니라 여기(마이그레이션 트랜잭션이
 * 커밋된 뒤 별도로 실행되는 백필)에 둔다.
 *
 * 여러 번 실행해도 안전하다 — 이미 이전된 DB에서 재실행해도 대상 행이 없어 무해하다.
 */
export async function backfillRoles(): Promise<void> {
  // viewer → exec (전체 열람 + 통계, 쓰기 없음 — 성격이 동일)
  await db.update(users).set({ role: 'exec' }).where(eq(users.role, 'viewer'))
  await db.update(orgDirectory).set({ role: 'exec' }).where(eq(orgDirectory.role, 'viewer'))

  // juhuikim@baeoom.com → system_admin (유일한 초기 관리자)
  await db.update(users).set({ role: 'system_admin' }).where(eq(users.email, 'juhuikim@baeoom.com'))
  await db.update(orgDirectory).set({ role: 'system_admin' }).where(eq(orgDirectory.email, 'juhuikim@baeoom.com'))
}
