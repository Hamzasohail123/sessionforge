import { AlertTriangle, ArrowRight, Hand, ShieldCheck, Square } from 'lucide-react'
import { Switch } from '../ui/switch'
import { Button } from '../ui/button'
import { callMain } from '../../lib/ipc'
import { cn } from '../../lib/utils'
import { useStore } from '../../store'
import { Callout, SettingsCard, SettingsPage, StatusDot, type DotTone } from './shared'
import { statusLine, useAgentBridgeData } from './agent-data'
const TONE = { off: 'off', starting: 'warn', listening: 'ok', error: 'error' } as const satisfies Record<string, DotTone>
export function OverviewPanel() {
  const { status, setStatus } = useAgentBridgeData()
  const setAgentTab = useStore((s) => s.setAgentTab)
  const rejected = Object.entries(status?.rejected ?? {})
  return (
    <SettingsPage>
      <SettingsCard>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor="agent-enable" className="text-sm font-semibold">
              Enable Agent Bridge
            </label>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Lets Cursor, Codex, Claude Code and other MCP clients on this computer use the sessions you allow. Off by
              default. Listens only on 127.0.0.1 and refuses requests from web pages.
            </p>
          </div>
          <Switch
            id="agent-enable"
            data-testid="agent-enable"
            checked={status?.enabled ?? false}
            onCheckedChange={(v) => callMain(window.api.agent.setEnabled(v)).then(setStatus)}
          />
        </div>
        <div className="mt-4 flex items-center gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5">
          <StatusDot tone={status ? TONE[status.state] : 'off'} />
          <p data-testid="agent-status" className={cn('font-mono text-xs', status?.state === 'error' && 'text-destructive')}>
            {statusLine(status)}
          </p>
          <span className="ml-auto text-xs text-muted-foreground">
            {status?.clients.length ? `${status.clients.length} connected` : 'No clients connected'}
          </span>
        </div>
      </SettingsCard>
      <SettingsCard title="Connected clients" description="MCP clients that called the bridge since it started.">
        {status && status.clients.length > 0 ? (
          <ul className="divide-y rounded-lg border text-sm">
            {status.clients.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                <StatusDot tone="ok" />
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.version}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  last seen {new Date(c.lastSeen).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">None yet. Set up your editor, then ask its agent to list SessionForge sessions.</p>
        )}
        {rejected.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Rejected requests since start: {rejected.map(([k, v]) => `${k} ${v}`).join(', ')}. Requests without the token,
            from web pages or with a foreign Host header are refused and counted here.
          </p>
        )}
      </SettingsCard>
      {status?.tokenRegenerated && (
        <Callout tone="warn" icon={<AlertTriangle />}>
          A new token was created; update your editor config (Agent Bridge → Token).
        </Callout>
      )}
      <SettingsCard title="Your controls" description="These apply to every editor, whatever its approval settings.">
        <ul className="grid gap-3 text-[13px] sm:grid-cols-3">
          <li className="rounded-lg border p-3">
            <ShieldCheck className="mb-1.5 h-4 w-4 text-emerald-600" aria-hidden />
            <div className="font-medium">Per-session access</div>
            <p className="text-muted-foreground">Hidden, Read or Control for each session.</p>
          </li>
          <li className="rounded-lg border p-3">
            <Hand className="mb-1.5 h-4 w-4 text-amber-600" aria-hidden />
            <div className="font-medium">Production is read-only</div>
            <p className="text-muted-foreground">Control needs the session name typed, until restart.</p>
          </li>
          <li className="rounded-lg border p-3">
            <Square className="mb-1.5 h-4 w-4 text-red-600" aria-hidden />
            <div className="font-medium">Stop</div>
            <p className="text-muted-foreground">In the pane header: ends the call and sets the session to Read.</p>
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setAgentTab('access')}>
            Session access <ArrowRight className="ml-1 h-3 w-3" aria-hidden />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAgentTab('editors')}>
            Connect an editor <ArrowRight className="ml-1 h-3 w-3" aria-hidden />
          </Button>
        </div>
      </SettingsCard>
    </SettingsPage>
  )
}
