// 테스트에서 dev-login 세션 쿠키를 얻기 위한 헬퍼
import type { FastifyInstance } from 'fastify'

export async function loginAsDev(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/dev-login' })
  const setCookie = res.headers['set-cookie'] as string
  return decodeURIComponent(setCookie.split('sid=')[1].split(';')[0])
}
