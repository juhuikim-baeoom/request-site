import { pool, db, withUser } from '../src/db/client.js'
import { users, requests } from '../src/db/schema.js'
import { eq, sql } from 'drizzle-orm'

async function main() {
  const juhui = await db.query.users.findFirst({ where: eq(users.email, 'juhuikim@baeoom.com') })
  if (!juhui) throw new Error('김주희 유저 없음 — db:seed 먼저 실행')

  // 요청 1건 생성 → seq 자동 생성 확인
  const [req] = await db.insert(requests).values({
    org: '공통', typeCode: 'error', title: '스모크 테스트',
    requesterId: juhui.id, visibility: 'dept',
  }).returning()
  if (!req.seq || !/^\d{6}-\d{2}$/.test(req.seq)) throw new Error(`seq 형식 오류: ${req.seq}`)
  console.log(`created seq=${req.seq}, requesterOrg(snapshot)=${req.requesterOrg}`)

  // 상태변경 → history 자동 기록(변경자=김주희) 확인
  await withUser(juhui.id, (tx) =>
    tx.update(requests).set({ status: '진행중' }).where(eq(requests.id, req.id)),
  )
  const hist = await db.execute<{ to_status: string; changed_by: string }>(
    sql`select to_status, changed_by from request_status_history where request_id = ${req.id} order by id desc limit 1`,
  )
  const row = hist.rows[0]
  if (row?.to_status !== '진행중' || row?.changed_by !== juhui.id) {
    throw new Error(`상태이력 검증 실패: ${JSON.stringify(row)}`)
  }
  console.log(`history ok: ${row.to_status} by ${row.changed_by}`)

  // 뷰 조회 확인
  const view = await db.execute(sql`select id, seq, type_label, due_status from request_view where id = ${req.id}`)
  console.log('view row:', view.rows[0])

  // 정리
  await db.delete(requests).where(eq(requests.id, req.id))
  await pool.end()
  console.log('SMOKE OK')
}

main().catch((e) => { console.error(e); process.exit(1) })
