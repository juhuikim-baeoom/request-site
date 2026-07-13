/**
 * test:bootstrap — 깨끗한 DB 부트스트랩 검증 (C1의 (c))
 *
 * 공식 배포 순서(README.md, docs/reference/db-schema.md): `db:migrate` → `db:seed`.
 * 이 스크립트는 기존 개발 DB를 건드리지 않고, 같은 Postgres 서버 위에 완전히 새로운
 * 임시 데이터베이스를 만들어 그 순서를 그대로 재현한 뒤 `system_admin`이 1명 이상
 * 존재하는지 확인한다. 이 테스트가 있었다면 "seed.ts가 juhuikim을 role='system'으로
 * 넣어 배포 직후 관리자가 0명"이던 회귀(C1)를 바로 잡아냈을 것이다.
 *
 * 임시 DB는 기존 DATABASE_URL과 같은 서버·자격증명을 쓰되 DB 이름만 랜덤 접미사를 붙여
 * 새로 만든다(예: request_site_bootstrap_<hex>). migrate/seed는 별도 프로세스로 실행해
 * 이미 로드된 db/client.js의 커넥션 풀(다른 DATABASE_URL로 고정됨)과 완전히 분리한다.
 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(__dirname, '..')

const baseUrl = process.env.DATABASE_URL ?? 'postgresql://request:request@localhost:5432/request_site'
const parsed = new URL(baseUrl)
const adminDbName = parsed.pathname.replace(/^\//, '') || 'postgres'
const tempDbName = `bootstrap_test_${randomBytes(4).toString('hex')}`

const tempUrl = new URL(baseUrl)
tempUrl.pathname = `/${tempDbName}`

console.log(`[test:bootstrap] 임시 DB 생성: ${tempDbName} (서버는 ${parsed.hostname}:${parsed.port || 5432} 공유)`)

const adminPool = new pg.Pool({ connectionString: baseUrl })

async function dropTempDb() {
  // 남아 있는 연결이 있으면 DROP DATABASE가 실패하므로 먼저 강제 종료한다.
  await adminPool.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
    [tempDbName],
  )
  await adminPool.query(`drop database if exists "${tempDbName}"`)
}

try {
  await adminPool.query(`create database "${tempDbName}"`)

  const env = { ...process.env, DATABASE_URL: tempUrl.toString() }

  console.log('[test:bootstrap] npm run db:migrate 실행 (임시 DB 대상)')
  execFileSync('npx', ['tsx', 'src/db/migrate.ts'], { cwd: serverRoot, env, stdio: 'inherit' })

  console.log('[test:bootstrap] npm run db:seed 실행 (임시 DB 대상)')
  execFileSync('npx', ['tsx', 'src/db/seed.ts'], { cwd: serverRoot, env, stdio: 'inherit' })

  console.log('[test:bootstrap] system_admin 카운트 검증')
  const tempPool = new pg.Pool({ connectionString: tempUrl.toString() })
  const res = await tempPool.query<{ count: number }>(
    `select count(*)::int as count from users where role = 'system_admin'`,
  )
  await tempPool.end()

  const count = res.rows[0]?.count ?? 0
  assert.ok(count >= 1, `깨끗한 DB에서 db:migrate+db:seed 후 system_admin >= 1이어야 함, got ${count}`)
  console.log(`[test:bootstrap] OK — system_admin=${count} (DB: ${tempDbName}, 원본 DB: ${adminDbName} 영향 없음)`)
  console.log('\ntest:bootstrap ALL PASSED')
} finally {
  await dropTempDb()
  await adminPool.end()
}
