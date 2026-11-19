// Pane placement for open and set_layout (design §14). Pure over the layout state.
import { AgentError } from './errors'
import type { LayoutMode, PaneId } from '../types'

export interface PlaceState {
  mode: LayoutMode
  activePaneId: PaneId
  panes: Array<{ paneId: PaneId; tabId: string | null; sessionId: string | null }>
}

const COUNTS: Record<LayoutMode, number> = { single: 1, columns: 2, rows: 2, grid: 4 }
export const paneIdOf = (n: number): PaneId => `pane-${n}` as PaneId
export const paneNumber = (id: PaneId): number => Number(id.slice(5))

function notInLayout(n: number): AgentError {
  return new AgentError(
    'pane_not_in_layout',
    `Pane ${n} is not in the current layout.`,
    `Call set_layout with a mode that has ${n} panes.`
  )
}

function cannotControlPane(n: number): AgentError {
  return new AgentError('permission_denied', `Pane ${n} shows a session you cannot control.`)
}

export interface PaneChoice {
  paneId: PaneId
  /** Mode to switch to first (growing the layout) */
  grow?: LayoutMode
}

/** For open: requested pane, a pane with this session, an empty pane, grow, a controllable pane. */
export function choosePane(
  state: PlaceState,
  sessionId: string,
  canControl: (sessionId: string) => boolean,
  requested?: number
): PaneChoice {
  const occupantOk = (sid: string | null) => sid === null || sid === sessionId || canControl(sid)
  if (requested !== undefined) {
    const pane = state.panes.find((p) => p.paneId === paneIdOf(requested))
    if (!pane) throw notInLayout(requested)
    if (!occupantOk(pane.sessionId)) throw cannotControlPane(requested)
    return { paneId: pane.paneId }
  }
  const same = state.panes.find((p) => p.sessionId === sessionId)
  if (same) return { paneId: same.paneId }
  const empty = state.panes.find((p) => p.tabId === null)
  if (empty) return { paneId: empty.paneId }
  const grown: LayoutMode | null = state.mode === 'single' ? 'columns' : state.mode === 'grid' ? null : 'grid'
  if (grown) return { paneId: paneIdOf(state.panes.length + 1), grow: grown }
  const controllable = state.panes.filter((p) => occupantOk(p.sessionId))
  const pick = controllable.find((p) => p.paneId !== state.activePaneId) ?? controllable[0]
  if (pick) return { paneId: pick.paneId }
  throw new AgentError('no_pane_available', 'Every pane shows a session you cannot control.', 'Ask the user to free a pane.')
}

export interface LayoutRequest {
  mode?: LayoutMode
  panes?: Array<{ pane: number; session: string | null }>
  focus?: number
}

export interface LayoutPlan {
  mode?: LayoutMode
  assignments: Array<{ paneId: PaneId; sessionId: string | null }>
  focus?: PaneId
}

/** For set_layout. Sessions in req.panes are already resolved to ids. */
export function planLayout(
  state: PlaceState,
  req: LayoutRequest,
  canControl: (sessionId: string) => boolean
): LayoutPlan {
  const mode = req.mode ?? state.mode
  const count = COUNTS[mode]
  const occupant = (n: number) => state.panes.find((p) => p.paneId === paneIdOf(n))?.sessionId ?? null

  if (req.mode && COUNTS[req.mode] < state.panes.length) {
    for (let n = COUNTS[req.mode] + 1; n <= state.panes.length; n++) {
      const sid = occupant(n)
      if (sid !== null && !canControl(sid)) throw cannotControlPane(n)
    }
  }

  const assignments: LayoutPlan['assignments'] = []
  for (const a of req.panes ?? []) {
    if (a.pane > count) throw notInLayout(a.pane)
    if (a.session !== null && !canControl(a.session)) {
      throw new AgentError('permission_denied', `Pane ${a.pane}: that session is read-only for agents.`)
    }
    const sid = occupant(a.pane)
    if (sid !== null && sid !== a.session && !canControl(sid)) throw cannotControlPane(a.pane)
    assignments.push({ paneId: paneIdOf(a.pane), sessionId: a.session })
  }

  let focus: PaneId | undefined
  if (req.focus !== undefined) {
    if (req.focus > count) throw notInLayout(req.focus)
    focus = paneIdOf(req.focus)
  }
  return { mode: req.mode, assignments, focus }
}
