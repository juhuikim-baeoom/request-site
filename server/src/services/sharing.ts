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

/** 같은 (target_type, target_value) 중복 제거. 순서는 최초 등장 기준으로 유지 */
function dedupeTargets(targets: SharedTarget[]): SharedTarget[] {
  const seen = new Set<string>()
  const out: SharedTarget[] = []
  for (const t of targets) {
    const k = key(t)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

/**
 * 공유 대상 배열을 검증 + 중복 제거한다.
 * POST /api/requests(생성)와 PUT /api/requests/:id/sharing(사후 수정) 두 경로가 공유하는
 * 단일 검증 로직 — 잘못된 target_type/target_value가 DB CHECK·NOT NULL 위반으로 새어
 * 500이 되는 것을 막고, 두 경로의 입력 계약을 하나로 통일한다.
 * 잘못된 입력은 SharingError(400 매핑용 code)로 거부한다.
 */
export function parseSharedTargets(raw: unknown[]): SharedTarget[] {
  const targets: SharedTarget[] = []
  for (const t of raw) {
    const tt = (t as any)?.target_type
    const tv = (t as any)?.target_value
    if (tt !== 'function' && tt !== 'dept') {
      throw new SharingError('invalid target_type', 'INVALID_TARGET_TYPE')
    }
    if (typeof tv !== 'string' || tv.length === 0) {
      throw new SharingError('invalid target_value', 'INVALID_TARGET_VALUE')
    }
    targets.push({ target_type: tt, target_value: tv })
  }
  return dedupeTargets(targets)
}

/**
 * 공유 설정을 전체 교체한다. 넘긴 targets가 곧 최종 상태이므로 추가·제거가 한 번에 처리된다.
 * added/removed는 서버가 기존 목록과 비교해 계산한다 — 클라이언트가 보낸 값을 믿지 않는다.
 * targets는 여기서도 방어적으로 중복 제거한다 — 호출부가 바뀌어도 이력(added)이 부풀지 않도록.
 *
 * TOCTOU 방지: SELECT … FOR UPDATE로 요청 행을 잠근 뒤 같은 트랜잭션에서 교체·이력 기록.
 */
export async function changeSharing({
  reqId,
  visibility,
  targets: targetsIn,
  actorId,
}: {
  reqId: number
  visibility: Visibility
  targets: SharedTarget[]
  actorId: string
}): Promise<void> {
  const targets = dedupeTargets(targetsIn)
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

    // 공유 대상은 실제로 바뀐 경우에만 교체한다 — visibility만 바뀐 경우까지 delete+insert하면
    // 안 바뀐 대상 행의 id·created_at이 의미 없이 리셋된다.
    if (added.length > 0 || removed.length > 0) {
      await tx.execute(sql`delete from request_shared_targets where request_id = ${reqId}`)
      for (const t of targets) {
        await tx.execute(sql`
          insert into request_shared_targets (request_id, target_type, target_value)
          values (${reqId}, ${t.target_type}, ${t.target_value})
          on conflict do nothing`)
      }
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
