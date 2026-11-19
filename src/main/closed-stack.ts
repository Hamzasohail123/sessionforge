// Pure rules of the "recently closed" stack (Cmd/Ctrl+Shift+T). No electron import: unit specs load
// this in plain Node. RecentlyClosed (recently-closed.ts) owns the closed_items rows and applies them.
import { z } from 'zod'
import { isOpenableUrl } from './import-payload'

/** Closed tabs kept on the stack; older tab entries are dropped (closed sessions don't count) */
export const MAX_CLOSED_TABS = 25
/** Closed sessions kept with their storage; older ones are deleted for good */
export const MAX_CLOSED_SESSIONS = 10

export type ClosedKind = 'tab' | 'session'

/** One tab of a closed session, stored as JSON in closed_items.tabs */
export const ClosedTabSchema = z.object({
  url: z.string().max(8192).refine(isOpenableUrl, 'Only http(s) and view-source:http(s) URLs are allowed'),
  title: z.string().max(2000).default(''),
  lastActiveAt: z.number().finite()
})
export type ClosedTab = z.infer<typeof ClosedTabSchema>

export interface ClosedItem {
  id: string
  kind: ClosedKind
  sessionId: string
  /** kind 'tab' */
  url: string | null
  /** kind 'tab' */
  title: string | null
  /** kind 'session': its tabs in tab order */
  tabs: ClosedTab[]
  closedAt: number
}

export type SessionState = 'open' | 'closed' | 'missing'

/** Stored tabs JSON → valid tabs. Corrupt JSON gives [] (logged); invalid elements are dropped. */
export function parseClosedTabs(json: string | null): ClosedTab[] {
  if (json === null) return []
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    console.warn('[closed] stored tabs JSON is corrupt; ignoring it')
    return []
  }
  if (!Array.isArray(raw)) {
    console.warn('[closed] stored tabs JSON is not a list; ignoring it')
    return []
  }
  const out: ClosedTab[] = []
  for (const el of raw) {
    const parsed = ClosedTabSchema.safeParse(el)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

/**
 * What to remove after a push. Closed sessions past the newest MAX_CLOSED_SESSIONS are deleted for
 * good (the DB cascade removes all their entries). Tab entries past the newest MAX_CLOSED_TABS are
 * dropped. The two caps are counted separately, so closing tabs never deletes a closed session.
 * Tab entries removed by a session's cascade don't count and are not listed in dropIds.
 */
export function planEviction(itemsNewestFirst: ClosedItem[]): { dropIds: string[]; hardDeleteSessionIds: string[] } {
  const hardDelete = new Set<string>()
  let sessions = 0
  for (const it of itemsNewestFirst) {
    if (it.kind !== 'session') continue
    sessions++
    if (sessions > MAX_CLOSED_SESSIONS) hardDelete.add(it.sessionId)
  }

  const tabs = itemsNewestFirst.filter((it) => it.kind === 'tab' && !hardDelete.has(it.sessionId))
  return {
    dropIds: tabs.slice(MAX_CLOSED_TABS).map((it) => it.id),
    hardDeleteSessionIds: [...hardDelete]
  }
}

/**
 * The entry Cmd/Ctrl+Shift+T restores, newest first, and the stale entries to delete on the way.
 * A session entry needs its session closed. A tab entry needs its session open and an openable URL;
 * a tab of a closed session is skipped but kept, since it becomes valid when that session reopens.
 */
export function pickReopen(
  itemsNewestFirst: ClosedItem[],
  stateOf: (sessionId: string) => SessionState
): { item: ClosedItem | null; staleIds: string[] } {
  const staleIds: string[] = []
  for (const it of itemsNewestFirst) {
    const state = stateOf(it.sessionId)
    if (it.kind === 'session') {
      if (state === 'closed') return { item: it, staleIds }
      staleIds.push(it.id)
      continue
    }
    if (state === 'closed') continue
    if (state === 'open' && it.url !== null && isOpenableUrl(it.url)) return { item: it, staleIds }
    staleIds.push(it.id)
  }
  return { item: null, staleIds }
}

/** Index of the tab the user saw last (highest lastActiveAt; a tie goes to the later tab); -1 when empty. */
export function restoreIndex(tabs: ClosedTab[]): number {
  let best = -1
  tabs.forEach((t, i) => {
    if (best === -1 || t.lastActiveAt >= tabs[best].lastActiveAt) best = i
  })
  return best
}
