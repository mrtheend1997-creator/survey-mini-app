import { authHeader } from './telegram'
import type { Lang } from './i18n'

export class ApiError extends Error {
  status: number
  code: string
  messageUz?: string
  messageRu?: string
  extra: Record<string, unknown>
  constructor(status: number, code: string, detail: Record<string, unknown> = {}) {
    super(code)
    this.status = status
    this.code = code
    this.messageUz = detail.message_uz as string | undefined
    this.messageRu = detail.message_ru as string | undefined
    this.extra = detail
  }
  text(lang: Lang): string | undefined {
    return lang === 'uz' ? this.messageUz : this.messageRu
  }
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = { Authorization: authHeader() }
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'network')
  }
  if (!res.ok) {
    let detail: Record<string, unknown> = {}
    try {
      const data = await res.json()
      if (data && typeof data.detail === 'object' && !Array.isArray(data.detail)) detail = data.detail
      else if (Array.isArray(data?.detail)) detail = { code: 'validation', items: data.detail }
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, (detail.code as string) || `http_${res.status}`, detail)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form, true),
}

export function qs(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}
