import type { FastifyInstance } from 'fastify'
import oauth2 from '@fastify/oauth2'
import { env } from '../env.js'
import { setSession } from './session.js'
import { upsertUserFromEmail, DomainNotAllowedError } from './upsert.js'

export async function googleRoutes(app: FastifyInstance) {
  await app.register(oauth2, {
    name: 'googleOAuth2',
    scope: ['openid', 'email', 'profile'],
    credentials: {
      client: { id: process.env.GOOGLE_CLIENT_ID!, secret: process.env.GOOGLE_CLIENT_SECRET! },
      auth: oauth2.GOOGLE_CONFIGURATION,
    },
    startRedirectPath: '/api/auth/google',
    callbackUri: process.env.GOOGLE_CALLBACK_URL!,
  })

  app.get('/api/auth/google/callback', async (request, reply) => {
    const { token } = await (app as any).googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    const info = (await res.json()) as { email: string; name?: string; sub?: string }
    try {
      const { id } = await upsertUserFromEmail(info.email, info.name ?? null, info.sub ?? null)
      setSession(reply, id)
      reply.redirect(env.WEB_ORIGIN)
    } catch (e) {
      if (e instanceof DomainNotAllowedError) {
        reply.redirect(`${env.WEB_ORIGIN}/login?error=domain`)
        return
      }
      throw e
    }
  })
}
