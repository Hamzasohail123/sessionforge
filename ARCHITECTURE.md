# SessionForge Architecture

This document explains how SessionForge is built and how its isolation works.

## Overview

SessionForge is an Electron desktop application with three main processes:

```
┌────────────────────────────────────────┐
│  Main Process (Node.js, trusted)       │
│  - SessionManager                      │
│  - WindowManager                       │
│  - DatabaseManager                     │
│  - IPC handlers                        │
└──────────────┬─────────────────────────┘
               │ IPC (typed, validated)
┌──────────────▼─────────────────────────┐
│  Preload Script (contextBridge)        │
│  - Exposes safe API to renderer        │
└──────────────┬─────────────────────────┘
               │
┌──────────────▼─────────────────────────┐
│  Renderer Process (React UI, trusted)  │
│  - Session bar, tabs, command palette  │
└────────────────────────────────────────┘

  Multiple Web Content Processes (sandboxed, untrusted)
  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │ WebContents  │ │ WebContents  │ │ WebContents  │
  │ Session A    │ │ Session B    │ │ Session C    │
  │ Tab 1        │ │ Tab 1        │ │ Tab 1        │
  └──────────────┘ └──────────────┘ └──────────────┘
```

## Key Components

### 1. SessionManager (Main Process)

Manages session lifecycle and isolation.

**Responsibilities:**
- Create/update/delete sessions
- Initialize Chromium partitions
- Export/import Playwright storage
- Enforce environment safety rules

**Isolation mechanism:**

Each session gets a unique persistent Chromium partition:

```typescript
const partition = `persist:sf-${uuid()}`  // e.g., persist:sf-a1b2c3d4
const electronSession = session.fromPartition(partition)
```

Chromium's `session.fromPartition()` creates a completely isolated storage:

- Separate cookie jar
- Separate localStorage / sessionStorage
- Separate IndexedDB databases
- Separate cache
- Separate service workers
- Separate permissions

Partitions are **immutable**. Renaming a session never changes its partition UUID.

### 2. WindowManager (Main Process)

Manages tabs and WebContentsView instances.

**Responsibilities:**
- Create/close tabs
- Handle navigation
- Enforce session inheritance for popups
- Manage DevTools

**Critical: Popup Inheritance**

All `window.open()`, `target="_blank"`, and OAuth popups must open in the same session as the parent:

```typescript
view.webContents.setWindowOpenHandler((details) => {
  // Create new tab in SAME session
  this.createTab(sessionId, details.url, window)
  return { action: 'deny' }  // Prevent default new window
})
```

This is **P0 critical**. If popups leak to the wrong session, isolation breaks.

### 3. DatabaseManager (Main Process)

SQLite database for metadata (not web content).

**Schema:**

- `sessions`: id, partition, name, color, env, timestamps
- `tabs`: id, sessionId, url, title, order, lastActiveAt
- `layouts`: window split configuration
- `closed_items`: the recently closed stack for `Cmd/Ctrl+Shift+T` (closed tabs, and closed sessions with their tab URLs). A session with a `session` row is closed: SessionManager hides it everywhere, and its partition stays on disk until it is reopened, deleted permanently, or evicted because more than 10 sessions are closed. Tab entries have their own cap of 25 and never evict a session. `RecentlyClosed` (`recently-closed.ts`) is the only writer; the rules are pure in `closed-stack.ts`.

**WAL mode** for crash safety.

### 4. IPC Layer (Preload + Main)

Typed, validated communication between renderer and main.

**Security rules:**

- All IPC messages validated with Zod schemas
- No direct Node.js access from renderer
- No IPC access from web content
- Web content runs fully sandboxed

**Example:**

```typescript
// Preload (safe bridge)
contextBridge.exposeInMainWorld('api', {
  session: {
    create: (input) => ipcRenderer.invoke('session:create', input)
  }
})

// Main (validation)
ipcMain.handle('session:create', async (_, input: unknown) => {
  const validated = CreateSessionSchema.parse(input)  // Zod
  return sessionManager.createSession(validated)
})
```

### 5. Renderer (React UI)

Standard React app with:

- **Zustand** for UI state
- **TanStack Query** for async data
- **React Hook Form** for forms
- **Tailwind + shadcn/ui** for styling

The renderer is **trusted** but has no Node.js access. It communicates with main process via IPC.

### 6. Web Content (Sandboxed)

Each tab runs in a separate Chromium process with:

```typescript
{
  session: electronSession,       // Isolated partition
  sandbox: true,                  // Full sandbox
  contextIsolation: true,         // No shared context
  nodeIntegration: false,         // No Node.js
  webSecurity: true,              // CORS, CSP enforced
}
```

Web content has **zero access** to:

- Node.js APIs
- IPC
- File system
- Other sessions' data

## Data Flow Examples

### Creating a Session

```
User clicks "Create Session"
  → Renderer: CreateSessionDialog opens
  → User fills form, clicks Create
  → Renderer: window.api.session.create(input)
  → Preload: ipcRenderer.invoke('session:create', input)
  → Main: IPC handler validates with Zod
  → Main: SessionManager.createSession()
    → Generate UUID
    → Create partition: session.fromPartition(persist:sf-UUID)
    → Save to database
  → Main: Return session object
  → Renderer: TanStack Query refetches, UI updates
```

### Opening a Popup (OAuth Flow)

```
User clicks "Sign in with Google" in Session A
  → Web content calls window.open()
  → Chromium triggers setWindowOpenHandler
  → Main: WindowManager intercepts
    → Extract parent tab's sessionId (A)
    → Create new tab in Session A
    → Load popup URL in Session A's partition
  → Google OAuth completes
  → Cookies saved to Session A's partition only
```

### Importing from Chrome (extension)

```
User clicks "Send to SessionForge" in the Chrome extension popup
  → Extension reads the tab's cookies (chrome.cookies) and localStorage (chrome.scripting)
  → Extension: POST http://127.0.0.1:34567/import with a Playwright storageState payload
  → Main: ImportServer accepts no Origin or a chrome-extension:// Origin only (web pages get 403),
    caps the body at 5 MB, validates it with zod
  → Main: SessionManager.importFromPlaywright() creates a new session and sets the cookies
  → Main: WindowManager opens the page in a pane, seeding localStorage before the page loads
  → Renderer: the new session appears in the session bar
```

### Agent Bridge (MCP)

```
Cursor / Codex → http://127.0.0.1:34568/mcp (Bearer token), or node <path>/sessionforge-mcp.mjs (stdio → same server; path shown in Settings → Agent Bridge)
  → Main: http-guard rejects a wrong Host, any Origin header, or a bad token
  → Main: policy checks the session's grant (hidden / read / control; production capped at read),
    the URL guards and the rate limit
  → Main: the tool runs against WindowManager / SessionManager (snapshot, click, send_request_as, ...)
  → Result: secrets redacted, page text labelled as untrusted, call recorded in the activity log
```

Off by default; turned on in Settings → Agent Bridge. Code in `src/main/agent/`.

### Exporting for Playwright

```
No UI button yet; the main-process API exists (playwright:export IPC)
  → Renderer: window.api.playwright.export(sessionId)
  → Main: SessionManager.exportToPlaywright()
    → Get Electron session from partition
    → Read all cookies: electronSession.cookies.get({})
    → Format as Playwright storageState JSON
    → Show save dialog
    → Write file
  → Main: Return success
```

## Security Model

### Threat Model

**What we protect against:**

- Cross-session data leaks
- Accidental token exposure in version control
- Mixing production and staging credentials
- Web content accessing Node.js or file system

**What we don't protect against:**

- OS-level malware with user privileges (can read any file the user can read)
- Physical access to unlocked machine
- Supply chain attacks on dependencies (CI checks dependency licenses; there is no automated vulnerability scanning yet, run `npm audit` by hand)

### Defense Layers

1. **Sandboxing**: All web content runs fully sandboxed
2. **Context Isolation**: Renderer and web content never share context
3. **IPC Validation**: All messages validated with Zod schemas
4. **CSP**: UI renderer has a Content Security Policy (`src/renderer/index.html`)
5. **Local servers**: the import server and the Agent Bridge bind `127.0.0.1` only and refuse requests from web pages
6. **Redaction**: Agent Bridge output masks cookies, auth headers and token-like keys (`src/main/agent/redact.ts`)

Not yet done: Electron fuses, and redaction of general app logs.

### Isolation Verification

Every PR that touches sessions, partitions, or window handling must pass the isolation specs:

```bash
npm run electron:build && npx playwright test e2e/isolation.spec.ts
```

The suite:

1. Creates two sessions (A and B)
2. Writes cookies, localStorage, sessionStorage and IndexedDB in session A and checks that B sees none of it
3. Opens a popup from A and checks it opens in session A, in the opener's pane
4. Relaunches the app and checks A kept its data while B stayed empty

## Performance Considerations

### Lazy Tab Restore

On app start, only active tabs load. Others load on first focus.

### Memory Per Session

Each session partition uses ~50–100 MB of RAM (baseline Chromium overhead). With 10 sessions and 3 tabs each:

- Expected: ~1.5 GB
- Acceptable: < 2 GB on 16 GB RAM

Tab suspension (P1) will reduce this further.

### Database Writes

Tab URL and title changes are written to SQLite as they happen (no debounce). Writes are small, and the database runs in WAL mode.

## Build and Release

```bash
# Development
npm run electron:dev        # Hot reload

# Production build
npm run package             # Current OS
npm run package:mac         # macOS only
npm run package:win         # Windows only
npm run package:linux       # Linux only
```

Outputs (in `release/`):

- **macOS**: `.dmg` per arch (arm64, x64), ad-hoc signed by `build/macos-adhoc-sign.cjs`, not notarized
- **Windows**: NSIS `.exe` installer, unsigned
- **Linux**: `.AppImage`, `.deb`

A `v*` tag runs `.github/workflows/release.yml`, which builds every target and attaches the files to a draft
GitHub Release. There is no auto-update yet: users download new versions from Releases.

## Future Architecture

### P1: Workspaces

Workspaces will group sessions:

```
workspace:acme-staging
  ├── session:admin
  ├── session:customer
  └── session:support
```

Workspaces stored in same SQLite DB, new `workspaces` table with `sessions.workspaceId` foreign key.

### Next: network hub, "Send as…", device emulation

The local automation API shipped as the Agent Bridge (above). The next milestones (see
[ROADMAP.md](./ROADMAP.md)) build on `src/main/web-request-hub.ts` for a per-session network log and
request rules, add a "Send as…" panel over the `send_request_as` engine, and add per-pane device emulation.

## Questions?

- **Implementation details**: Read the source in `src/main/`
- **Contributing**: See [CONTRIBUTING.md](./CONTRIBUTING.md)
- **Security concerns**: See [SECURITY.md](./SECURITY.md)
