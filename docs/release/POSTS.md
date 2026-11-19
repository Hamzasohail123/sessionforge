# Launch post drafts (v0.1.0)

Check that the repo links below point at your GitHub account (LAUNCH_CHECKLIST.md step 0 fills in
the name) and attach the demo video or GIF where marked. Keep the limitations in every post; people
trust a launch that says what doesn't work yet.

Repo link: `https://github.com/<owner>/sessionforge`

## Known limitations (paste into posts and the release notes)

- **Google sign-in may be blocked.** Google sometimes refuses logins inside embedded browsers. Importing
  an existing Chrome login with the extension avoids most cases, but not all.
- **The macOS build is not notarized.** It's ad-hoc signed only (no Apple Developer account yet), so the
  first launch needs System Settings → Privacy & Security → Open Anyway. The Windows installer is unsigned
  (SmartScreen → More info → Run anyway). Running from source avoids both.
- **Agent Bridge is new.** It's the first release of the MCP server. v1 has no arbitrary JavaScript,
  file uploads, downloads or cross-origin iframes. It's off by default.
- **Most testing so far has been on Linux.** CI runs the end-to-end suite on Linux and macOS. On Windows,
  CI only runs the typecheck and unit specs; the app itself hasn't been tested end to end there, so expect
  rough edges.
- The Chrome extension may still be in Web Store review; until then it's "Load unpacked".

---

## X (Twitter) thread

**1/**
I built SessionForge: a desktop browser that keeps every user role of your app logged in at once:
Admin, Customer, Guest, side by side.

New in v0.1.0: Cursor, Codex and Claude Code can use those logins through a local MCP server while you watch.

Free, open source (Apache-2.0). 🧵
[attach demo video]

**2/**
The problem: testing "can a Customer see the admin page?" means juggling profiles, incognito windows and
logins. Coding agents have it worse: their browser has one identity, or none.

In SessionForge each session is its own Chromium partition (own cookies and storage), and split view
shows up to 4.

**3/**
Getting logins in: a Chrome extension. Click "Send to SessionForge" on a tab where you're logged in and
that login opens in a new isolated session. It only talks to 127.0.0.1.

Agent Bridge: list_sessions, open, snapshot, click, type, and send_request_as, which sends one request
as several users and diffs the results.

**4/**
Safety, since agents + logged-in browsers is a risky mix:
• off by default, localhost only, bearer token
• per-session grants: hidden / read / control
• production sessions are read-only to agents unless you type to confirm
• cookies and tokens redacted in tool output
• no telemetry, no account, no cloud
• no AI of its own: it's the browser *your* agent uses, with your subscription

**5/**
Honest limits: Google sign-in can be blocked in embedded browsers; the Mac build isn't notarized (Open
Anyway on first launch); Agent Bridge is brand new; Linux is the best-tested OS.

Run from source in 3 commands, or grab a build:
https://github.com/<owner>/sessionforge
Feedback and issues very welcome.

---

## Show HN

**Title** (≤ 80 characters):
> Show HN: SessionForge – a multi-session browser your coding agent can drive

**URL**: `https://github.com/<owner>/sessionforge`

**First comment** (post right after submitting):

> Hi HN, I made SessionForge because testing role-based features meant constantly logging in and out, or
> juggling Chrome profiles and incognito windows.
>
> It's an Electron app where each session is a separate persistent Chromium partition, so Admin, Customer
> and Guest stay logged in at the same time and you can put up to four side by side. A small Chrome
> extension copies a login from your normal Chrome into a new session (it POSTs cookies and localStorage
> to 127.0.0.1 only).
>
> The part I'm most curious about feedback on is the Agent Bridge, new in this release: a local MCP server
> (Streamable HTTP on 127.0.0.1 plus a stdio bridge) that Cursor, Codex and Claude Code can use. The agent calls
> list_sessions, then acts as a named session: snapshot, click, type, or send_request_as, which sends the
> same HTTP request through several sessions' cookie jars and diffs the answers. That turns "can a
> customer reach this admin endpoint?" into one tool call, and you watch it happen in split view.
>
> Because a logged-in browser driven by an agent is a real risk, it's off by default, needs a bearer token,
> rejects any request with an Origin header, and has per-session grants (hidden / read / control).
> Production-tagged sessions are read-only to agents unless you confirm by typing the session's name, and
> cookies and auth headers are redacted in tool output. There's no telemetry and no account, and
> deliberately no built-in AI: your own coding agent does the thinking, SessionForge gives it the logins.
>
> Limitations: Google sometimes blocks sign-in inside embedded browsers; the macOS build is ad-hoc signed
> but not notarized (I don't have an Apple developer account yet), so first launch needs "Open Anyway"; the
> Windows build is unsigned; and most of my testing has been on Linux. Running from source is three
> commands.
>
> Apache-2.0. I'd love to hear what breaks, and what you'd want an agent to do with multiple identities.

---

## r/webdev

r/webdev only allows self-promotion in the **Showoff Saturday** thread or as a Saturday post with the
flair "Showoff Saturday". Check the current rules in the sidebar before posting.

**Title**:
> [Showoff Saturday] SessionForge: keep Admin, Customer and Guest logged in side by side (open source, with an MCP server for Cursor/Codex/Claude Code)

**Body**:

> I got tired of logging in and out to test role-based features, so I built a small desktop browser for it.
>
> - Each session is an isolated Chromium partition (own cookies, storage, cache); up to 4 side by side.
> - A Chrome extension copies a login from your normal Chrome into a new session with one click
>   (localhost only).
> - New: a local MCP server so Cursor, Codex or Claude Code can use those sessions by name: open pages, click, and
>   send the same request as several users to check permissions.
>
> Free and open source (Apache-2.0), no account, no telemetry. Electron + React + SQLite.
>
> Limits: Google sign-in can be blocked in embedded browsers, the Mac build isn't notarized (Open Anyway
> on first launch), the agent part is brand new, and Linux is the best-tested OS.
>
> Repo and 45 s demo: https://github.com/<owner>/sessionforge
>
> Feedback welcome, especially from anyone testing multi-tenant or RBAC apps.

---

## r/QualityAssurance

Read the subreddit rules on tool promotion first; if unsure, message the moderators before posting.

**Title**:
> Open-source browser for multi-role manual testing: every role logged in side by side

**Body**:

> For manual and exploratory testing of role-based apps I kept needing several users logged in at once.
> Profiles and incognito windows work, but they're slow to set up and easy to mix up, so I built
> SessionForge (free, Apache-2.0).
>
> What it does today:
> - Isolated sessions (separate cookies and storage per session) shown side by side in 1, 2 or 4 panes.
> - Sessions are colour-coded and can be tagged local, staging or production; production sessions get a
>   red banner.
> - Import a login from Chrome with one click instead of typing credentials again.
> - Sessions survive restarts.
> - For teams using AI coding agents: a local MCP server lets Cursor, Codex or Claude Code act as a named session, for
>   example sending the same request as Admin and Customer and comparing status codes.
>
> What it doesn't do (yet): no recorder (use Playwright codegen), no network log panel (next milestone),
> Google sign-in can be blocked inside it, and the Mac/Windows builds aren't code-signed.
>
> I'd value feedback from testers: what's missing for your multi-role sessions?
> https://github.com/<owner>/sessionforge

---

## Cursor forum (Showcase)

**Title**:
> SessionForge: give Cursor several logged-in users (Admin, Customer…) through MCP

**Body**:

> I built an open-source desktop browser that keeps multiple logged-in sessions, and a local MCP server so
> Cursor can use them by name.
>
> Setup: in SessionForge, Settings → Agent Bridge → turn it on → copy the Cursor config into
> `.cursor/mcp.json` and copy the token export line into the shell that starts Cursor. (If you prefer
> stdio, there's a dependency-free bridge too: `node <path>/sessionforge-mcp.mjs`, with the path shown in
> the same panel.)
>
> Then you can ask things like "Customers can open /admin/billing. Reproduce it in SessionForge and fix
> it." The agent calls `list_sessions`, runs `send_request_as(["Admin","Customer"], GET /api/admin/billing)`,
> sees two 200s, fixes the guard, reloads, and checks again: Admin 200, Customer 403. You watch both
> panes side by side.
>
> Tools in v1: list_sessions, open, navigate, back, reload, snapshot, click, type, select, press, wait_for,
> screenshot, console_logs, network_log, send_request_as, get_layout, set_layout.
>
> Safety: off by default, 127.0.0.1 only, bearer token, per-session grants, production sessions read-only
> unless confirmed, secrets redacted, page text labelled as untrusted.
>
> It's v0.1.0 and the Agent Bridge is new, so I'd really like reports of what goes wrong. Mac build is not
> notarized (Open Anyway on first launch); running from source avoids that.
>
> Claude Code and Codex work too; the panel shows their config.
>
> Demo and repo: https://github.com/<owner>/sessionforge
