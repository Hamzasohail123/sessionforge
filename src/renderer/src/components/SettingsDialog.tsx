import { Bot, Info, Keyboard, Layers, Puzzle, SlidersHorizontal } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { useViewOverlay } from '../hooks/useViewOverlay'
import { SETTINGS_TABS, useStore, type SettingsTab } from '../store'
import { GeneralTab } from './settings/GeneralTab'
import { SessionsTab } from './settings/SessionsTab'
import { AgentBridgeTab } from './settings/AgentBridgeTab'
import { ChromeImportTab } from './settings/ChromeImportTab'
import { ShortcutsTab } from './settings/ShortcutsTab'
import { AboutTab } from './settings/AboutTab'
const TABS: Record<SettingsTab, { label: string; description: string; icon: typeof Bot; render: () => JSX.Element }> = {
  general: { label: 'General', description: 'App version and where your data lives.', icon: SlidersHorizontal, render: () => <GeneralTab /> },
  sessions: {
    label: 'Sessions',
    description: 'Your isolated browser sessions and the access agents have to each.',
    icon: Layers,
    render: () => <SessionsTab />
  },
  agent: {
    label: 'Agent Bridge',
    description: 'Let AI coding agents in Cursor, Codex and Claude Code use the sessions you allow.',
    icon: Bot,
    render: () => <AgentBridgeTab />
  },
  import: { label: 'Chrome Import', description: 'Bring a logged-in Chrome tab into SessionForge.', icon: Puzzle, render: () => <ChromeImportTab /> },
  shortcuts: { label: 'Shortcuts', description: 'Keyboard shortcuts for tabs, panes and DevTools.', icon: Keyboard, render: () => <ShortcutsTab /> },
  about: {
    label: 'About & Privacy',
    description: 'Version, license, and how SessionForge handles your data.',
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
  useViewOverlay(open)
  const meta = TABS[tab]
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
      >
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as SettingsTab)}
          orientation="vertical"
          className="flex min-h-0 min-w-0 flex-1"
        >
          <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/40">
            <div className="px-5 pb-3 pt-5">
              <DialogTitle className="text-base">Settings</DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">Stored on this computer only.</p>
            </div>
            <TabsList aria-label="Settings sections" className="flex h-auto flex-col items-stretch gap-0.5 bg-transparent px-3 py-1">
              {SETTINGS_TABS.map((t) => {
                const Icon = TABS[t].icon
                return (
                  <TabsTrigger
                    key={t}
                    value={t}
                    data-testid={`settings-nav-${t}`}
                    className="w-full justify-start gap-2.5 px-3 py-2 text-[13px] text-muted-foreground hover:bg-background/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {TABS[t].label}
                  </TabsTrigger>
                )
              })}
            </TabsList>
            <p className="mt-auto px-5 pb-4 text-[11px] text-muted-foreground">
              <kbd className="rounded border bg-background px-1 font-mono">Ctrl/Cmd+,</kbd> opens Settings
            </p>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="border-b px-8 pb-4 pt-5 pr-14">
              <h2 data-testid="settings-title" className="text-lg font-semibold tracking-tight">
                {meta.label}
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
