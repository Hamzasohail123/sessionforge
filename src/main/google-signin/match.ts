// Recognises Google sign-in pages from committed main-frame URLs. Pure; used by the banner and the
// Agent Bridge alike. Production matching is exactly https://accounts.google.com; the only other origin
// is the e2e test origin from resolveTestGoogleOrigins (SESSIONFORGE_E2E=1 only).
import type { SignInKind } from './types'
import { isGoogleOwnedHost, toLaunchableUrl } from './domains'

export interface SignInMatch {
  kind: SignInKind
  /** Google's "Couldn't sign you in / may not be secure" page */
  rejected: boolean
  /** Origin that matched: 'https://accounts.google.com', or the e2e test origin */
  origin: string
  /** google-account only: the validated continue target */
  continueUrl: string | null
  /** oauth only: app_domain origin, else redirect_uri origin (launchable http(s) only) */
  appOrigin: string | null
  /** 'mail', 'youtube', … when it matches /^[a-z0-9_-]{1,40}$/i */
  service: string | null
}
export interface MatchOptions {
  testOrigins?: readonly string[]
}

const GOOGLE_SIGNIN_HOST = 'accounts.google.com'
const ACCOUNT_PATHS = new Set([
  '/',
  '/servicelogin',
  '/accountchooser',
  '/addsession',
  '/interactivelogin',
  '/serviceloginauth',
  '/login'
])
const MAX_CONTINUE = 4096

export const GOOGLE_SIGNIN_AGENT_NOTE =
  'Note: this tab is on a Google sign-in page. Google blocks sign-in inside embedded browsers like SessionForge. Do not type credentials or try to sign in here. This is the one exception to "never ask the user to log in": ask the user to click "Sign in with Chrome" in the banner at the top of this pane, and continue once the tab has left the sign-in page.'

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function hostUrl(url: string, opts: MatchOptions): URL | null {
  const u = parse(url)
  if (!u || u.username || u.password) return null
  if (u.protocol === 'https:' && u.port === '' && u.hostname.replace(/\.$/, '') === GOOGLE_SIGNIN_HOST) return u
  return (opts.testOrigins ?? []).includes(u.origin) ? u : null
}

/** https://accounts.google.com (exact host, default port, no credentials), or a passed test origin. */
export function isSignInHostUrl(url: string, opts: MatchOptions): boolean {
  return hostUrl(url, opts) !== null
}

const pathOf = (u: URL) => {
  const p = u.pathname.toLowerCase()
  return p.length > 1 ? p.replace(/\/+$/, '') || '/' : p
}
const isOAuthPath = (p: string) => p.startsWith('/o/oauth2/') || p.startsWith('/signin/oauth') || p.startsWith('/gsi/select')
const isAccountPath = (p: string) => ACCOUNT_PATHS.has(p) || p.startsWith('/v3/signin/') || p.startsWith('/signin/')

/** A sign-in-host URL whose path is an OAuth path. */
function isOAuthUrl(url: string, opts: MatchOptions): boolean {
  const u = hostUrl(url, opts)
  return !!u && isOAuthPath(pathOf(u))
}

export function matchGoogleSignIn(url: string, chain: readonly string[], opts: MatchOptions): SignInMatch | null {
  const u = hostUrl(url, opts)
  if (!u) return null
  const p = pathOf(u)
  const oauthPath = isOAuthPath(p)
  if (!oauthPath && !isAccountPath(p)) return null

  const q = u.searchParams
  const cont = q.get('continue')
  const oauth =
    oauthPath ||
    q.get('flowName') === 'GeneralOAuthFlow' ||
    q.has('client_id') ||
    (cont !== null && isOAuthUrl(cont, opts)) ||
    chain.some((c) => isOAuthUrl(c, opts))
  const kind: SignInKind = oauth ? 'oauth' : 'google-account'

  let continueUrl: string | null = null
  if (kind === 'google-account' && cont !== null && cont.length <= MAX_CONTINUE) {
    const c = parse(cont)
    if (
      c &&
      !c.username &&
      !c.password &&
      ((c.protocol === 'https:' && isGoogleOwnedHost(c.hostname)) || (opts.testOrigins ?? []).includes(c.origin))
    ) {
      continueUrl = c.href
    }
  }

  let appOrigin: string | null = null
  if (kind === 'oauth') {
    const raw = q.get('app_domain') ?? q.get('redirect_uri')
    const safe = raw ? toLaunchableUrl(raw) : null
    appOrigin = safe ? new URL(safe).origin : null
  }

  const service = q.get('service')
  return {
    kind,
    rejected: p === '/v3/signin/rejected' || p === '/signin/rejected',
    origin: u.origin,
    continueUrl,
    appOrigin,
    service: service && /^[a-z0-9_-]{1,40}$/i.test(service) ? service : null
  }
}

/**
 * Test-only: SESSIONFORGE_TEST_GOOGLE_ORIGIN (http://127.0.0.1:<port> or http://localhost:<port>) is
 * matched like accounts.google.com, and only when SESSIONFORGE_E2E=1. Production gets [].
 */
export function resolveTestGoogleOrigins(env: NodeJS.ProcessEnv): string[] {
  const raw = env.SESSIONFORGE_TEST_GOOGLE_ORIGIN
  if (env.SESSIONFORGE_E2E !== '1' || raw === undefined || raw === '') return []
  if (/^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(raw)) return [raw]
  console.error('[signin] invalid SESSIONFORGE_TEST_GOOGLE_ORIGIN, ignored')
  return []
}
