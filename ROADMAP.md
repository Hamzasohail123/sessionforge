# SessionForge Roadmap

SessionForge makes the logged-in session the unit for every dev tool: each session holds a real user's
cookies and storage, and features that reuse that identity (an agent acting as that user, a request sent
as that user, a device emulated for that user) are things standalone tools can't do well.

The main users of the agent features are developers working in **Cursor**, the **Codex extension in
VS Code** and **Claude Code**. SessionForge has no AI of its own: it is the browser your coding agent uses. Everything stays local-first: no account, no cloud sync, no telemetry (see [PRIVACY.md](./PRIVACY.md)).

This roadmap is a plan, not a promise. Feedback in issues and discussions changes the order.

## Status

| Milestone | Scope | Status |
|---|---|---|
| M0 Core browser | Isolated sessions (one Chromium partition each), split view (1, 2 or 4 panes), Chrome user agent, Chrome extension "Send to SessionForge" import into a pane, keyboard shortcuts, isolation e2e tests | Done |
| **M1 Agent Bridge MVP** | Local MCP server for Cursor, Codex and Claude Code (Streamable HTTP at `127.0.0.1:34568/mcp` plus a stdio bridge), v1 tools, security model, Settings → Agent Bridge panel, agent indicator and Stop button, activity log, agent instructions file | Ships with v0.1.0 |
| M2 Network log + request rules | Shared webRequest hub, network drawer per session, header/block/redirect rules, Copy as cURL; the `network_log` tool reads from the hub | Next |
| M3 "Send as…" panel | UI for sending one request as several sessions, on top of the M1 `send_request_as` engine | Planned |
| M4 Device emulation per pane | Per-pane device and throttling, also exposed as an MCP `set_device` tool | Planned |
| M5 Launch kit | Demo video, README with the demo first, install guides for Cursor, Codex and Claude Code, GitHub release builds | Started with v0.1.0; signing and notarization once there is traction |

### M1 Agent Bridge (v0.1.0)

Done when an MCP client lists sessions, opens pages, snapshots, clicks, reads console and network, and runs
`send_request_as` against the local test server, and the security tests pass: requests with an `Origin`
header are rejected, a wrong token is rejected, a production session refuses `click`, and a hidden session
is invisible.

Tools in v1: `list_sessions`, `open`, `navigate`, `back`, `reload`, `snapshot`, `click`, `type`, `select`,
`press`, `wait_for`, `screenshot`, `console_logs`, `network_log`, `send_request_as`, `get_layout`, `set_layout`.

Security model in v1: off by default; listens on `127.0.0.1` only; bearer token; per-session grants
(`hidden`, `read`, `control`) with production sessions capped at `read` unless confirmed by typing the
session name (until restart); URL guards; secrets redacted in network output; page text labelled as
untrusted; no filesystem or shell tools; rate limits.

Not in v1: arbitrary JavaScript evaluation, file uploads, downloads, CDP, cross-origin iframes.

### M2 Network log + request rules

- One `webRequest` hub per session, so features don't overwrite each other's listeners.
- Network drawer for the focused pane: method, URL, status, timing, redacted headers.
- Rules per session: add or override headers, block, redirect.
- Copy as cURL.
- Per-session allowed sites for agent actions: an agent acting as a session can only open or send
  requests to the origins you list for it (Settings → Agent Bridge → Access).

### M3 "Send as…" panel

- Paste a request (or cURL), pick sessions, send; see status, headers and body per session with a short diff.
- Requests can be saved as plain `.http` files later; no collections, workspaces or sync.

### M4 Device emulation per pane

- Device presets (viewport, DPR, touch, user agent) per pane, plus network throttling per session.
- MCP `set_device` tool.

### M5 Launch kit

- v0.1.0: run-from-source as the main install path; GitHub Releases with macOS DMGs (arm64 and x64,
  ad-hoc signed, not notarized), an unsigned Windows installer, and Linux AppImage and .deb; the Chrome
  extension on the Chrome Web Store; a 45-second demo.
- Later, once there is traction: Apple Developer ID signing and notarization, Windows code signing,
  and a sample app under `examples/rbac-demo` for the demo.

## Later (evaluating)

- "Ask your agent": a button that copies the error, URL and session (secrets removed) as a ready prompt
  for Cursor, Codex or Claude Code.
- Export as Playwright test: turn what you or your agent did in a pane into a spec, with a storageState
  per session.
- Only if users ask for it: a text-only "Explain this error" button using your own API key or a local
  model. It would have no tools, so it can't click or send requests.
- Capture a bug bundle: screenshots of all panes, console and network, with secrets redacted.
- Playwright codegen launched inside a logged-in session.
- Mailpit inbox panel for magic links and OTP codes.
- Per-session debugging proxy; locale, timezone and dark-mode overrides.
- Encrypted session export between your own machines; session lock with OS authentication.
- Workspaces and session templates (Admin + Customer + Guest in one step).

## Not building

- A full Postman: no workspaces, cloud collections, hosted mocks, API docs or monitors.
- Our own test recorder (use Playwright codegen).
- Cloud sync of cookies or tokens, or team features that need accounts.
- Fingerprint spoofing, anti-detection, CAPTCHA solving, proxy marketplaces.
- Syncing clicks or typing across panes of different roles.
- Telemetry.
- A built-in chat agent that acts in your sessions. Your own coding agent already does this through the
  Agent Bridge, and an in-app agent next to real logins and untrusted pages is a prompt-injection risk.
  We'll revisit only if many users ask and the allowed-sites list has shipped.

## How to influence the roadmap

- React with 👍 on the issues you want.
- Describe your workflow in Discussions.
- Pull requests for roadmap items are welcome; open an issue first for anything large.
