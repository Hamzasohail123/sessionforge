import { useEffect, useRef, useState } from 'react'
import { Bot, Info, Keyboard, Layers, Puzzle, Search, SlidersHorizontal, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { useViewOverlay } from '../hooks/useViewOverlay'
import { SETTINGS_TABS, useStore, type SettingsTab } from '../store'
import { TOP_LEVEL_SETTINGS, filterSettings, type SettingsSearchEntry } from './settings/settings-search'
import { GeneralTab } from './settings/GeneralTab'
import { SessionsTab } from './settings/SessionsTab'
import { AgentBridgeTab } from './settings/AgentBridgeTab'
import { ChromeImportTab } from './settings/ChromeImportTab'
import { ShortcutsTab } from './settings/ShortcutsTab'
import { AboutTab } from './settings/AboutTab'

const TABS: Record<SettingsTab, { label: string; heading: string; description: string; icon: typeof Bot; render: () => JSX.Element }> = {
  general: {
    label: TOP_LEVEL_SETTINGS.general.label,
    heading: TOP_LEVEL_SETTINGS.general.heading,
    description: TOP_LEVEL_SETTINGS.general.subtitle,
    icon: SlidersHorizontal,
    render: () => <GeneralTab />
  },
  sessions: {
    label: TOP_LEVEL_SETTINGS.sessions.label,
    heading: TOP_LEVEL_SETTINGS.sessions.heading,
    description: TOP_LEVEL_SETTINGS.sessions.subtitle,
    icon: Layers,
    render: () => <SessionsTab />
  },
  agent: {
    label: TOP_LEVEL_SETTINGS.agent.label,
    heading: TOP_LEVEL_SETTINGS.agent.heading,
    description: TOP_LEVEL_SETTINGS.agent.subtitle,
    icon: Bot,
    render: () => <AgentBridgeTab />
  },
  import: {
    label: TOP_LEVEL_SETTINGS.import.label,
    heading: TOP_LEVEL_SETTINGS.import.heading,
    description: TOP_LEVEL_SETTINGS.import.subtitle,
    icon: Puzzle,
    render: () => <ChromeImportTab />
  },
  shortcuts: {
    label: TOP_LEVEL_SETTINGS.shortcuts.label,
    heading: TOP_LEVEL_SETTINGS.shortcuts.heading,
    description: TOP_LEVEL_SETTINGS.shortcuts.subtitle,
    icon: Keyboard,
    render: () => <ShortcutsTab />
  },
  about: {
    label: TOP_LEVEL_SETTINGS.about.label,
    heading: TOP_LEVEL_SETTINGS.about.heading,
    description: TOP_LEVEL_SETTINGS.about.subtitle,
    icon: Info,
    render: () => <AboutTab />
  }
}

/**
 * Settings sheet with a tab sidebar. Page views draw above the DOM, so they are hidden while it is
 * open (overlay pattern); nested dialogs are covered by the same overlay counter.
 */
export function SettingsDialog() {
  const { open, tab } = useStore((s) => s.settings)
  const closeSettings = useStore((s) => s.closeSettings)
  const setTab = useStore((s) => s.setSettingsTab)
  const setAgentTab = useStore((s) => s.setAgentTab)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const meta = TABS[tab]
  const trimmedQuery = query.trim()
  const results = trimmedQuery ? filterSettings(query) : []
  const visibleTabs = trimmedQuery
    ? SETTINGS_TABS.filter((t) => t === tab || results.some((entry) => entry.kind === 'tab' && entry.target.tab === t))
    : SETTINGS_TABS

  useViewOverlay(open)

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const navigateTo = (entry: SettingsSearchEntry) => {
    setTab(entry.target.tab)
    if (entry.target.agentTab) setAgentTab(entry.target.agentTab)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeSettings()}>
      <DialogContent
        data-testid="settings-dialog"
        className="flex h-[calc(100vh-48px)] max-h-[860px] w-[calc(100vw-48px)] max-w-[1100px] gap-0 overflow-hidden p-0 sm:rounded-xl"
        // Focus goes back to the gear button that opened Settings, never to a session button
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          document.querySelector<HTMLElement>('[data-testid="open-settings"]')?.focus()
        }}
        onEscapeKeyDown={(e) => {
          if (query.length > 0) {
            e.preventDefault()
            setQuery('')
            searchRef.current?.focus()
          }
        }}
      >
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as SettingsTab)}
          orientation="vertical"
          className="flex min-h-0 min-w-0 flex-1"
        >
          <aside className="flex w-56 min-w-0 shrink-0 flex-col border-r bg-muted/40">
            <div className="px-5 pb-3 pt-5">
              <DialogTitle className="text-base">Settings</DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">Stored on this computer only.</p>
            </div>
            <div className="shrink-0 px-3 pb-2">
              <label htmlFor="settings-search" className="sr-only">
                Search settings
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  ref={searchRef}
                  id="settings-search"
                  role="searchbox"
                  aria-label="Search settings"
                  aria-controls="settings-search-results"
                  placeholder="Search settings…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && results.length === 1) {
                      e.preventDefault()
                      navigateTo(results[0])
                    }
                  }}
                  className="h-8 bg-background pl-8 pr-8 text-xs"
                />
                {query && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Clear settings search"
                    title="Clear settings search"
                    onClick={() => {
                      setQuery('')
                      searchRef.current?.focus()
                    }}
                    className="absolute right-0.5 top-0.5 h-7 w-7"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <TabsList aria-label="Settings sections" className="flex h-auto flex-col items-stretch gap-0.5 bg-transparent px-3 py-1">
                {visibleTabs.map((t) => {
                  const Icon = TABS[t].icon
                  return (
                    <TabsTrigger
                      key={t}
                      value={t}
                      data-testid={`settings-nav-${t}`}
                      className="w-full justify-start gap-2.5 px-3 py-2 text-[13px] text-muted-foreground hover:bg-background/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm"
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="min-w-0 truncate">
                        {TABS[t].label}
                        {t === 'agent' && <span className="ml-1 text-[10px] text-muted-foreground/80">Agent Bridge</span>}
                      </span>
                    </TabsTrigger>
                  )
                })}
              </TabsList>
              {trimmedQuery && (
                <div id="settings-search-results" data-testid="settings-search-results" className="mt-2 border-t px-3 pb-3 pt-2">
                  <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Results</p>
                  {results.length > 0 ? (
                    <div className="space-y-0.5">
                      {results.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          data-testid={`settings-search-result-${entry.id}`}
                          aria-label={`Open ${entry.label}`}
                          aria-describedby={`settings-search-result-${entry.id}-category settings-search-result-${entry.id}-description`}
                          onClick={() => navigateTo(entry)}
                          className="w-full min-w-0 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="block truncate text-xs font-medium text-foreground">{entry.label}</span>
                          <span id={`settings-search-result-${entry.id}-category`} className="block truncate text-[10px] text-muted-foreground">
                            {entry.category}
                          </span>
                          <span id={`settings-search-result-${entry.id}-description`} className="block break-words text-[11px] leading-snug text-muted-foreground">
                            {entry.subtitle}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div data-testid="settings-search-no-results" className="px-2 py-2">
                      <p className="text-xs font-medium text-foreground">No settings found</p>
                      <p data-testid="settings-search-no-results-suggestion" className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        Try MCP, Cursor, sessions, or shortcuts.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="mt-auto shrink-0 px-5 pb-4 pt-2 text-[11px] text-muted-foreground">
              <kbd className="rounded border bg-background px-1 font-mono">Ctrl/Cmd+,</kbd> opens Settings
            </p>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="border-b px-8 pb-4 pt-5 pr-14">
              <h2 data-testid="settings-title" className="text-lg font-semibold tracking-tight">
                {meta.heading}
              </h2>
              <DialogDescription className="mt-0.5 text-[13px]">{meta.description}</DialogDescription>
            </header>
            <div data-testid="settings-scroll" className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
              <div className="mx-auto max-w-3xl">
                {SETTINGS_TABS.map((t) => (
                  <TabsContent key={t} value={t} className="mt-0" tabIndex={-1}>
                    {TABS[t].render()}
                  </TabsContent>
                ))}
              </div>
            </div>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
