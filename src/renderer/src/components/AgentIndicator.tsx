import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PaneId } from '../../../main/types'
import type { AgentSessionGrant } from '../../../main/agent/types'
import { PRESENCE_LINGER_MS, useAgentStore } from '../agent-store'
import { callMain } from '../lib/ipc'
import { cn } from '../lib/utils'
import { toast } from './ui/use-toast'

interface Props {
  paneId: PaneId
  tabId: string | null
  sessionId: string | null
  sessionName: string
  production: boolean
}

/** "🤖 Agent" pill plus Stop in a pane header while an AI agent works in that pane. */
export function AgentIndicator({ paneId, tabId, sessionId, sessionName, production }: Props) {
  const p = useAgentStore((s) => (tabId ? s.presence[tabId] : undefined))
  const [now, setNow] = useState(Date.now())
  const { data: grants = [] } = useQuery<AgentSessionGrant[]>({
    queryKey: ['agent-grants'],
    queryFn: () => window.api.agent.getGrants()
  })
  const active = !!p && (p.inFlight > 0 || now - p.lastEnd < PRESENCE_LINGER_MS)

  // Re-render once a second while the pill is up, so it disappears after the linger time
  useEffect(() => {
    if (!p) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [p])

  if (!active || !sessionId) return null
  const canStop = grants.find((g) => g.sessionId === sessionId)?.effective === 'control'
  return (
    <>
      <span
        data-testid={`agent-indicator-${paneId}`}
        title={`An AI agent is using this pane (${p!.tool})`}
        className={cn(
          'px-1.5 rounded text-[10px] font-bold whitespace-nowrap',
          production ? 'bg-destructive text-destructive-foreground' : 'bg-amber-400 text-black'
        )}
      >
        🤖 Agent
      </span>
      {canStop && (
        <button
          data-testid={`agent-stop-${paneId}`}
          title="Stop agent control of this session"
          className="rounded px-1.5 text-[10px] font-semibold border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() =>
            callMain(window.api.agent.stop(sessionId)).then(() =>
              toast({
                title: `Agent control stopped for ${sessionName}.`,
                description: 'Allow it again in Settings → Agent Bridge.'
              })
            )
          }
        >
          Stop
        </button>
      )}
    </>
  )
}
