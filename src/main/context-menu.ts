import { BrowserWindow, Menu, MenuItemConstructorOptions, WebContents, clipboard, dialog } from 'electron'

export interface ContextMenuActions {
  /** Open a URL in a new tab of the same session */
  openInNewTab: (url: string) => void
}

type DevToolsPanel = 'elements' | 'console'

/** Open DevTools in a separate window (a docked panel would crush a split-view pane), or close it if open. */
export function toggleDevTools(wc: WebContents, panel: DevToolsPanel = 'elements'): void {
  if (wc.isDevToolsOpened()) {
    wc.closeDevTools()
    return
  }
  openDevTools(wc, panel)
}

/** Open DevTools detached (never closes them) and select the panel. */
export function openDevTools(wc: WebContents, panel: DevToolsPanel = 'elements'): void {
  if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' })
  if (panel === 'console') {
    const showConsole = () =>
      wc.devToolsWebContents
        ?.executeJavaScript('window.DevToolsAPI?.showPanel?.("console")')
        .catch(() => {})
    if (wc.devToolsWebContents) showConsole()
    else wc.once('devtools-opened', showConsole)
  }
}

function viewSource(wc: WebContents, actions: ContextMenuActions): void {
  const url = wc.getURL()
  if (url && !url.startsWith('view-source:')) actions.openInNewTab(`view-source:${url}`)
}

async function savePage(wc: WebContents): Promise<void> {
  const win = BrowserWindow.getAllWindows()[0]
  const name = (wc.getTitle() || 'page').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 100)
  const { filePath } = await dialog.showSaveDialog(win, {
    title: 'Save page as',
    defaultPath: `${name}.html`,
    filters: [{ name: 'Web page, complete', extensions: ['html'] }]
  })
  if (filePath) await wc.savePage(filePath, 'HTMLComplete')
}

const searchUrl = (text: string) =>
  `https://www.google.com/search?q=${encodeURIComponent(text.trim())}`

/** Build the Chrome-like menu for a right-click. Exported so it can be tested without a real click. */
export function buildContextMenuTemplate(
  wc: WebContents,
  params: Electron.ContextMenuParams,
  actions: ContextMenuActions
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  const section = (entries: MenuItemConstructorOptions[]) => {
    if (entries.length === 0) return
    if (items.length > 0) items.push({ type: 'separator' })
    items.push(...entries)
  }
  const flags = params.editFlags
  const selection = params.selectionText.trim()

  // Spelling suggestions in editable fields
  if (params.isEditable && params.misspelledWord) {
    const suggestions = params.dictionarySuggestions.slice(0, 5)
    section([
      ...(suggestions.length > 0
        ? suggestions.map((s) => ({ label: s, click: () => wc.replaceMisspelling(s) }))
        : [{ label: 'No spelling suggestions', enabled: false }]),
      {
        label: 'Add to dictionary',
        click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      }
    ])
  }

  // Links
  if (params.linkURL) {
    section([
      { label: 'Open link in new tab', click: () => actions.openInNewTab(params.linkURL) },
      { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
      ...(params.linkText
        ? [{ label: 'Copy link text', click: () => clipboard.writeText(params.linkText) }]
        : [])
    ])
  }

  // Images
  if (params.mediaType === 'image' && params.srcURL) {
    section([
      { label: 'Open image in new tab', click: () => actions.openInNewTab(params.srcURL) },
      { label: 'Save image as…', click: () => wc.downloadURL(params.srcURL) },
      { label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) }
    ])
  }

  // Editing
  if (params.isEditable) {
    section([
      { label: 'Undo', role: 'undo', enabled: flags.canUndo },
      { label: 'Redo', role: 'redo', enabled: flags.canRedo },
      { type: 'separator' },
      { label: 'Cut', role: 'cut', enabled: flags.canCut },
      { label: 'Copy', role: 'copy', enabled: flags.canCopy },
      { label: 'Paste', role: 'paste', enabled: flags.canPaste },
      { label: 'Paste as plain text', role: 'pasteAndMatchStyle', enabled: flags.canPaste },
      { label: 'Select all', role: 'selectAll', enabled: flags.canSelectAll }
    ])
  } else if (selection) {
    const short = selection.length > 30 ? `${selection.slice(0, 30)}…` : selection
    section([
      { label: 'Copy', role: 'copy' },
      { label: `Search Google for "${short}"`, click: () => actions.openInNewTab(searchUrl(selection)) }
    ])
  }

  // Page actions, when nothing more specific was clicked
  if (!params.linkURL && !params.isEditable && !selection && params.mediaType === 'none') {
    const history = wc.navigationHistory
    section([
      { label: 'Back', enabled: history.canGoBack(), click: () => history.goBack() },
      { label: 'Forward', enabled: history.canGoForward(), click: () => history.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'Save as…', click: () => savePage(wc).catch((e) => console.error('Save page failed:', e)) },
      { label: 'Print…', click: () => wc.print() },
      { type: 'separator' },
      { label: 'View page source', accelerator: 'CmdOrCtrl+U', click: () => viewSource(wc, actions) },
      { label: 'Copy page URL', click: () => clipboard.writeText(wc.getURL()) }
    ])
  }

  // Always available, like Chrome
  section([
    {
      label: 'Inspect',
      accelerator: 'CmdOrCtrl+Shift+I',
      click: () => {
        openDevTools(wc)
        wc.inspectElement(params.x, params.y)
      }
    }
  ])

  return items
}

/**
 * Attach the Chrome-like right-click menu to a web page. Keyboard shortcuts (F12, Ctrl+Shift+I/J/C,
 * Ctrl+U, reloads, Alt+arrows) are not handled here: WindowManager's single before-input-event
 * handler owns them through matchShortcut (src/main/shortcuts.ts).
 */
export function attachDeveloperTools(wc: WebContents, actions: ContextMenuActions): void {
  wc.on('context-menu', (_event, params) => {
    const menu = Menu.buildFromTemplate(buildContextMenuTemplate(wc, params, actions))
    menu.popup()
  })
}
