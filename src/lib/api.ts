export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || res.statusText
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' })
  return parse<T>(res)
}

export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  // 본문이 있을 때만 Content-Type: application/json 을 보낸다.
  // (본문 없이 JSON 헤더만 보내면 Fastify가 FST_ERR_CTP_EMPTY_JSON_BODY 400으로 거부 →
  //  dev-login·logout·알림 읽음 등 바디 없는 POST가 전부 실패한다.)
  const hasBody = body !== undefined
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  })
  return parse<T>(res)
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  return parse<T>(res)
}
