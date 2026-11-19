// One-time pending "Sign in with Chrome" requests. Pure (Node crypto only).
import { randomUUID } from 'crypto'
import type { SignInKind } from './types'

export const PENDING_TTL_MS = 10 * 60_000
export const MAX_PENDING = 8

export interface PendingSignIn {
  id: string
  sessionId: string
  /** Tab that showed the banner */
  tabId: string
  /** Tab to navigate on success (the opener for OAuth popups) */
  returnTabId: string
  kind: SignInKind
  /** Main only, never sent over HTTP */
  chromeUrl: string
  returnUrl: string
  targetHost: string
  /** 1..2 entries, lowercase */
  cookieDomains: string[]
  /** Set after launch (e.g. 'Google Chrome'); null while the browser is being opened */
  browser: string | null
  createdAt: number
  /** createdAt + ttl */
  expiresAt: number
}

/** Exactly what GET /pending returns per request */
export interface PendingSummary {
  id: string
  sessionName: string
  sessionColor: string
  cookieDomains: string[]
  expiresAt: number
}

export type RemovedReason = 'expired' | 'evicted' | 'replaced'

export interface PendingStoreOptions {
  now?: () => number
  ttlMs?: number
  /** One unref'd timer per request (production); unit specs turn it off */
  timers?: boolean
  onRemoved?: (r: PendingSignIn, why: RemovedReason) => void
}

export class PendingSignInStore {
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly timers: boolean
  private readonly onRemoved?: (r: PendingSignIn, why: RemovedReason) => void
  private readonly requests = new Map<string, PendingSignIn>()
  private readonly timerOf = new Map<string, NodeJS.Timeout>()

  constructor(opts: PendingStoreOptions = {}) {
    this.now = opts.now ?? Date.now
    this.ttlMs = opts.ttlMs ?? PENDING_TTL_MS
    this.timers = opts.timers ?? true
    this.onRemoved = opts.onRemoved
  }

  create(input: Omit<PendingSignIn, 'id' | 'createdAt' | 'expiresAt'>): PendingSignIn {
    this.purge()
    for (const r of [...this.requests.values()]) {
      if (r.sessionId === input.sessionId || r.tabId === input.tabId) this.remove(r, 'replaced')
    }
    const createdAt = this.now()
    const req: PendingSignIn = { ...input, id: randomUUID(), createdAt, expiresAt: createdAt + this.ttlMs }
    this.requests.set(req.id, req)
    if (this.timers) {
      const t = setTimeout(() => {
        const live = this.requests.get(req.id)
        if (live) this.expire(live)
      }, this.ttlMs)
      t.unref?.()
      this.timerOf.set(req.id, t)
    }
    while (this.requests.size > MAX_PENDING) {
      const oldest = [...this.requests.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
      this.remove(oldest, 'evicted')
    }
    return req
  }

  /** Live requests, newest first. */
  list(): PendingSignIn[] {
    this.purge()
    return [...this.requests.values()].reverse()
  }

  forTab(tabId: string): PendingSignIn | null {
    this.purge()
    for (const r of this.requests.values()) if (r.tabId === tabId) return r
    return null
  }

  /** One-time use: the request is removed whatever the outcome; returned only when its session is alive. */
  take(id: string, sessionAlive: (sessionId: string) => boolean): PendingSignIn | null {
    this.purge()
    const r = this.requests.get(id)
    if (!r) return null
    this.remove(r, null)
    return sessionAlive(r.sessionId) ? r : null
  }

  cancel(id: string): void {
    const r = this.requests.get(id)
    if (r) this.remove(r, null)
  }

  cancelForTab(tabId: string): void {
    for (const r of [...this.requests.values()]) if (r.tabId === tabId) this.remove(r, null)
  }

  expireForTest(id: string): void {
    if (process.env.SESSIONFORGE_E2E !== '1') throw new Error('expireForTest is only available in e2e runs')
    const r = this.requests.get(id)
    if (r) this.expire(r)
  }

  /** Clears every timer and removes all requests, without notifications. */
  dispose(): void {
    for (const t of this.timerOf.values()) clearTimeout(t)
    this.timerOf.clear()
    this.requests.clear()
  }

  private purge(): void {
    const now = this.now()
    for (const r of [...this.requests.values()]) if (now >= r.expiresAt) this.expire(r)
  }

  private expire(r: PendingSignIn): void {
    this.remove(r, 'expired')
  }

  /** The only removal path: map delete first, so each request is removed and notified at most once. */
  private remove(r: PendingSignIn, why: RemovedReason | null): void {
    if (this.requests.get(r.id) !== r) return
    this.requests.delete(r.id)
    const t = this.timerOf.get(r.id)
    if (t) clearTimeout(t)
    this.timerOf.delete(r.id)
    if (why === null || !this.onRemoved) return
    try {
      this.onRemoved(r, why)
    } catch (e) {
      console.warn('[signin] expiry handler failed', (e as Error)?.message ?? e)
    }
  }
}
