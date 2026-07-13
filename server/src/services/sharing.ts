import { sql } from 'drizzle-orm'
import { withUser } from '../db/client.js'

export type Visibility = 'private' | 'dept' | 'function' | 'org' | 'shared'
// interface가 아닌 type alias — drizzle의 execute<T extends Record<string, unknown>> 제약은
// 명시적 index signature가 없는 interface를 만족하지 못한다(암묵적 index signature는 object type
// literal에만 적용). type alias는 object type literal로 취급되어 제약을 만족한다.
export type SharedTarget = {
  target_type: 'function' | 'dept'
  target_value: string
}

export class SharingError extends Error {
  code: string
  constructor(msg: string, code: string) {
    super(msg)
    this.code = code
  }
}

/** 목록 비교용 키 */
const key = (t: SharedTarget) => `${t.target_type}|${t.target_value}`

/**
 * 공유 설정을 전체 교체한다. 넘긴 targets가 곧 최종 상태이므로 추가·제거가 한 번에 처리된다.
 * added/removed는 서버가 기존 목록과 비교해 계산한다 — 클라이언트가 보낸 값을 믿지 않는다.
 *
 * TOCTOU 방지: SELECT … FOR UPDATE로 요청 행을 잠근 뒤 같은 트랜잭션에서 교체·이력 기록.
 */
export async function changeSharing({
  reqId,
  visibility,
  targets,
  actorId,
}: {
  reqId: number
  visibility: Visibility
  targets: SharedTarget[]
  actorId: string
}): Promise<void> {
  await withUser(actorId, async (tx) => {
    const cur = await tx.execute<{ visibility: string }>(
      sql`select visibility from requests where id = ${reqId} for update`,
    )
    const row = cur.rows[0]
    if (!row) throw new SharingError('요청을 찾을 수 없습니다', 'NOT_FOUND')

    const prevRes = await tx.execute<SharedTarget>(sql`
      select target_type, target_value from request_shared_targets where request_id = ${reqId}`)
    const prev = prevRes.rows

    const prevKeys = new Set(prev.map(key))
    const nextKeys = new Set(targets.map(key))
    const added = targets.filter((t) => !prevKeys.has(key(t)))
    const removed = prev.filter((t) => !nextKeys.has(key(t)))
    const visibilityChanged = row.visibility !== visibility

    // 공개범위·공유대상이 둘 다 그대로면 아무것도 하지 않는다 (무의미한 이력 방지)
    if (!visibilityChanged && added.length === 0 && removed.length === 0) return

    if (visibilityChanged) {
      await tx.execute(sql`update requests set visibility = ${visibility} where id = ${reqId}`)
    }

    // 공유 대상 전체 교체
    await tx.execute(sql`delete from request_shared_targets where request_id = ${reqId}`)
    for (const t of targets) {
      await tx.execute(sql`
        insert into request_shared_targets (request_id, target_type, target_value)
        values (${reqId}, ${t.target_type}, ${t.target_value})
        on conflict do nothing`)
    }

    await tx.execute(sql`
      insert into request_sharing_history
        (request_id, changed_by, from_visibility, to_visibility, added, removed)
      values (
        ${reqId}, ${actorId},
        ${visibilityChanged ? row.visibility : null},
        ${visibilityChanged ? visibility : null},
        ${JSON.stringify(added)}::jsonb,
        ${JSON.stringify(removed)}::jsonb
      )`)
  })
}
