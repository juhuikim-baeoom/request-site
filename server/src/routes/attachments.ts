import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { authenticate } from '../auth/session.js'
import { canSeeRequest, isViewerUp } from '../authz.js'
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
    // multipart: 파일 파트와 함께 comment_id 텍스트 필드 지원
    // @fastify/multipart의 MultipartFile.fields에 같이 전송된 모든 필드가 담김
    const part = await request.file()
    if (!part) { reply.code(400).send({ error: 'no file' }); return }
    const buf = await part.toBuffer()

    // comment_id 추출 (선택적 폼 필드)
    let commentId: number | null = null
    const rawCommentId = (part.fields as any)?.comment_id
    if (rawCommentId !== undefined) {
      const raw = String(
        rawCommentId?.type === 'field' ? rawCommentId.value : rawCommentId ?? '',
      ).trim()
      const parsed = parseInt(raw, 10)
      if (!isNaN(parsed) && parsed > 0) commentId = parsed
    }

    const { path, size } = await saveUpload(id, part.filename, buf)
    const r = await db.execute<any>(sql`
      insert into request_attachments (request_id, storage_path, file_name, file_size, mime_type, uploaded_by, comment_id)
      values (${id}, ${path}, ${part.filename}, ${size}, ${part.mimetype || null}, ${u.id}, ${commentId})
      returning *`)
    reply.code(201); return r.rows[0]
  })

  app.get<{ Params: { id: string } }>('/api/attachments/:id/download', async (request, reply) => {
    const u = request.currentUser!
    const attId = parseId(request.params.id)
    if (attId === null) { reply.code(404).send({ error: 'not found' }); return }
    const a = await db.execute<any>(sql`select * from request_attachments where id = ${attId}`)
    const att = a.rows[0]; if (!att) { reply.code(404).send({ error: 'not found' }); return }
    // 다운로드 권한: 시스템팀·열람자, 업로더 본인, 또는 해당 요청을 열람할 수 있는 사용자
    // (시스템팀이 요청자에게 전달하는 산출물 파일 다운로드 지원)
    const canDownload = isViewerUp(u) || att.uploaded_by === u.id || (await canSee(u, att.request_id))
    if (!canDownload) { reply.code(404).send({ error: 'not found' }); return }
    reply.header('Content-Type', att.mime_type ?? 'application/octet-stream')
    reply.header('X-Content-Type-Options', 'nosniff') // 클라이언트 지정 MIME 스니핑 방지
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.file_name ?? 'file')}`)
    return reply.send(createReadStream(resolveUpload(att.storage_path)))
  })
}
