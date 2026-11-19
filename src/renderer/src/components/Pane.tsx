import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import type { PaneId, Session } from '../../../main/types'
import { useStore } from '../store'
import { callMain } from '../lib/ipc'
import { AgentIndicator } from './AgentIndicator'
import { SignInBanner } from './SignInBanner'

interface PaneProps {
  paneId: PaneId
  tabId: string | null
  sessionId: string | null
  focused: boolean
  slotRef: (el: HTMLDivElement | null) => void
}

export function Pane({ paneId, tabId, sessionId, focused, slotRef }: PaneProps) {
  const overlay = useStore((s) => s.overlayCount > 0)
  const [title, setTitle] = useState('')
  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: () => window.api.session.getAll()
  })
  const session = sessions.find((s) => s.id === sessionId)

  // Tab title: current state on mount / tab change, then live updates for this tab only
  useEffect(() => {
    setTitle('')
    if (!tabId) return
    let alive = true
    window.api.tab
      .getState(tabId)
      .then((state) => alive && setTitle(state?.title || state?.url || ''))
      .catch(() => undefined)
    const off = window.api.tab.onUpdate((state) => {
      if (state.id === tabId) setTitle(state.title || state.url)
    })
    return () => {
      alive = false
      off()
    }
  }, [tabId])

  const focus = () => {
    if (!focused) callMain(window.api.layout.focusPane(paneId))
  }

  return (
    <div
      data-testid={`pane-${paneId}`}
      data-focused={focused}
      // 2 px band reserved in every pane; the focused pane paints it in its session colour (the
      // page view sits inside the slot, so the band stays visible next to it)
      className="flex flex-col min-h-0 min-w-0 bg-background p-[2px]"
      style={{
        boxShadow: focused ? `inset 0 0 0 2px ${session?.color ?? 'hsl(var(--primary))'}` : undefined
      }}
      onMouseDown={focus}
    >
      <div
        data-testid={`pane-header-${paneId}`}
        className="h-7 shrink-0 flex items-center gap-2 pr-1 border-b bg-muted/60 text-xs"
      >
        <div className="w-[3px] self-stretch" style={{ backgroundColor: session?.color ?? 'transparent' }} />
        <span className="font-semibold truncate max-w-[40%]">{session?.name ?? 'Empty pane'}</span>
        {session?.env === 'production' && (
          <span className="bg-destructive text-destructive-foreground px-1 rounded text-[10px] font-bold">PROD</span>
        )}
        <AgentIndicator
          paneId={paneId}
          tabId={tabId}
          sessionId={sessionId}
          sessionName={session?.name ?? ''}
          production={session?.env === 'production'}
        />
        <span className="truncate flex-1 text-muted-foreground">{title}</span>
        {tabId && (
          <button
            title="Empty this pane"
            className="rounded p-0.5 hover:bg-accent"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => callMain(window.api.layout.assignTab(paneId, null))}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {/* Google sign-in hand-off; takes height from the slot below, like the header */}
      {tabId && <SignInBanner paneId={paneId} tabId={tabId} sessionName={session?.name ?? ''} />}
      {/* The page is a WebContentsView main draws over this measured placeholder */}
      <div ref={slotRef} data-testid={`pane-slot-${paneId}`} className="flex-1 min-h-0 relative">
        {!tabId && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Empty pane — pick a session above
          </div>
        )}
        {tabId && overlay && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted text-sm text-muted-foreground">
            {title}
          </div>
        )}
      </div>
    </div>
  )
}
