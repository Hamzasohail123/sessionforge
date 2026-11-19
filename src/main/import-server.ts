// SessionForge import server: the Chrome extension POSTs a session to http://127.0.0.1:<port>/import,
// and the session opens straight into a pane. For "Sign in with Chrome" it reads GET /pending and
// POSTs with a requestId, which imports into that request's existing session instead.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { SessionManager } from './session-manager'
import type { WindowManager } from './window-manager'
import { COLORS } from './constants'
import {
  deriveSessionName,
  formatZodIssues,
  HandOffImportSchema,
  ImportPayloadSchema,
  isHandOffPayload,
  pickSessionColor,
  resolveImportPort,
  type HandOffImport,
  type ImportPayload
} from './import-payload'
import type { CookieImportCounts } from './session-manager'
import type { PaneId, Tab } from './types'
import type { SignInImportPort } from './google-signin/coordinator'
import { inCookieScope } from './google-signin/domains'

const MAX_BODY = 5 * 1024 * 1024
const HARD_ABORT = 64 * 1024 * 1024

export interface ImportResult {
  sessionId: string
  tabId: string
  paneId: PaneId | null
  cookies: CookieImportCounts
  localStorageOrigins: number
}

export interface ImportServerStatus {
  port: number
  listening: boolean
  error?: string
}

/** "Sign in with Chrome" hand-off into an existing session */
export interface HandOffResult extends ImportResult {
  outOfScope: number
  intoExistingSession: true
}

/** A rejected request with a fixed status and code (the message is safe to show the user). */
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

const REQUEST_INVALID =
  'This sign-in request has expired or was already used. Click "Sign in with Chrome" in SessionForge again.'
/** Absent (Node, curl, tests) or the extension; web pages may not trigger imports. */
function originAllowed(origin: string | undefined): boolean {
  return origin === undefined || origin.startsWith('chrome-extension://')
}

/**
 * Only the literal loopback names reach the importer. Names that merely resolve to 127.0.0.1
 * (nip.io, localtest.me, DNS rebinding) carry their own Host and are refused.
 */
function hostAllowed(host: string | undefined, port: number): boolean {
  const h = (host ?? '').toLowerCase()
  return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`
}

export class ImportServer {
  private httpServer: Server | null = null
  private sessionManager: SessionManager
  private readonly port: number
  private listening = false
  private error: string | undefined
  /** Imports run one at a time, so concurrent POSTs get deterministic pane placement */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private windowManager: WindowManager,
    private signIn: SignInImportPort
  ) {
    this.sessionManager = SessionManager.getInstance()
    this.port = resolveImportPort(process.env.SESSIONFORGE_IMPORT_PORT)
  }

  start(): void {
    const server = createServer((req, res) => this.handle(req, res))
    server.on('error', (err: NodeJS.ErrnoException) => {
      this.listening = false
      this.error = err.code === 'EADDRINUSE' ? `port ${this.port} is in use` : err.message
      if (err.code === 'EADDRINUSE') console.error(`[import] port ${this.port} in use; extension import disabled`)
      else console.error('[import] server error', err.message)
    })
    server.listen(this.port, '127.0.0.1', () => {
      this.listening = true
      this.error = undefined
      console.log(`[import] listening on http://127.0.0.1:${this.port}/import`)
    })
    this.httpServer = server
  }
  /** For Settings → Chrome Import. */
  status(): ImportServerStatus {
    return { port: this.port, listening: this.listening, error: this.error }
  }

  stop(): void {
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
  }

  // Order: path+method 404 → Host 403 → Origin 403 → /pending Sec-Fetch-Mode 403 → CORS headers →
  // OPTIONS 204 → handler
  private handle(req: IncomingMessage, res: ServerResponse): void {
    const path = (req.url ?? '').split('?')[0]
    const route =
      path === '/import' && (req.method === 'POST' || req.method === 'OPTIONS')
        ? 'import'
        : path === '/pending' && (req.method === 'GET' || req.method === 'OPTIONS')
          ? 'pending'
          : null
    if (!route) {
      req.resume()
      return reply(res, 404, { success: false, error: 'Not found' })
    }

    if (!hostAllowed(req.headers.host, this.port)) {
      console.warn('[import] host not allowed', req.headers.host)
      res.setHeader('Connection', 'close')
      req.on('end', () => reply(res, 403, { success: false, error: 'Host not allowed' }))
      req.resume()
      return
    }

    const origin = req.headers.origin
    if (!originAllowed(origin)) {
      console.warn('[import] origin not allowed', origin)
      res.setHeader('Connection', 'close')
      // Drain first so the client can read the 403
      req.on('end', () => reply(res, 403, { success: false, error: 'Origin not allowed' }))
      req.resume()
      return
    }
    // A web page's no-cors GET (<img>, <script>) or navigation carries no Origin; refuse it by mode
    if (route === 'pending') {
      const mode = req.headers['sec-fetch-mode']
      if (mode !== undefined && mode !== 'cors' && mode !== 'same-origin') {
        console.warn('[import] request mode not allowed', mode)
        res.setHeader('Connection', 'close')
        req.on('end', () => reply(res, 403, { success: false, error: 'Request mode not allowed' }))
        req.resume()
        return
      }
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Methods', route === 'pending' ? 'GET, OPTIONS' : 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (route === 'pending') {
      req.resume()
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      return reply(res, 200, { requests: this.signIn.listForExtension() })
    }

    this.readBody(req, res, (body) => {
      let json: unknown
      try {
        json = JSON.parse(body)
      } catch {
        return reply(res, 400, { success: false, error: 'Invalid JSON' })
      }
      // "Sign in with Chrome": a payload with a requestId only ever goes into that request's session
      if (isHandOffPayload(json)) {
        const handOff = HandOffImportSchema.safeParse(json)
        if (!handOff.success) {
          return reply(res, 400, { success: false, error: 'Invalid payload: ' + formatZodIssues(handOff.error) })
        }
        const job = this.queue.then(() => this.runHandOff(handOff.data))
        this.queue = job.catch(() => undefined)
        job.then(
          (result) => reply(res, 200, { success: true, ...result }),
          (err: Error) => {
            if (err instanceof HttpError) {
              console.warn('[import] sign-in request rejected')
              return reply(res, err.status, { success: false, code: err.code, error: err.message })
            }
            console.error('[import] failed', err.message)
            reply(res, 500, { success: false, error: err.message })
          }
        )
        return
      }
      const parsed = ImportPayloadSchema.safeParse(json)
      if (!parsed.success) {
        return reply(res, 400, { success: false, error: 'Invalid payload: ' + formatZodIssues(parsed.error) })
      }

      const job = this.queue.then(() => this.run(parsed.data))
      this.queue = job.catch(() => undefined)
      job.then(
        (result) => reply(res, 200, { success: true, ...result }),
        (err: Error) => {
          console.error('[import] failed', err.message)
          reply(res, 500, { success: false, error: err.message })
        }
      )
    })
  }

  /**
   * Buffer the body up to MAX_BODY. A larger body is drained without buffering and answered with
   * 413 once it ends, so the client can read the response; past HARD_ABORT the socket is reset.
   */
  private readBody(req: IncomingMessage, res: ServerResponse, onBody: (body: string) => void): void {
    const tooLarge = () => reply(res, 413, { success: false, error: 'Payload too large (max 5 MB)' })
    const declared = Number(req.headers['content-length'])
    let total = 0
    let chunks: Buffer[] | null = []
    let aborted = false

    if (Number.isFinite(declared) && declared > MAX_BODY) {
      res.setHeader('Connection', 'close')
      chunks = null
    }

    req.on('data', (chunk: Buffer) => {
      if (aborted) return
      total += chunk.length
      if (total > HARD_ABORT) {
        aborted = true
        res.setHeader('Connection', 'close')
        tooLarge()
        req.destroy()
        return
      }
      if (chunks && total > MAX_BODY) {
        res.setHeader('Connection', 'close')
        chunks = null
      }
      chunks?.push(chunk)
    })
    req.on('end', () => {
      if (aborted) return
      if (!chunks) return tooLarge()
      onBody(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (err) => console.warn('[import] request error', err.message))
  }

  private async run(payload: ImportPayload): Promise<ImportResult> {
    const existing = this.sessionManager.getAllSessions()
    // Closed sessions keep their names, so reopening one never gives two sessions the same name
    const taken = [...existing, ...this.sessionManager.getClosedSessions()].map((s) => s.name)
    const name = deriveSessionName(payload, new Set(taken))
    const color = pickSessionColor(
      COLORS.map((c) => c.value),
      existing.map((s) => s.color)
    )
    const { session, cookies } = await this.sessionManager.importFromPlaywright(
      name,
      payload.storageState,
      'local',
      color
    )
    const seed = payload.storageState.origins.filter((o) => o.localStorage.length > 0)
    let tab: Tab
    try {
      tab = await this.windowManager.createTab(session.id, payload.metadata.url, { assign: 'place', seed })
    } catch (err) {
      // No tab means no way to reach the session (e.g. "Shutting down"), so do not leave it behind
      await this.sessionManager
        .deleteSession(session.id)
        .catch((e: Error) => console.warn('[import] cleanup failed', session.id, e.message))
      throw err
    }
    this.windowManager.bringToFront()
    const paneId = this.windowManager.getLayoutState().panes.find((p) => p.tabId === tab.id)?.paneId ?? null
    this.windowManager.notifyImported({ sessionId: session.id, tabId: tab.id, paneId, name })
    console.log('[import] imported session', session.id, `(${cookies.imported} cookies, ${seed.length} origins)`)
    return { sessionId: session.id, tabId: tab.id, paneId, cookies, localStorageOrigins: seed.length }
  }

  /**
   * Cookies into the existing session of a live, unused request (consumed here). Only cookies of the
   * request's domains are set; localStorage is ignored. Never creates a session.
   */
  private async runHandOff(p: HandOffImport): Promise<HandOffResult> {
    const req = this.signIn.takeRequest(p.requestId)
    if (!req) throw new HttpError(410, 'request_invalid', REQUEST_INVALID)
    const session = this.sessionManager.getSession(req.sessionId)
    if (!session) {
      this.signIn.failed(req)
      throw new HttpError(410, 'request_invalid', REQUEST_INVALID)
    }
    const inScope = p.storageState.cookies.filter((c) => inCookieScope(c.domain, req.cookieDomains))
    const outOfScope = p.storageState.cookies.length - inScope.length
    let counts: CookieImportCounts
    let placed: { tabId: string; paneId: PaneId | null }
    try {
      counts = await this.sessionManager.importCookiesInto(req.sessionId, inScope)
      placed = await this.signIn.complete(req)
    } catch (err) {
      // Cookies already set stay in the session the user chose
      this.signIn.failed(req)
      throw err
    }
    this.windowManager.notifyImported({ sessionId: session.id, ...placed, name: session.name, kind: 'signin' })
    console.log(
      `[import] signed in existing session ${session.id} (${counts.imported} cookies, ${outOfScope} out of scope)`
    )
    return {
      sessionId: session.id,
      tabId: placed.tabId,
      paneId: placed.paneId,
      cookies: counts,
      outOfScope,
      localStorageOrigins: 0,
      intoExistingSession: true
    }
  }
}

/** JSON response; does nothing when the client already went away. */
function reply(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed || res.socket?.destroyed) return
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
