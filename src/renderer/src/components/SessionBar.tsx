import { useQuery } from '@tanstack/react-query'
import { Plus, Settings, X } from 'lucide-react'
import { Button } from './ui/button'
import { CreateSessionDialog } from './CreateSessionDialog'
import { CloseSessionDialog } from './CloseSessionDialog'
import { SessionNameEditor } from './SessionNameEditor'
import { SettingsDialog } from './SettingsDialog'
import { LayoutSwitcher } from './LayoutSwitcher'
import { useState } from 'react'
import { useStore } from '../store'
import { callMain } from '../lib/ipc'
import { cn } from '../lib/utils'
import type { Session } from '../../../main/types'

/** Session colour at a given opacity (works for any CSS colour, not only #rrggbb). */
export const tint = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`

const RING = 'outline-none focus-visible:ring-1 focus-visible:ring-muted-foreground/60 focus-visible:ring-offset-0'

export function SessionBar() {
  const [createOpen, setCreateOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [closing, setClosing] = useState<Session | null>(null)
  const openSettings = useStore((s) => s.openSettings)
  const layout = useStore((s) => s.layout)
  const activeSessionId = useStore((s) => s.activeSessionId)

  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: () => window.api.session.getAll()
  })

  // Sessions visible in a pane other than the focused one get a secondary marker
  const shownElsewhere = new Set(
    (layout?.panes ?? [])
      .filter((p) => p.paneId !== layout?.activePaneId && p.sessionId)
      .map((p) => p.sessionId as string)
  )

  const handleSessionClick = (session: Session) => {
    if (!layout) return
    callMain(window.api.layout.openSession(layout.activePaneId, session.id))
  }

  return (
    <div data-testid="session-bar" className="h-12 bg-muted border-b flex items-center px-2 gap-2">
      <div className="flex items-center gap-1 flex-1 overflow-x-auto">
        {sessions.map((session) => {
          const active = activeSessionId === session.id
          const editing = editingId === session.id
          return (
            <div
              key={session.id}
              data-testid={`sessionbar-item-${session.id}`}
              className={cn(
                'group relative flex items-center rounded-md border-b-2 transition-colors',
                active
                  ? 'text-foreground'
                  : 'text-muted-foreground border-transparent hover:bg-background/60 hover:text-foreground'
              )}
              style={active ? { backgroundColor: tint(session.color, 18), borderBottomColor: session.color } : undefined}
            >
              {editing ? (
                <SessionNameEditor session={session} onDone={() => setEditingId(null)} />
              ) : (
                <button
                  data-testid={`session-${session.id}`}
                  aria-pressed={active}
                  aria-current={active ? 'true' : undefined}
                  // A mouse click must not leave focus (and later a focus ring) on the button, nor keep a
                  // stale focused input such as the address bar; keyboard focus still works
                  onMouseDown={(e) => {
                    e.preventDefault()
                    const el = document.activeElement
                    if (el instanceof HTMLElement && el !== document.body) el.blur()
                  }}
                  // The second click of a double-click only starts the rename
                  onClick={(e) => {
                    if (e.detail > 1) return
                    handleSessionClick(session)
                  }}
                  onDoubleClick={() => setEditingId(session.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'F2') {
                      e.preventDefault()
                      setEditingId(session.id)
                    }
                  }}
                  className={cn(
                    'relative flex items-center gap-2 py-1.5 pl-3 pr-1.5 rounded-md text-sm',
                    RING,
                    active ? 'font-semibold' : 'font-medium'
                  )}
                >
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: session.color }} />
                  <span>{session.name}</span>
                  {session.env === 'production' && (
                    <span className="text-xs bg-destructive text-destructive-foreground px-1.5 py-0.5 rounded">PROD</span>
                  )}
                  {!active && shownElsewhere.has(session.id) && (
                    <span
                      data-testid={`session-in-pane-${session.id}`}
                      title="Shown in another pane"
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: session.color }}
                    />
                  )}
                </button>
              )}
              {!editing && (
                <button
                  type="button"
                  data-testid={`close-session-${session.id}`}
                  aria-label={`Close session ${session.name}`}
                  title="Close session"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setClosing(session)}
                  className={cn(
                    'mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-opacity',
                    'hover:bg-foreground/10 hover:text-foreground',
                    RING,
                    active
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
                  )}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <LayoutSwitcher />

      <Button
        size="sm"
        variant="ghost"
        onClick={() => openSettings()}
        className="shrink-0"
        title="Settings (Ctrl/Cmd+,)"
        aria-label="Settings"
        data-testid="open-settings"
      >
        <Settings className="h-4 w-4" />
      </Button>

      <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)} className="shrink-0" title="New session">
        <Plus className="h-4 w-4" />
      </Button>

      <CreateSessionDialog open={createOpen} onOpenChange={setCreateOpen} />
      <CloseSessionDialog session={closing} onOpenChange={(open) => !open && setClosing(null)} />
      <SettingsDialog />
    </div>
  )
}
