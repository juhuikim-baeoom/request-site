import 'dotenv/config'

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`환경변수 ${name} 가 필요합니다. server/.env 를 확인하세요.`)
  return v
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  PORT: Number(process.env.PORT ?? 4000),
  APP_ENV: process.env.APP_ENV ?? 'local',
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'dev-secret',
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
}

export const isLocal = env.APP_ENV === 'local'
