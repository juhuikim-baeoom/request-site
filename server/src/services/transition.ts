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
 * changeStatus()가 tx 경로(이미 열린 트랜잭션 안에서 호출됨)일 때 호출자에게
 * 돌려주는 "발송 대기 중" 알림 정보. notify()의 인자와 1:1로 대응한다 —
 * 호출자는 자신의 트랜잭션이 커밋된 뒤 `notify(userId, type, requestId, message)`를
 * 그대로 호출하면 된다.
 */
export type PendingNotification = {
  userId: string
  type: 'status'
  requestId: number
  message: string
}

/**
 * 요청 상태 전이 서비스.
 * completed_at / first_resolved_at / final_resolved_at / inspection_due_at /
 * rework_count / sla_resolution_breached 는 on_status_change 트리거가 처리하므로
 * 이 서비스에서는 건드리지 않는다. 이 서비스가 직접 쓰는 컬럼은
 * status / completion_route / completion_note / hold_reason / reject_reason / rework_reason 뿐이다.
 *
 * TOCTOU 방지: SELECT … FOR UPDATE 와 UPDATE가 같은 트랜잭션 안에서 실행되고,
 * UPDATE WHERE 절에 AND status = ${from} 을 포함해 동시성 레이스를 막는다.
 *
 * ## 알림(notify) 발송 시점 — tx 유무에 따라 계약이 다르다
 * - `tx`를 넘기지 않으면(일반 호출) 이 함수가 자체적으로 새 트랜잭션을 열고, 커밋에
 *   성공한 뒤 알림을 자동으로 발송한다. 호출자는 반환값의 `notification`을 무시해도 된다
 *   (항상 undefined).
 * - `tx`를 넘기면(예: Task 6의 "이의 수락 + 완료→진행중 전이"를 한 트랜잭션으로 묶는 경우)
 *   이 함수는 **알림을 절대 스스로 보내지 않는다**. notify()는 모듈 레벨의 별도 커넥션 풀을
 *   쓰기 때문에, 호출자의 트랜잭션이 아직 커밋되지 않은 시점에 알림을 보내면 트랜잭션이
 *   롤백되더라도 알림은 이미 발송되어 되돌릴 수 없다. 대신 이 함수는 반환값의
 *   `notification` 필드에 발송에 필요한 정보를 채워 돌려준다.
 *   **호출자는 자신의 트랜잭션이 커밋된 후 직접 `notify(...)`를 호출해야 한다.**
 *   이 계약을 지키지 않으면(즉 tx 경로에서 notification을 그냥 버리면) 상태 전이가
 *   일어나도 요청자에게 알림이 가지 않는다.
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
  /**
   * 이미 열린 트랜잭션 안에서 호출할 때 전달한다 (이의 수락 경로 등).
   * **반드시 `withUser(userId, fn)`이 fn에 넘겨준 트랜잭션 핸들이어야 한다.**
   * - bare `db.transaction(...)`으로 연 핸들을 넘기면 `app.user_id`가 설정되지 않아
   *   트리거가 `request_status_history.changed_by`를 NULL로 기록한다.
   * - 아예 tx 없이(별도 트랜잭션으로) 실행하면 SELECT … FOR UPDATE 잠금과 UPDATE가
   *   서로 다른 트랜잭션에 걸려 TOCTOU 방지 로직이 무력화된다.
   */
  tx?: Tx
}): Promise<{ from: RequestStatus; notification?: PendingNotification }> {
  const run = async (tx: Tx) => {
    // 같은 트랜잭션 안에서 SELECT … FOR UPDATE로 행 잠금 후 status/requester_id/seq 읽기
    const cur = await tx.execute<{ status: RequestStatus; requester_id: string | null; seq: string | null }>(
      sql`select status, requester_id, seq from requests where id = ${reqId} for update`,
    )
    const row = cur.rows[0]
    if (!row) throw new TransitionError('요청을 찾을 수 없습니다', 'NOT_FOUND')
    const from = row.status

    // 전이 허용 여부 검증 — ILLEGAL_TRANSITION이 MISSING_COMPLETION_ROUTE보다 먼저 판정되어야
    // "접수 → 완료"처럼 애초에 불법인 전이가 필드 누락 오류로 잘못 보고되지 않는다.
    if (!ALLOWED[from]?.includes(to)) {
      throw new TransitionError(`${from} → ${to} 전이는 허용되지 않습니다`, 'ILLEGAL_TRANSITION')
    }

    if (to === '완료' && completionRoute === undefined) {
      throw new TransitionError('완료 전이에는 completionRoute가 필요합니다', 'MISSING_COMPLETION_ROUTE')
    }

    // reason 컬럼 결정 (대상 상태일 때만 세팅)
    const sets: ReturnType<typeof sql>[] = [sql`status = ${to}`]
    if (to === '완료') {
      sets.push(sql`completion_route = ${completionRoute!}`)
      // 강제 완료(SYSTEM_FORCED) 등 완료 사유의 유일한 기록처 — 감사 추적/대시보드 지표용.
      // 무조건 덮어써야 한다: reason이 없으면 null로 지워, 재작업 후 재완료 시
      // 이전 완료(예: SYSTEM_FORCED 강제완료 사유)의 흔적이 남아 감사 기록을 오염시키지 않게 한다.
      sets.push(sql`completion_note = ${reason ?? null}`)
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
    let notifyInfo: { requesterId: string; seq: string } | null = null
    const requesterId = row.requester_id
    if (requesterId && requesterId !== actorId) {
      notifyInfo = { requesterId, seq: row.seq ?? String(reqId) }
    }

    return { from, notifyInfo }
  }

  // tx가 전달되면 이미 열린 트랜잭션 안에서 실행 (Task 6 이의 수락 경로) —
  // 새 트랜잭션을 열지 않는다.
  const { from, notifyInfo } = outerTx ? await run(outerTx) : await withUser(actorId, run)

  if (notifyInfo === null) {
    return { from }
  }

  const { requesterId, seq } = notifyInfo
  const message =
    to === '검수대기'
      ? `요청 ${seq} 작업이 완료되었습니다. 확인해주세요`
      : `요청 ${seq} 상태가 ${to}로 변경되었습니다`

  if (outerTx) {
    // 호출자의 트랜잭션이 아직 커밋되지 않았다 — 여기서 보내면 롤백 시에도 알림이
    // 이미 나가버린다. 호출자가 커밋 후 직접 발송하도록 정보만 반환한다.
    return { from, notification: { userId: requesterId, type: 'status', requestId: reqId, message } }
  }

  // 우리가 연 트랜잭션은 이미 커밋되었으므로 best-effort 알림을 바로 발송한다.
  void notify(requesterId, 'status', reqId, message)
  return { from }
}
