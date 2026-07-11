import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const ROOT = resolve(process.cwd(), 'uploads')

export function safeExt(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return ''
  const ext = name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
  return ext ? `.${ext}` : ''
}

export async function saveUpload(requestId: number, fileName: string, buf: Buffer) {
  const rel = `${requestId}/${Date.now()}-${randomUUID()}${safeExt(fileName)}`
  const abs = join(ROOT, rel)
  await mkdir(join(ROOT, String(requestId)), { recursive: true })
  await writeFile(abs, buf)
  return { path: rel, size: buf.length }
}

export function resolveUpload(rel: string): string {
  const abs = resolve(ROOT, rel)
  if (!abs.startsWith(ROOT)) throw new Error('경로 이탈')  // path traversal 방지
  return abs
}
