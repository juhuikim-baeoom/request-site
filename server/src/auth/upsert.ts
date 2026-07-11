import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users, orgDirectory } from '../db/schema.js'

const ALLOWED = ['baeoom.com', 'baeron.com']

export class DomainNotAllowedError extends Error {
  constructor() { super('허용되지 않은 도메인입니다. @baeoom.com 또는 @baeron.com 계정만 이용할 수 있습니다.') }
}

export async function upsertUserFromEmail(
  email: string, name: string | null, googleSub: string | null,
): Promise<{ id: string }> {
  // 정확히 하나의 '@'만 허용 (x@baeoom.com@evil.com 같은 우회 차단)
  const parts = email.split('@')
  const domain = parts.length === 2 ? parts[1]?.toLowerCase() : undefined
  if (!domain || !ALLOWED.includes(domain)) throw new DomainNotAllowedError()

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) })
  if (existing) {
    if (googleSub && existing.googleSub !== googleSub) {
      await db.update(users).set({ googleSub }).where(eq(users.id, existing.id))
    }
    return { id: existing.id }
  }

  // org_directory 사전등록 반영
  const dir = await db.query.orgDirectory.findFirst({
    where: sql`lower(${orgDirectory.email}) = lower(${email})`,
  })
  const [inserted] = await db.insert(users).values(
    dir
      ? { email, name: dir.name, dept: dir.dept, orgAffil: dir.orgAffil, deptFunction: dir.deptFunction, role: dir.role, googleSub }
      : { email, name: name ?? email, googleSub },
  ).returning({ id: users.id })

  if (dir) {
    await db.update(orgDirectory).set({ synced: true })
      .where(sql`lower(${orgDirectory.email}) = lower(${email})`)
  }
  return inserted
}
