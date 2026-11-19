import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from './ui/command'
import { useStore } from '../store'
import { callMain } from '../lib/ipc'
import { useViewOverlay } from '../hooks/useViewOverlay'
import { LAYOUT_OPTIONS } from './LayoutSwitcher'
import { reopenLast } from '../lib/recently-closed'
import type { LayoutMode, Session } from '../../../main/types'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  // Page views draw above the DOM, so hide them while the palette is open
  useViewOverlay(open)
  const queryClient = useQueryClient()

  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: () => window.api.session.getAll()
  })

  const handleSelectSession = (sessionId: string) => {
    const layout = useStore.getState().layout
    if (layout) callMain(window.api.layout.openSession(layout.activePaneId, sessionId))
    onOpenChange(false)
  }

  const handleSelectLayout = (mode: LayoutMode) => {
    callMain(window.api.layout.setMode(mode))
    onOpenChange(false)
  }

  const handleReopen = () => {
    onOpenChange(false)
    void reopenLast(queryClient)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Sessions">
          {sessions.map((session) => (
            <CommandItem key={session.id} onSelect={() => handleSelectSession(session.id)}>
              <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: session.color }} />
              <span>{session.name}</span>
              {session.env === 'production' && <span className="ml-auto text-xs text-destructive">PROD</span>}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Layout">
          {LAYOUT_OPTIONS.map(({ mode, label, Icon }) => (
            <CommandItem key={mode} onSelect={() => handleSelectLayout(mode)}>
              <Icon className="h-4 w-4 mr-2" />
              <span>{label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem data-testid="palette-reopen" onSelect={handleReopen}>
            <RotateCcw className="h-4 w-4 mr-2" />
            <span>Reopen closed tab or session</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
