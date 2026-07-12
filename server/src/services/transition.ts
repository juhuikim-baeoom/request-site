import { sql } from 'drizzle-orm'
import { withUser } from '../db/client.js'
import { notify } from './notify.js'
import type { CompletionRoute } from './inspection.js'

export type RequestStatus = '접수' | '진행중' | '검수대기' | '보류' | '완료' | '반려' | '철회'

/** 허용된 상태 전이 맵.
 *  진행중 → 완료 직행은 없다. 완료에 도달하려면 반드시 검수대기를 거친다. */
const ALLOWED: Record<RequestStatus, RequestStatus[]> = {
  '접수':   ['진행중', '반려', '철회'],
  '진행중': ['검수대기', '보류', '반려'],
  '검수대기': ['완료', '진행중'],
  '보류':   ['진행중'],
  '완료':   ['진행중'],
  '반려':   [],
  '철회':   [],
}

export class TransitionError extends Error {
  code: string
  constructor(msg: string, code: string) {
    super(msg)
    this.code = code
  }
}

/** withUser 콜백에 넘어오는 트랜잭션 핸들 타입 (outerTx도 동일 타입이어야 함) */
type Tx = Parameters<Parameters<typeof withUser>[1]>[0]

/**
 * 요청 상태 전이 서비스.
 * completed_at / first_resolved_at / final_resolved_at / inspection_due_at /
 * rework_count / sla_resolution_breached 는 on_status_change 트리거가 처리하므로
 * 이 서비스에서는 건드리지 않는다. completion_route만 여기서 세팅한다.
 *
 * TOCTOU 방지: SELECT … FOR UPDATE 와 UPDATE가 같은 트랜잭션 안에서 실행되고,
 * UPDATE WHERE 절에 AND status = ${from} 을 포함해 동시성 레이스를 막는다.
 */
export async function changeStatus({
  reqId,
  to,
  reason,
  actorId,
  completionRoute,
  tx: outerTx,
}: {
  reqId: number
  to: RequestStatus
  reason?: string
  actorId: string
  completionRoute?: CompletionRoute
  /** 이미 열린 트랜잭션 안에서 호출할 때 전달한다 (이의 수락 경로). */
  tx?: Tx
}): Promise<{ from: RequestStatus }> {
  if (to === '완료' && completionRoute === undefined) {
    throw new TransitionError('완료 전이에는 completionRoute가 필요합니다', 'MISSING_COMPLETION_ROUTE')
  }

  let notifyInfo: { requesterId: string; seq: string } | null = null

  const run = async (tx: Tx) => {
    // 같은 트랜잭션 안에서 SELECT … FOR UPDATE로 행 잠금 후 status/requester_id/seq 읽기
    const cur = await tx.execute<{ status: RequestStatus; requester_id: string | null; seq: string | null }>(
      sql`select status, requester_id, seq from requests where id = ${reqId} for update`,
    )
    const row = cur.rows[0]
    if (!row) throw new TransitionError('요청을 찾을 수 없습니다', 'NOT_FOUND')
    const from = row.status

    // 전이 허용 여부 검증
    if (!ALLOWED[from]?.includes(to)) {
      throw new TransitionError(`${from} → ${to} 전이는 허용되지 않습니다`, 'ILLEGAL_TRANSITION')
    }

    // reason 컬럼 결정 (대상 상태일 때만 세팅)
    const sets: ReturnType<typeof sql>[] = [sql`status = ${to}`]
    if (to === '완료') {
      sets.push(sql`completion_route = ${completionRoute!}`)
      // 강제 완료 사유는 rework_reason이 아니라 별도 의미이므로 hold/reject 컬럼을 쓰지 않는다.
      // 사유는 request_status_history와 알림 메시지에 남는다.
    }
    if (to === '보류' && reason != null) {
      sets.push(sql`hold_reason = ${reason}`)
    } else if (to === '반려' && reason != null) {
      sets.push(sql`reject_reason = ${reason}`)
    } else if (to === '진행중' && (from === '완료' || from === '검수대기') && reason != null) {
      // 재작업 사유 — 검수 반려와 이의 수락 둘 다 여기에 남는다
      sets.push(sql`rework_reason = ${reason}`)
    }

    // AND status = ${from} 으로 낙관적 잠금: 동시 업데이트가 이미 상태를 바꿨다면 0행 리턴
    const upd = await tx.execute<{ id: number }>(sql`
      update requests
      set ${sql.join(sets, sql`, `)}
      where id = ${reqId} and status = ${from}
      returning id
    `)
    if (upd.rows.length === 0) {
      // 다른 트랜잭션이 이미 상태를 변경했음 — 재시도 필요 시 호출자가 처리
      throw new TransitionError(
        `동시 변경으로 인해 전이에 실패했습니다 (${from} → ${to})`,
        'CONCURRENT_MODIFICATION',
      )
    }

    // 알림 대상 정보 기록 (트랜잭션 커밋 후 발송)
    const requesterId = row.requester_id
    if (requesterId && requesterId !== actorId) {
      notifyInfo = { requesterId, seq: row.seq ?? String(reqId) }
    }

    return { from }
  }

  // tx가 전달되면 이미 열린 트랜잭션 안에서 실행 (Task 6 이의 수락 경로) —
  // 새 트랜잭션을 열지 않는다.
  const result = outerTx ? await run(outerTx) : await withUser(actorId, run)

  // 트랜잭션 커밋 후 best-effort 알림 발송
  if (notifyInfo !== null) {
    const { requesterId, seq } = notifyInfo
    const message =
      to === '검수대기'
        ? `요청 ${seq} 작업이 완료되었습니다. 확인해주세요`
        : `요청 ${seq} 상태가 ${to}로 변경되었습니다`
    void notify(requesterId, 'status', reqId, message)
  }

  return result
}
