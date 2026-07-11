import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { env, isLocal } from './env.js'
import { authRoutes } from './routes/auth.js'
import { devLoginRoutes } from './auth/dev-login.js'
import { googleRoutes } from './auth/google.js'
import './types.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true })

  await app.register(cookie, { secret: env.SESSION_SECRET })
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true })

  app.decorateRequest('currentUser', null)
  app.get('/health', async () => ({ ok: true }))
  await app.register(authRoutes)

  if (isLocal) await app.register(devLoginRoutes)
  if (process.env.GOOGLE_CLIENT_ID) await app.register(googleRoutes)

  return app
}
