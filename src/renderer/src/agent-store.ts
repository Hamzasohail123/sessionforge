import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import type {
  AgentActivityEntry,
  AgentBridgeStatus,
  AgentPresenceEvent,
  AgentSessionGrant
} from '../../main/agent/types'

export interface Presence {
  tool: string
  inFlight: number
  lastEnd: number
  control: boolean
}

interface AgentState {
  /** Agent activity per tab, from main's agent:presence events */
  presence: Record<string, Presence>
  applyPresence: (e: AgentPresenceEvent) => void
}

export const useAgentStore = create<AgentState>((set) => ({
  presence: {},
  applyPresence: (e) =>
    set((s) => {
      const cur = s.presence[e.tabId] ?? { tool: e.tool, inFlight: 0, lastEnd: 0, control: false }
      const next: Presence =
        e.phase === 'start'
          ? { tool: e.tool, inFlight: cur.inFlight + 1, lastEnd: cur.lastEnd, control: cur.control || e.control }
          : {
              tool: cur.tool,
              inFlight: Math.max(0, cur.inFlight - 1),
              lastEnd: e.at,
              control: cur.inFlight - 1 > 0 ? cur.control : e.control
            }
      return { presence: { ...s.presence, [e.tabId]: next } }
    })
}))

/** Shown while a call runs and for 10 s after the last one ended. */
export const PRESENCE_LINGER_MS = 10_000

/** Follow main's agent:* events: presence into the store, the rest into the query cache. Mount once. */
export function useAgentEvents(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const a = window.api.agent
    const offs = [
      a.onPresence((e) => useAgentStore.getState().applyPresence(e)),
      a.onGrants((g) => queryClient.setQueryData<AgentSessionGrant[]>(['agent-grants'], g)),
      a.onStatus((s) => queryClient.setQueryData<AgentBridgeStatus>(['agent-status'], s)),
      a.onActivity((e) =>
        queryClient.setQueryData<AgentActivityEntry[]>(['agent-activity'], (old) =>
          [e, ...(old ?? [])].slice(0, 500)
        )
      )
    ]
    return () => offs.forEach((off) => off())
  }, [queryClient])
}
