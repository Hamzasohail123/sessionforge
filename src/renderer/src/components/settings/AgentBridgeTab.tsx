import { Activity, Gauge, KeyRound, Plug, Users } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { AGENT_TABS, useStore, type AgentTab } from '../../store'
import { MCP_SERVER_SUBTABS } from './settings-search'
import { OverviewPanel } from './OverviewPanel'
import { AccessPanel } from './AccessPanel'
import { EditorsPanel } from './EditorsPanel'
import { TokenPanel } from './TokenPanel'
import { ActivityPanel } from './ActivityPanel'
const SUBTABS: Record<AgentTab, { label: string; icon: typeof Gauge }> = {
  overview: { label: MCP_SERVER_SUBTABS.overview.label, icon: Gauge },
  access: { label: MCP_SERVER_SUBTABS.access.label, icon: Users },
  editors: { label: MCP_SERVER_SUBTABS.editors.label, icon: Plug },
  token: { label: MCP_SERVER_SUBTABS.token.label, icon: KeyRound },
  activity: { label: MCP_SERVER_SUBTABS.activity.label, icon: Activity }
}
export function AgentBridgeTab() {
  const agentTab = useStore((s) => s.settings.agentTab)
  const setAgentTab = useStore((s) => s.setAgentTab)
  return (
    <Tabs data-testid="agent-bridge-panel" value={agentTab} onValueChange={(v) => setAgentTab(v as AgentTab)} className="text-sm">
      <div className="mb-6">
        {/* flex-wrap: in a narrow window the sub-tabs take a second row instead of scrolling sideways */}
        <TabsList aria-label="Agent Bridge sections" className="flex-wrap">
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
