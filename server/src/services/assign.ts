import { sql } from 'drizzle-orm'
import { withUser } from '../db/client.js'
import { type Impact, type Urgency } from '../sla.js'
import { computeSlaFields, loadHolidaySet } from './sla-fields.js'
import { notify } from './notify.js'

export class AssignError extends Error {
  code: string
  constructor(msg: string, code: string) {
    super(msg)
    this.code = code
  }
}

/**
 * 접수 상태인 요청에 담당자·impact를 배정하고 상태를 진행중으로 전환한다.
 * SLA resolution_due_at을 계산해 함께 저장한다.
 *
 * TOCTOU 방지: SELECT … FOR UPDATE 와 UPDATE가 같은 트랜잭션 안에서 실행되고,
 * UPDATE WHERE 절에 AND status = '접수' 를 포함해 동시성 레이스를 막는다.
 */
export async function assignRequest({
  reqId,
  assigneeId,
  impact,
  actorId,
}: {
  reqId: number
  assigneeId: string
  impact: Impact
  actorId: string
}): Promise<void> {
  // holidays는 트랜잭션 밖에서 읽어도 무방 (변경 빈도가 낮은 참조 데이터)
  const holidaySet = await loadHolidaySet()

  let notifySeq: string | null = null

  await withUser(actorId, async (tx) => {
    // 같은 트랜잭션 안에서 SELECT … FOR UPDATE로 행 잠금 후 status/urgency/created_at/seq 읽기
    const cur = await tx.execute<{ status: string; urgency: Urgency; created_at: string; seq: string | null }>(
      sql`select status, urgency, created_at, seq from requests where id = ${reqId} for update`,
    )
    const row = cur.rows[0]
    if (!row) {
      throw new AssignError('요청을 찾을 수 없습니다', 'NOT_FOUND')
    }
    if (row.status !== '접수') {
      throw new AssignError('접수 상태인 요청만 배정할 수 있습니다', 'ONLY_FROM_RECEIVED')
    }

    const sla = await computeSlaFields({
      tx,
      urgency: row.urgency,
      impact,
      createdAt: row.created_at,
      holidaySet,
    })

    // AND status = '접수' 로 낙관적 잠금: 동시 업데이트가 이미 상태를 바꿨다면 0행 리턴
    const upd = await tx.execute<{ id: number }>(sql`
      update requests
      set
        assignee_id           = ${assigneeId},
        impact                = ${impact},
        priority_level        = ${sla.priorityLevel},
        status                = '진행중',
        assigned_at           = now(),
        first_response_at     = now(),
        response_due_at       = ${sla.responseDueAt},
        resolution_due_at     = ${sla.resolutionDueAt},
        sla_policy_id         = ${sla.slaPolicyId},
        sla_response_breached = ${sla.responseBreached}
      where id = ${reqId} and status = '접수'
      returning id
    `)
    if (upd.rows.length === 0) {
      throw new AssignError(
        '동시 변경으로 인해 배정에 실패했습니다',
        'CONCURRENT_MODIFICATION',
      )
    }

    // 알림 대상 정보 기록 (트랜잭션 커밋 후 발송)
    if (assigneeId !== actorId) {
      notifySeq = row.seq ?? String(reqId)
    }
  })

  // 트랜잭션 커밋 후 best-effort 알림 발송
  if (notifySeq !== null) {
    void notify(assigneeId, 'assigned', reqId, `요청 ${notifySeq} 담당자로 배정되었습니다`)
  }
}
