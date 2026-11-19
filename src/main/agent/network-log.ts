// Per-tab request ring buffers and in-flight counters (design §11.3). Pure: the bridge subscribes
// every session through the WebRequestHub and feeds events here after the grant filter.
import type { HubEvent } from '../web-request-hub'
import { LIMITS } from './config'
import { redactHeaders, redactUrl } from './redact'

export interface NetworkEntry {
  id: number
  requestId: number
  method: string
  url: string
  status: number | null
  error: string | null
  type: string
  start: number
  duration_ms: number | null
  from_cache: boolean
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string[]>
}

/** What an agent sees: URL and headers redacted; headers only on request. Pure, unit-swept. */
export function networkEntryOut(e: NetworkEntry, includeHeaders: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: e.id,
    method: e.method,
    url: redactUrl(e.url),
    status: e.status,
    error: e.error,
    type: e.type,
    start: e.start,
    duration_ms: e.duration_ms,
    from_cache: e.from_cache
  }
  if (includeHeaders) {
    out.request_headers = redactHeaders(e.requestHeaders ?? {})
    out.response_headers = redactHeaders(e.responseHeaders ?? {})
  }
  return out
}

interface TabLog {
  done: NetworkEntry[]
  pending: Map<number, NetworkEntry>
  inFlight: number
}

export class NetworkLog {
  private tabs = new Map<string, TabLog>()
  private nextId = 1

  private log(tabId: string): TabLog {
    let t = this.tabs.get(tabId)
    if (!t) {
      t = { done: [], pending: new Map(), inFlight: 0 }
      this.tabs.set(tabId, t)
    }
    return t
  }

  private finish(t: TabLog, entry: NetworkEntry): void {
    t.done.push(entry)
    if (t.done.length > LIMITS.networkEntries) t.done.shift()
  }

  private expire(t: TabLog, now: number): void {
    for (const [rid, p] of t.pending) {
      if (now - p.start > LIMITS.networkPendingMaxAgeMs) {
        t.pending.delete(rid)
        t.inFlight = Math.max(0, t.inFlight - 1)
        this.finish(t, { ...p, error: 'unfinished' })
      }
    }
  }

  record(tabId: string, e: HubEvent): void {
    const t = this.log(tabId)
    this.expire(t, e.timestamp)
    if (e.kind === 'send') {
      if (t.pending.size >= LIMITS.networkPending) {
        const oldest = t.pending.keys().next().value
        if (oldest !== undefined) t.pending.delete(oldest)
        t.inFlight = Math.max(0, t.inFlight - 1)
      }
      t.pending.set(e.id, {
        id: this.nextId++,
        requestId: e.id,
        method: e.method,
        url: e.url,
        status: null,
        error: null,
        type: e.resourceType,
        start: e.timestamp,
        duration_ms: null,
        from_cache: false,
        requestHeaders: e.requestHeaders
      })
      t.inFlight++
      return
    }
    const p = t.pending.get(e.id)
    if (p) {
      t.pending.delete(e.id)
      t.inFlight = Math.max(0, t.inFlight - 1)
    }
    const base: NetworkEntry = p ?? {
      id: this.nextId++,
      requestId: e.id,
      method: e.method,
      url: e.url,
      status: null,
      error: null,
      type: e.resourceType,
      start: e.timestamp,
      duration_ms: null,
      from_cache: false
    }
    if (e.kind === 'completed') {
      this.finish(t, {
        ...base,
        status: e.statusCode,
        from_cache: e.fromCache,
        duration_ms: p ? Math.max(0, Math.round(e.timestamp - p.start)) : null,
        responseHeaders: e.responseHeaders
      })
    } else {
      this.finish(t, { ...base, error: e.error, duration_ms: p ? Math.max(0, Math.round(e.timestamp - p.start)) : null })
    }
  }

  inFlight(tabId: string): number {
    return this.tabs.get(tabId)?.inFlight ?? 0
  }

  query(
    tabId: string,
    opts: { since?: number; limit: number; urlContains?: string; failedOnly?: boolean; includeHeaders: boolean }
  ): { entries: Array<Record<string, unknown>>; next_cursor: number; in_flight: number } {
    const t = this.tabs.get(tabId)
    const since = opts.since ?? 0
    const all = (t?.done ?? []).filter(
      (e) =>
        e.id > since &&
        // Match what the agent is shown, so the filter cannot reveal redacted values
        (!opts.urlContains || redactUrl(e.url).includes(opts.urlContains)) &&
        (!opts.failedOnly || e.error !== null || (e.status !== null && e.status >= 400))
    )
    const entries = all.slice(-opts.limit)
    return {
      entries: entries.map((e) => networkEntryOut(e, opts.includeHeaders)),
      next_cursor: entries.length ? Math.max(...entries.map((e) => e.id)) : since,
      in_flight: t?.inFlight ?? 0
    }
  }

  dropTab(tabId: string): void {
    this.tabs.delete(tabId)
  }

  dropTabs(tabIds: string[]): void {
    for (const id of tabIds) this.tabs.delete(id)
  }

  clear(): void {
    this.tabs.clear()
  }
}
