import { Fragment, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { callMain } from '../../lib/ipc'
import { cn } from '../../lib/utils'
import { Badge, SettingsCard, SettingsPage } from './shared'
import { useActivity, useAgentBridgeData } from './agent-data'
const OUTCOME_TONE = { ok: 'green', error: 'red', denied: 'amber' } as const
export function ActivityPanel() {
  const { queryClient } = useAgentBridgeData()
  const { data: activity = [] } = useActivity()
  const [open, setOpen] = useState<Set<number>>(new Set())
  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  return (
    <SettingsPage>
      <SettingsCard
        title="Agent activity"
        description="Every tool call, newest first. Kept in memory only, with secrets redacted."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => callMain(window.api.agent.clearActivity()).then(() => queryClient.setQueryData(['agent-activity'], []))}
          >
            Clear
          </Button>
        }
      >
        <div data-testid="agent-activity" className="max-h-[52vh] overflow-auto rounded-lg border">
          {activity.length === 0 ? (
            <p className="p-3 text-[13px] text-muted-foreground">No agent activity yet.</p>
          ) : (
            <table className="w-full table-fixed text-xs">
              <thead className="sticky top-0 bg-muted/90 text-left text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                <tr>
                  <th className="w-8 px-2 py-2" aria-label="Details" />
                  <th className="w-20 px-2 py-2 font-medium">Time</th>
                  <th className="w-32 px-2 py-2 font-medium">Client</th>
                  <th className="w-32 px-2 py-2 font-medium">Tool</th>
                  <th className="px-2 py-2 font-medium">Session</th>
                  <th className="w-36 px-2 py-2 font-medium">Outcome</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((e) => {
                  const expanded = open.has(e.id)
                  return (
                    <Fragment key={e.id}>
                      <tr data-testid="agent-activity-row" className="border-t hover:bg-muted/40">
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`Arguments of ${e.tool}`}
                            onClick={() => toggle(e.id)}
                            className="rounded p-0.5 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
                          </button>
                        </td>
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</td>
                        <td className="truncate px-2 py-1.5" title={e.client}>
                          {e.client}
                        </td>
                        <td className="truncate px-2 py-1.5 font-mono font-semibold">{e.tool}</td>
                        <td className="truncate px-2 py-1.5">{e.sessionName ?? ''}</td>
                        <td className="px-2 py-1.5">
                          <Badge tone={OUTCOME_TONE[e.outcome]} className="max-w-full truncate">
                            {e.outcome}
                            {e.code ? ` ${e.code}` : ''}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{e.durationMs} ms</td>
                      </tr>
                      <tr data-testid="agent-activity-args" hidden={!expanded} className="bg-muted/30">
                        <td />
                        <td colSpan={6} className="px-2 pb-2">
                          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">{e.args}</pre>
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </SettingsCard>
    </SettingsPage>
  )
}
