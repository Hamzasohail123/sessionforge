import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import type { Session, Tab, Layout } from './types'
import type { AgentGrant } from './agent/types'
import { parseClosedTabs, type ClosedItem, type ClosedKind } from './closed-stack'

/** A sessions row as stored */
interface SessionRow {
  id: string
  partition: string
  name: string
  color: string
  icon: string | null
  env: Session['env']
  urlGuards: string | null
  workspaceId: string | null
  createdAt: number
  updatedAt: number
}

/** A tabs row as stored */
interface TabRow {
  id: string
  sessionId: string
  url: string
  title: string | null
  favicon: string | null
  order: number
  lastActiveAt: number
}

/** A closed_items row as stored */
interface ClosedRow {
  seq: number
  id: string
  kind: ClosedKind
  sessionId: string
  url: string | null
  title: string | null
  tabs: string | null
  closedAt: number
}

export class DatabaseManager {
  private static instance: DatabaseManager
  private db: Database.Database

  private constructor() {
    const dbPath = join(app.getPath('userData'), 'sessionforge.db')
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.initialize()
  }

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager()
    }
    return DatabaseManager.instance
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        partition TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        icon TEXT,
        env TEXT NOT NULL,
        urlGuards TEXT,
        workspaceId TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tabs (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        favicon TEXT,
        \`order\` INTEGER NOT NULL,
        lastActiveAt INTEGER NOT NULL,
        FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS layouts (
        windowId TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        panes TEXT NOT NULL,
        activePaneId TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tabs_session ON tabs(sessionId);
      CREATE INDEX IF NOT EXISTS idx_tabs_lastActive ON tabs(lastActiveAt);

      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

      CREATE TABLE IF NOT EXISTS agent_grants (
        sessionId TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        level TEXT NOT NULL CHECK (level IN ('hidden','read','control')),
        updatedAt INTEGER NOT NULL
      );

      -- Recently closed tabs and sessions (Cmd/Ctrl+Shift+T). A session is closed exactly when it has
      -- a 'session' row; its sessions row, grant and partition stay until it is deleted for good.
      CREATE TABLE IF NOT EXISTS closed_items (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('tab','session')),
        sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        url TEXT,
        title TEXT,
        tabs TEXT,
        closedAt INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_closed_session ON closed_items(sessionId) WHERE kind = 'session';
      CREATE INDEX IF NOT EXISTS idx_closed_items_session ON closed_items(sessionId);
    `)
    // Rows left behind while foreign keys were off
    this.db.prepare('DELETE FROM tabs WHERE sessionId NOT IN (SELECT id FROM sessions)').run()
    // Tabs of a session closed just before a crash (its URLs are already in its closed_items row)
    this.db
      .prepare("DELETE FROM tabs WHERE sessionId IN (SELECT sessionId FROM closed_items WHERE kind = 'session')")
      .run()
  }

  // Sessions
  createSession(session: Session): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, partition, name, color, icon, env, urlGuards, workspaceId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      session.id,
      session.partition,
      session.name,
      session.color,
      session.icon || null,
      session.env,
      session.urlGuards ? JSON.stringify(session.urlGuards) : null,
      session.workspaceId || null,
      session.createdAt,
      session.updatedAt
    )
  }

  getSession(id: string): Session | undefined {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?')
    const row = stmt.get(id) as SessionRow | undefined
    return row ? this.parseSession(row) : undefined
  }

  getAllSessions(): Session[] {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY createdAt ASC')
    const rows = stmt.all() as SessionRow[]
    return rows.map(this.parseSession)
  }

  updateSession(id: string, updates: Partial<Session>): void {
    const fields: string[] = []
    const values: Array<string | number> = []

    if (updates.name !== undefined) {
      fields.push('name = ?')
      values.push(updates.name)
    }
    if (updates.color !== undefined) {
      fields.push('color = ?')
      values.push(updates.color)
    }
    if (updates.icon !== undefined) {
      fields.push('icon = ?')
      values.push(updates.icon)
    }
    if (updates.env !== undefined) {
      fields.push('env = ?')
      values.push(updates.env)
    }
    if (updates.urlGuards !== undefined) {
      fields.push('urlGuards = ?')
      values.push(JSON.stringify(updates.urlGuards))
    }

    fields.push('updatedAt = ?')
    values.push(Date.now())
    values.push(id)

    const stmt = this.db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`)
    stmt.run(...values)
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }

  // Tabs
  createTab(tab: Tab): void {
    const stmt = this.db.prepare(`
      INSERT INTO tabs (id, sessionId, url, title, favicon, \`order\`, lastActiveAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      tab.id,
      tab.sessionId,
      tab.url,
      tab.title || null,
      tab.favicon || null,
      tab.order,
      tab.lastActiveAt
    )
  }

  getTabsBySession(sessionId: string): Tab[] {
    const stmt = this.db.prepare('SELECT * FROM tabs WHERE sessionId = ? ORDER BY `order` ASC')
    const rows = stmt.all(sessionId) as TabRow[]
    return rows.map(this.parseTab)
  }

  getAllTabs(): Tab[] {
    const rows = this.db.prepare('SELECT * FROM tabs ORDER BY sessionId, `order` ASC').all() as TabRow[]
    return rows.map(this.parseTab)
  }

  /** Next free order slot (count-based order collides after a middle tab is closed). */
  getNextTabOrder(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(`order`), -1) + 1 AS n FROM tabs WHERE sessionId = ?')
      .get(sessionId) as { n: number }
    return row.n
  }

  getTabById(id: string): Tab | null {
    const row = this.db.prepare('SELECT * FROM tabs WHERE id = ?').get(id) as TabRow | undefined
    return row ? this.parseTab(row) : null
  }

  updateTab(id: string, updates: Partial<Tab>): void {
    const fields: string[] = []
    const values: Array<string | number> = []

    if (updates.url !== undefined) {
      fields.push('url = ?')
      values.push(updates.url)
    }
    if (updates.title !== undefined) {
      fields.push('title = ?')
      values.push(updates.title)
    }
    if (updates.favicon !== undefined) {
      fields.push('favicon = ?')
      values.push(updates.favicon)
    }
    if (updates.order !== undefined) {
      fields.push('`order` = ?')
      values.push(updates.order)
    }
    if (updates.lastActiveAt !== undefined) {
      fields.push('lastActiveAt = ?')
      values.push(updates.lastActiveAt)
    }

    values.push(id)
    const stmt = this.db.prepare(`UPDATE tabs SET ${fields.join(', ')} WHERE id = ?`)
    stmt.run(...values)
  }

  deleteTab(id: string): void {
    this.db.prepare('DELETE FROM tabs WHERE id = ?').run(id)
  }

  // Layout
  saveLayout(layout: Layout): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO layouts (windowId, mode, panes, activePaneId)
      VALUES (?, ?, ?, ?)
    `)
    stmt.run(layout.windowId, layout.mode, JSON.stringify(layout.panes), layout.activePaneId)
  }

  /** The stored row, unvalidated (layout.ts normalizeLayout validates it). null when there is none. */
  getLayoutRaw(windowId: string): { mode: unknown; panes: unknown; activePaneId: unknown } | null {
    const row = this.db.prepare('SELECT * FROM layouts WHERE windowId = ?').get(windowId) as
      | { mode: string; panes: string; activePaneId: string }
      | undefined
    if (!row) return null
    let panes: unknown = null
    try {
      panes = JSON.parse(row.panes)
    } catch {
      console.warn('[layout] stored panes JSON is corrupt; using default')
    }
    return { mode: row.mode, panes, activePaneId: row.activePaneId }
  }

  // App settings (Agent Bridge)
  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row ? row.value : null
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value)
  }

  /** Stored agent grants; a session without a row has level 'read'. */
  getAgentGrants(): Array<{ sessionId: string; level: AgentGrant }> {
    return this.db.prepare('SELECT sessionId, level FROM agent_grants').all() as Array<{
      sessionId: string
      level: AgentGrant
    }>
  }

  setAgentGrant(sessionId: string, level: AgentGrant): void {
    this.db
      .prepare('INSERT OR REPLACE INTO agent_grants (sessionId, level, updatedAt) VALUES (?, ?, ?)')
      .run(sessionId, level, Date.now())
  }

  // Recently closed (RecentlyClosed is the only writer)
  addClosedItem(item: ClosedItem): void {
    this.db
      .prepare(
        'INSERT INTO closed_items (id, kind, sessionId, url, title, tabs, closedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        item.id,
        item.kind,
        item.sessionId,
        item.url,
        item.title,
        item.kind === 'session' ? JSON.stringify(item.tabs) : null,
        item.closedAt
      )
  }

  /** Newest first */
  listClosedItems(): ClosedItem[] {
    const rows = this.db.prepare('SELECT * FROM closed_items ORDER BY seq DESC').all() as ClosedRow[]
    return rows.map((r) => this.parseClosedItem(r))
  }

  getClosedItem(id: string): ClosedItem | null {
    const row = this.db.prepare('SELECT * FROM closed_items WHERE id = ?').get(id) as ClosedRow | undefined
    return row ? this.parseClosedItem(row) : null
  }

  deleteClosedItem(id: string): void {
    this.db.prepare('DELETE FROM closed_items WHERE id = ?').run(id)
  }

  getClosedSessionIds(): string[] {
    const rows = this.db.prepare("SELECT sessionId FROM closed_items WHERE kind = 'session'").all() as Array<{
      sessionId: string
    }>
    return rows.map((r) => r.sessionId)
  }

  private parseClosedItem(row: ClosedRow): ClosedItem {
    return {
      id: row.id,
      kind: row.kind,
      sessionId: row.sessionId,
      url: row.url ?? null,
      title: row.title ?? null,
      tabs: row.kind === 'session' ? parseClosedTabs(row.tabs ?? null) : [],
      closedAt: row.closedAt
    }
  }

  private parseSession(row: SessionRow): Session {
    return {
      id: row.id,
      partition: row.partition,
      name: row.name,
      color: row.color,
      icon: row.icon || undefined,
      env: row.env,
      urlGuards: row.urlGuards ? JSON.parse(row.urlGuards) : undefined,
      workspaceId: row.workspaceId || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }
  }

  private parseTab(row: TabRow): Tab {
    return {
      id: row.id,
      sessionId: row.sessionId,
      url: row.url,
      title: row.title || undefined,
      favicon: row.favicon || undefined,
      order: row.order,
      lastActiveAt: row.lastActiveAt
    }
  }

  close(): void {
    this.db.close()
  }
}
