const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
).replace(/\/$/, '')

const JWT_STORAGE_KEY = 'atlassian_demo_jwt'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function getJwt(): string | null {
  return sessionStorage.getItem(JWT_STORAGE_KEY)
}

export function setJwt(token: string): void {
  sessionStorage.setItem(JWT_STORAGE_KEY, token)
}

export function clearJwt(): void {
  sessionStorage.removeItem(JWT_STORAGE_KEY)
}

export function getLoginUrl(): string {
  return `${API_BASE}/api/auth/login`
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')

  const jwt = getJwt()
  if (jwt) {
    headers.set('Authorization', `Bearer ${jwt}`)
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers })

  if (!response.ok) {
    let code = `HTTP_${response.status}`
    let message = response.statusText || 'Request failed'

    try {
      const body = (await response.json()) as {
        detail?: string | { code?: string; message?: string }
      }
      const detail = body?.detail
      if (typeof detail === 'string') {
        message = detail
      } else if (detail && typeof detail === 'object') {
        code = detail.code ?? code
        message = detail.message ?? message
      }
    } catch {
      // The response body was not JSON; keep the status text.
    }

    throw new ApiError(response.status, code, message)
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}
