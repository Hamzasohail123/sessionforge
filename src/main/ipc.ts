import { app, ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { z } from 'zod'
import { existsSync } from 'fs'
import { basename, join } from 'path'
import { SessionManager } from './session-manager'
import { WindowManager } from './window-manager'
import { RecentlyClosed } from './recently-closed'
import type { ImportServer } from './import-server'
import {
  DOC_IDS,
  TOUR_OUTCOMES,
  type AppInfo,
  type CreateSessionInput,
  type DocId,
  type TourState,
  type UpdateCheckResult,
  type UpdateSessionInput,
  type UpdateState
} from './types'
import type { UpdateChecker } from './updates'
import { writeFile, readFile } from 'fs/promises'
import { formatZodIssues, isOpenableUrl, resolveImportPort, StorageStateSchema } from './import-payload'
import { prepareExtensionFolder } from './extension-copy'
import { CHROME_EXTENSION_STORE_URL, RELEASES_PAGE_URL, SESSION_NAME_MAX } from './constants'
import { isAllowedExternalUrl } from './external-url'
import type { DatabaseManager } from './database'
import { TOUR_SETTING_KEY, shouldAutoStartTour, type TourEnv } from './tour'

// All existing ids are 36-character UUIDs (checked read-only against the user's DB before this change)
const Id = z.string().uuid()
const SessionName = z.string().trim().min(1).max(SESSION_NAME_MAX)

const CreateSessionSchema = z.object({
  name: SessionName,
  color: z.string(),
  icon: z.string().optional(),
  env: z.enum(['local', 'staging', 'production', 'custom']),
  urlGuards: z.array(z.string()).optional()
})

// Strict and without env: a production session must not become 'local' (that would lift the agent
// production cap without the typed confirmation), so an env key is an error, not silently dropped
const UpdateSessionSchema = z
  .object({
    id: Id,
    name: SessionName.optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    icon: z.string().max(64).optional(),
    urlGuards: z.array(z.string()).optional()
  })
  .strict()
const PaneIdSchema = z.enum(['pane-1', 'pane-2', 'pane-3', 'pane-4'])
const ModeSchema = z.enum(['single', 'columns', 'rows', 'grid'])
const NavUrl = z
  .string()
  .max(8192)
  .refine(isOpenableUrl, 'Only http(s) and view-source:http(s) URLs are allowed')
const DevToolsPanel = z.enum(['elements', 'console']).optional()
const Coord = z.number().finite().min(0).max(100000)
const PaneRectSchema = z.object({ paneId: PaneIdSchema, x: Coord, y: Coord, width: Coord, height: Coord })
const PaneRectsSchema = z.array(PaneRectSchema).max(4)

export function initializeIPC(): void {
  const sessionManager = SessionManager.getInstance()
  const windowManager = WindowManager.getInstance()
  const recentlyClosed = RecentlyClosed.getInstance()

  // Sessions
  ipcMain.handle('session:create', async (_, input: unknown) => {
    const validated = CreateSessionSchema.parse(input)
    return sessionManager.createSession(validated as CreateSessionInput)
  })

  ipcMain.handle('session:getAll', async () => {
    return sessionManager.getAllSessions()
  })

  ipcMain.handle('session:get', async (_, id: unknown) => {
    return sessionManager.getSession(Id.parse(id))
  })

  ipcMain.handle('session:update', async (_, input: unknown) => {
    const validated = UpdateSessionSchema.parse(input)
    return sessionManager.updateSession(validated as UpdateSessionInput)
  })

  // "Delete permanently": open or closed sessions
  ipcMain.handle('session:delete', async (_, id: unknown) => recentlyClosed.deleteSession(Id.parse(id)))

  // Close (soft): reopenable with Cmd/Ctrl+Shift+T
  ipcMain.handle('session:close', async (_, id: unknown) => recentlyClosed.closeSession(Id.parse(id)))

  // Recently closed tabs and sessions
  ipcMain.handle('closed:reopenLast', async () => recentlyClosed.reopenLast())

  ipcMain.handle('closed:reopen', async (_, entryId: unknown) => recentlyClosed.reopen(Id.parse(entryId)))

  // Layout
  ipcMain.handle('layout:get', async () => windowManager.getLayoutState())

  ipcMain.handle('layout:setMode', async (_, mode: unknown) => windowManager.setMode(ModeSchema.parse(mode)))

  ipcMain.handle('layout:focusPane', async (_, paneId: unknown) =>
    windowManager.focusPane(PaneIdSchema.parse(paneId))
  )

  ipcMain.handle('layout:assignTab', async (_, paneId: unknown, tabId: unknown) =>
    windowManager.assignTab(PaneIdSchema.parse(paneId), Id.nullable().parse(tabId))
  )

  ipcMain.handle('layout:openSession', async (_, paneId: unknown, sessionId: unknown) =>
    windowManager.openSession(PaneIdSchema.parse(paneId), Id.parse(sessionId))
  )

  ipcMain.handle('layout:setPaneRects', async (_, rects: unknown) => {
    windowManager.setPaneRects(PaneRectsSchema.parse(rects))
  })

  ipcMain.handle('view:setOverlay', async (_, open: unknown) => {
    windowManager.setOverlay(z.boolean().parse(open))
  })

  // Tabs
  ipcMain.handle('tab:create', async (_, sessionId: unknown, url: unknown) => {
    return windowManager.createTab(Id.parse(sessionId), NavUrl.parse(url))
  })

  ipcMain.handle('tab:getBySession', async (_, sessionId: unknown) => {
    return windowManager.getTabsBySession(Id.parse(sessionId))
  })

  // The user closed it (x or Cmd/Ctrl+W), so it goes on the recently closed stack
  ipcMain.handle('tab:close', async (_, tabId: unknown) => {
    await recentlyClosed.closeTab(Id.parse(tabId))
  })

  ipcMain.handle('tab:navigate', async (_, tabId: unknown, url: unknown) => {
    windowManager.navigateTo(Id.parse(tabId), NavUrl.parse(url))
  })

  ipcMain.handle('tab:goBack', async (_, tabId: unknown) => {
    windowManager.goBack(Id.parse(tabId))
  })

  ipcMain.handle('tab:goForward', async (_, tabId: unknown) => {
    windowManager.goForward(Id.parse(tabId))
  })

  ipcMain.handle('tab:reload', async (_, tabId: unknown) => {
    windowManager.reload(Id.parse(tabId))
  })

  ipcMain.handle('tab:reloadIgnoringCache', async (_, tabId: unknown) => {
    windowManager.reloadIgnoringCache(Id.parse(tabId))
  })

  ipcMain.handle('tab:stop', async (_, tabId: unknown) => {
    windowManager.stop(Id.parse(tabId))
  })

  ipcMain.handle('tab:openDevTools', async (_, tabId: unknown, panel: unknown) => {
    windowManager.openDevTools(Id.parse(tabId), DevToolsPanel.parse(panel))
  })

  ipcMain.handle('tab:viewSource', async (_, tabId: unknown) => {
    await windowManager.viewSource(Id.parse(tabId))
  })

  ipcMain.handle('tab:setActive', async (_, tabId: unknown) => {
    windowManager.setActiveTab(Id.parse(tabId))
  })

  ipcMain.handle('tab:cycle', async (_, direction: unknown) => {
    windowManager.cycleTab(z.union([z.literal(1), z.literal(-1)]).parse(direction))
  })

  ipcMain.handle('tab:getState', async (_, tabId: unknown) => {
    return windowManager.getTabState(Id.parse(tabId))
  })

  // Playwright Export/Import
  ipcMain.handle('playwright:export', async (event, id: unknown) => {
    const sessionId = Id.parse(id)
    const storageState = await sessionManager.exportToPlaywright(sessionId)
    const window = BrowserWindow.fromWebContents(event.sender)
    
    if (!window) throw new Error('Window not found')

    const { filePath } = await dialog.showSaveDialog(window, {
      title: 'Export Playwright Storage State',
      defaultPath: `${sessionId}-storageState.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (filePath) {
      await writeFile(filePath, JSON.stringify(storageState, null, 2))
      return { success: true, path: filePath }
    }

    return { success: false }
  })

  ipcMain.handle('playwright:import', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const { filePaths } = await dialog.showOpenDialog(window, {
      title: 'Import Playwright Storage State',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })

    if (filePaths.length > 0) {
      const content = await readFile(filePaths[0], 'utf-8')
      let raw: unknown
      try {
        raw = JSON.parse(content)
      } catch {
        throw new Error('Invalid JSON file')
      }
      // Same schema as the extension import, so sameSite and origins are normalized the same way
      const parsed = StorageStateSchema.safeParse(raw)
      if (!parsed.success) throw new Error('Invalid storage state: ' + formatZodIssues(parsed.error))

      // Extract session name from filename
      const filename = basename(filePaths[0]) || 'Imported Session'
      const sessionName = filename.replace('-storageState.json', '').replace('.json', '').slice(0, SESSION_NAME_MAX)

      const { session, cookies } = await sessionManager.importFromPlaywright(sessionName, parsed.data)

      return { success: true, session, cookies }
    }

    return { success: false }
  })
}
// ---------------------------------------------------------------- app:* (Settings → General, Chrome Import, About)
/** Docs ship next to app.asar in packaged builds (electron-builder extraResources) and at the repo root in dev. */
const DOCS: Record<'dev' | 'packaged', Record<DocId, string>> = {
  dev: {
    readme: 'README.md',
    security: 'SECURITY.md',
    privacy: 'PRIVACY.md',
    license: 'LICENSE',
    chromeExtension: 'chrome-extension/README.md'
  },
  packaged: {
    readme: 'docs/README.md',
    security: 'docs/SECURITY.md',
    privacy: 'docs/PRIVACY.md',
    license: 'docs/LICENSE',
    chromeExtension: 'chrome-extension/README.md'
  }
}
const docBase = () => (app.isPackaged ? process.resourcesPath : app.getAppPath())
function extensionFolder(): { path: string | null; error?: string } {
  const src = join(docBase(), 'chrome-extension')
  if (!app.isPackaged) return { path: src }
  return prepareExtensionFolder(src, join(app.getPath('userData'), 'chrome-extension'))
}
/** Registered after the import server starts, so its status is real. */
export function registerAppIpc(getImportServer: () => ImportServer | null): void {
  ipcMain.handle('app:getInfo', async (): Promise<AppInfo> => {
    const ext = extensionFolder()
    const server = getImportServer()
    return {
      version: app.getVersion(),
      userDataPath: app.getPath('userData'),
      platform: process.platform,
      license: 'Apache-2.0',
      importServer: server?.status() ?? {
        port: resolveImportPort(process.env.SESSIONFORGE_IMPORT_PORT),
        listening: false
      },
      extensionPath: ext.path,
      extensionError: ext.error
    }
  })
  ipcMain.handle('app:showUserData', async () => {
    shell.showItemInFolder(app.getPath('userData'))
  })
  ipcMain.handle('app:showExtensionFolder', async () => {
    const ext = extensionFolder()
    if (!ext.path) throw new Error(`Could not prepare the extension folder: ${ext.error}`)
    shell.showItemInFolder(join(ext.path, 'manifest.json'))
  })
  ipcMain.handle('app:openDoc', async (_, doc: unknown) => {
    const id = z.enum(DOC_IDS).parse(doc)
    const file = join(docBase(), DOCS[app.isPackaged ? 'packaged' : 'dev'][id])
    if (!existsSync(file)) throw new Error('Not included in this build')
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
  })
  // No argument: the renderer can't choose the URL, main opens the one store page
  ipcMain.handle('app:openExtensionStore', async () =>
    openAllowedExternal(
      CHROME_EXTENSION_STORE_URL,
      'Could not open your browser. Open the Chrome Web Store and search for "SessionForge Import".'
    )
  )
}
async function openAllowedExternal(url: string, failMessage: string): Promise<void> {
  if (!isAllowedExternalUrl(url)) {
    console.error('[app] refused external URL')
    throw new Error('Refusing to open this URL')
  }
  try {
    await shell.openExternal(url)
  } catch (err) {
    console.warn('[app] openExternal failed', err instanceof Error ? err.message : String(err))
    throw new Error(failMessage)
  }
}
// ---------------------------------------------------------------- update:* (new release notice)
export function registerUpdateIpc(checker: UpdateChecker): void {
  ipcMain.handle('update:getState', async (): Promise<UpdateState> => checker.getState())
  ipcMain.handle('update:setEnabled', async (_, enabled: unknown) => checker.setEnabled(z.boolean().parse(enabled)))
  ipcMain.handle('update:checkNow', async (): Promise<UpdateCheckResult> => checker.checkNow())
  // No arguments: main dismisses the version on offer and opens its own vetted release URL
  ipcMain.handle('update:dismiss', async () => checker.dismiss())
  ipcMain.handle('update:openRelease', async () =>
    openAllowedExternal(
      checker.releaseUrl(),
      `Could not open your browser. Open ${RELEASES_PAGE_URL}.`
    )
  )
}
// ---------------------------------------------------------------- tour:* (first-run tour)
export function registerTourIpc(db: DatabaseManager, env: TourEnv): void {
  // Sessions are counted at call time: only a profile with none (and nothing stored) auto-starts
  ipcMain.handle(
    'tour:getState',
    async (): Promise<TourState> => ({
      autoStart: shouldAutoStartTour(db.getSetting(TOUR_SETTING_KEY), db.getAllSessions().length, env)
    })
  )
  ipcMain.handle('tour:finish', async (_, outcome: unknown) => {
    const value = z.enum(TOUR_OUTCOMES).parse(outcome)
    db.setSetting(TOUR_SETTING_KEY, value)
    console.log('[tour]', value)
  })
}
