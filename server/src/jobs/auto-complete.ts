import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db, withUser } from '../db/client.js'
import { notify } from '../services/notify.js'
import { changeStatus, TransitionError } from '../services/transition.js'
import { INSPECTION_DAYS, INSPECTION_REMINDER_DAYS } from '../services/inspection.js'

/** 배치가 상태를 바꿀 때 쓰는 액터. 시스템팀 계정 중 하나를 쓴다. */
async function systemActorId(): Promise<string | null> {
  const r = await db.execute<{ id: string }>(sql`
    select id from users where role in ('system', 'system_admin') order by created_at limit 1`)
  return r.rows[0]?.id ?? null
}

/**
 * 검수대기 건을 스캔해 두 가지를 한다.
 *  1. 검수 기한이 지난 건 → AUTO 경로로 완료
 *  2. 리마인더 시점을 지났고 아직 안 보낸 건 → 요청자에게 리마인더 1회
 *
 * 전이 실패(요청자가 그 사이 직접 처리한 경우 등)는 건별로 무시하고 다음 건을 계속 처리한다.
 */
export async function runAutoComplete(): Promise<{ completed: number; reminded: number }> {
  const actorId = await systemActorId()
  if (actorId === null) {
    console.error('[auto-complete] system 역할 사용자가 없어 배치를 건너뜁니다')
    return { completed: 0, reminded: 0 }
  }

  // ── 1. 자동완료
  const expired = await db.execute<{ id: number; requester_id: string | null; seq: string | null }>(sql`
    select id, requester_id, seq from requests
    where status = '검수대기' and inspection_due_at is not null and inspection_due_at < now()`)

  let completed = 0
  for (const row of expired.rows) {
    try {
      // tx를 넘겨 changeStatus가 자체 알림("상태가 완료로 변경되었습니다")을 보내지 않게 한다 —
      // 그 알림은 버리고, 트랜잭션 커밋 후 아래에서 배치 전용 메시지만 보낸다.
      // (반환되는 notification 필드는 의도적으로 무시한다)
      await withUser(actorId, (tx) => changeStatus({ reqId: row.id, to: '완료', actorId, completionRoute: 'AUTO', tx }))
      completed++
      if (row.requester_id) {
        const seq = row.seq ?? String(row.id)
        void notify(
          row.requester_id, 'status', row.id,
          `요청 ${seq}이(가) ${INSPECTION_DAYS}일간 확인이 없어 자동 완료되었습니다. 문제가 있으면 이의를 제기해주세요`,
        )
      }
    } catch (e) {
      if (e instanceof TransitionError) {
        // 그 사이 요청자가 직접 처리했을 수 있다. 다음 건으로 넘어간다.
        console.warn(`[auto-complete] 요청 ${row.id} 자동완료 건너뜀: ${e.code}`)
        continue
      }
      throw e
    }
  }

  // ── 2. 리마인더
  //    남은 기간이 (검수기한 - 리마인더시점) 이하로 줄었고 아직 안 보낸 건
  const remainDays = INSPECTION_DAYS - INSPECTION_REMINDER_DAYS
  const due = await db.execute<{ id: number; requester_id: string | null; seq: string | null }>(sql`
    select id, requester_id, seq from requests
    where status = '검수대기'
      and inspection_due_at is not null
      and inspection_due_at >= now()
      and inspection_due_at <= now() + (${remainDays} * interval '1 day')
      and inspection_reminder_sent_at is null
      and requester_id is not null`)

  let reminded = 0
  for (const row of due.rows) {
    // 발송 시각을 먼저 찍어 중복 발송을 막는다 (실패해도 재발송하지 않는 쪽이 낫다)
    const upd = await db.execute<{ id: number }>(sql`
      update requests set inspection_reminder_sent_at = now()
      where id = ${row.id} and inspection_reminder_sent_at is null
      returning id`)
    if (upd.rows.length === 0) continue  // 다른 워커가 이미 처리

    const seq = row.seq ?? String(row.id)
    void notify(
      row.requester_id!, 'status', row.id,
      `요청 ${seq} 확인이 아직 안 되었습니다. 기한 내 응답이 없으면 자동 완료됩니다`,
    )
    reminded++
  }

  return { completed, reminded }
}

/** 1시간 주기로 배치를 돌린다. */
export function startAutoCompleteJob(app: FastifyInstance): void {
  const ONE_HOUR = 60 * 60 * 1000
  const tick = async () => {
    try {
      const r = await runAutoComplete()
      if (r.completed > 0 || r.reminded > 0) {
        app.log.info({ ...r }, '[auto-complete] 배치 완료')
      }
    } catch (err) {
      app.log.error(err, '[auto-complete] 배치 실패')
    }
  }
  void tick()  // 기동 직후 1회
  const timer = setInterval(() => void tick(), ONE_HOUR)
  app.addHook('onClose', async () => { clearInterval(timer) })
}
