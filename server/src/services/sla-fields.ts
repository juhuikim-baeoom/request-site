import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  derivePriority,
  addBusinessMinutes,
  type Impact,
  type Urgency,
  type PriorityLevel,
} from '../sla.js'

/** 배정·영향도 재조정이 공유하는 우선순위·SLA 기한 계산 결과 */
export interface SlaFields {
  priorityLevel: PriorityLevel
  responseDueAt: Date | null
  resolutionDueAt: Date | null
  slaPolicyId: number | null
  responseBreached: boolean
}

/** holidays는 변경 빈도가 낮은 참조 데이터 — 트랜잭션 밖에서 읽는다 */
export async function loadHolidaySet(): Promise<Set<string>> {
  const rows = await db.execute<{ holiday_on: string }>(sql`select holiday_on from holidays`)
  return new Set(rows.rows.map((h) => h.holiday_on))
}

/**
 * urgency × impact → priority_level, sla_policy 기준 응답·해결 기한을 계산한다.
 * 기한 기준 시각은 요청 생성 시각(created_at)이므로 같은 요청에 같은 impact를 주면
 * 배정 시점과 재조정 시점의 결과가 동일하다.
 *
 * tx: 호출자의 트랜잭션 핸들 (sla_policy 조회를 같은 트랜잭션에서 수행)
 */
export async function computeSlaFields({
  tx,
  urgency,
  impact,
  createdAt,
  holidaySet,
}: {
  tx: { execute: typeof db.execute }
  urgency: Urgency
  impact: Impact
  createdAt: string
  holidaySet: Set<string>
}): Promise<SlaFields> {
  const priorityLevel = derivePriority(urgency, impact)

  const policyRes = await tx.execute<{
    id: number
    resolution_minutes: number | null
    response_minutes: number | null
  }>(
    sql`select id, resolution_minutes, response_minutes from sla_policy where priority_level = ${priorityLevel}`,
  )
  const policy = policyRes.rows[0]

  const created = new Date(createdAt)

  let resolutionDueAt: Date | null = null
  if (policy && policy.resolution_minutes != null) {
    resolutionDueAt = addBusinessMinutes(created, policy.resolution_minutes, holidaySet)
  }

  let responseDueAt: Date | null = null
  if (policy && policy.response_minutes != null) {
    responseDueAt = addBusinessMinutes(created, policy.response_minutes, holidaySet)
  }

  // sla_response_breached: 응답 기한을 이미 넘겼는지
  const responseBreached = responseDueAt != null && new Date() > responseDueAt

  return {
    priorityLevel,
    responseDueAt,
    resolutionDueAt,
    slaPolicyId: policy?.id ?? null,
    responseBreached,
  }
}
