// Where the tour card goes next to its anchor. Pure, so the unit project tests it.

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}
export interface Size {
  w: number
  h: number
}
export type TourSide = 'right' | 'bottom' | 'top' | 'left'

/** Distance kept from the window edges */
const MARGIN = 12
/** Distance between the anchor and the card */
const GAP = 10
const FALLBACK_ORDER: readonly TourSide[] = ['bottom', 'right', 'top', 'left']

/** Clamps v into [lo, hi]; when the range is empty (card larger than the room) it sticks to lo. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi))
}

function onSide(side: TourSide, a: Rect, card: Size, vp: Size): { left: number; top: number } {
  const centredLeft = clamp(a.left + a.width / 2 - card.w / 2, MARGIN, vp.w - MARGIN - card.w)
  const centredTop = clamp(a.top + a.height / 2 - card.h / 2, MARGIN, vp.h - MARGIN - card.h)
  switch (side) {
    case 'bottom':
      return { left: centredLeft, top: a.top + a.height + GAP }
    case 'top':
      return { left: centredLeft, top: a.top - GAP - card.h }
    case 'right':
      return { left: a.left + a.width + GAP, top: centredTop }
    case 'left':
      return { left: a.left - GAP - card.w, top: centredTop }
  }
}

function inside(p: { left: number; top: number }, card: Size, vp: Size): boolean {
  return p.left >= MARGIN && p.top >= MARGIN && p.left + card.w <= vp.w - MARGIN && p.top + card.h <= vp.h - MARGIN
}

/**
 * Tries `prefer`, then bottom → right → top → left. A side fits when the card stays inside the
 * viewport minus the margin; it never overlaps the anchor because it sits GAP px beyond it.
 * With no anchor, or when nothing fits, the card is centred and clamped.
 */
export function placeTourCard(
  anchor: Rect | null,
  card: Size,
  viewport: Size,
  prefer: 'right' | 'bottom'
): { left: number; top: number; side: TourSide | 'center' } {
  if (anchor) {
    const order = [prefer, ...FALLBACK_ORDER.filter((s) => s !== prefer)]
    for (const side of order) {
      const p = onSide(side, anchor, card, viewport)
      if (inside(p, card, viewport)) return { left: Math.round(p.left), top: Math.round(p.top), side }
    }
  }
  return {
    left: Math.round(clamp((viewport.w - card.w) / 2, MARGIN, viewport.w - MARGIN - card.w)),
    top: Math.round(clamp((viewport.h - card.h) / 2, MARGIN, viewport.h - MARGIN - card.h)),
    side: 'center'
  }
}
