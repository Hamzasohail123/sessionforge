import { useEffect } from 'react'
import { useStore } from '../store'

/** While open, page views are hidden (they draw above the DOM). A counter handles nesting and StrictMode. */
export function useViewOverlay(open: boolean): void {
  useEffect(() => {
    if (!open) return
    const { pushOverlay, popOverlay } = useStore.getState()
    pushOverlay()
    return popOverlay
  }, [open])
}
