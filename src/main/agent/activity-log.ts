// In-memory activity log (design §8.6). Never written to disk or stdout. Pure.
import { LIMITS } from './config'
import { redactArgs, redactText } from './redact'
import type { ActivityOutcome, AgentActivityEntry } from './types'

export interface ActivityInput {
  client: string
  tool: string
  sessionId: string | null
  sessionName: string | null
  tabId: string | null
  args: Record<string, unknown>
  isPassword?: boolean
  outcome: ActivityOutcome
  code?: string
  durationMs: number
  /** A SessionForge-built note instead of arguments (e.g. "blocked navigation to <host>") */
  note?: string
}

/** Pure builder, also used by the redaction unit sweep. */
export function buildActivityEntry(id: number, at: number, a: ActivityInput): AgentActivityEntry {
  return {
    id,
    at,
    client: redactText(a.client),
    tool: a.tool,
    sessionId: a.sessionId,
    sessionName: a.sessionName,
    tabId: a.tabId,
    args: a.note !== undefined ? redactText(a.note) : redactArgs(a.tool, a.args, { isPassword: a.isPassword }),
    outcome: a.outcome,
    code: a.code,
    durationMs: a.durationMs
  }
}

export class ActivityLog {
  private entries: AgentActivityEntry[] = []
  private nextId = 1

  constructor(private readonly onEntry: (e: AgentActivityEntry) => void = () => undefined) {}

  add(a: ActivityInput): AgentActivityEntry {
    const e = buildActivityEntry(this.nextId++, Date.now(), a)
    this.entries.push(e)
    if (this.entries.length > LIMITS.activityEntries) this.entries.shift()
    this.onEntry(e)
    return e
  }

  /** Newest first */
  list(): AgentActivityEntry[] {
    return [...this.entries].reverse()
  }

  clear(): void {
    this.entries = []
  }
}
