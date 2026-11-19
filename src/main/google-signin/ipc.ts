// signin:* IPC handlers. The renderer sends only a tab id; main owns every URL and cookie domain.
import { ipcMain } from 'electron'
import { z } from 'zod'
import type { GoogleSignInCoordinator } from './coordinator'

const Id = z.string().uuid()

export function registerSignInIpc(c: GoogleSignInCoordinator): void {
  ipcMain.handle('signin:getState', async (_, tabId: unknown) => c.getState(Id.parse(tabId)))
  ipcMain.handle('signin:start', async (_, tabId: unknown) => c.start(Id.parse(tabId)))
  ipcMain.handle('signin:cancel', async (_, tabId: unknown) => c.cancel(Id.parse(tabId)))
  ipcMain.handle('signin:dismiss', async (_, tabId: unknown) => {
    c.dismiss(Id.parse(tabId))
  })
}
