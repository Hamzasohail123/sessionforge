import { useState } from 'react'
import { Eye, EyeOff, MousePointerClick } from 'lucide-react'
import type { Session } from '../../../../main/types'
import type { AgentGrant } from '../../../../main/agent/types'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { callMain } from '../../lib/ipc'
import { ProductionGrantDialog } from '../ProductionGrantDialog'
import { Badge, SettingsCard, SettingsPage } from './shared'
import { GRANT_LABELS, useAgentBridgeData } from './agent-data'
const LEVELS = [
  { level: 'hidden', icon: EyeOff, title: 'Hidden', text: "Agents can't see or address the session." },
  { level: 'read', icon: Eye, title: 'Read', text: 'Snapshots, screenshots, logs and GET requests. No input.' },
  { level: 'control', icon: MousePointerClick, title: 'Control', text: 'Click, type, navigate and send write requests.' }
] as const
export function AccessPanel() {
  const { grants, sessions, refreshGrants } = useAgentBridgeData()
  const [prodConfirm, setProdConfirm] = useState<Session | null>(null)
  const setGrant = async (session: Session, level: AgentGrant, confirm?: string) => {
    if (session.env === 'production' && level === 'control' && confirm === undefined) {
      setProdConfirm(session)
      return
    }
    await callMain(window.api.agent.setGrant({ sessionId: session.id, level, confirm }))
    refreshGrants()
  }
  return (
    <SettingsPage>
      <SettingsCard title="Access levels" description="New sessions start at Read. Agents never see more than you allow here.">
        <ul className="grid gap-3 sm:grid-cols-3">
          {LEVELS.map(({ level, icon: Icon, title, text }) => (
            <li key={level} className="rounded-lg border p-3 text-[13px]">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden /> {title}
              </div>
              <p className="text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </SettingsCard>
      <SettingsCard
        title="Sessions"
        description="Production sessions stay read-only for agents until you type the session name; that lasts until SessionForge restarts."
      >
        {sessions.length === 0 && <p className="text-[13px] text-muted-foreground">No sessions yet.</p>}
        <div className="divide-y rounded-lg border">
          {sessions.map((s) => {
            const g = grants.find((x) => x.sessionId === s.id)
            const value: AgentGrant = g?.stored ?? 'read'
            return (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                {s.env === 'production' && <Badge tone="red">PROD</Badge>}
                {g?.elevated && <span className="text-xs text-muted-foreground">Control until restart</span>}
                {g?.productionCapped && (
                  <>
                    <span className="text-xs text-muted-foreground">Control — confirm again</span>
                    <Button size="sm" variant="outline" onClick={() => setProdConfirm(s)}>
                      Confirm
                    </Button>
                  </>
                )}
                <Select value={value} onValueChange={(v) => setGrant(s, v as AgentGrant)}>
                  <SelectTrigger data-testid={`agent-grant-${s.id}`} className="h-8 w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['hidden', 'read', 'control'] as const).map((l) => (
                      <SelectItem key={l} value={l} data-testid={`agent-grant-option-${l}`}>
                        {GRANT_LABELS[l]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )
          })}
        </div>
      </SettingsCard>
      <ProductionGrantDialog
        sessionName={prodConfirm?.name ?? null}
        onCancel={() => {
          setProdConfirm(null)
          refreshGrants()
        }}
        onConfirm={(typed) => {
          const s = prodConfirm
          setProdConfirm(null)
          if (s) void setGrant(s, 'control', typed)
        }}
      />
    </SettingsPage>
  )
}
