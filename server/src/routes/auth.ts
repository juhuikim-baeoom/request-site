import type { FastifyInstance } from 'fastify'
import { loadCurrentUser, clearSession } from '../auth/session.js'

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/me', async (request) => {
    const user = await loadCurrentUser(request)
    return { user }
  })

  app.post('/api/auth/logout', async (_request, reply) => {
    clearSession(reply)
    return { ok: true }
  })
}
