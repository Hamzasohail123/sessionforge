// Read-only list in this release: env changes must go through the agent policy (design §3.2, §6).
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { EnvTag, Session, Tab } from '../../../../main/types'
import type { AgentSessionGrant } from '../../../../main/agent/types'
import { Badge, SettingsCard, SettingsPage } from './shared'
import { useAgentBridgeData } from './agent-data'
const ENV_TONE: Record<EnvTag, 'neutral' | 'blue' | 'amber' | 'red'> = {
  local: 'neutral',
  staging: 'amber',
  production: 'red',
  custom: 'blue'
}
const ACCESS = { hidden: 'Hidden', read: 'Read', control: 'Control' } as const
function SessionRow({ session, grant }: { session: Session; grant: AgentSessionGrant | undefined }) {
  // Same key as TabBar, so the cache and tabs:changed invalidation are shared
  const { data: tabs = [] } = useQuery<Tab[]>({
    queryKey: ['tabs', session.id],
    queryFn: () => window.api.tab.getBySession(session.id)
  })
  const effective = grant?.effective ?? 'read'
  return (
    <div data-testid={`session-row-${session.id}`} className="flex items-center gap-3 px-3 py-3">
      <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-background" style={{ backgroundColor: session.color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{session.name}</div>
        <div className="text-xs text-muted-foreground">
          {tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'}
        </div>
      </div>
      <Badge tone={ENV_TONE[session.env]} className="capitalize">
        {session.env}
      </Badge>
      <div className="w-56 text-right text-xs">
        <span className="text-muted-foreground">Agent access: </span>
        <span data-testid={`session-access-${session.id}`} className="font-medium">
          {ACCESS[effective]}
        </span>
        {grant?.productionCapped && <div className="text-muted-foreground">(capped to Read: production)</div>}
        {grant?.elevated && <div className="text-muted-foreground">(confirmed until restart)</div>}
      </div>
    </div>
  )
}
export function SessionsTab() {
  const { sessions, grants } = useAgentBridgeData()
  return (
    <SettingsPage>
      <SettingsCard
        title="Your sessions"
        description={
          <>
            Each session has its own cookies and storage. Create sessions with <Plus className="inline h-3 w-3" aria-label="plus" /> in the
            session bar; change agent access in Agent Bridge → Access.
          </>
        }
      >
        {sessions.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No sessions yet.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} grant={grants.find((g) => g.sessionId === s.id)} />
            ))}
          </div>
        )}
      </SettingsCard>
    </SettingsPage>
  )
}
