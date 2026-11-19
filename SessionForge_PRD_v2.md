# SessionForge — Product Requirements Document (v2)

**Status:** MVP Definition (revised after market review)
**Product type:** Open-source desktop developer tool
**Platforms:** Linux, macOS, Windows
**Stack:** Electron + Chromium + React + TypeScript
**License:** Apache-2.0 (see §20)
**Repository:** github.com/<org>/sessionforge (TBD)

---

## 0. What changed from v1

| Area | v1 | v2 |
|---|---|---|
| Positioning | "Developer browser for multiple identities" | "Open-source multi-session browser for QA and devs, with Playwright built in" |
| MVP wedge | Isolated sessions only (already exists in paid tools) | Isolated sessions **+ split view + Playwright export + environment safety** |
| Competition | Generic "profiles and extensions" | Named competitors and a clear gap (§3) |
| Validation | Assumed | User interviews and kill criteria before heavy build (§2.3) |
| Extensions | Out of scope | Load unpacked dev extensions in MVP (React/Vue DevTools) |
| Technical risks | Electron isolation | Google OAuth blocking, popup leaks, patch lag, deletion leftovers |
| Release engineering | Not covered | Signing, notarization, auto-update, Electron upgrade schedule |
| Telemetry vs metrics | Contradicted each other | Opt-in only; metrics defined without it (§22) |
| Monetization | Team cloud sync of sessions | Fully open source; sustainability via sponsors; never sync cookies (§20.6) |
| Repo structure | 4-package monorepo | One Electron app; split later |

---

## 1. Summary

SessionForge is an open-source, local-first desktop browser for developers and QA engineers. It lets you log in to the same web app as many users at once, with each user in a fully isolated session.

Three things make it different from existing tools:

1. **Split view.** See Admin and Customer side by side and watch one user's action show up for the other.
2. **Playwright bridge.** Log in by hand once, then export the session as a Playwright `storageState` file to reuse in automated tests.
3. **Environment safety.** Sessions tagged `production` get a red banner and confirmation before risky actions.

It's free, open source (Apache-2.0), and has no account and no cloud.

**Core abstraction:**

> **Session = isolation boundary (one identity). Tab = page inside that session. Pane = a visible slot in split view.**

---

## 2. Problem

### 2.1 The pain

Teams that build multi-user apps (RBAC, multi-tenant SaaS, marketplaces, admin dashboards) need to act as several users at the same time:

```text
Admin creates a resource → Manager approves → Customer sees it → Support edits it
```

Normal tabs share one cookie jar, so a second login kicks out the first. Today people get around this with:

```text
Chrome → Admin    Firefox → Customer    Incognito → Manager    Chrome profile → Support
```

This approach has several problems:
- Separate windows, so you can't see two roles side by side in one place
- Incognito loses the login on close
- Logins are typed again every day
- Logins done by hand can't be reused in automated tests
- No visual signal when you're on production

### 2.2 Why existing tools don't fully solve it

See §3. In short: the good tools are **paid and closed**, and the free ones are **Firefox-only or window-based**. None of them connect manual sessions to test automation.

### 2.3 Validation plan (before Milestone 2)

The pain is assumed until we prove it. We'll do these in parallel with the technical spike:

- **10–15 interviews** with QA engineers and full-stack devs who work on multi-role apps. Ask:
  - How do you test multiple roles today?
  - How often do you do this?
  - What annoys you most?
  - Do you reuse logins in Playwright/Cypress?
- **Problem post** on r/QualityAssurance, r/webdev, and dev.to, with a 20-second GIF of the spike, linking to the GitHub repo.
- **Signals to continue:** at least 6 of 15 interviewees do multi-role testing weekly, **and** at least 4 say split view or Playwright export would change their workflow.
- **Kill or pivot signal:** most people say "Firefox Containers / Chrome profiles are fine." If so, pivot to a smaller tool, such as a Playwright session-capture CLI or a browser extension.

---

## 3. Market and Competition

| Tool | Model | Isolated sessions | Split view across sessions | Playwright export | Open source | Platform |
|---|---|---|---|---|---|---|
| Ghost Browser | Paid subscription | Yes (per tab, color-coded, workspaces) | No | No | No | Desktop (Chromium) |
| Polypane | Paid subscription | Yes (sessions per tab/pane) | Yes (multi-viewport focus) | Cookie export only | No | Desktop (Chromium) |
| Firefox Multi-Account Containers | Free | Yes | No | No | Yes | Firefox only |
| SessionBox and similar extensions | Freemium | Yes (extension-level) | No | No | No | Chrome/Edge extension |
| Chrome / Edge profiles | Free | Yes (per window) | No | No | Partly (Chromium) | Any |
| **SessionForge** | **Free** | **Yes** | **Yes, built for roles** | **Yes, first-class** | **Yes (Apache-2.0)** | **Desktop (Chromium)** |

**The gap:** there's no free, open-source, Chromium-based tool built around *roles and environments* that also connects to test automation.

**Note:** competitor features change. Re-check this table before public launch.

---

## 4. Positioning

**One-liner:**

> **Log in as every role at once, side by side. Then reuse those logins in your tests. Free and open source.**

**What we are not:**
- A Chrome replacement for daily browsing
- An anti-detect or multi-account marketing browser
- A scraping tool

We stay away from the proxy and fingerprint market on purpose. It brings bad users, platform bans, and reputation risk.

**README hero GIF (the "aha" moment):**
1. Create Admin and Customer sessions.
2. Open split view.
3. Admin creates an order and Customer sees it on refresh.
4. Click "Export to Playwright" and run a test that starts already logged in.

---

## 5. Target Users

### Primary
- **QA engineers** (manual and automation) testing role-based flows.
- **Full-stack / backend developers** building RBAC or multi-tenant apps (Django, Rails, Laravel, Node, etc.).

### Secondary
- Agencies managing several clients and environments.
- Support engineers reproducing customer issues.
- Security testers checking authorization (IDOR, privilege escalation).

### Not targeted
Social media managers, affiliate marketers, and multi-account farming. The product doesn't ban these uses, but we don't build features for them.

---

## 6. Product Principles

1. **Local first.** No account, no cloud, no data leaves the machine by default.
2. **Developer first.** Features exist for testing and debugging, not general browsing.
3. **Open source forever.** All features of the desktop app are open source. There is no "pro" edition of the local app.
4. **Safe by default.** Production is loud and clear. Destructive actions are confirmed.
5. **Correct isolation over features.** An isolation leak is a P0 bug that blocks release.
6. **Fast.** Session switching feels like tab switching.
7. **Small core.** Say no to scope creep (see §11).

---

## 7. Core Concepts

```text
Workspace (later)
└── Session  ← isolation boundary (one identity + environment)
    ├── Tab
    ├── Tab
    └── Tab

Window
└── Layout: single | split (2–4 panes)
    └── Pane → shows one Tab from any Session
```

| Concept | Meaning |
|---|---|
| **Session** | A persistent, isolated Chromium storage partition with name, color, icon, and environment tag. |
| **Tab** | A page inside a session. Tabs in the same session share login state. |
| **Pane** | A slot in split view. Each pane can show a tab from a different session. |
| **Environment tag** | `local`, `staging`, `production`, or `custom`. Controls safety UI. |
| **Workspace** | (P1) A named group of sessions, such as "ACME Staging". |

---

## 8. MVP Scope (P0)

Every P0 item has acceptance criteria. "Done" means the criteria pass in automated or written manual tests.

### 8.1 Sessions
- Create, rename, recolor, and delete a session. Fields: name, color, optional icon, environment tag.
- Each session gets an **immutable UUID partition** (`persist:sf-<uuid>`). Renaming never touches the partition.
- Delete shows a warning, clears storage, and removes the partition folder from disk after the session closes.

**Accept:** create 10 sessions, rename all, restart, and every session keeps its login. Deleting a session leaves no partition folder on disk.

### 8.2 Tabs and Navigation
- Address bar, back, forward, reload, stop, new tab, close tab, reopen closed tab.
- **Popups, `window.open`, `target=_blank`, and OAuth popups open in the same session as the parent tab.**
- External links: default is "open in same session". "Open in system browser" is an explicit action.
- Downloads go to the user's download folder, labeled with the session name.
- Permissions (camera, mic, notifications, geolocation) are stored **per session**.

**Accept:** an OAuth popup opened from session A completes login in A only.

### 8.3 Split View (new, key differentiator)
- Show 2 panes (P0) or up to 4 panes (P1) side by side, each from any session.
- Each pane has a colored border and session label.
- Keyboard: `Ctrl/Cmd+\` toggles split, `Ctrl/Cmd+1..4` focuses a pane.
- No input sync between panes. Different roles see different UIs, so syncing would break.

**Accept:** Admin and Customer panes on the same URL. A change by Admin appears for Customer after reload, and neither login is affected.

### 8.4 Environment Safety (new)
- Sessions tagged `production` get:
  - A red top banner: "PRODUCTION — <session name>"
  - Red session color that can't be changed to green or blue
  - A one-time confirmation when the session opens each day (setting, on by default)
- Optional per-session **URL guard**: warn if a staging session navigates to a production domain (user defines domain patterns).

**Accept:** with a production session open, the banner is visible in every pane and tab of that session.

### 8.5 Persistence and Crash Recovery
- Restore sessions, tabs, layout, active session, and active tab on restart.
- **Lazy restore:** only visible tabs load. Other tabs load on first focus.
- Metadata is stored in SQLite (WAL mode). Tab state writes are debounced (≤ 1 s).

**Accept:** kill the process during use. On restart, all sessions, tabs, and URLs come back, and logins remain unless the site expired them.

### 8.6 Chromium DevTools
- Full DevTools per tab (Elements, Console, Network, Application, Sources, Performance).
- The Application panel shows only that session's storage.

### 8.7 Playwright Bridge (new, key differentiator)
- **Export:** Session → "Export for Playwright" creates a `storageState` JSON file (cookies + localStorage per origin).
- **Import:** create a session from a Playwright `storageState` file.
- **CLI:** `sessionforge export --session "ACME Admin" --out admin.json` for scripts and CI.
- A strong warning appears on export: "This file contains live login tokens. Do not commit it."
- The `.gitignore` snippet is shown in the export dialog.

**Accept:** export from a logged-in session, then a Playwright test using `storageState` starts already logged in.

### 8.8 Dev Extensions (new)
- Load **unpacked** Chrome extensions per app, with on/off per session where Electron allows.
- Officially tested for MVP: React DevTools and Vue DevTools.
- Clearly document which extension APIs work and which don't (Electron supports only a subset of Chrome extension APIs).

**Accept:** React DevTools works in a session's DevTools.

### 8.9 Clear Session Data
Clear cookies, cache, localStorage, IndexedDB, service workers, or everything, per session or per site within a session.

### 8.10 Keyboard and Command Palette

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd+T` / `W` | New / close tab |
| `Ctrl/Cmd+L` | Address bar |
| `Ctrl/Cmd+R` | Reload |
| `Ctrl/Cmd+K` | Command palette (switch session, open session, run actions) |
| `Ctrl/Cmd+Shift+N` | New session |
| `Ctrl/Cmd+\` | Toggle split view |

### 8.11 Signed Builds and Auto-update
- Signed and notarized builds for macOS, signed builds for Windows, and AppImage + .deb for Linux.
- Auto-update from GitHub Releases. Users can turn it off.

**Accept:** a v0.1.0 install updates itself to v0.1.1 on all three platforms.

---

## 9. P1 (after alpha, based on feedback)

- Workspaces: group sessions by project/client and open a whole workspace at once.
- Session templates: "SaaS QA" creates Admin, Customer, Manager, and Support at once.
- Split view up to 4 panes.
- Duplicate a session (with warning that tokens are copied).
- Encrypted session export/import (`.sfsession`, passphrase-based) for moving between your own machines.
- Password manager support: test Bitwarden and 1Password extensions. Document the results.
- Per-session notes (no secrets; warn if text looks like a password or token).
- Tab and session suspension to free memory.
- Per-session custom request headers (such as `X-Tenant-ID` and feature flags).

## 10. P2 / Later

- Role × environment matrix view.
- Session lock (OS auth to open production sessions).
- Local automation API / MCP server so Playwright, scripts, or AI agents can drive an existing session (local-only, off by default).
- Per-session proxy **for testing geo features only**. Decide carefully, since it pulls toward the anti-detect market.
- Integrations: VS Code "open in session" link, GitHub issue templates with session info (no secrets).

---

## 11. Out of Scope (MVP and likely forever)

- Cloud sync of cookies or login state, user accounts, team billing
- Fingerprint spoofing, anti-detection, CAPTCHA solving, proxy marketplace
- Built-in password manager or VPN
- Built-in AI assistant
- Mobile apps
- Chrome Web Store installation (unpacked extensions only)
- General consumer browser features (reading mode, sync, news feed)

---

## 12. Technical Architecture

### 12.1 Process model

```text
┌──────────────────────────────────────────────┐
│ Main process (Node, trusted)                 │
│  SessionManager  TabManager  LayoutManager   │
│  PersistenceStore (SQLite)  UpdateService    │
│  ExtensionManager  PlaywrightBridge  CLI     │
└───────────────┬──────────────────────────────┘
                │ typed, minimal IPC (contextBridge)
┌───────────────▼──────────────────────────────┐
│ UI renderer (React, trusted, local files only)│
│  session bar, tabs, address bar, panes, palette│
└──────────────────────────────────────────────┘

Web content: one WebContentsView per tab
  - session = session.fromPartition('persist:sf-<uuid>')
  - sandbox: true, contextIsolation: true, nodeIntegration: false
  - no preload (or a minimal one with no privileged APIs)
```

### 12.2 Key decisions

| Decision | Choice | Reason |
|---|---|---|
| Shell | Electron | Full Chromium + DevTools + per-partition sessions. Tauri uses system webviews (weak isolation control, no Chromium DevTools on macOS). Forking Chromium/CEF is too heavy for a small team. |
| Tab views | `WebContentsView` | `BrowserView` is deprecated. |
| Isolation | One persistent partition per session | Native Chromium isolation for cookies, storage, IndexedDB, cache, and service workers. |
| Partition name | UUID, immutable | Rename-safe, no data loss. |
| Metadata | SQLite (better-sqlite3), WAL | Crash safe, simple. |
| UI state | Zustand | Small and enough. |
| UI | React, Vite (electron-vite), Tailwind, shadcn/ui | Fast to build. |
| Repo | Single app first | Split into packages only when there's a second consumer (e.g. CLI). |

### 12.3 Security hardening (required for MVP)
- Electron fuses: disable `RunAsNode`, disable `EnableNodeOptionsEnvironmentVariable`, disable `EnableNodeCliInspectArguments`, enable `EnableCookieEncryption`, enable `OnlyLoadAppFromAsar`, enable embedded ASAR integrity validation.
- Strict CSP on the UI renderer. The UI never loads remote content.
- The IPC surface is a typed allowlist, and every message is validated (zod).
- Web content can't reach IPC at all.
- `will-navigate` and `setWindowOpenHandler` are handled in one place, so session inheritance can't be bypassed.
- Logs never contain cookie values, tokens, auth headers, or storage contents. A lint rule plus a test scans log output.

---

## 13. Data Model

```ts
type EnvTag = 'local' | 'staging' | 'production' | 'custom'

interface Session {
  id: string            // UUID
  partition: string     // 'persist:sf-<uuid>', immutable
  name: string
  color: string
  icon?: string
  env: EnvTag
  urlGuards?: string[]  // domain patterns for env warnings
  workspaceId?: string  // P1
  createdAt: number
  updatedAt: number
}

interface Tab {
  id: string
  sessionId: string
  url: string
  title?: string
  favicon?: string
  order: number
  lastActiveAt: number
}

interface Layout {
  windowId: string
  mode: 'single' | 'split'
  panes: { paneId: string; tabId: string }[]  // 1–4
  activePaneId: string
}
```

---

## 14. Isolation and Leak Test Matrix

All tests run in CI on Linux, macOS, and Windows with Playwright's Electron support plus a local test site that writes and reads every storage type.

| Check | Priority |
|---|---|
| Cookies (incl. HttpOnly, SameSite) | P0 |
| localStorage / sessionStorage | P0 |
| IndexedDB | P0 |
| Cache Storage and HTTP cache | P0 |
| Service worker registration + cache | P0 |
| `window.open` / `target=_blank` / popups inherit session | P0 |
| OAuth popup and redirect flows (GitHub, Microsoft, Google, self-hosted Keycloak) | P0 |
| Permissions per session | P0 |
| Downloads attributed to correct session | P0 |
| WebSockets carry correct session cookies | P0 |
| Restart keeps login in each session | P0 |
| Crash (kill -9) keeps login and tabs | P0 |
| Delete session removes partition folder | P0 |
| Split view: two sessions, same origin, no cross-talk | P0 |
| Playwright export → test starts logged in | P0 |
| BroadcastChannel / SharedWorker don't cross sessions | P1 |

Core rule: **A writes "A", B writes "B". A must read A, and B must read B. Never cross.**

---

## 15. Known Technical Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **Google blocks sign-in from embedded/Electron browsers** ("This browser may not be secure") | High: many apps use Google login | Test on **day 1 of the spike**. If blocked: document it, test user-agent options carefully (within Google's policy), and recommend email/password or other IdPs for test accounts. Don't build hacks to bypass it. |
| 2 | Popups/new windows escape the session | High: silent login mix-ups | Single central window-open handler + P0 tests (§14). |
| 3 | Chromium security patch lag | High: users open prod admin panels in it | Follow every Electron stable major (≈ every 8 weeks) and patch release. Automated upgrade PRs (Renovate). Security releases within 7 days of an Electron security fix. |
| 4 | Limited Chrome extension APIs in Electron | Medium: password managers may not work | Support dev extensions first. Test password managers in P1. Document clearly. |
| 5 | Memory with many sessions | Medium | Lazy restore, tab discarding, memory display per session. |
| 6 | Leftover partition data on delete | Medium: tokens left on disk | Delete folder after the session's webContents close. Verify in tests. |
| 7 | Maintainer burnout / bus factor | High for OSS | 2+ maintainers before v1.0, clear contribution path, automation for releases. |
| 8 | Trademark conflict on "SessionForge" | Low–medium | Check trademark and domain before public launch. |

---

## 16. Security and Threat Model

**What we protect:** live login sessions, often for production admin panels. This makes the app a high-value target.

| Threat | Control |
|---|---|
| Malicious website tries to reach Node/IPC | Sandbox, context isolation, no privileged preload in web content |
| XSS in our own UI | Strict CSP, no remote content in UI, no `dangerouslySetInnerHTML` |
| Malware reading cookies from disk | Cookie encryption via OS keychain (Electron fuse). Document honestly that local malware with user rights can still steal data. |
| Exported files leaking tokens | Warnings, encrypted export option (P1), `.gitignore` guidance |
| Tampered update | Signed builds, signature-verified auto-update |
| Logs leaking secrets | Log redaction + tests |

We'll publish `SECURITY.md` with a private reporting channel (GitHub Security Advisories) and a 90-day disclosure policy.

---

## 17. Privacy and Telemetry

- **No telemetry by default.**
- Optional **opt-in** anonymous usage ping, asked once on first run with "No" as the default. If the user opts in, it sends: app version, OS, and counts (sessions, tabs, split-view use). It never sends URLs, domains, cookies, or names.
- Crash reports are opt-in and stripped of URLs and storage.
- Everything about telemetry is documented in `PRIVACY.md`, and the code is in the open.

---

## 18. Performance Targets

| Metric | Target |
|---|---|
| Cold start (no tabs loaded) | < 2.5 s on a mid-range laptop |
| Session switch (UI) | < 150 ms |
| Split view toggle | < 200 ms |
| 10 sessions, 3 tabs each, lazy | Usable on 16 GB RAM |
| 20 sessions | Works, with suspension (P1) |

---

## 19. Release Engineering

- **CI:** GitHub Actions builds and tests on Linux, macOS, and Windows for every PR.
- **Signing:**
  - macOS: Apple Developer ID + notarization
  - Windows: code-signing certificate (or SignPath's free OSS program)
- **Distribution:** GitHub Releases, Homebrew cask, winget, AppImage, .deb. Flatpak later.
- **Auto-update:** electron-updater pointing at GitHub Releases.
- **Electron upgrades:** follow stable majors and patches. Renovate opens PRs, and the isolation suite must pass before merge.
- **Versioning:** SemVer. Pre-1.0 alphas: `0.x.y`.
- **Release notes:** generated from Conventional Commits.

---

## 20. Open-Source Plan

### 20.1 License
**Apache-2.0.** It's permissive, corporate-friendly (companies can adopt it at work), and includes a patent grant. All dependencies must use compatible licenses, checked in CI with a license scanner.

### 20.2 Promise
> Every feature of the SessionForge desktop app is and will stay open source under Apache-2.0. There is no paid "pro" version of the local app.

### 20.3 Repo files (before first public release)

```text
README.md            hero GIF, 3-line pitch, install, quick start
LICENSE              Apache-2.0
CONTRIBUTING.md      setup, how to run tests, PR rules
CODE_OF_CONDUCT.md   Contributor Covenant
SECURITY.md          private reporting, disclosure policy
PRIVACY.md           what is and isn't collected
ARCHITECTURE.md      process model, isolation design, IPC rules
GOVERNANCE.md        maintainers, decisions, how to become a maintainer
ROADMAP.md           public, linked to GitHub Projects
.github/             issue + PR templates, CI workflows
```

### 20.4 Contribution model
- **DCO sign-off** (`git commit -s`), no CLA. This keeps the barrier low and fits the "open forever" promise.
- Conventional Commits.
- Every PR runs the isolation suite. PRs that touch isolation need maintainer review.
- **Labels:**
  - Type: `good-first-issue`, `help-wanted`, `bug`, `feature`
  - Area: `isolation`, `security`, `split-view`, `playwright`, `ux`, `docs`, `platform:mac/win/linux`
- Keep 10+ well-written `good-first-issue` tickets open at launch.

### 20.5 Governance
- Start with a BDFL (founder) plus a written path to maintainer: e.g. 5 merged non-trivial PRs and 2 months of activity.
- Goal: 2+ maintainers with release rights before v1.0.
- Public roadmap. Big changes go through a short RFC in GitHub Discussions.

### 20.6 Sustainability (no paywall)
- GitHub Sponsors and Open Collective for signing certificates, Apple developer fee, and CI costs.
- Company sponsor logos in the README.
- If a hosted service is ever added (e.g. shared session **templates** for teams), it must:
  - be a separate, optional project
  - never gate any local feature
  - never sync cookies or login tokens

---

## 21. Launch and Community Plan

1. **Pre-launch (during spike):** 10–15 interviews (§2.3), problem post with spike GIF.
2. **Alpha (v0.1):** GitHub release, "Show HN", r/QualityAssurance, r/webdev, dev.to article: "How we test 4 user roles at once".
3. **Content:** short guides, such as "Testing Django admin + customer flows side by side" and "Reuse manual logins in Playwright".
4. **Channels:** GitHub Discussions first. Discord only once there are enough active users to keep it alive.
5. **Product Hunt:** after v0.3, when split view and Playwright export are stable.

---

## 22. Metrics

Measured without forced telemetry:

| Type | Metric |
|---|---|
| Adoption | Downloads per release, Homebrew/winget installs, GitHub stars |
| Community | Contributors, external PRs merged per month, issue response time |
| Engagement (opt-in only) | Weekly active installs using 2+ sessions; % using split view; Playwright exports per week |
| Reliability | Isolation bugs reported (target: 0 open P0), crash reports (opt-in), restore success in tests |

**North Star (opt-in data + survey):**

> **Weekly active developers who use 2+ sessions at the same time** (split view or switching).

**Alpha success, 3 months after v0.1:**
- 1,000+ downloads
- 30+ users in the opt-in group
- 5+ external contributors
- 0 open P0 isolation bugs

---

## 23. Milestones

Solo or two-person team, part-time.

| # | Milestone | Content | Est. |
|---|---|---|---|
| M0 | **Spike** | 2 partitions, same test site, cookie/storage/IDB/SW isolation, **Google OAuth test**, popup inheritance test. No UI polish. | 1 week |
| M0.5 | **Validation** | Interviews + problem post (parallel with M0/M1). Go/no-go decision. | parallel |
| M1 | Browser shell | Window, WebContentsView tabs, navigation, DevTools, central window-open handler | 1.5 weeks |
| M2 | Sessions | CRUD, colors, env tags, production banner, command palette | 1 week |
| M3 | Split view | 2 panes, pane focus, colored borders | 1 week |
| M4 | Persistence | SQLite, lazy restore, crash recovery, safe delete | 1 week |
| M5 | Playwright bridge + dev extensions | Export/import storageState, CLI, React/Vue DevTools | 1 week |
| M6 | Security + release eng | Fuses, CSP, IPC validation, log redaction, signing, auto-update, CI on 3 OSes | 1.5 weeks |
| M7 | **Public alpha v0.1.0** | Docs, README GIF, OSS files, launch | 0.5 week |

**Total:** ~8–9 weeks to alpha.

**Rule:** don't polish the UI before M0 passes. If Google OAuth is blocked in M0, decide the plan before M1.

---

## 24. Release Criteria (v0.1.0-alpha)

**Core**
- [ ] Create / rename / delete / switch sessions
- [ ] Multiple tabs per session
- [ ] Split view with 2 sessions
- [ ] Restore after restart and after crash
- [ ] Production banner works in all panes and tabs

**Isolation (all §14 P0 rows green on 3 OSes)**
- [ ] Storage types isolated
- [ ] Popups and OAuth stay in their session
- [ ] Delete leaves no partition data on disk

**Developer experience**
- [ ] DevTools + React DevTools
- [ ] Playwright export → logged-in test passes
- [ ] Keyboard shortcuts + command palette

**Security and release**
- [ ] Fuses, CSP, IPC validation in place
- [ ] Log redaction test passes
- [ ] Signed builds on macOS and Windows, auto-update works
- [ ] SECURITY.md, PRIVACY.md, LICENSE, CONTRIBUTING.md published

---

## 25. Open Questions

1. If Google OAuth is blocked in Electron, how much does that hurt the target users? Answer during M0 and interviews.
2. Do users want split view with **input sync** for same-role, different-environment comparison (e.g. staging vs prod as Admin)? Default is no sync; revisit after alpha.
3. Should the CLI work while the app is closed (read partitions directly), or only through the running app?
4. Is "SessionForge" free to use as a name (trademark, domain, npm, Homebrew)?
5. Which Linux packaging matters most to users: AppImage, .deb, or Flatpak?

---

## 26. Final Definition

**SessionForge is** a free, open-source (Apache-2.0), local-first desktop browser that lets developers and QA engineers log in as many users at once, see them side by side, and reuse those logins in automated tests.

**SessionForge is not** a Chrome replacement, an anti-detect browser, a scraping tool, a password manager, or a cloud service.

```text
Session = one isolated identity
Tab     = a page inside that identity
Pane    = a slot in split view showing any session's tab
```
