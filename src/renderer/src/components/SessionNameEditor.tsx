import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './ui/popover'
import { COLORS, SESSION_NAME_MAX } from '../../../main/constants'
import { useStore } from '../store'
import { callMain } from '../lib/ipc'
import { cn } from '../lib/utils'
import type { Session } from '../../../main/types'

interface SessionNameEditorProps {
  session: Session
  /** Editing ended (saved, cancelled or nothing to save) */
  onDone: () => void
}

const RING = 'outline-none focus-visible:ring-1 focus-visible:ring-muted-foreground/60 focus-visible:ring-offset-0'

/**
 * Inline rename in the SessionBar: Enter or leaving the field saves, Escape cancels, an empty name
 * keeps the old one. The dot opens the color picker; a picked color is saved at once.
 */
export function SessionNameEditor({ session, onDone }: SessionNameEditorProps) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(session.name)
  const [pickerOpen, setPickerOpenState] = useState(false)
  // The ref is read in blur handlers that run before React re-renders
  const pickerOpenRef = useRef(false)
  const doneRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedSwatchRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const { setInlineEditing } = useStore.getState()
    setInlineEditing(true)
    inputRef.current?.focus()
    inputRef.current?.select()
    return () => setInlineEditing(false)
  }, [])

  const setPickerOpen = (open: boolean) => {
    pickerOpenRef.current = open
    setPickerOpenState(open)
  }

  const cancel = () => {
    if (doneRef.current) return
    doneRef.current = true
    onDone()
  }

  const commit = async () => {
    if (doneRef.current) return
    const name = value.trim()
    if (!name || name === session.name) return cancel()
    doneRef.current = true
    await callMain(window.api.session.update({ id: session.id, name }))
    await queryClient.invalidateQueries({ queryKey: ['sessions'] })
    onDone()
  }

  const pickColor = async (color: string) => {
    setPickerOpen(false)
    if (color === session.color) return
    await callMain(window.api.session.update({ id: session.id, color }))
    await queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }

  return (
    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
      {/* The picker hangs below the whole editor, not below the dot, so it never covers the item */}
      <PopoverAnchor asChild>
        <div
          ref={containerRef}
          className="flex items-center gap-2 px-2 py-1"
          onBlur={(e) => {
            if (pickerOpenRef.current) return
            // Blurs inside the picker's portal bubble here too; closing it puts focus back on the input
            if (!containerRef.current?.contains(e.target as Node)) return
            const next = e.relatedTarget as Node | null
            if (next && containerRef.current.contains(next)) return
            void commit()
          }}
        >
          <PopoverTrigger
            data-testid={`color-session-${session.id}`}
            aria-label={`Change color of ${session.name}`}
            title="Change color"
            // Keep focus in the input until the picker opens
            onMouseDown={(e) => e.preventDefault()}
            className={cn('h-4 w-4 shrink-0 rounded-full border border-background/60 shadow-sm', RING)}
            style={{ backgroundColor: session.color }}
          />
          <input
            ref={inputRef}
            data-testid={`rename-session-${session.id}`}
            aria-label={`Rename session ${session.name}`}
            value={value}
            maxLength={SESSION_NAME_MAX}
            size={Math.min(32, Math.max(8, value.length + 1))}
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                cancel()
              }
            }}
            className={cn(
              'h-7 min-w-[6rem] max-w-[16rem] rounded-sm border border-input bg-background px-1.5 text-sm font-semibold text-foreground',
              'outline-none focus-visible:ring-1 focus-visible:ring-ring'
            )}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        data-testid={`color-popover-${session.id}`}
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-auto"
        // Start on the current color, so the focus ring and the selection are the same swatch
        onOpenAutoFocus={(e) => {
          if (!selectedSwatchRef.current) return // a color outside the list: Radix focuses the first swatch
          e.preventDefault()
          selectedSwatchRef.current.focus()
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <div role="group" aria-label="Session color" className="flex items-center gap-1.5">
          {COLORS.map((c) => {
            const selected = c.value.toLowerCase() === session.color.toLowerCase()
            return (
              <button
                key={c.value}
                ref={selected ? selectedSwatchRef : undefined}
                type="button"
                data-testid={`color-option-${c.name.toLowerCase()}`}
                aria-label={c.name}
                aria-pressed={selected}
                title={c.name}
                onClick={() => void pickColor(c.value)}
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full outline-none',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
                  selected && 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-popover'
                )}
                style={{ backgroundColor: c.value }}
              >
                {selected && <Check className="h-3.5 w-3.5 text-white" aria-hidden />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
