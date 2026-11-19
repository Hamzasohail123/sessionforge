# SessionForge Development Guide

How to run, test and package SessionForge from source. For contribution rules (branches, commits,
reviews) see [CONTRIBUTING.md](./CONTRIBUTING.md); for the design see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Requirements

- Node.js 20 or 22 and npm. CI uses Node 22.
- git.
- A C/C++ toolchain for the native SQLite module, in case no prebuilt binary matches:
  - macOS: `xcode-select --install`
  - Windows: Visual Studio Build Tools with the "Desktop development with C++" workload
  - Linux: `build-essential` and `python3`

## Run from source

```bash
git clone https://github.com/Hamzasohail123/sessionforge && cd sessionforge
npm install
npm run rebuild:native   # builds better-sqlite3 for Electron's Node ABI
npm run electron:dev     # dev mode with hot reload
```

`npm run electron:dev` runs `tools/dev.mjs`, which starts `electron-vite dev` and sets
`ELECTRON_DISABLE_SANDBOX=1` on Linux only (the Chromium sandbox helper in `node_modules` isn't
setuid root on most machines). macOS and Windows keep the sandbox.

Renderer changes hot reload. Changes in `src/main` or `src/preload` need a restart (Ctrl+C, run again).

If `npm install` or a later `npm ci` replaced the native module, the app fails at start with a
`NODE_MODULE_VERSION` error from better-sqlite3. Run `npm run rebuild:native` again.

## Commands

| Command | What it does |
|---|---|
| `npm run electron:dev` | Dev mode (Vite on port 5173 plus Electron) |
| `npm run typecheck` | `tsc --noEmit` for the app and for `e2e/` |
| `npx playwright test --project=unit` | Unit specs in `e2e/unit/` (plain Node, a few seconds) |
| `npm run test:e2e` | `electron-vite build`, then the whole Playwright suite (unit + Electron e2e) |
| `npm run lint` | ESLint with `--max-warnings 0`; CI fails on any lint error or warning |
| `npm run electron:build` | Build main, preload and renderer into `dist-electron/` |
| `npm run package` | Build and package for the current OS into `release/` |
| `npm run package:mac` / `package:win` / `package:linux` | Package for one OS; add `-- --arm64` or `-- --x64` to pick the arch |

## Tests

The e2e specs launch the built app with Playwright's `_electron`, one window at a time. Each run uses a
temporary profile, a free import port and a free MCP port, so it doesn't touch your real sessions or a
running SessionForge. Pages come from a local test server; the `example.com` and Google checks skip when
offline. Screenshots go to `test-artifacts/screenshots/`.

On Linux without a display, wrap the run: `xvfb-run --auto-servernum npm run test:e2e`.

If you change sessions, partitions, popups or window handling, run the isolation specs
(`npx playwright test e2e/isolation.spec.ts` after `npm run electron:build`) and check by hand:

1. Create sessions A and B and open the same site in both.
2. In A's DevTools console: `localStorage.setItem('probe', 'A')`; in B, `localStorage.getItem('probe')` must be `null`.
3. Repeat for a cookie (`document.cookie = 'probe=A'`) and IndexedDB.
4. Open a popup from A (`window.open(location.href)`): it must open in A, in the same pane.

## Project layout

```
src/
├── main/                    Electron main process (Node.js, trusted)
│   ├── index.ts             App start, main window, lifecycle
│   ├── session-manager.ts   Session CRUD, one persist:sf-<id> partition per session, Playwright import/export
│   ├── window-manager.ts    Tabs as WebContentsViews, panes, popups, DevTools
│   ├── layout.ts            Split-view layout state (single, columns, rows, grid)
│   ├── database.ts          SQLite (better-sqlite3) for sessions, tabs and layout
│   ├── ipc.ts               IPC handlers, inputs validated with zod
│   ├── import-server.ts     HTTP import endpoint for the Chrome extension (127.0.0.1:34567)
│   ├── import-payload.ts    Import payload schema and helpers (pure, unit tested)
│   ├── shortcuts.ts         Keyboard shortcuts for pages and the shell
│   ├── context-menu.ts      Page context menu
│   ├── user-agent.ts        Chrome user agent for every session
│   ├── web-request-hub.ts   Shared webRequest listeners per session
│   └── agent/               Agent Bridge: MCP server (127.0.0.1:34568), tools, grants, redaction
├── preload/index.ts         contextBridge API (window.api)
└── renderer/                React UI (session bar, tab bar, address bar, split view, settings)
bin/sessionforge-mcp.mjs     stdio MCP bridge for agents that can't use HTTP
chrome-extension/            "Send to SessionForge" Chrome extension
e2e/                         Playwright unit (e2e/unit) and Electron e2e specs
tools/dev.mjs                Cross-platform dev launcher
build/                       electron-builder resources (app icon, macOS ad-hoc signing hook)
```

## Where data lives

The app name is `sessionforge`, so the profile folder is:

- Linux: `~/.config/sessionforge/`
- macOS: `~/Library/Application Support/sessionforge/`
- Windows: `%APPDATA%\sessionforge\`

It holds `sessionforge.db` (session, tab and layout metadata), `Partitions/` (each session's cookies and
storage) and `agent-bridge/` (the encrypted Agent Bridge token). Quit the app before deleting anything there.

## Ports and environment variables

| Variable | Default | Used for |
|---|---|---|
| `SESSIONFORGE_IMPORT_PORT` | `34567` | Chrome extension import server (`POST /import`). The extension has `34567` hard-coded in `chrome-extension/popup.js`; change both if you change it. |
| `SESSIONFORGE_MCP_PORT` | `34568` | Agent Bridge MCP server (`/mcp`), when enabled in Settings |

Both servers bind `127.0.0.1` only. If a port is taken, the app logs it and that feature stays off.

## Packaging and releases

Packaging uses electron-builder (`electron-builder.yml`, output in `release/`). Builds are not signed with
paid certificates:

- macOS: DMG per arch, ad-hoc signed by `build/macos-adhoc-sign.cjs`, not notarized.
- Windows: NSIS installer, unsigned.
- Linux: AppImage and .deb.

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds all four targets
(mac arm64, mac x64, Windows x64, Linux x64) and attaches them to a **draft** GitHub Release. A maintainer
checks the draft and publishes it. See [docs/release/LAUNCH_CHECKLIST.md](./docs/release/LAUNCH_CHECKLIST.md).

## Common problems

- **`NODE_MODULE_VERSION` mismatch from better-sqlite3**: run `npm run rebuild:native`.
- **Linux: "The SUID sandbox helper binary was found, but is not configured correctly"**: start with
  `npm run electron:dev` (which disables the sandbox on Linux) rather than calling `electron` directly.
- **Port 5173 in use**: another `electron:dev` is running. Stop it first.
- **Extension says SessionForge is not running**: the app must be running and port 34567 free; the app
  logs `[import] listening on http://127.0.0.1:34567/import` at start.
