// Redaction at the point where data leaves main toward an agent or the UI (design §8.8). Pure.

export const REDACTED = '[redacted]'

const SECRET_HEADER_RE = /token|secret|password|passwd|api[-_]?key/i
const SECRET_QUERY_RE = /token|secret|password|passwd|api[-_]?key|code|sig|signature|auth/i
const SECRET_JSON_RE = /token|secret|password|passwd|api[-_]?key|authorization|cookie/i
const TOKEN_RE = /sfa_[A-Za-z0-9_-]{43}/g
const AUTH_SCHEMES = new Set(['bearer', 'basic', 'digest', 'token'])
const COOKIE_ATTRS = /^(path|domain|expires|max-age|secure|httponly|samesite|priority|partitioned)$/i

function redactAuthorization(value: string): string {
  const scheme = value.trim().split(/\s+/)[0] ?? ''
  return AUTH_SCHEMES.has(scheme.toLowerCase()) && value.trim().includes(' ') ? `${scheme} ${REDACTED}` : REDACTED
}

function redactCookie(value: string): string {
  return value
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const eq = p.indexOf('=')
      return `${eq === -1 ? p : p.slice(0, eq)}=${REDACTED}`
    })
    .join('; ')
}

function redactSetCookie(value: string): string {
  const parts = value.split(';').map((p) => p.trim())
  const [first, ...attrs] = parts
  const eq = first.indexOf('=')
  const name = eq === -1 ? first : first.slice(0, eq)
  // Attributes are kept; anything that does not look like a cookie attribute is dropped
  const kept = attrs.filter((a) => COOKIE_ATTRS.test(a.split('=')[0].trim()))
  return [`${name}=${REDACTED}`, ...kept].join('; ')
}

export function redactHeaderValue(name: string, value: string): string {
  const n = name.toLowerCase()
  if (n === 'authorization' || n === 'proxy-authorization') return redactAuthorization(value)
  if (n === 'cookie') return redactCookie(value)
  if (n === 'set-cookie') return redactSetCookie(value)
  if (SECRET_HEADER_RE.test(n)) return REDACTED
  return value
}

export function isSensitiveHeader(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n === 'cookie' ||
    n === 'set-cookie' ||
    n === 'authorization' ||
    n === 'proxy-authorization' ||
    SECRET_HEADER_RE.test(n)
  )
}

export type HeaderBag = Record<string, string | string[] | undefined>

/** Header names are lower-cased; arrays (multi-value headers) are redacted element by element. */
export function redactHeaders(headers: HeaderBag | undefined | null): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  if (!headers) return out
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const key = name.toLowerCase()
    out[key] = Array.isArray(value)
      ? value.map((v) => redactText(redactHeaderValue(key, String(v))))
      : redactText(redactHeaderValue(key, String(value)))
  }
  return out
}

export function redactUrl(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return redactText(redactQueryString(url))
  }
  u.username = ''
  u.password = ''
  const params = [...u.searchParams.keys()]
  if (params.some((k) => SECRET_QUERY_RE.test(k))) {
    const next = new URLSearchParams()
    for (const [k, v] of u.searchParams) next.append(k, SECRET_QUERY_RE.test(k) ? REDACTED : v)
    u.search = next.toString()
  }
  return redactText(u.toString())
}

/** key=value pairs (query or form style) whose key looks secret get a redacted value. */
export function redactQueryString(s: string): string {
  return s.replace(/([^?&=\s]+)=([^&\s]*)/g, (m, k: string) => (SECRET_QUERY_RE.test(k) ? `${k}=${REDACTED}` : m))
}

export function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 20) return REDACTED
  if (Array.isArray(value)) return value.map((v) => redactJson(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_JSON_RE.test(k) ? REDACTED : redactJson(v, depth + 1)
    }
    return out
  }
  if (typeof value === 'string') return redactText(value)
  return value
}

export function redactText(s: string): string {
  return s.replace(TOKEN_RE, 'sfa_' + REDACTED)
}

export function cut(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function looksAbsoluteUrl(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s)
}

function redactBody(body: string, headers: Record<string, string> | undefined): string {
  try {
    return cut(JSON.stringify(redactJson(JSON.parse(body))), 200)
  } catch {
    // not JSON
  }
  const ct = Object.entries(headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
  if (/application\/x-www-form-urlencoded/i.test(ct)) {
    const p = new URLSearchParams(body)
    const next = new URLSearchParams()
    for (const [k, v] of p) next.append(k, SECRET_QUERY_RE.test(k) ? REDACTED : v)
    return cut(next.toString(), 200)
  }
  return `[body ${Buffer.byteLength(body, 'utf8')} bytes]`
}

/** Activity-log arguments (design §8.6): redacted, serialised, cut to 500 characters. */
export function redactArgs(tool: string, args: Record<string, unknown>, opts: { isPassword?: boolean } = {}): string {
  const a: Record<string, unknown> = { ...args }
  if (typeof a.url === 'string') a.url = redactUrl(a.url)
  if (typeof a.url_contains === 'string') {
    a.url_contains = looksAbsoluteUrl(a.url_contains) ? redactUrl(a.url_contains) : redactQueryString(a.url_contains)
  }
  // Masked unless the target is known not to be a password field (a call can fail before the check)
  if (tool === 'type' && typeof a.text === 'string' && opts.isPassword !== false) a.text = '•••'
  if (tool === 'send_request_as') {
    const headers = a.headers as Record<string, string> | undefined
    if (headers && typeof headers === 'object') a.headers = redactHeaders(headers)
    if (typeof a.body === 'string') a.body = redactBody(a.body, headers)
  }
  const json = JSON.stringify(redactJson(a))
  return cut(redactText(json), 500)
}
