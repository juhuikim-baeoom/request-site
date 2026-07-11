import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { env, isLocal } from './env.js'
import { authRoutes } from './routes/auth.js'
import { devLoginRoutes } from './auth/dev-login.js'
import { googleRoutes } from './auth/google.js'
import { metaRoutes } from './routes/meta.js'
import { requestRoutes } from './routes/requests.js'
import { requestDetailRoutes } from './routes/request-detail.js'
import { attachmentRoutes } from './routes/attachments.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { userRoutes } from './routes/users.js'
import { notificationRoutes } from './routes/notifications.js'
import './types.js'

/** CSRF 방어: 변경 메서드에 대해 Origin 헤더가 허용 출처와 일치하는지 검증.
 *  fetch() XHR은 CORS로 차단되지만, form submit / meta-refresh 등은 CORS 대상이 아니어서
 *  Origin 검증이 추가 방어선이 됨. OAuth callback(GET)과 health check(GET)는 제외. */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  // origin 헤더는 "scheme://host[:port]" 형태
  try { return new URL(origin).origin === new URL(env.WEB_ORIGIN).origin } catch { return false }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true })

  await app.register(cookie, { secret: env.SESSION_SECRET })
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true })
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } })

  // CSRF 방어 훅: POST/PATCH/PUT/DELETE 요청의 Origin 헤더 검증
  app.addHook('onRequest', async (request, reply) => {
    const method = request.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return
    // 로컬 개발 환경에서는 완화 (dev-login, curl 테스트 지원)
    if (isLocal) return
    const origin = request.headers.origin
    if (!isAllowedOrigin(origin)) {
      reply.code(403).send({ error: 'forbidden: origin mismatch' })
    }
  })

  app.decorateRequest('currentUser', null)
  app.get('/health', async () => ({ ok: true }))

  await app.register(authRoutes)
  if (isLocal) await app.register(devLoginRoutes)
  if (process.env.GOOGLE_CLIENT_ID) await app.register(googleRoutes)

  await app.register(metaRoutes)
  await app.register(requestRoutes)
  await app.register(requestDetailRoutes)
  await app.register(attachmentRoutes)
  await app.register(dashboardRoutes)
  await app.register(userRoutes)
  await app.register(notificationRoutes)

  return app
}
