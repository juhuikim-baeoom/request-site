import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'

/**
 * 알림 생성 헬퍼.
 * best-effort: 실패해도 주 트랜잭션을 막지 않는다.
 */
export async function notify(
  userId: string,
  type: 'assigned' | 'status' | 'comment' | 'dispute',
  requestId: number,
  message: string,
): Promise<void> {
  try {
    await db.execute(sql`
      insert into notifications (user_id, type, request_id, message)
      values (${userId}, ${type}, ${requestId}, ${message})
    `)
  } catch (err) {
    // 알림 실패는 로깅만 하고 무시
    console.error('[notify] failed to insert notification:', err)
  }
}
