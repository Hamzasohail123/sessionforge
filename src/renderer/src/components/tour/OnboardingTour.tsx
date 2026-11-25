import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { TourOutcome, TourState } from '../../../../main/types'
import { useStore, type AgentTab, type SettingsTab } from '../../store'
import { useViewOverlay } from '../../hooks/useViewOverlay'
import { callMain } from '../../lib/ipc'
import { placeTourCard, type Rect, type Size } from '../../lib/tour-placement'
import { Button } from '../ui/button'
import { TOUR_STEPS } from './tour-steps'

const STEP_COUNT = TOUR_STEPS.length - 1 // the welcome card is not numbered
const CARD_MAX_W = 340
/** Card height used until the real one is measured */
const CARD_H_GUESS = 180
/** Spotlight padding around the anchor */
const PAD = 4
/** Longest wait for Settings to finish opening or closing (its animation is 200 ms) */
const SETTLE_TIMEOUT_MS = 1_000

// Module scope survives StrictMode's mount → cleanup → mount, so getState runs once and the tour
// auto-starts at most once per renderer load (getState keeps saying autoStart until the tour ends)
let tourStatePromise: Promise<TourState> | null = null
let started = false
function loadTourState(): Promise<TourState> {
  if (!window.api.tour) return Promise.resolve({ autoStart: false }) // preload too old
  tourStatePromise ??= window.api.tour.getState().catch((err: unknown) => {
    console.error('[tour] getState failed', err)
    return { autoStart: false }
  })
  return tourStatePromise
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(id)}"]`)

interface Snapshot {
  open: boolean
  tab: SettingsTab
  agentTab: AgentTab
  focus: { el: HTMLElement | null; testid: string | null }
}
interface Measured {
  step: number
  /** Padded anchor rect; null for the welcome card or a missing anchor */
  rect: Rect | null
  vp: Size
  cardH: number
}

/**
 * First-run tour: a welcome card, then eight steps that open Settings tabs through the store and
 * point a spotlight at a real element. The card is a modal Radix dialog remounted per step, so it is
 * always the top layer (above Settings). Ending restores Settings and focus as they were at start.
 */
export function OnboardingTour() {
  const tourActive = useStore((s) => s.tourActive)
  const [step, setStep] = useState(0)
  // The step whose view has rendered; a plain boolean would let a new step's card mount (with the
  // old step's true) before its effect opened Settings, and Settings would then be the top layer
  const [readyStep, setReadyStep] = useState<number | null>(null)
  const ready = readyStep === step
  const [measured, setMeasured] = useState<Measured | null>(null)
  const snapshot = useRef<Snapshot | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Page views draw above the DOM, so they stay hidden while the tour runs
  useViewOverlay(tourActive)

  // Auto-start once for a new profile, after anything the user opened in the first moments closed
  useEffect(() => {
    let alive = true
    let unsub: (() => void) | undefined
    void loadTourState().then(({ autoStart }) => {
      if (!alive || !autoStart) return
      const tryStart = (overlays: number): boolean => {
        if (overlays !== 0) return false
        unsub?.()
        unsub = undefined
        if (!started) {
          started = true
          useStore.getState().startTour()
        }
        return true
      }
      if (!tryStart(useStore.getState().overlayCount)) {
        unsub = useStore.subscribe((s) => {
          tryStart(s.overlayCount)
        })
      }
    })
    return () => {
      alive = false
      unsub?.()
    }
  }, [])

  // Start: remember Settings and focus (declared before the step effect so it runs first)
  useEffect(() => {
    if (!tourActive) return
    const { open, tab, agentTab } = useStore.getState().settings
    const el = document.activeElement as HTMLElement | null
    snapshot.current = {
      open,
      tab,
      agentTab,
      focus: { el, testid: el?.closest<HTMLElement>('[data-testid]')?.dataset.testid ?? null }
    }
    setStep(0)
  }, [tourActive])

  // Apply the step's Settings view, wait two frames for it to render, then show the card
  useEffect(() => {
    if (!tourActive) return
    const s = TOUR_STEPS[step]
    const store = useStore.getState()
    if (s.view.kind === 'closed') store.closeSettings()
    else if (s.view.kind === 'settings') store.openSettings(s.view.tab, s.view.agentTab)
    setReadyStep(null)
    // Radix layers stack in mount order, so the card mounts only once Settings is fully open (or
    // fully gone, after its exit animation); otherwise Settings would take Esc and clicks
    const settingsSettled = () => {
      const dialog = byTestId('settings-dialog')
      if (s.view.kind === 'closed') return dialog === null
      if (s.view.kind === 'settings') return dialog?.dataset.state === 'open'
      return true
    }
    const deadline = performance.now() + SETTLE_TIMEOUT_MS
    let frames = 0
    let raf = 0
    const wait = () => {
      frames++
      if (frames < 2 || (!settingsSettled() && performance.now() < deadline)) {
        raf = requestAnimationFrame(wait)
        return
      }
      if (s.anchor) {
        const el = byTestId(s.anchor)
        if (el) el.scrollIntoView({ block: 'nearest' })
        else console.warn('[tour] anchor not found:', s.id)
      }
      setReadyStep(step)
    }
    raf = requestAnimationFrame(wait)
    return () => cancelAnimationFrame(raf)
  }, [tourActive, step])

  const end = useCallback((outcome: TourOutcome) => {
    if (window.api.tour) void callMain(window.api.tour.finish(outcome))
    const store = useStore.getState()
    store.endTour()
    setStep(0)
    setReadyStep(null)
    setMeasured(null)
    const snap = snapshot.current
    snapshot.current = null
    if (!snap) return
    if (snap.open) store.openSettings(snap.tab, snap.agentTab)
    else {
      store.closeSettings()
      store.setSettingsTab(snap.tab)
      store.setAgentTab(snap.agentTab)
    }
    // The focused element is often unmounted mid-tour, so fall back to its testid, then a safe control
    requestAnimationFrame(() => {
      const target =
        (snap.focus.el?.isConnected ? snap.focus.el : null) ??
        (snap.focus.testid ? byTestId(snap.focus.testid) : null) ??
        (snap.open ? byTestId(`settings-nav-${snap.tab}`) : byTestId('open-settings'))
      target?.focus()
    })
  }, [])
  const skip = useCallback(() => end('skipped'), [end])

  // Esc between steps (card unmounted, Settings on top) must skip the tour, not close Settings
  const waiting = tourActive && !ready
  useEffect(() => {
    if (!waiting) return
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      skip()
    }
    window.addEventListener('keydown', h, { capture: true })
    return () => window.removeEventListener('keydown', h, { capture: true })
  }, [waiting, skip])

  // Follow the anchor (Settings' open animation, resizes, scrolling); update only on whole-pixel changes
  useEffect(() => {
    if (!tourActive || !ready) return
    const anchor = TOUR_STEPS[step].anchor
    let raf = 0
    let last = ''
    const tick = () => {
      const r = anchor ? byTestId(anchor)?.getBoundingClientRect() : undefined
      const next: Measured = {
        step,
        rect: r
          ? {
              left: Math.round(r.left) - PAD,
              top: Math.round(r.top) - PAD,
              width: Math.round(r.width) + 2 * PAD,
              height: Math.round(r.height) + 2 * PAD
            }
          : null,
        vp: { w: window.innerWidth, h: window.innerHeight },
        cardH: Math.round(cardRef.current?.offsetHeight ?? 0)
      }
      const key = JSON.stringify(next)
      if (key !== last) {
        last = key
        setMeasured(next)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [tourActive, ready, step])

  if (!tourActive) return null

  const s = TOUR_STEPS[step]
  const isWelcome = step === 0
  const isLast = step === STEP_COUNT
  // Between steps the previous spotlight stays, so the screen does not flash undimmed
  const vp = measured?.vp ?? { w: window.innerWidth, h: window.innerHeight }
  const cardW = Math.min(CARD_MAX_W, vp.w - 24)
  const current = measured?.step === step ? measured : null
  const pos = placeTourCard(current?.rect ?? null, { w: cardW, h: current?.cardH || CARD_H_GUESS }, vp, s.placement)
  // Hidden by opacity (not visibility) until measured, so Radix can still focus its button
  const placed = current !== null && current.cardH > 0

  const spotlight = measured?.rect ? (
    <div
      data-testid="tour-spotlight"
      aria-hidden="true"
      className="pointer-events-none fixed z-[55] rounded-md ring-2 ring-primary"
      style={{
        left: measured.rect.left,
        top: measured.rect.top,
        width: measured.rect.width,
        height: measured.rect.height,
        boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)'
      }}
    />
  ) : (
    <div data-testid="tour-dim" aria-hidden="true" className="pointer-events-none fixed inset-0 z-[55] bg-black/55" />
  )

  return (
    <>
      {createPortal(spotlight, document.body)}
      {ready && (
        <DialogPrimitive.Root key={s.id} open modal>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Content
              ref={cardRef}
              data-testid="tour-card"
              data-step={s.id}
              className="fixed z-[60] max-h-[calc(100vh-24px)] overflow-auto rounded-lg border bg-background p-4 shadow-lg focus:outline-none"
              style={{ left: pos.left, top: pos.top, width: cardW, opacity: placed ? 1 : 0 }}
              onEscapeKeyDown={(e) => {
                e.preventDefault()
                skip()
              }}
              onPointerDownOutside={(e) => e.preventDefault()}
              onInteractOutside={(e) => e.preventDefault()}
              onOpenAutoFocus={(e) => {
                e.preventDefault()
                cardRef.current?.querySelector<HTMLElement>(`[data-testid="${isWelcome ? 'tour-start' : 'tour-next'}"]`)?.focus()
              }}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {!isWelcome && (
                <p data-testid="tour-counter" className="mb-1 text-[11px] font-medium text-muted-foreground">
                  Step {step} of {STEP_COUNT}
                </p>
              )}
              <DialogPrimitive.Title asChild>
                <h2 data-testid="tour-title" className="text-sm font-semibold leading-tight">
                  {s.title}
                </h2>
              </DialogPrimitive.Title>
              <DialogPrimitive.Description asChild>
                <p data-testid="tour-body" className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
                  {s.body}
                </p>
              </DialogPrimitive.Description>
              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" variant="ghost" data-testid="tour-skip" onClick={skip}>
                  Skip tour
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  {isWelcome ? (
                    <Button size="sm" data-testid="tour-start" onClick={() => setStep(1)}>
                      Start tour
                    </Button>
                  ) : (
                    <>
                      {step > 1 && (
                        <Button size="sm" variant="outline" data-testid="tour-back" onClick={() => setStep(step - 1)}>
                          Back
                        </Button>
                      )}
                      <Button
                        size="sm"
                        data-testid="tour-next"
                        onClick={() => (isLast ? end('completed') : setStep(step + 1))}
                      >
                        {isLast ? 'Finish' : 'Next'}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </>
  )
}
