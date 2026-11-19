import { session } from 'electron'
import { randomUUID } from 'crypto'
import { DatabaseManager } from './database'
import type { Session, CreateSessionInput, UpdateSessionInput, PlaywrightStorageState } from './types'
import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { getChromeUserAgent } from './user-agent'
import { toElectronCookie, type CookieInput, type StorageStateInput } from './import-payload'

export interface CookieImportCounts {
  imported: number
  failed: number
  skipped: number
}

export class SessionManager {
  private static instance: SessionManager
  private db: DatabaseManager
  /** Every stored session, closed ones included */
  private sessions: Map<string, Session> = new Map()
  /**
   * Sessions the user closed (reopenable with Cmd/Ctrl+Shift+T). The getters below act as if they
   * don't exist, so the UI, the Agent Bridge and the import server never see them.
   */
  private closed: Set<string> = new Set()
  /** Partitions that already got the Chrome user agent */
  private configured: Set<string> = new Set()

  private constructor() {
    this.db = DatabaseManager.getInstance()
    this.loadSessions()
  }

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager()
    }
    return SessionManager.instance
  }

  private loadSessions(): void {
    const sessions = this.db.getAllSessions()
    sessions.forEach((s) => this.sessions.set(s.id, s))
    this.closed = new Set(this.db.getClosedSessionIds())
  }

  createSession(input: CreateSessionInput): Session {
    const id = randomUUID()
    const partition = `persist:sf-${randomUUID()}`

    const newSession: Session = {
      id,
      partition,
      name: input.name,
      color: input.color,
      icon: input.icon,
      env: input.env,
      urlGuards: input.urlGuards,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    this.db.createSession(newSession)
    this.sessions.set(id, newSession)

    // Initialize the Chromium partition
    this.configureSession(partition, session.fromPartition(partition, { cache: true }))

    return newSession
  }

  /** Open sessions only */
  getSession(id: string): Session | undefined {
    return this.closed.has(id) ? undefined : this.sessions.get(id)
  }

  /** Open sessions only */
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values()).filter((s) => !this.closed.has(s.id))
  }

  getSessionIncludingClosed(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  getClosedSessions(): Session[] {
    return Array.from(this.sessions.values()).filter((s) => this.closed.has(s.id))
  }

  isClosed(id: string): boolean {
    return this.closed.has(id)
  }

  stateOf(id: string): 'open' | 'closed' | 'missing' {
    if (!this.sessions.has(id)) return 'missing'
    return this.closed.has(id) ? 'closed' : 'open'
  }

  /** Memory only: the closed_items row (RecentlyClosed) is what persists it. */
  setClosed(id: string, closed: boolean): void {
    if (closed) this.closed.add(id)
    else this.closed.delete(id)
  }

  /** Name, color, icon and URL guards. The environment is fixed once a session exists. */
  updateSession(input: UpdateSessionInput): Session | undefined {
    const existing = this.getSession(input.id)
    if (!existing) return undefined

    const updated: Session = {
      ...existing,
      name: input.name ?? existing.name,
      color: input.color ?? existing.color,
      icon: input.icon ?? existing.icon,
      urlGuards: input.urlGuards ?? existing.urlGuards,
      updatedAt: Date.now()
    }

    this.db.updateSession(input.id, updated)
    this.sessions.set(input.id, updated)

    return updated
  }

  async deleteSession(id: string): Promise<boolean> {
    const sess = this.sessions.get(id)
    if (!sess) return false

    // Clear the partition data
    const electronSession = session.fromPartition(sess.partition)
    await electronSession.clearStorageData()

    // Delete from database (cascades to its tabs, agent grant and closed_items rows)
    this.db.deleteSession(id)
    this.sessions.delete(id)
    this.closed.delete(id)

    // Delete partition folder from disk
    try {
      const partitionPath = join(app.getPath('userData'), 'Partitions', sess.partition)
      await fs.rm(partitionPath, { recursive: true, force: true })
    } catch (error) {
      console.error('Failed to delete partition folder:', error)
    }

    return true
  }

  /** Write cookies and storage of every session to disk (quit flush). Never throws. */
  async flushAll(): Promise<void> {
    // The raw map: closed sessions keep their logins on disk too
    await Promise.all(
      Array.from(this.sessions.values()).map(async (s) => {
        try {
          const ses = session.fromPartition(s.partition)
          await ses.cookies.flushStore()
          ses.flushStorageData()
        } catch (e) {
          console.warn('[session] flush failed', s.id, (e as Error).message)
        }
      })
    )
  }

  /** Open sessions only */
  getElectronSession(sessionId: string): Electron.Session | undefined {
    const sess = this.getSession(sessionId)
    if (!sess) return undefined
    return this.configureSession(sess.partition, session.fromPartition(sess.partition))
  }

  /** Once per partition: send the Chrome user agent instead of Electron's. */
  private configureSession(partition: string, ses: Electron.Session): Electron.Session {
    if (!this.configured.has(partition)) {
      ses.setUserAgent(getChromeUserAgent())
      this.configured.add(partition)
    }
    return ses
  }

  async exportToPlaywright(sessionId: string): Promise<PlaywrightStorageState> {
    const electronSession = this.getElectronSession(sessionId)
    if (!electronSession) {
      throw new Error('Session not found')
    }

    // Get cookies
    const cookies = await electronSession.cookies.get({})
    const playwrightCookies = cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain || '',
      path: cookie.path || '/',
      expires: cookie.expirationDate || -1,
      httpOnly: cookie.httpOnly || false,
      secure: cookie.secure || false,
      sameSite: (cookie.sameSite as 'Strict' | 'Lax' | 'None') || 'Lax'
    }))

    // Get localStorage for all origins
    const origins: PlaywrightStorageState['origins'] = []
    
    // Note: Electron doesn't provide direct localStorage access
    // This would need to be captured from the renderer or during navigation
    // For now, returning empty origins array
    // TODO: Implement localStorage capture via executeJavaScript on WebContents

    return {
      cookies: playwrightCookies,
      origins
    }
  }

  /**
   * New session with the given cookies. Accepts only StorageStateSchema output, so sameSite is
   * already normalized. localStorage is seeded by the tab that opens the page (WindowManager).
   * Cookie and storage values are never logged.
   */
  async importFromPlaywright(
    name: string,
    storageState: StorageStateInput,
    env: CreateSessionInput['env'] = 'local',
    color: string = '#3b82f6'
  ): Promise<{ session: Session; cookies: CookieImportCounts }> {
    const newSession = this.createSession({ name, color, env })
    const electronSession = this.getElectronSession(newSession.id)

    if (!electronSession) {
      throw new Error('Failed to create session')
    }

    const counts = await this.setCookies(electronSession, storageState.cookies)
    return { session: newSession, cookies: counts }
  }

  /**
   * Add cookies to an existing session (Sign in with Chrome). Same name, domain and path replace the
   * session's old cookie; nothing else is cleared. Values are never logged.
   */
  async importCookiesInto(sessionId: string, cookies: CookieInput[]): Promise<CookieImportCounts> {
    const electronSession = this.getElectronSession(sessionId)
    if (!electronSession) throw new Error('Session not found')
    return this.setCookies(electronSession, cookies)
  }

  private async setCookies(ses: Electron.Session, cookies: CookieInput[]): Promise<CookieImportCounts> {
    const counts: CookieImportCounts = { imported: 0, failed: 0, skipped: 0 }
    const nowSec = Date.now() / 1000
    for (const cookie of cookies) {
      const details = toElectronCookie(cookie, nowSec)
      if (!details) {
        counts.skipped++
        continue
      }
      try {
        await ses.cookies.set(details)
        counts.imported++
      } catch (e) {
        counts.failed++
        console.warn('[import] cookie rejected', cookie.name, cookie.domain, (e as Error).message)
      }
    }
    await ses.cookies.flushStore()
    return counts
  }
}
