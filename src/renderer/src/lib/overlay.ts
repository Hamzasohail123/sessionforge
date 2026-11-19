export interface DOMRectLike {
  top: number
  bottom: number
  left?: number
  right?: number
}

/** True when an open toast reaches below the top of the highest pane slot (so a page view would hide it). */
export function toastCovers(toastRect: DOMRectLike | null, slotRects: DOMRectLike[]): boolean {
  if (!toastRect || slotRects.length === 0) return false
  const top = Math.min(...slotRects.map((r) => r.top))
  return toastRect.bottom > top
}
