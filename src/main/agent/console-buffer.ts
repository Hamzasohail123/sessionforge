// Per-tab console ring buffers (design §11.1). Pure: main feeds it from 'console-message'.
import { LIMITS } from './config'
import { cut, redactUrl } from './redact'

export type ConsoleLevel = 'debug' | 'info' | 'warning' | 'error'
const RANK: Record<ConsoleLevel, number> = { debug: 0, info: 1, warning: 2, error: 3 }

export interface ConsoleEntry {
  id: number
  at: number
  level: ConsoleLevel
  message: string
  source: string
  line: number
}

export function normaliseLevel(level: unknown): ConsoleLevel {
  if (level === 'debug' || level === 'info' || level === 'warning' || level === 'error') return level
  if (level === 'verbose') return 'debug'
  if (typeof level === 'number') return (['debug', 'info', 'warning', 'error'] as const)[Math.max(0, Math.min(3, level))]
  return 'info'
}

export class ConsoleBuffer {
  private rings = new Map<string, { entries: ConsoleEntry[]; dropped: number }>()
  private nextId = 1

  push(tabId: string, e: { level: unknown; message: string; sourceId: string; lineNumber: number }): void {
    let ring = this.rings.get(tabId)
    if (!ring) {
      ring = { entries: [], dropped: 0 }
      this.rings.set(tabId, ring)
    }
    ring.entries.push({
      id: this.nextId++,
      at: Date.now(),
      level: normaliseLevel(e.level),
      message: cut(String(e.message ?? ''), 2000),
      source: e.sourceId ? redactUrl(e.sourceId) : '',
      line: Number.isFinite(e.lineNumber) ? e.lineNumber : 0
    })
    if (ring.entries.length > LIMITS.consoleEntries) {
      ring.entries.shift()
      ring.dropped++
    }
  }

  query(
    tabId: string,
    opts: { level?: ConsoleLevel; since?: number; limit: number }
  ): { entries: ConsoleEntry[]; next_cursor: number; dropped: number } {
    const ring = this.rings.get(tabId)
    const min = RANK[opts.level ?? 'debug']
    const since = opts.since ?? 0
    const all = (ring?.entries ?? []).filter((e) => e.id > since && RANK[e.level] >= min)
    const entries = all.slice(-opts.limit)
    const next = entries.length ? entries[entries.length - 1].id : since
    return { entries, next_cursor: next, dropped: ring?.dropped ?? 0 }
  }

  dropTab(tabId: string): void {
    this.rings.delete(tabId)
  }

  clear(): void {
    this.rings.clear()
  }
}
