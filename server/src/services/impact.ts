import { sql } from 'drizzle-orm'
import { withUser } from '../db/client.js'
import { type Impact, type Urgency, type PriorityLevel } from '../sla.js'
import { computeSlaFields, loadHolidaySet } from './sla-fields.js'
import { notify } from './notify.js'

/** 종결 상태 — 영향도를 소급 변경하지 않는다 (routes/requests.ts 긴급도 편집 재산정 분기도 재사용) */
export const CLOSED = ['완료', '반려', '철회']

export class ImpactError extends Error {
  code: string
  constructor(msg: string, code: string) {
    super(msg)
    this.code = code
  }
}

/**
 * 배정된 요청의 영향도를 바꾸고 priority_level·SLA 기한을 재산정한다.
 * assigned_at / first_response_at / status 는 건드리지 않는다 (배정 이력 보존).
 *
 * TOCTOU 방지: SELECT … FOR UPDATE 와 UPDATE가 같은 트랜잭션 안에서 실행되고,
 * UPDATE WHERE 절에 AND impact is not null 을 포함해 동시 배정취소 레이스를 막는다.
 */
export async function changeImpact({
  reqId,
  impact,
  actorId,
}: {
  reqId: number
  impact: Impact
  actorId: string
}): Promise<{ priorityLevel: PriorityLevel }> {
  const holidaySet = await loadHolidaySet()

  let notifyInfo: { assigneeId: string; seq: string; priorityLevel: PriorityLevel } | null = null

  const result = await withUser(actorId, async (tx) => {
    const cur = await tx.execute<{
      status: string
      urgency: Urgency
      created_at: string
      assignee_id: string | null
      first_response_at: string | null
      seq: string | null
    }>(
      sql`select status, urgency, created_at, assignee_id, first_response_at, seq from requests where id = ${reqId} for update`,
    )
    const row = cur.rows[0]
    if (!row) {
      throw new ImpactError('요청을 찾을 수 없습니다', 'NOT_FOUND')
    }
    // CLOSED를 먼저 검사한다: 접수→반려/철회로 직행한 미배정 종결 건은 배정 자체가 영영 불가능하므로
    // (assignRequest는 status='접수'만 대상) NOT_ASSIGNED보다 CLOSED가 실제 원인을 정확히 알려준다.
    if (CLOSED.includes(row.status)) {
      throw new ImpactError('종결된 요청은 영향도를 조정할 수 없습니다', 'CLOSED')
    }
    if (!row.assignee_id) {
      throw new ImpactError('배정된 요청만 영향도를 조정할 수 있습니다', 'NOT_ASSIGNED')
    }

    // assignee_id가 세팅된 건은 항상 assignRequest가 first_response_at도 함께 세팅했으므로
    // (transition.ts의 진행중→접수 되돌리기도 둘을 함께 null로 되돌린다) 여기서는 항상 값이 있다.
    const firstResponseAt = row.first_response_at != null ? new Date(row.first_response_at) : null

    const sla = await computeSlaFields({
      tx,
      urgency: row.urgency,
      impact,
      createdAt: row.created_at,
      holidaySet,
      firstResponseAt,
    })

    // AND assignee_id is not null: 동시에 배정 취소된 경우 0행 → 레이스 차단
    const upd = await tx.execute<{ id: number }>(sql`
      update requests
      set
        impact                = ${impact},
        priority_level        = ${sla.priorityLevel},
        response_due_at       = ${sla.responseDueAt},
        resolution_due_at     = ${sla.resolutionDueAt},
        sla_policy_id         = ${sla.slaPolicyId},
        sla_response_breached = ${sla.responseBreached}
      where id = ${reqId} and assignee_id is not null
      returning id
    `)
    if (upd.rows.length === 0) {
      throw new ImpactError(
        '동시 변경으로 인해 영향도 조정에 실패했습니다',
        'CONCURRENT_MODIFICATION',
      )
    }

    if (row.assignee_id !== actorId) {
      notifyInfo = {
        assigneeId: row.assignee_id,
        seq: row.seq ?? String(reqId),
        priorityLevel: sla.priorityLevel,
      }
    }

    return { priorityLevel: sla.priorityLevel }
  })

  // 트랜잭션 커밋 후 best-effort 알림
  if (notifyInfo !== null) {
    const { assigneeId, seq, priorityLevel } = notifyInfo
    void notify(assigneeId, 'status', reqId, `요청 ${seq} 우선순위가 ${priorityLevel}로 변경되었습니다`)
  }

  return result
}
