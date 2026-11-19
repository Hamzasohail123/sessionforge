// Pure pane-layout functions. No electron import: unit specs load this in plain Node.
import { z } from 'zod'
import type { Layout, LayoutMode, Pane, PaneId, Tab } from './types'

export const PANE_IDS: PaneId[] = ['pane-1', 'pane-2', 'pane-3', 'pane-4']

const COUNTS: Record<LayoutMode, number> = { single: 1, columns: 2, rows: 2, grid: 4 }

export function paneCount(mode: LayoutMode): number {
  return COUNTS[mode]
}

export function defaultLayout(): Layout {
  return { windowId: 'main', mode: 'single', panes: [{ paneId: 'pane-1', tabId: null }], activePaneId: 'pane-1' }
}

const PaneIdSchema = z.enum(['pane-1', 'pane-2', 'pane-3', 'pane-4'])
const StoredLayoutSchema = z.object({
  mode: z.enum(['single', 'columns', 'rows', 'grid']),
  panes: z.array(z.object({ paneId: PaneIdSchema, tabId: z.string().nullable() })).min(1).max(4),
  activePaneId: PaneIdSchema
})

/** Panes for a mode, positional ids, tabs taken from `from` by index. */
function sizedPanes(mode: LayoutMode, from: Pane[]): Pane[] {
  return PANE_IDS.slice(0, paneCount(mode)).map((paneId, i) => ({ paneId, tabId: from[i]?.tabId ?? null }))
}

function inMode(mode: LayoutMode, paneId: PaneId): boolean {
  return PANE_IDS.indexOf(paneId) < paneCount(mode)
}

/** Validate a stored layout row and repair it against the tabs that exist now. */
export function normalizeLayout(raw: unknown | null, liveTabIds: Set<string>): Layout {
  if (raw === null || raw === undefined) return defaultLayout()
  const parsed = StoredLayoutSchema.safeParse(raw)
  if (!parsed.success) return defaultLayout()
  const { mode, activePaneId } = parsed.data
  const seen = new Set<string>()
  const cleaned: Pane[] = parsed.data.panes.map((p) => {
    let tabId = p.tabId
    if (tabId !== null && (!liveTabIds.has(tabId) || seen.has(tabId))) tabId = null
    if (tabId !== null) seen.add(tabId)
    return { paneId: p.paneId, tabId }
  })
  return {
    windowId: 'main',
    mode,
    panes: sizedPanes(mode, cleaned),
    activePaneId: inMode(mode, activePaneId) ? activePaneId : 'pane-1'
  }
}

/** Switch mode. Tabs in removed panes stay open (detached) and can be shown later. */
export function setMode(layout: Layout, mode: LayoutMode): Layout {
  return {
    ...layout,
    mode,
    panes: sizedPanes(mode, layout.panes),
    activePaneId: inMode(mode, layout.activePaneId) ? layout.activePaneId : 'pane-1'
  }
}

export function focusPane(layout: Layout, paneId: PaneId): Layout {
  if (!inMode(layout.mode, paneId)) throw new Error('Pane not in current layout')
  return { ...layout, activePaneId: paneId }
}

/** Show tabId in paneId (null clears it). A tab is in at most one pane; the target becomes active. */
export function assignTab(layout: Layout, paneId: PaneId, tabId: string | null): Layout {
  if (!inMode(layout.mode, paneId)) throw new Error('Pane not in current layout')
  return {
    ...layout,
    panes: layout.panes.map((p) => {
      if (p.paneId === paneId) return { ...p, tabId }
      if (tabId !== null && p.tabId === tabId) return { ...p, tabId: null }
      return p
    }),
    activePaneId: paneId
  }
}

/** Replace tabId wherever it is shown with pickReplacement(paneId). */
export function removeTab(layout: Layout, tabId: string, pickReplacement: (paneId: PaneId) => string | null): Layout {
  return {
    ...layout,
    panes: layout.panes.map((p) => (p.tabId === tabId ? { ...p, tabId: pickReplacement(p.paneId) } : p))
  }
}

/** For imports: first empty pane, else grow the layout, else replace the active pane's tab. */
export function placeTab(layout: Layout, tabId: string): Layout {
  const empty = layout.panes.find((p) => p.tabId === null)
  if (empty) return assignTab(layout, empty.paneId, tabId)
  const grown: LayoutMode | null =
    layout.mode === 'single' ? 'columns' : layout.mode === 'grid' ? null : 'grid'
  if (grown) {
    const next = setMode(layout, grown)
    const firstNew = next.panes.find((p) => p.tabId === null)!
    return assignTab(next, firstNew.paneId, tabId)
  }
  return assignTab(layout, layout.activePaneId, tabId)
}

export function paneOfTab(layout: Layout, tabId: string): PaneId | null {
  return layout.panes.find((p) => p.tabId === tabId)?.paneId ?? null
}

/** Most recently shown tab (highest lastActiveAt, ties → higher order), skipping excluded ids. */
export function pickMostRecent<T extends Pick<Tab, 'id' | 'lastActiveAt' | 'order'>>(
  tabs: T[],
  exclude: Set<string> = new Set()
): T | null {
  let best: T | null = null
  for (const t of tabs) {
    if (exclude.has(t.id)) continue
    if (
      !best ||
      t.lastActiveAt > best.lastActiveAt ||
      (t.lastActiveAt === best.lastActiveAt && t.order > best.order)
    )
      best = t
  }
  return best
}
