import { test, expect } from '@playwright/test'
import { EventEmitter } from 'node:events'
import { launchWith, type ChildLike, type LaunchDeps } from '../../src/main/google-signin/browsers'

const URL_ = 'https://accounts.google.com/ServiceLogin?service=mail&continue=https%3A%2F%2Fmail.google.com%2F'

class FakeChild extends EventEmitter {
  unrefs = 0
  unref(): void {
    this.unrefs++
  }
}

interface Rig {
  deps: LaunchDeps
  spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }>
  opened: string[]
  child: FakeChild
}

/** script runs right after spawn returns (emit 'spawn', 'error', 'exit' …). */
function rig(
  opts: {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    executables?: string[]
    existing?: string[]
    script?: (c: FakeChild) => void
    spawnThrows?: boolean
    openRejects?: boolean
  } = {}
): Rig {
  const child = new FakeChild()
  const spawned: Rig['spawned'] = []
  const opened: string[] = []
  const executables = opts.executables ?? ['/usr/bin/google-chrome']
  const deps: LaunchDeps = {
    platform: opts.platform ?? 'linux',
    env: opts.env ?? { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', HOME: '/h' },
    probe: { isExecutable: (p) => executables.includes(p), exists: (p) => (opts.existing ?? executables).includes(p) },
    spawn: (command, args, options) => {
      spawned.push({ command, args, options: options as unknown as Record<string, unknown> })
      if (opts.spawnThrows) throw Object.assign(new Error('spawn EACCES'), { code: 'EACCES' })
      setImmediate(() => opts.script?.(child))
      return child as ChildLike
    },
    openExternal: async (u) => {
      opened.push(u)
      if (opts.openRejects) throw new Error('no handler')
    },
    timeoutMs: 30,
    exitWaitMs: 30
  }
  return { deps, spawned, opened, child }
}

/** launchWith logs on every branch; keep the test output clean */
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { log, warn } = console
  console.log = () => undefined
  console.warn = () => undefined
  try {
    return await fn()
  } finally {
    console.log = log
    console.warn = warn
  }
}

test('success on Linux: argv spawn, detached, shell false, clean env; no openExternal', async () => {
  const r = rig({ script: (c) => c.emit('spawn') })
  expect(await quiet(() => launchWith(URL_, r.deps))).toEqual({ browser: 'Google Chrome', via: 'spawn' })
  expect(r.spawned).toHaveLength(1)
  const s = r.spawned[0]
  expect(s.command).toBe('/usr/bin/google-chrome')
  expect(s.args).toEqual([URL_])
  expect(s.options).toMatchObject({ detached: true, stdio: 'ignore', shell: false })
  const env = s.options.env as Record<string, string>
  expect(Object.keys(env).some((k) => /^ELECTRON_/i.test(k))).toBe(false)
  expect(env.PATH).toBe('/usr/bin')
  expect(r.child.unrefs).toBe(1)
  expect(r.opened).toEqual([])
})

test('success on macOS: open -a <bundle> <url>', async () => {
  const r = rig({ platform: 'darwin', env: { HOME: '/Users/me' }, executables: [], existing: ['/Applications/Google Chrome.app'], script: (c) => c.emit('spawn') })
  expect(await quiet(() => launchWith(URL_, r.deps))).toEqual({ browser: 'Google Chrome', via: 'spawn' })
  expect(r.spawned[0].command).toBe('/usr/bin/open')
  expect(r.spawned[0].args).toEqual(['-a', '/Applications/Google Chrome.app', URL_])
})

test("'spawn' then exit 0 (handed to a running Chrome) counts as started", async () => {
  const r = rig({
    script: (c) => {
      c.emit('spawn')
      c.emit('exit', 0, null)
    }
  })
  expect(await quiet(() => launchWith(URL_, r.deps))).toEqual({ browser: 'Google Chrome', via: 'spawn' })
  expect(r.opened).toEqual([])
})

test("'spawn' then a non-zero exit or a signal falls back to the default browser", async () => {
  for (const [code, signal] of [
    [1, null],
    [null, 'SIGKILL']
  ] as const) {
    const r = rig({
      script: (c) => {
        c.emit('spawn')
        c.emit('exit', code, signal)
      }
    })
    expect(await quiet(() => launchWith(URL_, r.deps))).toEqual({ browser: 'your default browser', via: 'default-browser' })
    expect(r.opened).toEqual([URL_])
  }
})

test("'error' (ENOENT) or a synchronous spawn throw falls back to the default browser once", async () => {
  const r1 = rig({ script: (c) => c.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })) })
  expect(await quiet(() => launchWith(URL_, r1.deps))).toEqual({ browser: 'your default browser', via: 'default-browser' })
  expect(r1.opened).toEqual([URL_])

  const r2 = rig({ spawnThrows: true })
  expect(await quiet(() => launchWith(URL_, r2.deps))).toEqual({ browser: 'your default browser', via: 'default-browser' })
  expect(r2.opened).toEqual([URL_])
})

test('no browser found: openExternal, no spawn', async () => {
  const r = rig({ env: { PATH: '' } })
  expect(await quiet(() => launchWith(URL_, r.deps))).toEqual({ browser: 'your default browser', via: 'default-browser' })
  expect(r.spawned).toEqual([])
  expect(r.opened).toEqual([URL_])
})

test('openExternal rejects → "Could not open a browser"', async () => {
  const r = rig({ env: { PATH: '' }, openRejects: true })
  await expect(quiet(() => launchWith(URL_, r.deps))).rejects.toThrow('Could not open a browser')
})

test('invalid URLs are refused before either fake is called', async () => {
  for (const bad of ['file:///etc/passwd', 'http://192.168.1.1/', 'javascript:alert(1)', 'https://u:p@example.com/']) {
    const r = rig({ script: (c) => c.emit('spawn') })
    await expect(quiet(() => launchWith(bad, r.deps)), bad).rejects.toThrow('Refusing to open this URL')
    expect(r.spawned).toEqual([])
    expect(r.opened).toEqual([])
  }
})

test('no event at all counts as started after timeoutMs', async () => {
  const r = rig()
  const started = Date.now()
  expect(await quiet(() => launchWith(URL_, r.deps))).toEqual({ browser: 'Google Chrome', via: 'spawn' })
  expect(Date.now() - started).toBeGreaterThanOrEqual(25)
  expect(r.opened).toEqual([])
})

test("a late 'error' after success does not throw", async () => {
  const r = rig({ script: (c) => c.emit('spawn') })
  await quiet(() => launchWith(URL_, r.deps))
  expect(() => r.child.emit('error', new Error('late'))).not.toThrow()
})
