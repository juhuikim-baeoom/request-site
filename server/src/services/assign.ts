import { sql } from 'drizzle-orm'
import { db, withUser } from '../db/client.js'
import { derivePriority, addBusinessMinutes, type Impact, type Urgency } from '../sla.js'

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
  // 현재 status, urgency, created_at 조회
  const cur = await db.execute<{ status: string; urgency: Urgency; created_at: string }>(
    sql`select status, urgency, created_at from requests where id = ${reqId}`,
  )
  const row = cur.rows[0]
  if (!row) {
    throw new AssignError('요청을 찾을 수 없습니다', 'NOT_FOUND')
  }
  if (row.status !== '접수') {
    throw new AssignError('접수 상태인 요청만 배정할 수 있습니다', 'ONLY_FROM_RECEIVED')
  }

  const urgency = row.urgency
  const priorityLevel = derivePriority(urgency, impact)

  // sla_policy에서 resolution_minutes 조회
  const policyRes = await db.execute<{ id: number; resolution_minutes: number | null }>(
    sql`select id, resolution_minutes from sla_policy where priority_level = ${priorityLevel}`,
  )
  const policy = policyRes.rows[0]

  // holidays 로드
  const holidayRows = await db.execute<{ holiday_on: string }>(
    sql`select holiday_on from holidays`,
  )
  const holidaySet = new Set(holidayRows.rows.map((h) => h.holiday_on))

  // resolution_due_at 계산
  let resolutionDueAt: Date | null = null
  if (policy && policy.resolution_minutes != null) {
    const createdAt = new Date(row.created_at)
    resolutionDueAt = addBusinessMinutes(createdAt, policy.resolution_minutes, holidaySet)
  }

  await withUser(actorId, (tx) =>
    tx.execute(sql`
      update requests
      set
        assignee_id       = ${assigneeId},
        impact            = ${impact},
        priority_level    = ${priorityLevel},
        status            = '진행중',
        assigned_at       = now(),
        first_response_at = now(),
        resolution_due_at = ${resolutionDueAt},
        sla_policy_id     = ${policy?.id ?? null}
      where id = ${reqId}
    `),
  )
}
