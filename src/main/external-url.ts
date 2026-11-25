import { EXTERNAL_URL_ALLOWLIST } from './constants'

/** Exact string match against the allowlist: no normalisation, so any variant of an entry is refused. */
export function isAllowedExternalUrl(url: unknown): url is string {
  return typeof url === 'string' && EXTERNAL_URL_ALLOWLIST.includes(url)
}
