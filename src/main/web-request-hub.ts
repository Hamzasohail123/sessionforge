// The only place that calls ses.webRequest.*. Electron keeps just the last listener per webRequest
// event, so every feature subscribes here instead of attaching its own. M1 uses only the observer
// events (onSendHeaders, onCompleted, onErrorOccurred), which never block requests. M2 adds use()
// middleware for the blocking events (onBeforeRequest, onBeforeSendHeaders, onHeadersReceived).
import type { Session } from 'electron'

interface HubBase {
  id: number
  url: string
  method: string
  resourceType: string
  webContentsId?: number
  timestamp: number
}

export type HubEvent =
  | (HubBase & { kind: 'send'; requestHeaders: Record<string, string> })
  | (HubBase & {
      kind: 'completed'
      statusCode: number
      responseHeaders?: Record<string, string[]>
      fromCache: boolean
    })
  | (HubBase & { kind: 'error'; error: string })

export type HubListener = (e: HubEvent) => void

const hubs = new WeakMap<Session, WebRequestHub>()

export class WebRequestHub {
  private listeners = new Set<HubListener>()
  private warned = new WeakSet<HubListener>()
  private attached = false

  private constructor(private readonly ses: Session) {}

  /** One hub per Electron Session object. */
  static for(ses: Session): WebRequestHub {
    let hub = hubs.get(ses)
    if (!hub) {
      hub = new WebRequestHub(ses)
      hubs.set(ses, hub)
    }
    return hub
  }

  /** Attaches the webRequest listeners on the first subscriber; detaches after the last. */
  subscribe(listener: HubListener): () => void {
    this.listeners.add(listener)
    if (!this.attached) this.attach()
    let done = false
    return () => {
      if (done) return
      done = true
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.detach()
    }
  }

  /** 0 means no webRequest listener is attached. */
  get subscriberCount(): number {
    return this.listeners.size
  }

  private emit(e: HubEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e)
      } catch (err) {
        if (!this.warned.has(l)) {
          this.warned.add(l)
          console.warn('[webRequest] listener failed', (err as Error).message)
        }
      }
    }
  }

  private attach(): void {
    const wr = this.ses.webRequest
    wr.onSendHeaders((d) =>
      this.emit({
        kind: 'send',
        id: d.id,
        url: d.url,
        method: d.method,
        resourceType: d.resourceType,
        webContentsId: d.webContentsId,
        timestamp: d.timestamp,
        requestHeaders: d.requestHeaders
      })
    )
    wr.onCompleted((d) =>
      this.emit({
        kind: 'completed',
        id: d.id,
        url: d.url,
        method: d.method,
        resourceType: d.resourceType,
        webContentsId: d.webContentsId,
        timestamp: d.timestamp,
        statusCode: d.statusCode,
        responseHeaders: d.responseHeaders,
        fromCache: d.fromCache
      })
    )
    wr.onErrorOccurred((d) =>
      this.emit({
        kind: 'error',
        id: d.id,
        url: d.url,
        method: d.method,
        resourceType: d.resourceType,
        webContentsId: d.webContentsId,
        timestamp: d.timestamp,
        error: d.error
      })
    )
    this.attached = true
  }

  private detach(): void {
    const wr = this.ses.webRequest
    wr.onSendHeaders(null)
    wr.onCompleted(null)
    wr.onErrorOccurred(null)
    this.attached = false
  }
}
