import { EXTERNAL_URL_ALLOWLIST } from './constants'

const RELEASES_PATH = '/Hamzasohail123/sessionforge/releases'

/**
 * SessionForge's GitHub releases page or a path under it (a tag page, /latest).
 * The string must already be in canonical form, so case, encoding and `..` variants are refused.
 */
export function isReleasePageUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.href === url &&
    parsed.protocol === 'https:' &&
    parsed.hostname === 'github.com' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.port === '' &&
    parsed.search === '' &&
    parsed.hash === '' &&
    (parsed.pathname === RELEASES_PATH || parsed.pathname.startsWith(RELEASES_PATH + '/'))
  )
}

/** Exact string match against the allowlist (no normalisation, so any variant of an entry is refused), or a release page. */
export function isAllowedExternalUrl(url: unknown): url is string {
  return (typeof url === 'string' && EXTERNAL_URL_ALLOWLIST.includes(url)) || isReleasePageUrl(url)
}
