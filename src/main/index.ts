import { app, BrowserWindow, shell } from 'electron'
import { isAbsolute, join } from 'path'
import { mkdirSync } from 'fs'
import { electronApp, is } from '@electron-toolkit/utils'
import { initializeIPC, registerAppIpc } from './ipc'
import { SessionManager } from './session-manager'
import { WindowManager } from './window-manager'
import { ImportServer } from './import-server'
import { DatabaseManager } from './database'
import { getChromeUserAgent } from './user-agent'
import { resolveImportPort, StorageStateSchema } from './import-payload'
import { AgentBridge } from './agent/mcp-server'
import { registerAgentIpc } from './agent/ipc'
import { GoogleSignInCoordinator } from './google-signin/coordinator'
import { resolveTestGoogleOrigins } from './google-signin/match'
import { openInBrowser } from './google-signin/launch'
import { registerSignInIpc } from './google-signin/ipc'
import { RecentlyClosed } from './recently-closed'
// Real file path: resources/** is asarUnpacked in packaged builds
import icon from '../../resources/icon.png?asset&asarUnpack'

// Lets tests run against a throwaway data folder instead of ~/.config/sessionforge.
// A relative path is refused: falling back to the real profile could let a test write into it.
const userDataDir = process.env.SESSIONFORGE_USER_DATA
let envOk = true
if (userDataDir) {
  if (!isAbsolute(userDataDir)) {
    console.error('[env] SESSIONFORGE_USER_DATA must be an absolute path')
    envOk = false
    app.exit(1)
  } else {
    mkdirSync(userDataDir, { recursive: true })
    app.setPath('userData', userDataDir)
  }
}
const e2e = process.env.SESSIONFORGE_E2E === '1'

// Default session and the shell send a Chrome UA; each session partition sets the same one
app.userAgentFallback = getChromeUserAgent()

let mainWindow: BrowserWindow | null = null
let importServer: ImportServer | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    // Linux window icon; macOS and Windows take it from the app bundle / exe
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (envOk) app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sessionforge')

  // No optimizer.watchWindowShortcuts: its F12 listener would open the shell's DevTools next to the
  // tab's. WindowManager's shell before-input-event handler owns shortcuts and blocks zoom keys.

  // Initialize managers
  const sessionManager = SessionManager.getInstance()
  const windowManager = WindowManager.getInstance()
  initializeIPC()

  // "Sign in with Chrome": watches navigations from the first view on; production matching is
  // exactly https://accounts.google.com (the test origin needs SESSIONFORGE_E2E=1)
  const signIn = new GoogleSignInCoordinator({
    windows: windowManager,
    sessions: sessionManager,
    testOrigins: resolveTestGoogleOrigins(process.env),
    open: openInBrowser,
    importStatus: () =>
      importServer?.status() ?? { port: resolveImportPort(process.env.SESSIONFORGE_IMPORT_PORT), listening: false },
    e2e
  })
  windowManager.setTabObserver(signIn)
  registerSignInIpc(signIn)

  // Agent Bridge (off by default): hooks go in before any view exists, init() after the window
  const agentBridge = new AgentBridge({
    windowManager,
    sessionManager,
    db: DatabaseManager.getInstance(),
    importPort: resolveImportPort(process.env.SESSIONFORGE_IMPORT_PORT),
    googleSignIn: signIn
  })
  windowManager.setPopupGuard((sid, tabId, url) => agentBridge.shouldBlockPopup(sid, tabId, url))
  agentBridge.installHooks()
  registerAgentIpc(agentBridge)

  // Closing or deleting a session ends its agent calls and its waiting Google sign-in requests
  RecentlyClosed.getInstance().setHooks({
    onSessionRemoved: (id) => {
      agentBridge.onSessionRemoved(id)
      signIn.onSessionRemoved(id)
    },
    onSessionReopened: (id) => agentBridge.onSessionReopened(id)
  })

  createWindow()
  // Pane bounds follow the renderer's measured rects, so no resize handler is needed here
  windowManager.init(mainWindow!)
  signIn.init(mainWindow!)

  // Import server for the Chrome extension starts once the window exists
  importServer = new ImportServer(windowManager, signIn)
  importServer.start()
  registerAppIpc(() => importServer)
  agentBridge.init(mainWindow!)

  // Flush cookies/storage before quitting. beginShutdown runs first so view teardown writes nothing.
  let flushed = false
  app.on('before-quit', (e) => {
    windowManager.beginShutdown()
    if (flushed) return
    e.preventDefault()
    importServer?.stop()
    signIn.dispose()
    agentBridge.stop('quit')
    const delay = new Promise<void>((r) => setTimeout(r, 2000))
    Promise.race([sessionManager.flushAll(), delay]).finally(() => {
      flushed = true
      DatabaseManager.getInstance().close()
      app.quit()
    })
  })

  // Test-only handle for Playwright specs (app.evaluate)
  if (e2e) {
    (globalThis as Record<string, unknown>).__sessionforge = {
      windowManager,
      sessionManager,
      db: DatabaseManager.getInstance(),
      StorageStateSchema,
      window: mainWindow,
      agentBridge,
      googleSignIn: signIn
    }
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
