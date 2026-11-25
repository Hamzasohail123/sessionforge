import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { WindowManager } from '../../src/main/window-manager'
import type { SessionManager } from '../../src/main/session-manager'
import type { DatabaseManager } from '../../src/main/database'
import type { StorageStateSchema } from '../../src/main/import-payload'
import type { AgentBridge } from '../../src/main/agent/mcp-server'
import type { UpdateChecker } from '../../src/main/updates'

export const projectRoot = resolve(__dirname, '..', '..')

/** Shape of globalThis.__sessionforge in main (set only when SESSIONFORGE_E2E=1). */
export interface SfGlobal {
  windowManager: WindowManager
  sessionManager: SessionManager
  db: DatabaseManager
  StorageStateSchema: typeof StorageStateSchema
  window: BrowserWindow
  agentBridge: AgentBridge
  updates: UpdateChecker
}

export interface AppCtx {
  app: ElectronApplication
  page: Page
  userDataDir: string
  importPort: number
  /** SESSIONFORGE_MCP_PORT of this launch (always a free port, never the real 34568) */
  mcpPort: number
  /** SESSIONFORGE_EDITOR_CONFIG_HOME of this launch: a temp dir, so ~/.cursor, ~/.claude and ~/.codex are never touched */
  editorHome: string
  logs: string[]
  /** Electron process, kept so exit state can be read after app.close() */
  proc: ReturnType<ElectronApplication['process']>
}

export async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo
      srv.close(() => resolvePort(port))
    })
  })
}

export interface LaunchOptions {
  userDataDir?: string
  importPort?: number
  mcpPort?: number
  /** Temp editor config home (default: a fresh mkdtemp dir) */
  editorHome?: string
  /** Electron switches added before '.' (e.g. --password-store=basic) */
  extraArgs?: string[]
  env?: Record<string, string>
}

export async function launchApp(opts: LaunchOptions = {}): Promise<AppCtx> {
  const userDataDir = opts.userDataDir ?? (await mkdtemp(join(tmpdir(), 'sessionforge-e2e-')))
  // Never let a spec point the app at the user's real profile
  if (!userDataDir.startsWith(tmpdir())) throw new Error(`userDataDir must be under ${tmpdir()}: ${userDataDir}`)
  const importPort = opts.importPort ?? (await freePort())
  const mcpPort = opts.mcpPort ?? (await freePort())
  const editorHome = opts.editorHome ?? (await mkdtemp(join(tmpdir(), 'sessionforge-editors-')))
  if (!editorHome.startsWith(tmpdir())) throw new Error(`editorHome must be under ${tmpdir()}: ${editorHome}`)

  const app = await electron.launch({
    args: ['--no-sandbox', '--force-device-scale-factor=1', ...(opts.extraArgs ?? []), '.'],
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SANDBOX: '1',
      SESSIONFORGE_USER_DATA: userDataDir,
      SESSIONFORGE_IMPORT_PORT: String(importPort),
      SESSIONFORGE_MCP_PORT: String(mcpPort),
      SESSIONFORGE_EDITOR_CONFIG_HOME: editorHome,
      SESSIONFORGE_E2E: '1',
      ELECTRON_RENDERER_URL: '',
      ...opts.env
    }
  })
  const logs: string[] = []
  app.process().stdout?.on('data', (d: Buffer) => logs.push(d.toString()))
  app.process().stderr?.on('data', (d: Buffer) => logs.push(d.toString()))

  const proc = app.process()
  let page: Page
  try {
    page = await rendererPage(app)
  } catch (e) {
    await app.close().catch(() => undefined)
    throw new Error(`${(e as Error).message}\n--- app logs ---\n${logs.join('')}`)
  }
  return { app, page, userDataDir, importPort, mcpPort, editorHome, logs, proc }
}

/** The SessionForge UI page (pane views can show up in app.windows() too, so firstWindow() is not used). */
export async function rendererPage(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const page = app.windows().find((p) => p.url().endsWith('/renderer/index.html'))
    if (page) {
      await page.waitForSelector('[data-testid="session-bar"]', { timeout: 20_000 })
      return page
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('SessionForge renderer window did not appear')
}

/** Quit the app and wait for the process to exit (fails after 10 s). */
export async function closeApp(ctx: AppCtx): Promise<void> {
  const proc = ctx.proc
  if (proc.exitCode !== null || proc.signalCode !== null) return
  const exited =
    proc.exitCode !== null
      ? Promise.resolve()
      : new Promise<void>((r) => proc.once('exit', () => r()))
  await ctx.app.close()
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Electron did not exit within 10 s')), 10_000)
  })
  try {
    await Promise.race([exited, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export async function relaunch(ctx: AppCtx, opts: Pick<LaunchOptions, 'extraArgs' | 'env'> = {}): Promise<AppCtx> {
  await closeApp(ctx)
  return launchApp({
    ...opts,
    userDataDir: ctx.userDataDir,
    importPort: ctx.importPort,
    mcpPort: ctx.mcpPort,
    editorHome: ctx.editorHome
  })
}

/** Close the app (if still running) and delete its temp profile. */
export async function teardown(ctx: AppCtx | undefined): Promise<void> {
  if (!ctx) return
  await closeApp(ctx).catch(() => undefined)
  if (ctx.userDataDir.startsWith(tmpdir())) await rm(ctx.userDataDir, { recursive: true, force: true })
  if (ctx.editorHome.startsWith(tmpdir())) await rm(ctx.editorHome, { recursive: true, force: true })
}

type ElectronModule = typeof import('electron')

/**
 * Run fn in the main process with the E2E handle. fn is serialised, so it must not use closures;
 * pass data through arg.
 */
export async function wm<R, A = undefined>(
  app: ElectronApplication,
  fn: (sf: SfGlobal, arg: A, electron: ElectronModule) => R | Promise<R>,
  arg?: A
): Promise<R> {
  return app.evaluate(
    (electronModule, { src, arg }) => {
      const f = new Function(`return (${src})`)()
      return f((globalThis as unknown as { __sessionforge: unknown }).__sessionforge, arg, electronModule)
    },
    { src: fn.toString(), arg }
  ) as Promise<R>
}

/** executeJavaScript in a tab's page (user gesture on). */
export async function tabEval<R = unknown>(app: ElectronApplication, tabId: string, js: string): Promise<R> {
  return wm(
    app,
    (sf, { tabId, js }) => {
      const view = sf.windowManager.getViewForTest(tabId)
      if (!view) throw new Error('No live view for tab ' + tabId)
      return view.webContents.executeJavaScript(js, true)
    },
    { tabId, js }
  ) as Promise<R>
}

/**
 * Right-click the centre of selector in a tab and return the menu labels (or null if no menu).
 * Menu.prototype.popup is patched to record the menu instead of showing it.
 */
export async function openMenuAt(
  app: ElectronApplication,
  tabId: string,
  selector: string,
  prepare = ''
): Promise<string[] | null> {
  return wm(
    app,
    async (sf, { tabId, selector, prepare }, { Menu }) => {
      const g = globalThis as unknown as { __menuPatched?: boolean; __lastMenu: Electron.Menu | null }
      if (!g.__menuPatched) {
        Menu.prototype.popup = function (this: Electron.Menu) {
          g.__lastMenu = this
        }
        g.__menuPatched = true
      }
      const view = sf.windowManager.getViewForTest(tabId)
      if (!view) throw new Error('No live view for tab ' + tabId)
      const wc = view.webContents
      const pos = await wc.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        ${prepare}
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      })()`)
      g.__lastMenu = null
      wc.sendInputEvent({ type: 'mouseDown', x: pos.x, y: pos.y, button: 'right', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: pos.x, y: pos.y, button: 'right', clickCount: 1 })
      const recorded = () => g.__lastMenu as Electron.Menu | null // set by the patched popup()
      for (let i = 0; i < 30 && !recorded(); i++) await new Promise((r) => setTimeout(r, 100))
      const menu = recorded()
      return menu ? menu.items.map((item) => item.label).filter(Boolean) : null
    },
    { tabId, selector, prepare }
  )
}

/** Click an item of the last recorded context menu by label prefix. */
export async function clickMenuItem(app: ElectronApplication, labelPrefix: string): Promise<void> {
  await wm(
    app,
    (_sf, { labelPrefix }) => {
      const menu = (globalThis as unknown as { __lastMenu: Electron.Menu | null }).__lastMenu
      const item = menu?.items.find((i) => i.label.startsWith(labelPrefix))
      if (!item) throw new Error('Menu item not found: ' + labelPrefix)
      item.click()
    },
    { labelPrefix }
  )
}

export async function internetAvailable(): Promise<boolean> {
  try {
    const res = await fetch('https://example.com', { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}

/** Poll fn until it returns a truthy value (or throw after timeout). */
export async function waitFor<T>(fn: () => Promise<T> | T, timeout = 15_000, what = 'condition'): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout
  let last: T | undefined
  while (Date.now() < deadline) {
    last = await fn()
    if (last) return last as NonNullable<T>
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`Timed out waiting for ${what}; last value: ${JSON.stringify(last)}`)
}
