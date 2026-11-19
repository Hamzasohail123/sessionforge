import { Columns2, Grid2x2, Rows2, Square } from 'lucide-react'
import type { LayoutMode } from '../../../main/types'
import { Button } from './ui/button'
import { useStore } from '../store'
import { callMain } from '../lib/ipc'
import { cn } from '../lib/utils'

// eslint-disable-next-line react-refresh/only-export-components -- shared with CommandPalette; edits here do a full reload in dev
export const LAYOUT_OPTIONS: Array<{ mode: LayoutMode; label: string; Icon: typeof Square }> = [
  { mode: 'single', label: 'Single pane', Icon: Square },
  { mode: 'columns', label: 'Two columns', Icon: Columns2 },
  { mode: 'rows', label: 'Two rows', Icon: Rows2 },
  { mode: 'grid', label: '2×2 grid', Icon: Grid2x2 }
]

export function LayoutSwitcher() {
  const mode = useStore((s) => s.layout?.mode)
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {LAYOUT_OPTIONS.map(({ mode: m, label, Icon }) => (
        <Button
          key={m}
          size="icon"
          variant="ghost"
          data-testid={`layout-${m}`}
          aria-pressed={mode === m}
          title={label}
          className={cn('h-8 w-8', mode === m && 'bg-background text-foreground shadow-sm')}
          onClick={() => callMain(window.api.layout.setMode(m))}
        >
          <Icon className="h-4 w-4" />
        </Button>
      ))}
    </div>
  )
}
