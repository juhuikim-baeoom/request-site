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

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true })

  await app.register(cookie, { secret: env.SESSION_SECRET })
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true })
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } })

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
