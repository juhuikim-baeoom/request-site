import { eq } from 'drizzle-orm'
import { db } from './client.js'
import { users, orgDirectory, roleBackfillHistory } from './schema.js'

/** 이 백필의 고유 키 — role_backfill_history에 이 값으로 1행이 존재하면 "이미 적용됨"으로 간주한다. */
const BACKFILL_KEY = 'role_model_v1'

/**
 * 역할 모델 정교화 데이터 이전 — 최초 1회만 실행되는 백필.
 *
 * `0005_role_model_add_values.sql`이 `ALTER TYPE user_role ADD VALUE`로 dept_monitor·
 * org_monitor·exec·system_admin을 추가했다. Postgres는 이 방식으로 추가한 enum 값을
 * "같은 트랜잭션" 안에서 사용(SELECT/UPDATE 등)할 수 없고, drizzle-orm 마이그레이터는
 * 대기 중인 모든 마이그레이션 파일을 단일 트랜잭션으로 묶어 실행하므로, 새 값을
 * 사용하는 데이터 이전은 마이그레이션 파일이 아니라 여기(마이그레이션 트랜잭션이
 * 커밋된 뒤 별도로 실행되는 백필)에 둔다.
 *
 * `migrate.ts`는 `npm run db:migrate`(= 배포마다) 때마다 이 함수를 호출한다. 만약 매번
 * 무조건 UPDATE를 실행하면, 관리자가 계정 관리 화면에서 juhuikim@baeoom.com의 역할을
 * 다른 값으로 바꿔도 다음 배포에서 이메일 조건만 보고 system_admin으로 되돌려 버린다
 * (viewer → exec 이전도 같은 문제 소지). 그래서 `role_backfill_history`에 `BACKFILL_KEY`를
 * 원자적으로 claim(INSERT ... ON CONFLICT DO NOTHING RETURNING)한 뒤, claim에 성공했을 때만
 * (= 이 DB에서 처음 실행될 때만) 실제 UPDATE를 수행한다. 이미 적용된 DB에서 재실행하면
 * claim이 0행을 반환해 UPDATE 자체를 건너뛰므로, 이후 수동으로 바뀐 역할이 되살아나지 않는다.
 * claim과 UPDATE를 한 트랜잭션으로 묶어, UPDATE가 실패하면 claim도 커밋되지 않는다(원자성).
 */
export async function backfillRoles(): Promise<void> {
  const applied = await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(roleBackfillHistory)
      .values({ backfillKey: BACKFILL_KEY })
      .onConflictDoNothing()
      .returning()

    if (claimed.length === 0) {
      // 이미 이 DB에 적용된 백필 — 대상 행이 없어서가 아니라, 다시 실행하면 안 되므로 스킵한다.
      return false
    }

    // viewer → exec (전체 열람 + 통계, 쓰기 없음 — 성격이 동일)
    await tx.update(users).set({ role: 'exec' }).where(eq(users.role, 'viewer'))
    await tx.update(orgDirectory).set({ role: 'exec' }).where(eq(orgDirectory.role, 'viewer'))

    // juhuikim@baeoom.com → system_admin (유일한 초기 관리자)
    await tx.update(users).set({ role: 'system_admin' }).where(eq(users.email, 'juhuikim@baeoom.com'))
    await tx
      .update(orgDirectory)
      .set({ role: 'system_admin' })
      .where(eq(orgDirectory.email, 'juhuikim@baeoom.com'))

    return true
  })

  console.log(
    applied
      ? `role backfill applied (${BACKFILL_KEY})`
      : `role backfill skipped — already applied (${BACKFILL_KEY})`,
  )
}
