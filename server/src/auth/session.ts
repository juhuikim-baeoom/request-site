import type { FastifyReply, FastifyRequest } from 'fastify'
import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sessions } from '../db/schema.js'
import { isLocal } from '../env.js'
import type { CurrentUser } from '../types.js'

const COOKIE = 'sid'
const TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30일

/** 랜덤 세션 토큰을 발급하고 DB에 저장한 뒤 서명 쿠키로 내려준다. */
export async function setSession(reply: FastifyReply, userId: string): Promise<void> {
  const id = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + TTL_MS)
  await db.insert(sessions).values({ id, userId, expiresAt })
  reply.setCookie(COOKIE, id, {
    httpOnly: true, sameSite: 'lax', signed: true, path: '/',
    secure: !isLocal, // 프로덕션(HTTPS)에서는 평문 HTTP 전송 차단
    maxAge: Math.floor(TTL_MS / 1000),
  })
}

/** 현재 세션을 서버·클라이언트 양쪽에서 무효화한다. */
export async function clearSession(reply: FastifyReply, request: FastifyRequest): Promise<void> {
  const id = getSessionId(request)
  if (id) await db.delete(sessions).where(eq(sessions.id, id))
  reply.clearCookie(COOKIE, { path: '/' })
}

function getSessionId(request: FastifyRequest): string | null {
  const raw = request.cookies[COOKIE]
  if (!raw) return null
  const un = request.unsignCookie(raw)
  return un.valid ? un.value : null
}

export async function loadCurrentUser(request: FastifyRequest): Promise<CurrentUser | null> {
  const id = getSessionId(request)
  if (!id) return null
  const r = await db.execute<any>(sql`
    select u.id, u.email, u.name, u.org_affil, u.dept_function, u.role
    from sessions s join users u on u.id = s.user_id
    where s.id = ${id} and s.expires_at > now()
    limit 1`)
  const u = r.rows[0]
  if (!u) return null
  return {
    id: u.id, email: u.email, name: u.name,
    orgAffil: u.org_affil, deptFunction: u.dept_function, role: u.role,
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const user = await loadCurrentUser(request)
  if (!user) { reply.code(401).send({ error: 'unauthorized' }); return }
  request.currentUser = user
}
