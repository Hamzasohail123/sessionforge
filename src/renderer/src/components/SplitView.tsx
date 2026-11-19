import { useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LayoutMode, PaneId, PaneRect, Session } from '../../../main/types'
import { useStore } from '../store'
import { cn } from '../lib/utils'
import { Pane } from './Pane'

const GRID: Record<LayoutMode, string> = {
  single: 'grid-cols-1 grid-rows-1',
  columns: 'grid-cols-2 grid-rows-1',
  rows: 'grid-cols-1 grid-rows-2',
  grid: 'grid-cols-2 grid-rows-2'
}

/**
 * Measure every pane slot and send the rects to main, which positions the page views over them.
 * One ResizeObserver for all slots (plus window resize), batched per animation frame, sent only on change.
 */
function usePaneRects(): (paneId: PaneId) => (el: HTMLDivElement | null) => void {
  const slots = useRef(new Map<PaneId, HTMLDivElement>())
  const last = useRef('')
  const frame = useRef<number | null>(null)
  const observer = useRef<ResizeObserver | null>(null)

  const measure = useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const rects: PaneRect[] = []
      for (const [paneId, el] of slots.current) {
        const r = el.getBoundingClientRect()
        rects.push({
          paneId,
          x: Math.max(0, Math.round(r.left)),
          y: Math.max(0, Math.round(r.top)),
          width: Math.max(0, Math.floor(r.width)),
          height: Math.max(0, Math.floor(r.height))
        })
      }
      rects.sort((a, b) => a.paneId.localeCompare(b.paneId))
      const key = JSON.stringify(rects)
      if (key === last.current) return
      last.current = key
      window.api.layout.setPaneRects(rects).catch((err) => {
        last.current = '' // retry on the next observer callback
        console.error('[layout] setPaneRects failed', err)
      })
    })
  }, [])

  useEffect(() => {
    observer.current = new ResizeObserver(measure)
    for (const el of slots.current.values()) observer.current.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.current?.disconnect()
      observer.current = null
      window.removeEventListener('resize', measure)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [measure])

  const refs = useRef(new Map<PaneId, (el: HTMLDivElement | null) => void>())
  return useCallback(
    (paneId: PaneId) => {
      let ref = refs.current.get(paneId)
      if (!ref) {
        ref = (el: HTMLDivElement | null) => {
          const prev = slots.current.get(paneId)
          if (prev) observer.current?.unobserve(prev)
          if (el) {
            slots.current.set(paneId, el)
            observer.current?.observe(el)
          } else {
            slots.current.delete(paneId)
          }
          measure()
        }
        refs.current.set(paneId, ref)
      }
      return ref
    },
    [measure]
  )
}

export function SplitView() {
  const layout = useStore((s) => s.layout)
  const slotRef = usePaneRects()
  const { data: sessions = [], isSuccess } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: () => window.api.session.getAll()
  })

  if (isSuccess && sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">Welcome to SessionForge</h2>
          <p>Create a session to get started</p>
        </div>
      </div>
    )
  }
  if (!layout) return <div className="flex-1 min-h-0" />

  return (
    <div data-testid="split-view" className={cn('flex-1 min-h-0 grid gap-1 bg-border', GRID[layout.mode])}>
      {layout.panes.map((pane) => (
        <Pane
          key={pane.paneId}
          paneId={pane.paneId}
          tabId={pane.tabId}
          sessionId={pane.sessionId}
          focused={layout.activePaneId === pane.paneId && layout.panes.length > 1}
          slotRef={slotRef(pane.paneId)}
        />
      ))}
    </div>
  )
}
