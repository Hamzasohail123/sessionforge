# SessionForge

> **Your app's users, ready for your coding agent.** Log in as Admin, Customer and Guest once, watch them side by side, and let Cursor, Codex or Claude Code test every role.

[![CI](https://github.com/Hamzasohail123/sessionforge/actions/workflows/ci.yml/badge.svg)](https://github.com/Hamzasohail123/sessionforge/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Hamzasohail123/sessionforge?include_prereleases)](https://github.com/Hamzasohail123/sessionforge/releases)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

![SessionForge: an agent checks Admin and Customer side by side](./docs/release/demo.gif)

- **Every role, logged in, side by side.** Each session has its own cookies and storage; split view shows up to four at once.
- **One click from Chrome.** The extension's "Send to SessionForge" copies a real Chrome login into a new session.
- **Agent Bridge (new).** A local MCP server lets Cursor, Codex and Claude Code list sessions, open pages and send the same request as each role. Off by default, localhost only, production sessions are read-only. See [Agent Bridge](#agent-bridge-cursor-codex-and-claude-code) and [docs/agents/](./docs/agents/sessionforge.md).

SessionForge is a free, open-source, local-first desktop browser for developers and QA engineers. No account, no cloud, no telemetry.

## Features

- **🔒 Isolated Sessions** – Each session has its own cookies, storage, and cache. No cross-contamination.
- **↔️ Split View** – See Admin and Customer side by side. Watch one user's action appear for the other.
- **📥 Chrome Import** – The SessionForge Import extension sends a logged-in Chrome tab to a new session with one click.
- **🤖 Agent Bridge** – A local MCP server so Cursor, Codex, Claude Code and other MCP clients can use your sessions. Off by default.
- **⚠️ Environment Safety** – Production sessions get a red banner, and agents can't act in them without your typed confirmation.
- **🛠️ DevTools Built In** – Full Chromium DevTools for every tab.
- **🚀 Local First** – No account, no cloud, no telemetry.

## Installation

### Run from source (recommended)

Needs Node.js 20 or 22, npm and git. On macOS also run `xcode-select --install` once (for the native SQLite build); on Windows install the "Desktop development with C++" workload of Visual Studio Build Tools if `rebuild:native` asks for it. Works the same on macOS, Windows and Linux.

```bash
git clone https://github.com/Hamzasohail123/sessionforge
cd sessionforge
npm install
npm run rebuild:native
npm run electron:dev
```

### Prebuilt downloads

Get the file for your system from [GitHub Releases](https://github.com/Hamzasohail123/sessionforge/releases):

| System | File |
|---|---|
| macOS, Apple Silicon | `SessionForge-<version>-mac-arm64.dmg` |
| macOS, Intel | `SessionForge-<version>-mac-x64.dmg` |
| Windows 10/11 | `SessionForge-<version>-win-x64-setup.exe` |
| Linux (Debian, Ubuntu) | `SessionForge-<version>-linux-amd64.deb` |
| Linux (other distributions) | `SessionForge-<version>-linux-x86_64.AppImage` |

`SHA256SUMS.txt` in the release lists the checksums.

**macOS first launch.** The app is ad-hoc signed but not notarized (there is no Apple Developer account yet), so macOS blocks the first open. Drag SessionForge to Applications and open it once. Then either:
- go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to the SessionForge message (required on macOS 15 and later; also works on 13 and 14), or
- run `xattr -dr com.apple.quarantine /Applications/SessionForge.app` in Terminal.

**Windows first launch.** The installer is unsigned, so SmartScreen shows "Windows protected your PC". Click **More info → Run anyway**.

**Linux.** On Ubuntu 23.10 and later, use the .deb: `sudo apt install ./SessionForge-*-linux-amd64.deb`. Its install script sets up Chromium's sandbox helper, so the app starts with the sandbox on.

The AppImage works on distributions that allow unprivileged user namespaces: `chmod +x SessionForge-*.AppImage && ./SessionForge-*.AppImage`. On Ubuntu 23.10+ AppArmor blocks those namespaces, and the AppImage exits with "The SUID sandbox helper binary was found, but is not configured correctly". You can start it with `./SessionForge-*.AppImage --no-sandbox`, but that turns off Chromium's sandbox for every page you open, so a browser exploit on a malicious page would run with your user's full rights. Prefer the .deb, or an AppArmor profile that allows user namespaces for the AppImage.

### Chrome extension (SessionForge Import)

The extension copies the login of the current Chrome tab into a new SessionForge session. Until it is approved in the Chrome Web Store, load it unpacked:

1. Get the `chrome-extension/` folder (clone the repo, or download the source zip from the release).
2. Open `chrome://extensions/` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `chrome-extension/` folder.
4. With SessionForge running, open a logged-in tab in Chrome, click the extension, click **Agree** the first time, then **Send to SessionForge**, and allow access to the site when Chrome asks.

The extension has no access to any website at install. It reads a site's cookies and localStorage only when you click Send, after you allowed that site, and sends them only to SessionForge on `127.0.0.1:34567`.

Details and troubleshooting: [chrome-extension/README.md](./chrome-extension/README.md).

## Quick Start

1. **Create a session** – Click the `+` button, name it (e.g., "Admin"), pick a color and environment.
2. **Log in** – Navigate to your app and log in as that role.
3. **Open split view** – Pick a layout with the layout buttons at the right of the session bar.
4. **Create another session** – Repeat for "Customer" or other roles.
5. **Send a login from Chrome** – In Chrome, click the SessionForge Import extension → "Send to SessionForge". The login opens in a new session, in a pane.

## Usage

### Sessions

- **Rename**: double-click a session in the session bar (or focus it and press `F2`), type, then `Enter` saves and `Escape` cancels. Clicking elsewhere also saves; an empty name keeps the old one.
- **Color**: while renaming, click the dot and pick a color.
- **Close**: the `×` next to a session closes it after a confirmation. Its tabs close, but its logins stay on disk, and `Cmd/Ctrl+Shift+T` reopens it with its tabs.
- **Reopen**: `Cmd/Ctrl+Shift+T` also reopens tabs closed with `×` or `Cmd/Ctrl+W`, newest first. SessionForge keeps your last 10 closed sessions and your last 25 closed tabs. Closing an 11th session deletes the oldest closed session for good, including its logins; closing tabs never deletes a closed session.
- **Delete permanently** (in the close confirmation) removes the session's cookies and storage. It can't be reopened.
- A session's environment can't be changed after it is created.

### Split View

The layout buttons at the right of the session bar switch between single, columns (two side by side), rows (two stacked) and a 2×2 grid. Each pane shows one tab from any session, under a header with the session and page name. Click a pane (or press `Cmd/Ctrl+1`–`4`) to focus it; the tab bar, address bar and session bar then act on that pane. Clicking a session fills the focused pane with that session's last tab. Layout and pane contents are restored on the next start.

Context-menu "open in new tab" items, `Cmd/Ctrl+U` and `window.open()` popups open in the pane they came from, in the same session. DevTools open in a separate window.

**One Google account per Chrome profile.** When several Google accounts are signed in to one Chrome profile, every session sent to SessionForge from that profile carries all of them, and signing out in one can sign out the others; keep each Google account in its own Chrome profile before sending it.

Cookies without an expiry date (session cookies) are kept for 30 days after import, so imported logins survive a restart.

### Signing in with Google

Google blocks Google Account sign-in inside embedded browsers on purpose, and SessionForge is one ([Google's announcement](https://developers.googleblog.com/en/guidance-to-developers-affected-by-our-effort-to-block-less-secure-browsers-and-applications/), [OAuth in embedded webviews](https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/)). You see "Couldn't sign you in. This browser or app may not be secure." SessionForge does not disguise itself to get around this: its user agent and fingerprint stay as they are.

Instead, when a pane reaches a Google sign-in page, a banner at the top of that pane offers **Sign in with Chrome**:

1. Click **Sign in with Chrome**. Your browser opens the right Google sign-in page (or the site's login page for "Sign in with Google" on another site).
2. Sign in there as usual.
3. Click the SessionForge Import extension and choose **Send to <session> (SessionForge asked for this)**.

That's two clicks after signing in. The login goes into the session that asked for it (no new session), and the waiting pane continues where it left off. From the keyboard: press `Cmd/Ctrl+L`, then `Tab` until the banner's button is focused, and `Enter`. This works for Google services such as Gmail and YouTube, and for "Sign in with Google" / "Continue with Google" on other sites; in that case you sign in to that site, not to Google, in that session. For your own app the site must use https, except on localhost (`http://localhost:3000` works; LAN addresses over plain http don't).

Requirements: the [SessionForge Import extension](#chrome-extension-sessionforge-import) version 1.2.0 or later in the browser that opens (SessionForge tries Chrome, then Chromium, Edge and Brave, else your default browser), and SessionForge's import server on its default port 34567 (not changed with `SESSIONFORGE_IMPORT_PORT`). A request is valid for 10 minutes and works once. Keep [one Google account per Chrome profile](#split-view), as above.

Unverified: Chrome can bind Google sessions to the device ([Device Bound Session Credentials](https://developer.chrome.com/docs/web-platform/device-bound-session-credentials)). If your Google session is bound this way, the copy in SessionForge may sign out after a while; sign in with Chrome again if it does.

### Environment Safety

Sessions tagged `production` show a red banner. AI agents get read-only access to them unless you confirm by typing the session name (Settings → Agent Bridge). The environment can't be changed after a session is created, so a production session can't lose this protection. Renaming keeps it, and a closed production session comes back read-only for agents until you confirm again.

## Agent Bridge (Cursor, Codex and Claude Code)

The Agent Bridge lets AI coding agents in Cursor, Codex (CLI and VS Code extension), Claude Code and other MCP clients use your logged-in SessionForge sessions. An agent can list your sessions, open pages in panes, read a compact page outline with element refs, click and type with real input events, read console and network logs, take screenshots, change the split layout, and send one HTTP request as several roles to compare what each gets. It is an MCP server inside SessionForge at `http://127.0.0.1:34568/mcp` (set `SESSIONFORGE_MCP_PORT` to change the port). Instructions for agents: [docs/agents/sessionforge.md](docs/agents/sessionforge.md).

<!-- Demo picture: added with the M5 demo app. -->

### Setup

1. In SessionForge, open Settings (gear icon or `Cmd/Ctrl+,`) → Agent Bridge and turn on **Enable Agent Bridge**.
2. Click **Copy export line** and add it to `~/.bashrc` or `~/.zshrc`:
   ```sh
   export SESSIONFORGE_TOKEN='sfa_…'
   ```
3. Add the server to your editor (the panel shows the same snippets with your real port and path):

   **Cursor**: `.cursor/mcp.json` in a project, or `~/.cursor/mcp.json` for all projects:
   ```json
   {
     "mcpServers": {
       "sessionforge": {
         "url": "http://127.0.0.1:34568/mcp",
         "headers": {
           "Authorization": "Bearer ${env:SESSIONFORGE_TOKEN}"
         }
       }
     }
   }
   ```

   **Codex** (CLI, VS Code extension and app share it): `~/.codex/config.toml`:
   ```toml
   [mcp_servers.sessionforge]
   url = "http://127.0.0.1:34568/mcp"
   bearer_token_env_var = "SESSIONFORGE_TOKEN"
   ```

   **Claude Code**: run once in a terminal. Keep the single quotes: they store `${SESSIONFORGE_TOKEN}` literally, and Claude Code fills it in from your environment when it connects, so the token never lands in `~/.claude.json`.
   ```sh
   claude mcp add --transport http --scope user sessionforge http://127.0.0.1:34568/mcp --header 'Authorization: Bearer ${SESSIONFORGE_TOKEN}'
   ```
4. Restart the editor from a shell that has `SESSIONFORGE_TOKEN` (or log out and in, since desktop-launched editors read the login environment). Start Claude Code from such a shell too.
5. Check that the tools are listed: Cursor → Settings → MCP; Codex → `codex mcp list`, or `/mcp` in the chat; Claude Code → `claude mcp list` (should say "✔ Connected"), or `/mcp` in a session.
6. Optional: give your agent the rules in [docs/agents/sessionforge.md](docs/agents/sessionforge.md) (a Cursor rule, and a section for `AGENTS.md` or Claude Code's `CLAUDE.md`).
### Approvals in your editor
Each editor decides on its own whether to ask before it runs an MCP tool. Settings (`Cmd/Ctrl+,`) → Agent Bridge → Editors → **Approvals** offers three presets per editor: **Ask every time**, **Auto-run read-only tools** (recommended: `list_sessions`, `snapshot`, `wait_for`, `screenshot`, `console_logs`, `network_log`, `get_layout`, taken from the tools' `readOnlyHint` annotations) and **Auto-run all SessionForge tools** (for sessions you deliberately set to Control). Each preset shows the exact text to paste, and **Apply** edits the file for you after showing a preview: it makes a `<file>.bak-YYYYMMDD-HHmmss` backup, changes only SessionForge entries, keeps comments, and never writes the token. SessionForge's own limits (Hidden/Read/Control, read-only production sessions, Stop) apply whatever you choose.
- **Cursor**: `~/.cursor/permissions.json`, `mcpAllowlist` entries `sessionforge:<tool>` or `sessionforge:*`. Once this key exists, Cursor uses it *instead of* the MCP allowlist in Cursor Settings, so tools you allowed there for other servers (Figma, Notion and so on) ask again until you add them to the file. The allowlist only applies in Run Mode **Allowlist** or **Auto-review** (Cursor Settings → Agents → Approvals & Execution).
- **Claude Code**: `~/.claude/settings.json`, `permissions.allow` entries `mcp__sessionforge__<tool>` or `mcp__sessionforge__*` (no parentheses: Claude Code skips `mcp__…(…)` rules). Claude Code reloads the file by itself. An `ask` or `deny` rule that matches SessionForge (for example `mcp__*`) wins over `allow`; the panel then shows **Custom**.
- **Codex** (CLI, IDE extension, app): `default_tools_approval_mode` in your `[mcp_servers.sessionforge]` table of `~/.codex/config.toml`: `"prompt"` asks every time, `"approve"` never asks, and no key is the Codex default (read-only tools run, others ask). Restart Codex afterwards. A top-level `approval_policy = "never"` makes Codex refuse tools that would need approval, and per-tool `[mcp_servers.sessionforge.tools.<tool>]` `approval_mode` entries win over the server default (Apply refuses to edit those; edit them by hand).

### stdio alternative

Some setups prefer a command over a URL. `bin/sessionforge-mcp.mjs` is a dependency-free bridge (Node 18 or later) that forwards to the running app; its path is shown in the panel (packaged builds keep it in `resources/bin/`).

```json
{
  "mcpServers": {
    "sessionforge": {
      "type": "stdio",
      "command": "node",
      "args": [
        "<path>/sessionforge-mcp.mjs"
      ],
      "env": {
        "SESSIONFORGE_TOKEN": "${env:SESSIONFORGE_TOKEN}"
      }
    }
  }
}
```

```toml
[mcp_servers.sessionforge]
command = "node"
args = ["<path>/sessionforge-mcp.mjs"]
env_vars = ["SESSIONFORGE_TOKEN"]
```

Claude Code (remove an HTTP entry first with `claude mcp remove sessionforge`; the name must come before `--env`):
```sh
claude mcp add sessionforge --transport stdio --scope user --env 'SESSIONFORGE_TOKEN=${SESSIONFORGE_TOKEN}' -- node '<path>/sessionforge-mcp.mjs'
```

Without Node installed, run the bridge with the SessionForge executable itself: use the executable as `command` and add `ELECTRON_RUN_AS_NODE=1` to the server's environment. This relies on Electron's `RunAsNode` fuse, which electron-builder leaves enabled by default.

### Security

- Off by default. Nothing listens until you turn it on.
- Listens on 127.0.0.1 only, accepts only `127.0.0.1`/`localhost` `Host` headers, and refuses every request that carries an `Origin` header, so web pages cannot reach it.
- Every request needs a 256-bit bearer token, stored encrypted with the OS keyring (rotate it in the panel; old clients get 401).
- Per-session access: Hidden, Read or Control. New sessions start at Read. Hidden sessions are not listed and cannot be addressed.
- Production sessions are read-only for agents unless you type the session name to confirm; that lasts until SessionForge restarts.
- The session's URL guards apply to agent navigation, requests, redirects and popups. Agents can never call SessionForge's own import or MCP server.
- A "🤖 Agent" badge and a **Stop** button appear in the header of the pane an agent is using; Stop sets the session back to Read and ends the running call. An activity log in the panel lists every call.
- Cookie, Set-Cookie, Authorization and other secret headers, query parameters and JSON keys are redacted in results and the log; page content is wrapped and labelled as untrusted; calls are rate limited. There is no eval, CDP, file or shell tool.

### Troubleshooting

- **Port in use**: another SessionForge (or app) has port 34568. Quit it, or set `SESSIONFORGE_MCP_PORT`, then toggle the bridge off and on.
- **401 after rotating the token**: copy the new export line, update your shell profile and restart the editor.
- **"SessionForge is not running, or the Agent Bridge is turned off"** from the stdio bridge: start SessionForge and enable Settings → Agent Bridge.
- **`ui_busy`**: Settings, a dialog or a notification covers the panes; input tools pause until it closes. Read tools keep working.

## Keyboard Shortcuts

Shortcuts work both in the SessionForge toolbar and inside pages, and act on the focused pane. `Cmd` on macOS, `Ctrl` elsewhere; `Ctrl+Tab` is `Ctrl` on every OS. A combination with extra modifiers (for example `Ctrl+Shift+K`) goes to the page.

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+K` | Command palette |
| `Cmd/Ctrl+,` | Open Settings |
| `Cmd/Ctrl+T` | New tab |
| `Cmd/Ctrl+W` | Close tab |
| `Cmd/Ctrl+Shift+T` | Reopen closed tab or session |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Cmd/Ctrl+1`–`4` | Focus pane 1–4 |
| `Cmd/Ctrl+L` | Focus address bar |
| `Cmd/Ctrl+R`, `F5` | Reload |
| `Cmd/Ctrl+Shift+R`, `Shift+F5` | Hard reload (ignore cache) |
| `Alt+Left` / `Alt+Right` | Back / forward |
| `Escape` | Stop loading (while a page loads; otherwise the page gets it) |
| `F12`, `Cmd/Ctrl+Shift+I` | Toggle DevTools |
| `Cmd/Ctrl+Shift+J` | DevTools console |
| `Cmd/Ctrl+Shift+C` | Inspect element |
| `Cmd/Ctrl+U` | View page source |

The SessionForge window's own DevTools are in the menu (press `Alt`, then View → Toggle Developer Tools).

## Development

```bash
# Clone the repo
git clone https://github.com/Hamzasohail123/sessionforge.git
cd sessionforge

# Install dependencies and build the native SQLite module for Electron
npm install
npm run rebuild:native

# Run in development mode
npm run electron:dev

# Build an installer for the current OS (output in release/)
npm run package
```

See [DEVELOPMENT.md](./DEVELOPMENT.md) for prerequisites and platform notes.

### Tests

```bash
npm run test:e2e
```

This builds the app and runs the Playwright suite: unit specs (`e2e/unit/`) and Electron end-to-end specs (`e2e/*.spec.ts`). The e2e specs open real windows on your display, use a temporary profile and import port, and load pages only from a local test server; the `example.com` and Google checks are skipped when offline. Screenshots go to `test-artifacts/screenshots/`. Run the unit specs alone with `npx playwright test --project=unit`.

The Google sign-in specs never contact Google. Two test-only variables, read only when `SESSIONFORGE_E2E=1`, stand in for it: `SESSIONFORGE_TEST_GOOGLE_ORIGIN` (`http://127.0.0.1:<port>` or `http://localhost:<port>`) is matched like `https://accounts.google.com`, and `SESSIONFORGE_TEST_BROWSER_LOG` (an absolute path) receives the URL "Sign in with Chrome" would open instead of starting a browser. Outside e2e runs both are ignored, and production matching stays exactly `https://accounts.google.com`.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## Architecture

SessionForge is built with:

- **Electron** – Desktop framework with full Chromium
- **React + TypeScript** – UI layer
- **SQLite** – Local metadata storage (WAL mode)
- **Chromium Partitions** – Isolated storage per session

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## Known limitations

- **Google sign-in inside SessionForge is blocked by Google.** Use **Sign in with Chrome** in the banner (two clicks with the extension, see [Signing in with Google](#signing-in-with-google)). Logins kept in localStorage or IndexedDB are not carried by that hand-off; some Google sessions may be bound to the device in Chrome and could sign out after import (unverified).
- **The macOS build is not notarized.** It is ad-hoc signed only (no Apple Developer account yet), so the first launch needs the steps in [Installation](#prebuilt-downloads). The Windows installer is unsigned (SmartScreen → More info → Run anyway). Running from source avoids both.
- **Agent Bridge is new.** This is the first release of the MCP server. It has no arbitrary JavaScript, file uploads, downloads or cross-origin iframe support, and it is off by default.
- **Most testing so far has been on Linux.** CI runs the end-to-end suite on Linux and macOS. On Windows it runs only the typecheck and unit specs, so expect rough edges there.
- The Chrome extension may still be in Web Store review; until then, use "Load unpacked".

## Roadmap

Next up, in order (details in [ROADMAP.md](./ROADMAP.md)):

- **M2 Network log and request rules**: a network drawer per session, header/block/redirect rules, Copy as cURL.
- **M3 "Send as…" panel**: send one request as several sessions and compare the answers.
- **M4 Device emulation per pane**: device presets and throttling, also as an agent tool.
- **M5 Launch kit**: signed and notarized builds once there is traction.

## Support

- **Bugs**: [Open an issue](https://github.com/Hamzasohail123/sessionforge/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Hamzasohail123/sessionforge/discussions)
- **Security**: See [SECURITY.md](./SECURITY.md)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for:
- How to set up your dev environment
- Code style and commit conventions
- How to run tests
- PR review process

## License

Apache-2.0. See [LICENSE](./LICENSE).

> **Promise:** Every feature of the SessionForge desktop app is and will stay open source under Apache-2.0. There is no paid "pro" version of the local app.

---

**Made for developers and QA engineers who need to test as multiple users.**

If you find SessionForge useful, please ⭐ star the repo and share it with your team.
