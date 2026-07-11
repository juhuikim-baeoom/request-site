import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { env } from '../env.js'
import * as schema from './schema.js'

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL })
export const db = drizzle(pool, { schema })

/** 트랜잭션 내에서 app.user_id 세션변수를 세팅해 트리거(on_status_change)가 변경자를 인식하게 함 */
export async function withUser<T>(
  userId: string | null,
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId ?? ''}, true)`)
    return fn(tx as unknown as typeof db)
  })
}
