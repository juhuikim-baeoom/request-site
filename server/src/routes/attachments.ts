import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { canSeeRequest } from '../authz.js'
import { saveUpload, resolveUpload } from '../storage.js'
import { parseId } from '../http.js'
import type { CurrentUser } from '../types.js'

async function canSee(u: CurrentUser, requestId: number): Promise<boolean> {
  const r = await db.execute<any>(sql`
    select requester_id, visibility, requester_org, requester_function
    from requests where id = ${requestId}`)
  const req = r.rows[0]; if (!req) return false
  const st = await db.execute<any>(sql`select target_type, target_value from request_shared_targets where request_id = ${requestId}`)
  return canSeeRequest(u,
    { requesterId: req.requester_id, visibility: req.visibility, requesterOrg: req.requester_org, requesterFunction: req.requester_function },
    st.rows.map((x: any) => ({ targetType: x.target_type, targetValue: x.target_value })))
}

export async function attachmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.post<{ Params: { id: string } }>('/api/requests/:id/attachments', async (request, reply) => {
    const u = request.currentUser!
    const id = parseId(request.params.id)
    if (id === null) { reply.code(404).send({ error: 'not found' }); return }
    if (!(await canSee(u, id))) { reply.code(404).send({ error: 'not found' }); return }
    const part = await request.file()
    if (!part) { reply.code(400).send({ error: 'no file' }); return }
    const buf = await part.toBuffer()
    const { path, size } = await saveUpload(id, part.filename, buf)
    const r = await db.execute<any>(sql`
      insert into request_attachments (request_id, storage_path, file_name, file_size, mime_type, uploaded_by)
      values (${id}, ${path}, ${part.filename}, ${size}, ${part.mimetype || null}, ${u.id})
      returning *`)
    reply.code(201); return r.rows[0]
  })

  app.get<{ Params: { id: string } }>('/api/attachments/:id/download', async (request, reply) => {
    const u = request.currentUser!
    const attId = parseId(request.params.id)
    if (attId === null) { reply.code(404).send({ error: 'not found' }); return }
    const a = await db.execute<any>(sql`select * from request_attachments where id = ${attId}`)
    const att = a.rows[0]; if (!att) { reply.code(404).send({ error: 'not found' }); return }
    if (!(await canSee(u, att.request_id))) { reply.code(404).send({ error: 'not found' }); return }
    reply.header('Content-Type', att.mime_type ?? 'application/octet-stream')
    reply.header('X-Content-Type-Options', 'nosniff') // 클라이언트 지정 MIME 스니핑 방지
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.file_name ?? 'file')}`)
    return reply.send(createReadStream(resolveUpload(att.storage_path)))
  })
}
