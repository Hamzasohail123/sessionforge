// send_request_as summary (design §13). Pure.
import { cut, redactHeaders, redactUrl } from './redact'

export interface DiffColumn {
  name: string
  status?: number
  location?: string
  bytes?: number
  bodyHash?: string
  /** Decoded body (for the JSON key comparison only; never printed here) */
  bodyText?: string
  durationMs?: number
  error?: string
}

function topKeys(text: string | undefined): Set<string> | null {
  if (!text) return null
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? new Set(Object.keys(v)) : null
  } catch {
    return null
  }
}

/** Location relative to the request when same-origin, else absolute; cut to 200 characters. */
export function displayLocation(location: string, requestUrl: string): string {
  try {
    const loc = new URL(location, requestUrl)
    const red = redactUrl(loc.toString())
    if (loc.origin === new URL(requestUrl).origin) return cut(red.slice(loc.origin.length) || '/', 200)
    return cut(red, 200)
  } catch {
    return cut(location, 200)
  }
}

function describe(c: DiffColumn, url: string): string {
  if (c.error) return `${c.name}: error ${c.error}`
  const parts = [c.location !== undefined ? `${c.status} -> ${displayLocation(c.location, url)}` : String(c.status)]
  parts.push(`${c.bytes ?? 0} B`)
  if (c.durationMs !== undefined) parts.push(`${c.durationMs} ms`)
  return `${c.name}: ${parts.join(', ')}`
}

export function compareColumns(base: DiffColumn, c: DiffColumn): string {
  if (c.error || base.error) return ''
  if (c.status === base.status && c.bodyHash === base.bodyHash) return `same as ${base.name}`
  const diffs: string[] = []
  if (c.status !== base.status) diffs.push(`status differs from ${base.name} (${c.status} vs ${base.status})`)
  if (c.bodyHash !== base.bodyHash) {
    diffs.push(`body differs (${c.bytes ?? 0} vs ${base.bytes ?? 0} bytes)`)
    const a = topKeys(base.bodyText)
    const b = topKeys(c.bodyText)
    if (a && b) {
      const onlyBase = [...a].filter((k) => !b.has(k)).slice(0, 10)
      const onlyThis = [...b].filter((k) => !a.has(k)).slice(0, 10)
      if (onlyBase.length) diffs.push(`keys only in ${base.name}: ${onlyBase.map((k) => cut(k, 40)).join(', ')}`)
      if (onlyThis.length) diffs.push(`keys only here: ${onlyThis.map((k) => cut(k, 40)).join(', ')}`)
    }
  }
  return diffs.join('; ')
}

/** One send_request_as column as the request engine produced it (response headers still raw). */
export interface RawColumn {
  name: string
  sessionId: string | null
  status?: number
  location?: string
  hops?: Array<{ status: number; location: string }>
  headers?: Record<string, string | string[]>
  bodyText?: string
  bodyHash?: string
  bytes?: number
  truncated?: boolean
  durationMs?: number
  error?: string
  message?: string
}

const TEXTUAL = /^text\/|json|xml|javascript|application\/x-www-form-urlencoded/i

export function headerValue(headers: Record<string, string | string[]> | undefined, name: string): string {
  if (!headers) return ''
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return Array.isArray(v) ? v.join(', ') : v
  }
  return ''
}

export function isTextual(contentType: string): boolean {
  return contentType === '' || TEXTUAL.test(contentType)
}

/** Agent-facing column JSON: headers and URLs redacted, body cut. Pure, unit-swept. */
export function columnOut(c: RawColumn, maxBodyChars: number): Record<string, unknown> {
  const out: Record<string, unknown> = { session: c.name }
  if (c.sessionId) out.session_id = c.sessionId
  if (c.error) {
    out.error = c.error
    if (c.message) out.message = c.message
    if (c.hops?.length) out.hops = c.hops.map((h) => ({ status: h.status, location: redactUrl(h.location) }))
    return out
  }
  out.status = c.status
  if (c.location !== undefined) out.location = redactUrl(c.location)
  if (c.hops?.length) out.hops = c.hops.map((h) => ({ status: h.status, location: redactUrl(h.location) }))
  out.headers = redactHeaders(c.headers ?? {})
  const ct = headerValue(c.headers, 'content-type')
  if (c.bodyText !== undefined) {
    if (isTextual(ct)) {
      out.body = c.bodyText.length > maxBodyChars ? c.bodyText.slice(0, maxBodyChars) : c.bodyText
      if (c.bodyText.length > maxBodyChars) out.body_truncated = true
    } else {
      out.body = `[binary ${c.bytes ?? 0} bytes, ${ct}]`
    }
  }
  out.bytes = c.bytes ?? 0
  if (c.truncated) out.truncated = true
  if (c.durationMs !== undefined) out.duration_ms = c.durationMs
  return out
}

export function toDiffColumn(c: RawColumn): DiffColumn {
  return {
    name: c.name,
    status: c.status,
    location: c.location,
    bytes: c.bytes,
    bodyHash: c.bodyHash,
    bodyText: c.bodyText,
    durationMs: c.durationMs,
    error: c.error
  }
}

export function summarize(method: string, url: string, columns: DiffColumn[]): string {
  const lines = [`send_request_as ${method} ${redactUrl(url)}`]
  const base = columns[0]
  columns.forEach((c, i) => {
    let line = describe(c, url)
    if (i > 0 && base) {
      const cmp = compareColumns(base, c)
      if (cmp) line += ` — ${cmp}`
    }
    lines.push(line)
  })
  return lines.join('\n')
}
