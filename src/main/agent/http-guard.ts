// HTTP front door checks for /mcp, in order (design §7.1). Pure. Cheap and rebinding checks run
// before auth.

export interface GuardRequest {
  path: string
  method: string | undefined
  host: string | undefined
  origin: string | undefined
  authorization: string | undefined
  contentType: string | undefined
}

export interface GuardConfig {
  port: number
  tokenMatches: (token: string) => boolean
}

export type RejectReason = 'path' | 'host' | 'origin' | 'method' | 'bad_token' | 'content_type'

export type GuardResult =
  | { ok: true }
  | { ok: false; status: number; reason: RejectReason; message: string; headers?: Record<string, string> }

export function checkRequest(req: GuardRequest, cfg: GuardConfig): GuardResult {
  const path = req.path.split('?')[0]
  if (path !== '/mcp') return { ok: false, status: 404, reason: 'path', message: 'Not found' }

  const host = (req.host ?? '').toLowerCase()
  if (host !== `127.0.0.1:${cfg.port}` && host !== `localhost:${cfg.port}`) {
    return { ok: false, status: 403, reason: 'host', message: 'Host not allowed' }
  }

  if (req.origin !== undefined) {
    return { ok: false, status: 403, reason: 'origin', message: 'Requests from web pages are not allowed' }
  }

  const method = (req.method ?? '').toUpperCase()
  if (method !== 'POST' && method !== 'GET' && method !== 'DELETE') {
    return {
      ok: false,
      status: 405,
      reason: 'method',
      message: 'Method not allowed',
      headers: { Allow: 'GET, POST, DELETE' }
    }
  }

  const m = /^Bearer ([^\s]+)$/.exec(req.authorization ?? '')
  if (!m || !cfg.tokenMatches(m[1])) {
    return {
      ok: false,
      status: 401,
      reason: 'bad_token',
      message: 'Missing or invalid bearer token',
      headers: { 'WWW-Authenticate': 'Bearer realm="sessionforge"' }
    }
  }

  if (method === 'POST' && !(req.contentType ?? '').toLowerCase().includes('application/json')) {
    return { ok: false, status: 415, reason: 'content_type', message: 'Content-Type must be application/json' }
  }
  return { ok: true }
}
