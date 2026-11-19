import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, Loader2, Plus, X } from 'lucide-react'
import { Button } from './ui/button'
import { useStore } from '../store'
import { callMain } from '../lib/ipc'
import { cn } from '../lib/utils'
import { tint } from './SessionBar'
import type { Session, Tab, TabState } from '../../../main/types'
import { DEFAULT_URL } from '../../../main/constants'
import { useState, useEffect } from 'react'

interface TabBarProps {
  /** Session of the focused pane; null when that pane is empty (only a disabled + is shown) */
  sessionId: string | null
}

export function TabBar({ sessionId }: TabBarProps) {
  const activeTabId = useStore((s) => s.activeTabId)
  const queryClient = useQueryClient()
  const [tabStates, setTabStates] = useState<Map<string, TabState>>(new Map())

  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: () => window.api.session.getAll()
  })
  const color = sessions.find((s) => s.id === sessionId)?.color

  const { data: tabs = [] } = useQuery<Tab[]>({
    queryKey: ['tabs', sessionId],
    queryFn: () => window.api.tab.getBySession(sessionId!),
    enabled: !!sessionId
  })

  // Titles and loading state pushed from the main process
  useEffect(() => {
    return window.api.tab.onUpdate((data) => {
      setTabStates((prev) => new Map(prev).set(data.id, data))
    })
  }, [])

  const handleNewTab = async () => {
    if (!sessionId) return
    // Main shows the new tab in the focused pane and sends layout:updated
    await callMain(window.api.tab.create(sessionId, DEFAULT_URL))
    queryClient.invalidateQueries({ queryKey: ['tabs', sessionId] })
  }

  const handleCloseTab = async (tabId: string) => {
    await callMain(window.api.tab.close(tabId))
    queryClient.invalidateQueries({ queryKey: ['tabs', sessionId] })
  }

  const handleTabClick = (tabId: string) => {
    callMain(window.api.tab.setActive(tabId))
  }

  const getTabTitle = (tab: Tab): string => {
    const title = tabStates.get(tab.id)?.title || tab.title
    if (title) return title
    try {
      return new URL(tab.url).hostname || tab.url
    } catch {
      return tab.url
    }
  }

  return (
    <div
      data-testid="tab-bar"
      role="tablist"
      // Bottom line is an inset shadow so the active tab (painted above it) joins the address bar
      className="h-10 bg-muted flex items-end px-2 gap-0 overflow-x-auto overflow-y-hidden border-l-4 shadow-[inset_0_-1px_0_hsl(var(--border))]"
      style={{
        borderLeftColor: color ?? 'transparent',
        backgroundImage: color ? `linear-gradient(${tint(color, 8)}, ${tint(color, 8)})` : undefined
      }}
    >
      {sessionId &&
        tabs.map((tab, i) => {
          const active = activeTabId === tab.id
          const loading = tabStates.get(tab.id)?.isLoading
          const nextActive = tabs[i + 1]?.id === activeTabId
          return (
            <div
              key={tab.id}
              role="tab"
              data-testid={`tab-${tab.id}`}
              aria-selected={active}
              className={cn(
                'relative flex items-center gap-2 px-3 h-9 text-sm max-w-[200px] min-w-[80px] group cursor-pointer rounded-t-md',
                active
                  ? 'bg-background text-foreground border-x border-t z-10'
                  : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
              )}
              style={active && color ? { borderTopColor: color, borderTopWidth: 2 } : undefined}
              onClick={() => handleTabClick(tab.id)}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <Globe className="h-3.5 w-3.5 shrink-0 opacity-60" />
              )}
              <span className="truncate flex-1">{getTabTitle(tab)}</span>
              <button
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation()
                  handleCloseTab(tab.id)
                }}
                className={cn(
                  'hover:bg-destructive/10 rounded p-0.5',
                  active ? 'opacity-70' : 'opacity-0 group-hover:opacity-100'
                )}
              >
                <X className="h-3 w-3" />
              </button>
              {/* Thin separator between inactive tabs, hidden next to the active one */}
              {!active && !nextActive && i < tabs.length - 1 && (
                <span className="absolute right-0 top-2 bottom-2 w-px bg-border" />
              )}
            </div>
          )
        })}

      <Button
        size="sm"
        variant="ghost"
        onClick={handleNewTab}
        disabled={!sessionId}
        className="shrink-0 self-center ml-1"
        title="New tab"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}
