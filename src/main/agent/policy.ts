// Grants, the production cap, Stop and the abort registry (design §8.1–8.3). Pure: the DB and the
// session list are injected, so the unit spec uses fakes.
import { AgentError } from './errors'
import type { AgentGrant, AgentSessionGrant } from './types'
import type { EnvTag } from '../types'

const RANK: Record<AgentGrant, number> = { hidden: 0, read: 1, control: 2 }

export function effectiveGrant(stored: AgentGrant, env: EnvTag, elevated: boolean): AgentGrant {
  if (env === 'production' && stored === 'control' && !elevated) return 'read'
  return stored
}

export interface GrantStore {
  getAgentGrants(): Array<{ sessionId: string; level: AgentGrant }>
  setAgentGrant(sessionId: string, level: AgentGrant): void
}

export interface PolicySession {
  id: string
  name: string
  env: EnvTag
}

export interface SessionLookup {
  getSession(id: string): PolicySession | undefined
  getAllSessions(): PolicySession[]
}

export type Need = 'read' | 'control'

interface Registered {
  sessionIds: Set<string>
  controller: AbortController
}

export class AgentPolicy {
  private elevated = new Set<string>()
  private inflight = new Set<Registered>()

  constructor(
    private readonly store: GrantStore,
    private readonly sessions: SessionLookup,
    /** Called after any grant change (broadcast to the renderer) */
    private readonly onChange: () => void = () => undefined
  ) {}

  /** Read from the DB on every call: an env or grant change applies to the very next call. */
  stored(sessionId: string): AgentGrant {
    const row = this.store.getAgentGrants().find((g) => g.sessionId === sessionId)
    return row?.level ?? 'read'
  }

  effective(sessionId: string): AgentGrant {
    const s = this.sessions.getSession(sessionId)
    if (!s) return 'hidden'
    return effectiveGrant(this.stored(sessionId), s.env, this.elevated.has(sessionId))
  }

  isVisible(sessionId: string): boolean {
    return this.effective(sessionId) !== 'hidden'
  }

  canControl(sessionId: string): boolean {
    return this.effective(sessionId) === 'control'
  }

  grantOf(sessionId: string): AgentSessionGrant | null {
    const s = this.sessions.getSession(sessionId)
    if (!s) return null
    const stored = this.stored(sessionId)
    const elevated = this.elevated.has(sessionId)
    const effective = effectiveGrant(stored, s.env, elevated)
    return {
      sessionId,
      stored,
      effective,
      productionCapped: s.env === 'production' && stored === 'control' && !elevated,
      elevated: s.env === 'production' && elevated
    }
  }

  allGrants(): AgentSessionGrant[] {
    return this.sessions
      .getAllSessions()
      .map((s) => this.grantOf(s.id))
      .filter((g): g is AgentSessionGrant => g !== null)
  }

  /** Throws unknown_session / production_read_only / permission_denied. */
  check(sessionId: string, need: Need): PolicySession {
    const s = this.sessions.getSession(sessionId)
    const eff = this.effective(sessionId)
    if (!s || eff === 'hidden') {
      throw new AgentError('unknown_session', `No session named or with id '${sessionId}'.`, 'Call list_sessions.')
    }
    if (need === 'control' && eff !== 'control') {
      if (s.env === 'production' && this.stored(sessionId) === 'control') {
        throw new AgentError(
          'production_read_only',
          `Session '${s.name}' is a production session and is read-only for agents.`,
          'The user can allow control until restart in SessionForge → Settings → Agent Bridge.'
        )
      }
      throw new AgentError(
        'permission_denied',
        `Session '${s.name}' is read-only for agents.`,
        'The user can allow control in SessionForge → Settings → Agent Bridge.'
      )
    }
    return s
  }

  /** IPC only, never MCP. Production control needs the exact session name as confirm. */
  setGrant(sessionId: string, level: AgentGrant, confirm?: string): AgentSessionGrant {
    const s = this.sessions.getSession(sessionId)
    if (!s) throw new Error('Session not found')
    const before = this.effective(sessionId)
    if (s.env === 'production' && level === 'control') {
      if ((confirm ?? '').trim() !== s.name) throw new Error(`Type the session name "${s.name}" to confirm`)
      this.store.setAgentGrant(sessionId, 'control')
      this.elevated.add(sessionId)
    } else {
      this.elevated.delete(sessionId)
      this.store.setAgentGrant(sessionId, level)
    }
    const after = this.effective(sessionId)
    if (RANK[after] < RANK[before]) {
      this.abortSession(
        sessionId,
        new AgentError('grant_changed', `Agent access to '${s.name}' was lowered by the user.`)
      )
    }
    this.onChange()
    return this.grantOf(sessionId)!
  }

  /** Pane-header Stop: store read (persisted), drop elevation, abort in-flight calls. */
  stop(sessionId: string): PolicySession | null {
    const s = this.sessions.getSession(sessionId)
    if (!s) return null
    this.elevated.delete(sessionId)
    this.store.setAgentGrant(sessionId, this.stored(sessionId) === 'hidden' ? 'hidden' : 'read')
    this.abortSession(sessionId, new AgentError('stopped', `The user stopped agent control of '${s.name}'.`))
    this.onChange()
    return s
  }

  /** Session closed, deleted or reopened: production control needs a new confirmation. No broadcast. */
  forgetElevation(sessionId: string): void {
    this.elevated.delete(sessionId)
  }

  // ---------------------------------------------------------------- abort registry

  register(sessionIds: string[], controller: AbortController): () => void {
    const entry: Registered = { sessionIds: new Set(sessionIds), controller }
    this.inflight.add(entry)
    return () => {
      this.inflight.delete(entry)
    }
  }

  abortSession(sessionId: string, reason: AgentError): void {
    for (const e of [...this.inflight]) {
      if (e.sessionIds.has(sessionId) && !e.controller.signal.aborted) e.controller.abort(reason)
    }
  }

  abortAll(reason: AgentError): void {
    for (const e of [...this.inflight]) if (!e.controller.signal.aborted) e.controller.abort(reason)
  }

  get inflightCount(): number {
    return this.inflight.size
  }
}
