// Finds the user's Chrome-family browser and opens one URL in it, with the default browser as the
// fallback. Pure: every OS access goes through LaunchDeps, so the whole chain is unit-tested.
import type { EventEmitter } from 'events'
import { posix, win32 } from 'path'
import { toLaunchableUrl } from './domains'

export type BrowserName = 'Google Chrome' | 'Chromium' | 'Microsoft Edge' | 'Brave'
export interface LaunchPlan {
  browser: BrowserName
  command: string
  args: string[]
}
export interface Probe {
  exists(path: string): boolean
  isExecutable(path: string): boolean
}
export interface LaunchResult {
  browser: string
  via: 'spawn' | 'default-browser' | 'test-log'
}

/** The part of ChildProcess launchWith uses; tests pass an EventEmitter with unref() */
export type ChildLike = Pick<EventEmitter, 'on' | 'once'> & { unref(): void }
export type SpawnFn = (
  command: string,
  args: string[],
  options: { detached: true; stdio: 'ignore'; env: NodeJS.ProcessEnv; shell: false }
) => ChildLike
export interface LaunchDeps {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  probe: Probe
  spawn: SpawnFn
  openExternal: (url: string) => Promise<void>
  /** Wait for 'spawn' or 'error' (default 5000) */
  timeoutMs?: number
  /** After 'spawn', wait this long for an early 'exit' (default 3000) */
  exitWaitMs?: number
}

const LINUX: Array<[string, BrowserName]> = [
  ['google-chrome', 'Google Chrome'],
  ['google-chrome-stable', 'Google Chrome'],
  ['chromium', 'Chromium'],
  ['chromium-browser', 'Chromium'],
  ['microsoft-edge', 'Microsoft Edge'],
  ['microsoft-edge-stable', 'Microsoft Edge'],
  ['brave-browser', 'Brave'],
  ['brave', 'Brave']
]
const MAC: Array<[string, BrowserName]> = [
  ['Google Chrome.app', 'Google Chrome'],
  ['Chromium.app', 'Chromium'],
  ['Microsoft Edge.app', 'Microsoft Edge'],
  ['Brave Browser.app', 'Brave']
]
const WINDOWS: Array<[string, BrowserName]> = [
  ['Google\\Chrome\\Application\\chrome.exe', 'Google Chrome'],
  ['Chromium\\Application\\chrome.exe', 'Chromium'],
  ['Microsoft\\Edge\\Application\\msedge.exe', 'Microsoft Edge'],
  ['BraveSoftware\\Brave-Browser\\Application\\brave.exe', 'Brave']
]

/** Windows env keys are case-insensitive. */
function envGet(env: Record<string, string | undefined>, key: string): string | undefined {
  const k = Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase())
  return k ? env[k] : undefined
}

export function findBrowser(
  url: string,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  probe: Probe
): LaunchPlan | null {
  if (platform === 'linux') {
    const dirs = (env.PATH ?? '').split(':').filter((d) => posix.isAbsolute(d))
    for (const [name, browser] of LINUX) {
      for (const dir of dirs) {
        const full = posix.join(dir, name)
        if (probe.isExecutable(full)) return { browser, command: full, args: [url] }
      }
    }
    return null
  }
  if (platform === 'darwin') {
    const home = env.HOME
    for (const [bundle, browser] of MAC) {
      const paths = [posix.join('/Applications', bundle), ...(home ? [posix.join(home, 'Applications', bundle)] : [])]
      for (const p of paths) {
        if (probe.exists(p)) return { browser, command: '/usr/bin/open', args: ['-a', p, url] }
      }
    }
    return null
  }
  if (platform === 'win32') {
    const bases = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']
      .map((k) => envGet(env, k))
      .filter((b): b is string => !!b)
    for (const [rel, browser] of WINDOWS) {
      for (const base of bases) {
        const full = win32.join(base, rel)
        if (probe.exists(full)) return { browser, command: full, args: [url] }
      }
    }
    return null
  }
  return null
}

/** The environment for the browser: no ELECTRON_* keys, and no AppImage library path. */
export function browserEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) {
    if (/^ELECTRON_/i.test(k)) continue
    if (env.APPIMAGE && k === 'LD_LIBRARY_PATH') continue
    out[k] = v
  }
  return out
}

type Outcome = { ok: true } | { ok: false; reason: string }

function waitForStart(child: ChildLike, timeoutMs: number, exitWaitMs: number): Promise<Outcome> {
  return new Promise((resolve) => {
    let done = false
    let timer: NodeJS.Timeout | undefined
    const finish = (o: Outcome) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve(o)
    }
    timer = setTimeout(() => finish({ ok: true }), timeoutMs)
    child.once('error', (e: NodeJS.ErrnoException) => finish({ ok: false, reason: e?.code ?? e?.message ?? 'error' }))
    child.once('spawn', () => {
      if (done) return
      if (timer) clearTimeout(timer)
      // A running Chrome takes the URL and exits 0; a fresh Chrome keeps running
      timer = setTimeout(() => finish({ ok: true }), exitWaitMs)
      child.once('exit', (code: number | null, signal: string | null) => {
        if (code === 0) finish({ ok: true })
        else finish({ ok: false, reason: `exit ${code ?? signal}` })
      })
    })
  })
}

export async function launchWith(url: string, deps: LaunchDeps): Promise<LaunchResult> {
  const safe = toLaunchableUrl(url)
  if (!safe) throw new Error('Refusing to open this URL')
  const plan = findBrowser(safe, deps.platform, deps.env, deps.probe)
  if (!plan) {
    console.warn('[signin] no Chrome-family browser found')
  } else {
    let child: ChildLike | null = null
    let outcome: Outcome
    try {
      child = deps.spawn(plan.command, plan.args, {
        detached: true,
        stdio: 'ignore',
        env: browserEnv(deps.env),
        shell: false
      })
      // A late 'error' must never crash main
      child.on('error', () => undefined)
      outcome = await waitForStart(child, deps.timeoutMs ?? 5000, deps.exitWaitMs ?? 3000)
    } catch (e) {
      outcome = { ok: false, reason: (e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message ?? 'error' }
    }
    child?.unref()
    if (outcome.ok) {
      console.log('[signin] opened in', plan.browser)
      return { browser: plan.browser, via: 'spawn' }
    }
    console.warn('[signin] could not start', plan.browser, outcome.reason)
  }
  try {
    await deps.openExternal(safe)
  } catch (e) {
    console.warn('[signin] openExternal failed', (e as Error)?.message ?? e)
    throw new Error('Could not open a browser')
  }
  return { browser: 'your default browser', via: 'default-browser' }
}
