import { test, expect } from '@playwright/test'
import { LATEST_RELEASE_API_URL, RELEASES_PAGE_URL } from '../../src/main/constants'
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_SETTING_KEYS,
  UpdateChecker,
  type UpdateFetchResponse,
  compareVersions,
  isCheckDue,
  isNewerVersion,
  parseLatestRelease,
  parseVersion,
  resolveUpdateEndpoint
} from '../../src/main/updates'
import type { UpdateState } from '../../src/main/types'

const ENDPOINT = 'http://127.0.0.1:9/releases/latest'
const HOUR = 3_600_000
type Reply = { status: number; body?: unknown; badJson?: boolean } | 'network-error'
const release = (tag: string, extra: Record<string, unknown> = {}): Reply => ({
  status: 200,
  body: { tag_name: tag, html_url: `${RELEASES_PAGE_URL}/tag/${tag}`, draft: false, prerelease: false, ...extra }
})

function harness(opts: { version?: string; endpoint?: string | null; reply?: Reply } = {}) {
  const store = new Map<string, string>()
  const calls: Array<{ url: string; init: RequestInit }> = []
  const states: UpdateState[] = []
  const clock = { now: 1_700_000_000_000 }
  let reply: Reply = opts.reply ?? release('v0.2.0')
  let gate: Promise<void> | null = null
  const checker = new UpdateChecker({
    settings: {
      getSetting: (k) => store.get(k) ?? null,
      setSetting: (k, v) => void store.set(k, v)
    },
    fetch: async (url, init): Promise<UpdateFetchResponse> => {
      calls.push({ url, init })
      if (gate) await gate
      const r = reply
      if (r === 'network-error') throw new TypeError('net::ERR_INTERNET_DISCONNECTED')
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => {
          if (r.badJson) throw new SyntaxError('Unexpected token <')
          return r.body
        }
      }
    },
    now: () => clock.now,
    version: opts.version ?? '0.1.0',
    endpoint: opts.endpoint === undefined ? ENDPOINT : opts.endpoint,
    onState: (s) => void states.push(s)
  })
  return {
    checker,
    store,
    calls,
    states,
    clock,
    setReply: (r: Reply) => void (reply = r),
    hold: () => {
      let release!: () => void
      gate = new Promise<void>((r) => (release = r))
      return () => {
        gate = null
        release()
      }
    }
  }
}

test.describe('version compare', () => {
  test('parses X.Y.Z with an optional v', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('0.10.0')).toEqual([0, 10, 0])
    for (const bad of ['1.0.0-beta', '1.0', '1.0.0.0', 'V1.0.0', ' 1.0.0', 'latest', '', null, 1, undefined]) {
      expect(parseVersion(bad), String(bad)).toBeNull()
    }
  })
  test('compares numerically, not as strings', () => {
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(true)
    expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true)
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false)
    expect(isNewerVersion('v0.1.0', '0.1.0')).toBe(false)
    expect(isNewerVersion('0.0.9', '0.1.0')).toBe(false)
    expect(compareVersions([1, 2, 3], [1, 2, 3])).toBe(0)
    expect(compareVersions([1, 2, 3], [1, 3, 0])).toBeLessThan(0)
  })
  test('an invalid side is never newer', () => {
    expect(isNewerVersion('1.0.0-beta', '0.1.0')).toBe(false)
    expect(isNewerVersion('garbage', '0.1.0')).toBe(false)
    expect(isNewerVersion('9.9.9', 'garbage')).toBe(false)
  })
})

test.describe('24 h throttle', () => {
  const now = 1_700_000_000_000
  test('isCheckDue', () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(24 * HOUR)
    expect(isCheckDue(null, now)).toBe(true)
    expect(isCheckDue(String(now - (24 * HOUR - 60_000)), now)).toBe(false)
    expect(isCheckDue(now - 24 * HOUR, now)).toBe(true)
    expect(isCheckDue(String(now + 60_000), now)).toBe(true)
    expect(isCheckDue('abc', now)).toBe(true)
  })
})

test.describe('parseLatestRelease', () => {
  test('reads tag_name and a vetted html_url', () => {
    expect(parseLatestRelease({ tag_name: 'v0.2.0', html_url: `${RELEASES_PAGE_URL}/tag/v0.2.0` })).toEqual({
      version: '0.2.0',
      url: `${RELEASES_PAGE_URL}/tag/v0.2.0`
    })
  })
  test('falls back to the releases page for any other html_url', () => {
    for (const html_url of ['https://evil.example/x', 'https://github.com/other/repo/releases', undefined, 5]) {
      expect(parseLatestRelease({ tag_name: '1.2.3', html_url })).toEqual({ version: '1.2.3', url: RELEASES_PAGE_URL })
    }
  })
  test('ignores drafts, pre-releases, odd tags and non-objects', () => {
    expect(parseLatestRelease({ tag_name: 'v0.2.0', draft: true })).toBeNull()
    expect(parseLatestRelease({ tag_name: 'v0.2.0', prerelease: true })).toBeNull()
    expect(parseLatestRelease({ tag_name: 'v0.2.0-rc.1' })).toBeNull()
    expect(parseLatestRelease({})).toBeNull()
    for (const v of [null, 'v0.2.0', 1, []]) expect(parseLatestRelease(v)).toBeNull()
  })
})

test.describe('resolveUpdateEndpoint', () => {
  test('production always uses the GitHub API and ignores the override', () => {
    expect(resolveUpdateEndpoint({})).toBe(LATEST_RELEASE_API_URL)
    expect(resolveUpdateEndpoint({ SESSIONFORGE_TEST_UPDATE_URL: 'http://127.0.0.1:1/x' })).toBe(LATEST_RELEASE_API_URL)
  })
  test('e2e without an override has no endpoint', () => {
    expect(resolveUpdateEndpoint({ SESSIONFORGE_E2E: '1' })).toBeNull()
    expect(resolveUpdateEndpoint({ SESSIONFORGE_E2E: '1', SESSIONFORGE_TEST_UPDATE_URL: '' })).toBeNull()
  })
  test('e2e accepts only a local http URL', () => {
    const e2e = (u: string) => resolveUpdateEndpoint({ SESSIONFORGE_E2E: '1', SESSIONFORGE_TEST_UPDATE_URL: u })
    expect(e2e('http://127.0.0.1:4567/releases/latest')).toBe('http://127.0.0.1:4567/releases/latest')
    expect(e2e('http://localhost:80/x')).toBe('http://localhost:80/x')
    for (const bad of ['https://evil.example/', 'http://10.0.0.1:1/', 'http://127.0.0.1/x', 'http://127.0.0.1:1/a b']) {
      expect(e2e(bad), bad).toBeNull()
    }
  })
})

test.describe('UpdateChecker', () => {
  test('checks off: no request', async () => {
    const h = harness()
    h.store.set(UPDATE_SETTING_KEYS.enabled, 'false')
    await h.checker.maybeCheck()
    expect(h.calls).toHaveLength(0)
    const result = await h.checker.checkNow()
    expect(result.outcome).toBe('disabled')
    expect(h.calls).toHaveLength(0)
  })
  test('a due check sends one cookie-less request with a SessionForge user agent and a timeout', async () => {
    const h = harness()
    await h.checker.maybeCheck()
    expect(h.calls).toHaveLength(1)
    const { url, init } = h.calls[0]
    expect(url).toBe(ENDPOINT)
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('omit')
    expect(init.cache).toBe('no-store')
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('SessionForge/0.1.0')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(h.store.get(UPDATE_SETTING_KEYS.lastCheckedAt)).toBe(String(h.clock.now))
  })
  test('inside 24 h no second request; after 24 h one more', async () => {
    const h = harness()
    await h.checker.maybeCheck()
    h.clock.now += 23 * HOUR
    await h.checker.maybeCheck()
    expect(h.calls).toHaveLength(1)
    h.clock.now += HOUR
    await h.checker.maybeCheck()
    expect(h.calls).toHaveLength(2)
  })
  test('a network error is not recorded as a check, so the next tick retries', async () => {
    const h = harness({ reply: 'network-error' })
    await h.checker.maybeCheck()
    expect(h.store.has(UPDATE_SETTING_KEYS.lastCheckedAt)).toBe(false)
    expect(h.checker.getState().notice).toBeNull()
    expect((await h.checker.checkNow()).outcome).toBe('failed')
    await h.checker.maybeCheck()
    expect(h.calls).toHaveLength(3)
  })
  test('an HTTP error (403 rate limit) counts as an answer and waits a day', async () => {
    const h = harness({ reply: { status: 403 } })
    expect((await h.checker.checkNow()).outcome).toBe('failed')
    expect(h.store.get(UPDATE_SETTING_KEYS.lastCheckedAt)).toBe(String(h.clock.now))
    await h.checker.maybeCheck()
    expect(h.calls).toHaveLength(1)
  })
  test('a body that is not JSON or not a release fails without a notice', async () => {
    const h = harness({ reply: { status: 200, badJson: true } })
    expect((await h.checker.checkNow()).outcome).toBe('failed')
    h.setReply({ status: 200, body: { message: 'Not Found' } })
    expect((await h.checker.checkNow()).outcome).toBe('failed')
    expect(h.checker.getState().notice).toBeNull()
    expect(h.store.has(UPDATE_SETTING_KEYS.latest)).toBe(false)
  })
  test('newer gives a notice; Later hides that version only', async () => {
    const h = harness()
    const result = await h.checker.checkNow()
    expect(result.outcome).toBe('available')
    expect(result.version).toBe('0.2.0')
    expect(h.checker.getState().notice).toEqual({ version: '0.2.0', url: `${RELEASES_PAGE_URL}/tag/v0.2.0` })
    expect(h.checker.releaseUrl()).toBe(`${RELEASES_PAGE_URL}/tag/v0.2.0`)
    const dismissed = h.checker.dismiss()
    expect(h.store.get(UPDATE_SETTING_KEYS.dismissedVersion)).toBe('0.2.0')
    expect(dismissed.notice).toBeNull()
    expect(dismissed.available?.version).toBe('0.2.0')
    expect(h.states.at(-1)?.notice).toBeNull()
    h.setReply(release('v0.3.0'))
    await h.checker.checkNow()
    expect(h.checker.getState().notice?.version).toBe('0.3.0')
  })
  test('same or older version: up to date, no notice', async () => {
    const h = harness({ reply: release('v0.1.0') })
    expect((await h.checker.checkNow()).outcome).toBe('up-to-date')
    h.setReply(release('v0.0.9'))
    expect((await h.checker.checkNow()).outcome).toBe('up-to-date')
    expect(h.checker.getState().notice).toBeNull()
    expect(h.checker.getState().latestVersion).toBe('0.0.9')
  })
  test('turning checks off hides the notice; turning them on checks when due', async () => {
    const h = harness()
    await h.checker.maybeCheck()
    expect(h.checker.getState().notice).not.toBeNull()
    const off = h.checker.setEnabled(false)
    expect(off.available).toBeNull()
    expect(off.notice).toBeNull()
    expect(h.store.get(UPDATE_SETTING_KEYS.enabled)).toBe('false')
    h.clock.now += 25 * HOUR
    h.checker.setEnabled(true)
    await expect.poll(() => h.calls.length).toBe(2)
  })
  test('no endpoint: never fetches, Check now fails', async () => {
    const h = harness({ endpoint: null })
    await h.checker.maybeCheck()
    expect((await h.checker.checkNow()).outcome).toBe('failed')
    expect(h.calls).toHaveLength(0)
  })
  test('concurrent checks share one request', async () => {
    const h = harness()
    const open = h.hold()
    const a = h.checker.checkNow()
    const b = h.checker.checkNow()
    const c = h.checker.maybeCheck()
    await expect.poll(() => h.calls.length).toBe(1)
    expect(h.checker.getState().checking).toBe(true)
    open()
    const [ra, rb] = await Promise.all([a, b, c])
    expect(ra.outcome).toBe('available')
    expect(rb.outcome).toBe('available')
    expect(h.calls).toHaveLength(1)
    expect(h.checker.getState().checking).toBe(false)
  })
  test('a cached release URL that is not a release page is never returned', () => {
    const h = harness()
    h.store.set(UPDATE_SETTING_KEYS.latest, JSON.stringify({ version: '0.2.0', url: 'https://evil.example' }))
    expect(h.checker.releaseUrl()).toBe(RELEASES_PAGE_URL)
    h.store.set(UPDATE_SETTING_KEYS.latest, 'not json')
    expect(h.checker.releaseUrl()).toBe(RELEASES_PAGE_URL)
    expect(h.checker.getState().latestVersion).toBeNull()
  })
})
