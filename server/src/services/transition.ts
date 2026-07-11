import { sql } from 'drizzle-orm'
import { db, withUser } from '../db/client.js'

export type RequestStatus = '접수' | '진행중' | '보류' | '완료' | '반려' | '철회'

/** 허용된 상태 전이 맵 */
const ALLOWED: Record<RequestStatus, RequestStatus[]> = {
  '접수':  ['진행중', '반려', '철회'],
  '진행중': ['완료', '보류', '반려'],
  '보류':  ['진행중'],
  '완료':  ['진행중'],
  '반려':  [],
  '철회':  [],
}

export class TransitionError extends Error {
  code: string
  constructor(msg: string, code: string) {
    super(msg)
    this.code = code
  }
}

/**
 * 요청 상태 전이 서비스.
 * completed_at / first_resolved_at / final_resolved_at / rework_count / sla_resolution_breached 는
 * on_status_change 트리거가 처리하므로 이 서비스에서는 건드리지 않는다.
 */
export async function changeStatus({
  reqId,
  to,
  reason,
  actorId,
}: {
  reqId: number
  to: RequestStatus
  reason?: string
  actorId: string
}): Promise<void> {
  // 현재 status 조회
  const cur = await db.execute<{ status: RequestStatus }>(
    sql`select status from requests where id = ${reqId}`,
  )
  const row = cur.rows[0]
  if (!row) {
    throw new TransitionError('요청을 찾을 수 없습니다', 'NOT_FOUND')
  }
  const from = row.status

  // 전이 허용 여부 검증
  if (!ALLOWED[from]?.includes(to)) {
    throw new TransitionError(
      `${from} → ${to} 전이는 허용되지 않습니다`,
      'ILLEGAL_TRANSITION',
    )
  }

  // reason 컬럼 결정 (대상 상태일 때만 세팅)
  const sets: ReturnType<typeof sql>[] = [sql`status = ${to}`]
  if (to === '보류' && reason != null) {
    sets.push(sql`hold_reason = ${reason}`)
  } else if (to === '반려' && reason != null) {
    sets.push(sql`reject_reason = ${reason}`)
  } else if (to === '진행중' && from === '완료' && reason != null) {
    // 완료→진행중 재작업 사유
    sets.push(sql`rework_reason = ${reason}`)
  }

  await withUser(actorId, (tx) =>
    tx.execute(sql`
      update requests
      set ${sql.join(sets, sql`, `)}
      where id = ${reqId}
    `),
  )
}
