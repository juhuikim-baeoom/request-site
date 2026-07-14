import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  derivePriority,
  addBusinessMinutes,
  urgencyResponseLevel,
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
 * firstResponseAt: 이미 응답이 이뤄진 건이면 그 시각, 아직 응답 전이면 null.
 *   응답 완료 건은 "응답 시각이 기한을 넘겼는가"로, 미응답 건은 "지금이 기한을 넘겼는가"로 판정한다.
 *   (오래된 건에서 기한 내 응답을 마쳤는데도 나중에 긴급도/영향도만 바꾸면 new Date()가 과거의
 *   response_due_at을 넘어서서 breached=true로 뒤집히는 데이터 오염을 막기 위함)
 */
export async function computeSlaFields({
  tx,
  urgency,
  impact,
  createdAt,
  holidaySet,
  firstResponseAt,
}: {
  tx: { execute: typeof db.execute }
  urgency: Urgency
  impact: Impact
  createdAt: string
  holidaySet: Set<string>
  firstResponseAt: Date | null
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

  // sla_response_breached: 응답이 이미 이뤄졌으면 응답 시각 기준, 아니면 현재 시각 기준으로 판정
  const responseBreached =
    responseDueAt != null &&
    (firstResponseAt != null ? firstResponseAt > responseDueAt : new Date() > responseDueAt)

  return {
    priorityLevel,
    responseDueAt,
    resolutionDueAt,
    slaPolicyId: policy?.id ?? null,
    responseBreached,
  }
}

/**
 * urgency만으로 response_due_at을 계산한다 (요청 생성부/미배정 긴급도 편집 공유).
 * 미배정 건은 impact가 없어 priority_level·resolution_due_at을 아직 정할 수 없으므로
 * response_due_at만 urgencyResponseLevel 기준으로 산정한다.
 *
 * tx: 호출자의 트랜잭션 핸들 (sla_policy 조회를 같은 트랜잭션/커넥션에서 수행)
 * from: 기한 기산 시작 시각 (생성부는 생성 시각, 편집부는 원래 created_at)
 */
export async function computeResponseDueAtForUrgency({
  tx,
  urgency,
  from,
  holidaySet,
}: {
  tx: { execute: typeof db.execute }
  urgency: Urgency
  from: Date
  holidaySet: Set<string>
}): Promise<Date | null> {
  const respLevel = urgencyResponseLevel(urgency)
  const policyRes = await tx.execute<{ response_minutes: number | null }>(
    sql`select response_minutes from sla_policy where priority_level = ${respLevel}`,
  )
  const respMin = policyRes.rows[0]?.response_minutes ?? null
  return respMin != null ? addBusinessMinutes(from, respMin, holidaySet) : null
}
