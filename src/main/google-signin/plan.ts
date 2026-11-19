// What "Sign in with Chrome" opens, where the login goes back to and which cookies it may carry. Pure.
import type { ImportStatusInput, SignInKind } from './types'
import type { SignInMatch } from './match'
import { isSignInHostUrl } from './match'
import { MAX_LAUNCH_URL, registrableDomain, toLaunchableUrl } from './domains'
import { DEFAULT_IMPORT_PORT } from '../import-payload'

export interface PlanContext {
  tabId: string
  match: SignInMatch
  /** Last committed http(s) URL of this tab that was not on a sign-in host */
  lastSiteUrl: string | null
  /** Popup tabs: the opener tab's current URL and its lastSiteUrl */
  opener: { tabId: string; url: string; lastSiteUrl: string | null } | null
  testOrigins: readonly string[]
}
export type HandOffPlan =
  | {
      ok: true
      kind: SignInKind
      chromeUrl: string
      returnUrl: string
      returnTabId: string
      targetHost: string
      cookieDomains: string[]
    }
  | { ok: false; reason: 'no_site' }

export const DEFAULT_CONTINUE = 'https://myaccount.google.com/'

function planGoogleAccount(ctx: PlanContext): HandOffPlan {
  const { match } = ctx
  const build = (cont: string, followup: boolean) => {
    const url = new URL('/ServiceLogin', match.origin)
    if (match.service) url.searchParams.set('service', match.service)
    url.searchParams.set('continue', cont)
    if (followup) url.searchParams.set('followup', cont)
    return url.href
  }
  let cont = match.continueUrl ?? DEFAULT_CONTINUE
  let chromeUrl = build(cont, true)
  if (chromeUrl.length > MAX_LAUNCH_URL) chromeUrl = build(cont, false)
  if (chromeUrl.length > MAX_LAUNCH_URL) {
    cont = DEFAULT_CONTINUE
    chromeUrl = build(cont, true)
  }
  const domains = ['google.com', registrableDomain(new URL(cont).hostname)]
  return {
    ok: true,
    kind: 'google-account',
    chromeUrl,
    returnUrl: cont,
    returnTabId: ctx.tabId,
    targetHost: new URL(match.origin).host,
    cookieDomains: [...new Set(domains)]
  }
}

function planOAuth(ctx: PlanContext): HandOffPlan {
  const app = ctx.match.appOrigin ? ctx.match.appOrigin + '/' : null
  const candidates: Array<[string | null, string]> = ctx.opener
    ? [
        [ctx.opener.url, ctx.opener.tabId],
        [ctx.opener.lastSiteUrl, ctx.opener.tabId],
        [ctx.lastSiteUrl, ctx.tabId],
        [app, ctx.tabId]
      ]
    : [
        [ctx.lastSiteUrl, ctx.tabId],
        [app, ctx.tabId]
      ]
  for (const [candidate, returnTabId] of candidates) {
    if (!candidate) continue
    const site = toLaunchableUrl(candidate)
    if (!site || isSignInHostUrl(site, { testOrigins: ctx.testOrigins })) continue
    const url = new URL(site)
    // The extension only accepts hostname scopes, so a site on an IPv6 literal cannot be handed off
    if (url.hostname.startsWith('[')) continue
    return {
      ok: true,
      kind: 'oauth',
      chromeUrl: site,
      returnUrl: site,
      returnTabId,
      targetHost: url.host,
      cookieDomains: [registrableDomain(url.hostname)]
    }
  }
  return { ok: false, reason: 'no_site' }
}

export function planHandOff(ctx: PlanContext): HandOffPlan {
  return ctx.match.kind === 'oauth' ? planOAuth(ctx) : planGoogleAccount(ctx)
}

const sameOrigin = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

/**
 * The tab a completed hand-off navigates: the return tab, else the banner tab, if it still belongs to
 * the session and is on a sign-in page or the return URL's origin. null → main opens a new tab.
 */
export function chooseCompletionTab(
  req: { tabId: string; returnTabId: string; sessionId: string; returnUrl: string },
  tabs: ReadonlyMap<string, { sessionId: string; url: string; onSignInPage: boolean }>
): string | null {
  for (const id of new Set([req.returnTabId, req.tabId])) {
    const t = tabs.get(id)
    if (t && t.sessionId === req.sessionId && (t.onSignInPage || sameOrigin(t.url, req.returnUrl))) return id
  }
  return null
}

/** Why a hand-off cannot start (the extension could not reach this SessionForge), or null. */
export function handOffBlocker(status: ImportStatusInput, e2e: boolean): string | null {
  if (!status.listening && status.error && /EADDRINUSE|in use/i.test(status.error)) {
    return `The import server isn't running (port ${status.port} is in use), so the extension can't send the login back. Close the other program and restart SessionForge.`
  }
  if (!status.listening) {
    return "The import server isn't running, so the extension can't send the login back. Restart SessionForge."
  }
  if (status.port !== DEFAULT_IMPORT_PORT && !e2e) {
    return `Sign in with Chrome needs the import server on port ${DEFAULT_IMPORT_PORT}; this SessionForge uses ${status.port} (SESSIONFORGE_IMPORT_PORT).`
  }
  return null
}
