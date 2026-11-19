// send_request_as engine (design §13): net.request on the session's partition with its cookie jar,
// always redirect: 'manual' so every hop is reported or guard-checked.
import { net, type Session } from 'electron'
import { createHash } from 'crypto'
import { LIMITS } from './config'
import { headerValue, isTextual, type RawColumn } from './diff'

export const FORBIDDEN_HEADERS = new Set([
  'cookie',
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'te',
  'trailer'
])

export function isForbiddenHeader(name: string): boolean {
  const n = name.toLowerCase()
  return FORBIDDEN_HEADERS.has(n) || n.startsWith('proxy-')
}

export interface ColumnRequest {
  name: string
  sessionId: string | null
  ses: Session
  /** false for the "No session" column: no cookies sent or stored */
  useCookies: boolean
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  followRedirects: boolean
  /** Returns an error code when a redirect hop is not allowed */
  checkHop: (url: string) => string | null
  timeoutMs: number
  signal: AbortSignal
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

export function runColumn(o: ColumnRequest): Promise<RawColumn> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const hops: Array<{ status: number; location: string }> = []
    let settled = false
    let req: Electron.ClientRequest | null = null
    const base = { name: o.name, sessionId: o.sessionId }
    const done = (c: Omit<RawColumn, 'name' | 'sessionId'>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      o.signal.removeEventListener('abort', onAbort)
      resolve({ ...base, ...c, durationMs: Date.now() - t0 })
      try {
        req?.abort()
      } catch {
        // already finished
      }
    }
    const onAbort = () => done({ error: 'stopped', hops: hops.length ? hops : undefined })
    const timer = setTimeout(() => done({ error: 'timeout', hops: hops.length ? hops : undefined }), o.timeoutMs)
    if (o.signal.aborted) return onAbort()
    o.signal.addEventListener('abort', onAbort, { once: true })

    try {
      req = net.request({
        method: o.method,
        url: o.url,
        session: o.ses,
        useSessionCookies: o.useCookies,
        credentials: o.useCookies ? 'include' : 'omit',
        redirect: 'manual'
      })
      for (const [k, v] of Object.entries(o.headers)) req.setHeader(k, v)
    } catch (e) {
      return done({ error: 'request_failed', message: (e as Error).message.slice(0, 300) })
    }
    const r = req

    r.on('redirect', (status, _method, redirectUrl, headers) => {
      if (settled) return
      if (!o.followRedirects) {
        done({
          status,
          location: redirectUrl,
          headers: headers as Record<string, string[]>,
          bodyText: '',
          bodyHash: sha(Buffer.alloc(0)),
          bytes: 0,
          hops: hops.length ? hops : undefined
        })
        return
      }
      const blocked = o.checkHop(redirectUrl)
      if (blocked) {
        hops.push({ status, location: redirectUrl })
        done({ error: blocked, hops })
        return
      }
      if (hops.length >= LIMITS.requestAsMaxHops) {
        done({ error: 'too_many_redirects', hops })
        return
      }
      hops.push({ status, location: redirectUrl })
      r.followRedirect()
    })

    r.on('response', (res) => {
      const chunks: Buffer[] = []
      let n = 0
      let truncated = false
      const finish = () => {
        const buf = Buffer.concat(chunks)
        const headers = res.headers as Record<string, string | string[]>
        const ct = headerValue(headers, 'content-type')
        done({
          status: res.statusCode,
          headers,
          bodyText: isTextual(ct) ? buf.toString('utf8') : '',
          bodyHash: sha(buf),
          bytes: buf.length,
          truncated: truncated || undefined,
          hops: hops.length ? hops : undefined
        })
      }
      res.on('data', (chunk: Buffer) => {
        if (truncated || settled) return
        n += chunk.length
        if (n > LIMITS.requestAsMaxResponseBytes) {
          truncated = true
          chunks.push(chunk.subarray(0, chunk.length - (n - LIMITS.requestAsMaxResponseBytes)))
          finish()
          return
        }
        chunks.push(chunk)
      })
      res.on('end', finish)
      res.on('error', (e: Error) => done({ error: 'request_failed', message: e.message.slice(0, 300) }))
    })

    r.on('error', (e: Error) => done({ error: 'request_failed', message: e.message.slice(0, 300) }))
    try {
      if (o.body !== undefined) r.end(o.body)
      else r.end()
    } catch (e) {
      done({ error: 'request_failed', message: (e as Error).message.slice(0, 300) })
    }
  })
}
