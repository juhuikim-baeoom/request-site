import 'dotenv/config'

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`환경변수 ${name} 가 필요합니다. server/.env 를 확인하세요.`)
  return v
}

// fail-safe: APP_ENV 미설정이면 'production'으로 간주해 dev-login 등 로컬 기능을 닫는다.
const APP_ENV = process.env.APP_ENV ?? 'production'
const LOCAL = APP_ENV === 'local'

// 세션 서명 키: 프로덕션에서는 반드시 설정해야 한다(기본값 fallback 금지 — 쿠키 위조 방지).
function sessionSecret(): string {
  const s = process.env.SESSION_SECRET
  if (s) return s
  if (LOCAL) return 'dev-secret-local-only'
  throw new Error('SESSION_SECRET 환경변수가 필요합니다(프로덕션). 32바이트 이상의 임의값을 설정하세요.')
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  PORT: Number(process.env.PORT ?? 4000),
  APP_ENV,
  SESSION_SECRET: sessionSecret(),
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
}

export const isLocal = LOCAL
