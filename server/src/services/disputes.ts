import { sql } from 'drizzle-orm'
import { db, withUser } from '../db/client.js'
import { notify } from './notify.js'
import { changeStatus, type PendingNotification } from './transition.js'
import { isDisputable, type DisputeStatusCd } from './inspection.js'

export class DisputeError extends Error {
  code: string
  constructor(msg: string, code: string) {
    super(msg)
    this.code = code
  }
}

/**
 * 이의제기 생성.
 * 상태가 완료이고, 최종 완료 후 14일 이내이며, 열린 이의가 없을 때만 가능하다.
 * 열린 이의 중복은 부분 유니크 인덱스(request_disputes_one_open)가 최종 방어선이다.
 */
export async function raiseDispute({
  reqId, raisedBy, reason,
}: { reqId: number; raisedBy: string; reason: string }): Promise<{ id: number }> {
  const cur = await db.execute<{ status: string; completed_at: string | null; seq: string | null }>(sql`
    select status, completed_at, seq from requests where id = ${reqId}`)
  const row = cur.rows[0]
  if (!row) throw new DisputeError('요청을 찾을 수 없습니다', 'NOT_FOUND')
  if (row.status !== '완료') {
    throw new DisputeError('완료된 요청에만 이의를 제기할 수 있습니다', 'NOT_COMPLETED')
  }
  // db.execute는 timestamptz를 문자열로 돌려준다 — Date로 변환 후 판정
  const completedAt = row.completed_at ? new Date(row.completed_at) : null
  if (!isDisputable(completedAt)) {
    throw new DisputeError('이의제기 기간이 지났습니다. 새 요청으로 접수해주세요', 'WINDOW_EXPIRED')
  }

  let id: number
  try {
    const ins = await db.execute<{ id: number }>(sql`
      insert into request_disputes (request_id, raised_by, reason)
      values (${reqId}, ${raisedBy}, ${reason})
      returning id`)
    id = ins.rows[0].id
  } catch (e: any) {
    // 부분 유니크 인덱스 위반 = 이미 열린 이의가 있다
    if (e?.code === '23505') {
      throw new DisputeError('이미 심사 중인 이의가 있습니다', 'ALREADY_OPEN')
    }
    throw e
  }

  // 시스템팀 전원에게 알림 (best-effort)
  const sysUsers = await db.execute<{ id: string }>(sql`select id from users where role = 'system'`)
  const seq = row.seq ?? String(reqId)
  for (const s of sysUsers.rows) {
    void notify(s.id, 'dispute', reqId, `요청 ${seq}에 이의가 제기되었습니다`)
  }

  return { id }
}

/**
 * 이의 심사.
 * ACCEPTED면 이의 갱신과 완료 → 진행중 전이를 하나의 트랜잭션으로 묶는다.
 * 부분 실패로 "수락됐는데 상태는 완료"인 상태가 생기면 안 된다.
 *
 * 알림은 두 종류가 나갈 수 있다 — 둘 다 트랜잭션 커밋 후에만 발송한다:
 * - changeStatus가 tx 경로로 반환하는 "상태가 진행중으로 변경되었습니다" 알림
 *   (changeStatus 계약상 tx를 넘기면 스스로 보내지 않고 정보만 돌려준다)
 * - 이 함수가 직접 구성하는 "이의가 수락/기각되었습니다" 알림
 * 두 알림은 내용이 달라 중복이 아니므로 둘 다 유지한다.
 */
export async function reviewDispute({
  disputeId, decision, comment, actorId,
}: {
  disputeId: number
  decision: Extract<DisputeStatusCd, 'ACCEPTED' | 'REJECTED'>
  comment: string
  actorId: string
}): Promise<void> {
  let disputeNotify: { requesterId: string; reqId: number; seq: string } | null = null
  let statusNotification: PendingNotification | null = null

  await withUser(actorId, async (tx) => {
    const cur = await tx.execute<{
      request_id: number; status_cd: string; reason: string
      requester_id: string | null; seq: string | null
    }>(sql`
      select d.request_id, d.status_cd, d.reason, r.requester_id, r.seq
      from request_disputes d
      join requests r on r.id = d.request_id
      where d.id = ${disputeId}
      for update of d`)
    const row = cur.rows[0]
    if (!row) throw new DisputeError('이의를 찾을 수 없습니다', 'NOT_FOUND')
    if (row.status_cd !== 'OPEN') {
      throw new DisputeError('이미 심사가 끝난 이의입니다', 'NOT_OPEN')
    }

    await tx.execute(sql`
      update request_disputes
      set status_cd = ${decision}, reviewed_by = ${actorId},
          review_comment = ${comment}, reviewed_at = now(), updated_at = now()
      where id = ${disputeId} and status_cd = 'OPEN'`)

    if (decision === 'ACCEPTED') {
      // 같은 트랜잭션 안에서 재작업으로 되돌린다. 이의 사유가 재작업 사유가 된다.
      const result = await changeStatus({
        reqId: row.request_id, to: '진행중', reason: row.reason, actorId, tx,
      })
      // changeStatus는 tx 경로에서 스스로 알림을 보내지 않고 정보만 돌려준다 —
      // 이 트랜잭션이 커밋된 뒤 우리가 직접 발송해야 한다 (계약: transition.ts 참조).
      if (result.notification) statusNotification = result.notification
    }

    if (row.requester_id && row.requester_id !== actorId) {
      disputeNotify = {
        requesterId: row.requester_id,
        reqId: row.request_id,
        seq: row.seq ?? String(row.request_id),
      }
    }
  })

  // 트랜잭션 커밋 후에만 발송 — 롤백 시 알림이 나가는 거짓을 방지한다.
  if (statusNotification) {
    const { userId, type, requestId, message } = statusNotification
    void notify(userId, type, requestId, message)
  }

  if (disputeNotify) {
    const { requesterId, reqId, seq } = disputeNotify
    const message =
      decision === 'ACCEPTED'
        ? `요청 ${seq} 이의가 수락되어 재작업이 시작되었습니다`
        : `요청 ${seq} 이의가 기각되었습니다: ${comment}`
    void notify(requesterId, 'dispute', reqId, message)
  }
}
