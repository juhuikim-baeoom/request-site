import type { FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { isLocal } from '../env.js'
import type { CurrentUser } from '../types.js'

const COOKIE = 'sid'

export function setSession(reply: FastifyReply, userId: string) {
  reply.setCookie(COOKIE, userId, {
    httpOnly: true, sameSite: 'lax', signed: true, path: '/',
    secure: !isLocal, // 프로덕션(HTTPS)에서는 평문 HTTP 전송 차단
    maxAge: 60 * 60 * 24 * 30,
  })
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(COOKIE, { path: '/' })
}

export function getSessionUserId(request: FastifyRequest): string | null {
  const raw = request.cookies[COOKIE]
  if (!raw) return null
  const un = request.unsignCookie(raw)
  return un.valid ? un.value : null
}

export async function loadCurrentUser(request: FastifyRequest): Promise<CurrentUser | null> {
  const id = getSessionUserId(request)
  if (!id) return null
  const u = await db.query.users.findFirst({ where: eq(users.id, id) })
  if (!u) return null
  return {
    id: u.id, email: u.email, name: u.name,
    orgAffil: u.orgAffil, deptFunction: u.deptFunction, role: u.role,
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const user = await loadCurrentUser(request)
  if (!user) { reply.code(401).send({ error: 'unauthorized' }); return }
  request.currentUser = user
}
