import { useEffect, useState } from 'react'
import { ExternalLink, Puzzle, ShieldAlert } from 'lucide-react'
import type { PaneId } from '../../../main/types'
import type { SignInBannerState } from '../../../main/google-signin/types'
import { callMain } from '../lib/ipc'
import { Button } from './ui/button'

interface SignInBannerProps {
  paneId: PaneId
  tabId: string
  sessionName: string
}

const NOTICE: Record<NonNullable<SignInBannerState['notice']>, string> = {
  expired: 'The last request expired.',
  failed: 'Sending the login back failed.'
}

function bannerText(s: SignInBannerState, sessionName: string): string {
  if (s.status === 'unavailable') {
    return "Google doesn't allow “Sign in with Google” here, and SessionForge can't tell which site started it. Go back to the site in this pane and start the sign-in again."
  }
  if (s.status === 'waiting') {
    const at = s.expiresAt ? new Date(s.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
    const browser = s.browser ?? 'Chrome'
    return [
      `Finish signing in in ${browser}. Then click the SessionForge Import extension and choose “Send to ${sessionName}”.`,
      at ? `Expires at ${at}.` : '',
      browser === 'your default browser' ? 'The SessionForge Import extension must be installed in that browser.' : '',
      `No “Send to ${sessionName}” button? Reload SessionForge Import in chrome://extensions (version 1.2.0 or later).`
    ]
      .filter(Boolean)
      .join(' ')
  }
  const offer =
    s.kind === 'oauth'
      ? `Google doesn't allow “Sign in with Google” inside embedded browsers like SessionForge. Sign in to ${s.targetHost} with Chrome and send the login back, two clicks.`
      : "Google doesn't allow signing in inside embedded browsers like SessionForge. Sign in with Chrome and send the login back, two clicks."
  return [s.notice ? NOTICE[s.notice] : '', s.rejected ? 'Google refused this sign-in.' : '', offer].filter(Boolean).join(' ')
}

/**
 * Shown above a pane's page when its tab reached a Google sign-in page. It sits in the pane's flex
 * column like the header, so it takes height from the page slot and never covers the page view.
 */
export function SignInBanner({ paneId, tabId, sessionName }: SignInBannerProps) {
  const [state, setState] = useState<SignInBannerState | null>(null)
  const [busy, setBusy] = useState(false)
  const [extBusy, setExtBusy] = useState(false)

  // Current state on mount / tab change, then live updates for this tab only
  useEffect(() => {
    setState(null)
    setBusy(false)
    setExtBusy(false)
    // A dev renderer hot-reloaded against an older preload has no signin API until the app restarts
    if (!window.api.signin) return
    let alive = true
    let heard = false
    window.api.signin
      .getState(tabId)
      .then((s) => alive && !heard && setState(s))
      .catch(() => undefined)
    const off = window.api.signin.onState((e) => {
      if (e.tabId !== tabId) return
      heard = true
      setState(e.state)
    })
    return () => {
      alive = false
      off()
    }
  }, [tabId])

  if (!state) return null

  const start = () => {
    setBusy(true)
    callMain(window.api.signin.start(tabId)).finally(() => setBusy(false))
  }
  const dismiss = () => callMain(window.api.signin.dismiss(tabId))
  const cancel = () => callMain(window.api.signin.cancel(tabId))
  const getExtension = () => {
    setExtBusy(true)
    // callMain never rejects (it toasts and resolves undefined), so finally always runs
    void callMain(window.api.app.openExtensionStore()).finally(() => setExtBusy(false))
  }
  // Not in 'unavailable' (the hand-off can't start there), nor with a preload that predates the IPC
  const showExtension =
    (state.status === 'offer' || state.status === 'waiting') && typeof window.api.app.openExtensionStore === 'function'

  return (
    <div
      role="region"
      aria-label="Google sign-in"
      data-testid={`signin-banner-${paneId}`}
      data-state={state.status}
      data-kind={state.kind}
      data-rejected={state.rejected}
      className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1.5 text-xs bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50"
    >
      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <p data-testid={`signin-text-${paneId}`} aria-live="polite" className="flex-1 min-w-[12rem] leading-snug">
        {bannerText(state, sessionName)}
      </p>
      <div className="flex items-center gap-1.5">
        {state.status === 'offer' && (
          <>
            <Button size="sm" className="h-7" data-testid={`signin-start-${paneId}`} disabled={busy} onClick={start}>
              {busy ? 'Opening…' : 'Sign in with Chrome'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              data-testid={`signin-dismiss-${paneId}`}
              disabled={busy}
              onClick={dismiss}
            >
              Dismiss
            </Button>
          </>
        )}
        {state.status === 'waiting' && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              data-testid={`signin-start-${paneId}`}
              disabled={busy}
              onClick={start}
            >
              {busy ? 'Opening…' : 'Open again'}
            </Button>
            <Button size="sm" variant="ghost" className="h-7" data-testid={`signin-cancel-${paneId}`} onClick={cancel}>
              Cancel
            </Button>
          </>
        )}
        {state.status === 'unavailable' && (
          <Button size="sm" variant="ghost" className="h-7" data-testid={`signin-dismiss-${paneId}`} onClick={dismiss}>
            Dismiss
          </Button>
        )}
      </div>
      {showExtension && (
        <div className="flex basis-full flex-wrap items-center gap-x-2 gap-y-1 border-t border-amber-200/60 pt-1.5">
          <Puzzle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p data-testid={`signin-extension-${paneId}`} className="flex-1 min-w-[12rem] leading-snug">
            The SessionForge Import extension brings your existing Chrome login into this session.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            data-testid={`signin-get-extension-${paneId}`}
            title="Opens the Chrome Web Store in your browser"
            disabled={extBusy}
            onClick={getExtension}
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {extBusy ? 'Opening…' : 'Get the extension'}
          </Button>
        </div>
      )}
    </div>
  )
}
