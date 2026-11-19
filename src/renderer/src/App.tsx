import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session, TabState } from '../../main/types'
import { SessionBar } from './components/SessionBar'
import { TabBar } from './components/TabBar'
import { AddressBar } from './components/AddressBar'
import { SplitView } from './components/SplitView'
import { CommandPalette } from './components/CommandPalette'
import { useStore } from './store'
import { useAgentEvents } from './agent-store'
import { callMain } from './lib/ipc'
import { DEFAULT_URL } from '../../main/constants'
import { Toaster } from './components/ui/toaster'
import { toast } from './components/ui/use-toast'
import { reopenLast } from './lib/recently-closed'

function App() {
  const [commandOpen, setCommandOpen] = useState(false)
  const activeTabId = useStore((s) => s.activeTabId)
  const activeSessionId = useStore((s) => s.activeSessionId)
  const overlayOpen = useStore((s) => s.overlayCount > 0)
  const setLayout = useStore((s) => s.setLayout)
  const queryClient = useQueryClient()
  const [tabState, setTabState] = useState<TabState | null>(null)
  const addressInputRef = useRef<HTMLInputElement>(null)
  useAgentEvents()

  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: () => window.api.session.getAll()
  })

  // Main owns the layout: pull it once, then follow its broadcasts
  useEffect(() => {
    callMain(window.api.layout.get()).then((l) => l && setLayout(l))
    const offLayout = window.api.layout.onUpdate(setLayout)
    // Main created/closed tabs (popups, context menu, imports): refresh that session's list
    const offTabs = window.api.tab.onTabsChanged(({ sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ['tabs', sessionId] })
    })
    // Chrome-extension import: main already placed it in a pane; show the session and say so
    const offImported = window.api.session.onImported(({ sessionId, name, kind }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['tabs', sessionId] })
      // "Sign in with Chrome" cannot tell whether the cookies are signed in, so the text stays neutral
      toast({ title: kind === 'signin' ? `Login sent from Chrome: ${name}` : `Imported ${name}` })
    })
    return () => {
      offLayout()
      offTabs()
      offImported()
    }
  }, [queryClient, setLayout])

  // Live state of the focused pane's tab
  useEffect(() => {
    setTabState(null)
    if (!activeTabId) return
    let alive = true
    window.api.tab.getState(activeTabId).then((state) => {
      if (!alive) return
      if (state) setTabState(state)
      else callMain(window.api.layout.get()).then((l) => l && setLayout(l)) // stale id: resync
    })
    const off = window.api.tab.onUpdate((data) => {
      if (data.id === activeTabId) setTabState(data)
    })
    return () => {
      alive = false
      off()
    }
  }, [activeTabId, setLayout])

  // Page views draw above the React UI, so hide them while any overlay is open
  useEffect(() => {
    callMain(window.api.view.setOverlay(overlayOpen))
  }, [overlayOpen])

  const handleNavigate = (url: string) => {
    if (activeTabId) callMain(window.api.tab.navigate(activeTabId, url))
  }
  const handleBack = () => {
    if (activeTabId) callMain(window.api.tab.goBack(activeTabId))
  }
  const handleForward = () => {
    if (activeTabId) callMain(window.api.tab.goForward(activeTabId))
  }
  const handleReload = () => {
    if (activeTabId) callMain(window.api.tab.reload(activeTabId))
  }
  const handleStop = () => {
    if (activeTabId) callMain(window.api.tab.stop(activeTabId))
  }

  // Keyboard shortcuts are matched in main (pages and shell alike). Main resolves the target tab after
  // any pane focus change and sends it in the payload, so this handler never reads it from React state.
  useEffect(() => {
    return window.api.shortcut.onTriggered(({ action, tabId, sessionId }) => {
      // While a session name is being edited, keys belong to its input. Main already prevented the
      // mod-key shortcuts, so the input never sees them either. Known limits: Cmd/Ctrl+1–4 focus the
      // pane in main, which blurs the input and so saves the name; and an Escape that cancelled the
      // edit can still arrive after the editor unmounted (at most a tab.stop on a loading page).
      if (useStore.getState().inlineEditing) return
      const tab = window.api.tab
      switch (action) {
        case 'commandPalette':
          setCommandOpen(true)
          return
        case 'reopenClosed':
          void reopenLast(queryClient)
          return
        case 'openSettings':
          // The palette closes first so only one dialog is on screen
          setCommandOpen(false)
          useStore.getState().openSettings()
          return
        case 'focusAddressBar':
          addressInputRef.current?.focus()
          addressInputRef.current?.select()
          return
        case 'newTab':
          if (sessionId) callMain(tab.create(sessionId, DEFAULT_URL))
          return
        case 'nextTab':
          callMain(tab.cycle(1))
          return
        case 'prevTab':
          callMain(tab.cycle(-1))
          return
        case 'focusPane1':
        case 'focusPane2':
        case 'focusPane3':
        case 'focusPane4':
          return // main already focused the pane; layout:updated re-renders the focus ring
      }
      if (!tabId) return
      switch (action) {
        case 'closeTab':
          callMain(tab.close(tabId))
          return
        case 'reload':
          callMain(tab.reload(tabId))
          return
        case 'hardReload':
          callMain(tab.reloadIgnoringCache(tabId))
          return
        case 'back':
          callMain(tab.goBack(tabId))
          return
        case 'forward':
          callMain(tab.goForward(tabId))
          return
        case 'devtools':
          callMain(tab.openDevTools(tabId))
          return
        case 'devtoolsConsole':
          callMain(tab.openDevTools(tabId, 'console'))
          return
        case 'devtoolsInspect':
          callMain(tab.openDevTools(tabId, 'elements'))
          return
        case 'viewSource':
          callMain(tab.viewSource(tabId))
          return
        case 'stop':
          // Esc is closing a dialog or the palette
          if (useStore.getState().overlayCount > 0) return
          callMain(tab.stop(tabId))
          return
      }
    })
  }, [queryClient])

  // Toolbar height stays constant (136 px) whenever a session exists, even with an empty focused pane
  const hasSessions = sessions.length > 0

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background">
      <SessionBar />
      {hasSessions && <TabBar sessionId={activeSessionId} />}
      {hasSessions && (
        <AddressBar
          ref={addressInputRef}
          tabId={activeTabId}
          onNavigate={handleNavigate}
          onBack={handleBack}
          onForward={handleForward}
          onReload={handleReload}
          onStop={handleStop}
          canGoBack={tabState?.canGoBack}
          canGoForward={tabState?.canGoForward}
          isLoading={tabState?.isLoading}
          currentUrl={tabState?.url || ''}
          pageTitle={tabState?.title}
        />
      )}
      <SplitView />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <Toaster />
    </div>
  )
}

export default App
