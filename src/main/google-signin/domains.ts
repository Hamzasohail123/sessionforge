// Cookie-scope and launch-URL helpers for the Google sign-in hand-off. Pure.
import { isLoopbackHost } from '../agent/url-guard'

export const MAX_LAUNCH_URL = 8192

/** Hosting suffixes where every tenant is a different site; treated as public suffixes. */
const MULTI_TENANT = [
  'github.io',
  'vercel.app',
  'netlify.app',
  'herokuapp.com',
  'web.app',
  'firebaseapp.com',
  'pages.dev',
  'workers.dev',
  'appspot.com',
  'azurewebsites.net',
  'cloudfront.net',
  'onrender.com',
  'fly.dev',
  'ngrok.io',
  'ngrok-free.app',
  'glitch.me',
  'blogspot.com'
]

/**
 * Registrable-ish domain without the Public Suffix List (a simpler heuristic than the extension's
 * baseDomain in chrome-extension/access.js, which keys second-level suffixes by country code),
 * plus multi-tenant hosting suffixes. A miss errs narrow, which collects fewer cookies, never more.
 */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (h.includes(':') || h.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h
  if (h === 'localhost' || h.endsWith('.localhost')) return h
  for (const suffix of MULTI_TENANT) {
    if (h.endsWith('.' + suffix)) {
      const label = h.slice(0, -(suffix.length + 1)).split('.').pop()
      return `${label}.${suffix}`
    }
  }
  const labels = h.split('.')
  if (labels.length <= 2) return h
  const last = labels[labels.length - 1]
  const second = labels[labels.length - 2]
  const take = second.length <= 3 && last.length === 2 ? 3 : 2
  return labels.slice(-take).join('.')
}

/** google.com, youtube.com, blogger.com and Google's country domains (google.de, google.co.uk, google.com.au). */
export function isGoogleOwnedHost(host: string): boolean {
  const d = registrableDomain(host)
  return d === 'google.com' || d === 'youtube.com' || d === 'blogger.com' || /^google\.(com?\.)?[a-z]{2}$/.test(d)
}

/** The cookie's domain is one of the scopes or a subdomain of one. */
export function inCookieScope(cookieDomain: string, scopes: readonly string[]): boolean {
  const d = cookieDomain.toLowerCase().replace(/^\./, '')
  return scopes.some((s) => d === s || d.endsWith('.' + s))
}

/**
 * The only URLs SessionForge hands to the OS: https on any host, http only on a loopback host,
 * no credentials, at most MAX_LAUNCH_URL characters. Returns the normalised href or null.
 */
export function toLaunchableUrl(u: string): string | null {
  if (typeof u !== 'string' || u.length > MAX_LAUNCH_URL) return null
  let url: URL
  try {
    url = new URL(u)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  const ok = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname))
  if (!ok || url.href.length > MAX_LAUNCH_URL) return null
  return url.href
}
