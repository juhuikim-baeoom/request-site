import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
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
  // 구분자까지 포함해 검사 (ROOT='/a/uploads' 일 때 '/a/uploads-evil' 우회 방지)
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) throw new Error('경로 이탈')
  return abs
}
