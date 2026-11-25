// Update check: version compare, 24 h throttle and the GitHub request. Pure (no Electron import)
// so the unit project can drive it; index.ts injects net.fetch, the settings store and the clock.
import type { DatabaseManager } from './database'
import type { AvailableUpdate, UpdateCheckResult, UpdateState } from './types'
import { LATEST_RELEASE_API_URL, RELEASES_PAGE_URL } from './constants'
import { isReleasePageUrl } from './external-url'

/** app_settings keys */
export const UPDATE_SETTING_KEYS = {
  /** 'false' turns checks off; absent or anything else is on */
  enabled: 'updates.enabled',
  /** Epoch ms of the last time GitHub answered */
  lastCheckedAt: 'updates.lastCheckedAt',
  /** JSON { version, url } of the newest release GitHub reported */
  latest: 'updates.latest',
  /** Version hidden with "Later" */
  dismissedVersion: 'updates.dismissedVersion'
} as const

export const UPDATE_CHECK_INTERVAL_MS = 86_400_000
/** How often the running app asks "is a check due?"; only due checks hit the network */
export const UPDATE_TICK_MS = 3_600_000
export const UPDATE_FETCH_TIMEOUT_MS = 10_000

type Version = [number, number, number]

/** Strict X.Y.Z with an optional leading 'v'; pre-release and build suffixes are not versions here. */
export function parseVersion(value: unknown): Version | null {
  if (typeof value !== 'string') return null
  const match = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/.exec(value)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Negative, zero or positive like a sort comparator; both sides must be valid versions. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/** True only when both parse and latest is strictly newer than current. */
export function isNewerVersion(latest: unknown, current: unknown): boolean {
  const l = parseVersion(latest)
  const c = parseVersion(current)
  return l !== null && c !== null && compareVersions(l, c) > 0
}

/** "X.Y.Z" without the 'v', or null */
export function normalizeVersion(value: unknown): string | null {
  const v = parseVersion(value)
  return v ? v.join('.') : null
}

/** A check is due when none is recorded, the value is unreadable or in the future, or 24 h have passed. */
export function isCheckDue(lastCheckedAt: string | number | null, now: number): boolean {
  if (lastCheckedAt === null) return true
  const last = typeof lastCheckedAt === 'number' ? lastCheckedAt : Number(lastCheckedAt)
  if (!Number.isFinite(last) || last > now) return true
  return now - last >= UPDATE_CHECK_INTERVAL_MS
}

/** GitHub's releases/latest body → { version, url }; drafts, pre-releases and odd tags are ignored. */
export function parseLatestRelease(json: unknown): AvailableUpdate | null {
  if (typeof json !== 'object' || json === null) return null
  const body = json as Record<string, unknown>
  if (body.draft === true || body.prerelease === true) return null
  const version = normalizeVersion(body.tag_name)
  if (!version) return null
  const url = isReleasePageUrl(body.html_url) ? body.html_url : RELEASES_PAGE_URL
  return { version, url }
}

/**
 * The GitHub API in production (any override is ignored). Under SESSIONFORGE_E2E=1 only a local
 * SESSIONFORGE_TEST_UPDATE_URL is used; without one there is no endpoint, so e2e makes no requests.
 */
export function resolveUpdateEndpoint(env: NodeJS.ProcessEnv): string | null {
  if (env.SESSIONFORGE_E2E !== '1') return LATEST_RELEASE_API_URL
  const raw = env.SESSIONFORGE_TEST_UPDATE_URL
  if (raw === undefined || raw === '') return null
  if (/^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}\/[\x21-\x7e]*$/.test(raw)) return raw
  console.error('[update] invalid SESSIONFORGE_TEST_UPDATE_URL, ignored')
  return null
}

/** The part of a fetch Response the checker reads */
export interface UpdateFetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export interface UpdateCheckerDeps {
  settings: Pick<DatabaseManager, 'getSetting' | 'setSetting'>
  fetch: (url: string, init: RequestInit) => Promise<UpdateFetchResponse>
  now: () => number
  /** app.getVersion() */
  version: string
  /** resolveUpdateEndpoint(); null means never send a request */
  endpoint: string | null
  /** Called after every state change (the window gets 'update:state') */
  onState: (state: UpdateState) => void
}

type Outcome = 'up-to-date' | 'available' | 'failed'

export class UpdateChecker {
  private inflight: Promise<Outcome> | null = null
  private startTimer: ReturnType<typeof setTimeout> | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null

  constructor(private deps: UpdateCheckerDeps) {}

  /** First check after delayMs (startup is never blocked), then an hourly "is it due?" tick. */
  start(delayMs: number): void {
    this.stop()
    this.startTimer = setTimeout(() => {
      this.startTimer = null
      void this.maybeCheck()
      this.tickTimer = setInterval(() => void this.maybeCheck(), UPDATE_TICK_MS)
    }, delayMs)
  }

  stop(): void {
    if (this.startTimer) clearTimeout(this.startTimer)
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.startTimer = null
    this.tickTimer = null
  }

  getState(): UpdateState {
    const { settings, version, endpoint } = this.deps
    const enabled = settings.getSetting(UPDATE_SETTING_KEYS.enabled) !== 'false'
    const latest = this.cachedLatest()
    const dismissedVersion = settings.getSetting(UPDATE_SETTING_KEYS.dismissedVersion)
    const rawLast = settings.getSetting(UPDATE_SETTING_KEYS.lastCheckedAt)
    const last = rawLast === null ? NaN : Number(rawLast)
    const available =
      enabled && endpoint !== null && latest !== null && isNewerVersion(latest.version, version) ? latest : null
    return {
      enabled,
      currentVersion: version,
      latestVersion: latest?.version ?? null,
      available,
      notice: available && available.version !== dismissedVersion ? available : null,
      dismissedVersion,
      lastCheckedAt: Number.isFinite(last) ? last : null,
      checking: this.inflight !== null
    }
  }

  setEnabled(enabled: boolean): UpdateState {
    this.deps.settings.setSetting(UPDATE_SETTING_KEYS.enabled, enabled ? 'true' : 'false')
    this.emit()
    if (enabled) void this.maybeCheck()
    return this.getState()
  }

  /** Automatic check: only when on, an endpoint exists and 24 h have passed. Never throws. */
  async maybeCheck(): Promise<void> {
    try {
      if (this.deps.endpoint === null) return
      const state = this.getState()
      if (!state.enabled) return
      if (!isCheckDue(this.deps.settings.getSetting(UPDATE_SETTING_KEYS.lastCheckedAt), this.deps.now())) return
      await this.run()
    } catch (err) {
      console.warn('[update] check failed:', err instanceof Error ? err.message : err)
    }
  }

  /** Settings → "Check now": ignores the throttle, reports the outcome. */
  async checkNow(): Promise<UpdateCheckResult> {
    if (!this.getState().enabled) return { outcome: 'disabled', state: this.getState() }
    let outcome: Outcome
    try {
      outcome = await this.run()
    } catch (err) {
      console.warn('[update] check failed:', err instanceof Error ? err.message : err)
      outcome = 'failed'
    }
    const state = this.getState()
    if (outcome === 'available' && state.available) return { outcome, version: state.available.version, state }
    return { outcome: outcome === 'available' ? 'up-to-date' : outcome, state }
  }

  /** "Later": hide the version currently on offer; a newer one shows again. */
  dismiss(): UpdateState {
    const { available } = this.getState()
    if (available) {
      this.deps.settings.setSetting(UPDATE_SETTING_KEYS.dismissedVersion, available.version)
      this.emit()
    }
    return this.getState()
  }

  /** The cached release page, or the releases list; always a vetted release URL. */
  releaseUrl(): string {
    const url = this.cachedLatest()?.url
    return isReleasePageUrl(url) ? url : RELEASES_PAGE_URL
  }

  private cachedLatest(): AvailableUpdate | null {
    const raw = this.deps.settings.getSetting(UPDATE_SETTING_KEYS.latest)
    if (raw === null) return null
    try {
      const parsed = JSON.parse(raw) as { version?: unknown; url?: unknown }
      const version = normalizeVersion(parsed.version)
      if (!version) return null
      return { version, url: isReleasePageUrl(parsed.url) ? parsed.url : RELEASES_PAGE_URL }
    } catch {
      return null
    }
  }

  private emit(): void {
    try {
      this.deps.onState(this.getState())
    } catch (err) {
      console.warn('[update] state listener failed:', err instanceof Error ? err.message : err)
    }
  }

  /** One request at a time; concurrent callers share it. */
  private run(): Promise<Outcome> {
    if (this.inflight) return this.inflight
    this.inflight = this.request().finally(() => {
      this.inflight = null
      this.emit()
    })
    this.emit()
    return this.inflight
  }

  private async request(): Promise<Outcome> {
    const { endpoint, settings, version } = this.deps
    if (endpoint === null) {
      console.warn('[update] no update endpoint; check skipped')
      return 'failed'
    }
    let res: UpdateFetchResponse
    try {
      res = await this.deps.fetch(endpoint, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': `SessionForge/${version}`
        },
        signal: AbortSignal.timeout(UPDATE_FETCH_TIMEOUT_MS)
      })
    } catch (err) {
      // Offline or timed out: lastCheckedAt stays, so the next launch or hourly tick retries
      console.warn('[update] could not reach GitHub:', err instanceof Error ? err.message : err)
      return 'failed'
    }
    // GitHub answered (even 403/404): wait a day before asking again
    settings.setSetting(UPDATE_SETTING_KEYS.lastCheckedAt, String(this.deps.now()))
    if (!res.ok) {
      console.warn(`[update] GitHub answered HTTP ${res.status}`)
      return 'failed'
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      console.warn('[update] GitHub answered with a body that is not JSON')
      return 'failed'
    }
    const latest = parseLatestRelease(body)
    if (!latest) {
      console.warn('[update] GitHub answered without a usable release')
      return 'failed'
    }
    settings.setSetting(UPDATE_SETTING_KEYS.latest, JSON.stringify(latest))
    return isNewerVersion(latest.version, version) ? 'available' : 'up-to-date'
  }
}
