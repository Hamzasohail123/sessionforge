import { Activity, Gauge, KeyRound, Plug, Users } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { AGENT_TABS, useStore, type AgentTab } from '../../store'
import { OverviewPanel } from './OverviewPanel'
import { AccessPanel } from './AccessPanel'
import { EditorsPanel } from './EditorsPanel'
import { TokenPanel } from './TokenPanel'
import { ActivityPanel } from './ActivityPanel'
const SUBTABS: Record<AgentTab, { label: string; icon: typeof Gauge }> = {
  overview: { label: 'Overview', icon: Gauge },
  access: { label: 'Access', icon: Users },
  editors: { label: 'Editors', icon: Plug },
  token: { label: 'Token', icon: KeyRound },
  activity: { label: 'Activity', icon: Activity }
}
export function AgentBridgeTab() {
  const agentTab = useStore((s) => s.settings.agentTab)
  const setAgentTab = useStore((s) => s.setAgentTab)
  return (
    <Tabs data-testid="agent-bridge-panel" value={agentTab} onValueChange={(v) => setAgentTab(v as AgentTab)} className="text-sm">
      <div className="mb-6">
        <TabsList aria-label="Agent Bridge sections">
          {AGENT_TABS.map((t) => {
            const Icon = SUBTABS[t].icon
            return (
              <TabsTrigger key={t} value={t} data-testid={`settings-subtab-${t}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {SUBTABS[t].label}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </div>
      <TabsContent value="overview">
        <OverviewPanel />
      </TabsContent>
      <TabsContent value="access">
        <AccessPanel />
      </TabsContent>
      <TabsContent value="editors">
        <EditorsPanel />
      </TabsContent>
      <TabsContent value="token">
        <TokenPanel />
      </TabsContent>
      <TabsContent value="activity">
        <ActivityPanel />
      </TabsContent>
    </Tabs>
  )
}
