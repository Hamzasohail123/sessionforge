# 45-second demo: Cursor fixes a permission bug while you watch two roles

Story (research doc §11): Customers can open the admin billing page. The agent reproduces the bug as both
users through SessionForge, fixes the route guard, and proves the fix: Admin 200, Customer 403.

## Setup (off camera, ~15 minutes)

### 1. A small app with the bug

`examples/rbac-demo` isn't in the repo yet. Use your own app with an admin-only route, or save this as
`server.mjs` in an empty folder **outside** the SessionForge repo (Node 20+, no dependencies) and run
`node server.mjs`:

```js
import { createServer } from 'node:http'
const users = { admin: 'admin', customer: 'customer' } // login name → role
const role = (req) => users[/(?:^|; )user=(\w+)/.exec(req.headers.cookie ?? '')?.[1]]
// BUG: any logged-in user passes. The fix is: role(req) === 'admin'
const canSeeBilling = (req) => role(req) !== undefined
createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/login') {
    res.writeHead(302, { 'Set-Cookie': `user=${url.searchParams.get('as')}; Path=/; HttpOnly`, Location: '/' })
    return res.end()
  }
  const r = role(req)
  if (url.pathname === '/api/admin/billing') {
    if (!canSeeBilling(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"error":"Forbidden"}') }
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"mrr":12400,"invoices":37}')
  }
  if (url.pathname === '/admin/billing') {
    res.writeHead(canSeeBilling(req) ? 200 : 403, { 'Content-Type': 'text/html' })
    return res.end(canSeeBilling(req)
      ? `<h1>Billing</h1><p>Signed in as ${r}</p><p>MRR $12,400 · 37 invoices</p>`
      : `<h1 style="color:#b91c1c">Forbidden</h1><p>Signed in as ${r}</p>`)
  }
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(r ? `<p>Signed in as ${r}. <a href="/admin/billing">Admin billing</a></p>`
            : `<a href="/login?as=admin">Log in as admin</a> · <a href="/login?as=customer">Log in as customer</a>`)
}).listen(3000, '127.0.0.1', () => console.log('http://127.0.0.1:3000'))
```

(`node --watch server.mjs` restarts it when the agent edits the file.)

### 2. SessionForge

1. Create two sessions, **Admin** (blue) and **Customer** (orange), environment `local`.
2. Log in: in Admin open `http://127.0.0.1:3000/login?as=admin`, in Customer `…/login?as=customer`.
3. Layout **Two columns**: Admin left, Customer right, both on `http://127.0.0.1:3000/admin/billing`.
4. Settings → Agent Bridge: turn it on, set both sessions to **control**, copy the Cursor config.

### 3. Cursor

1. Open the app folder in Cursor and add the copied config to `.cursor/mcp.json`.
2. Export the token in the shell that starts Cursor (Settings → Agent Bridge → "Copy export line").
3. Cursor Settings → MCP: `sessionforge` shows its tools. Run one throwaway prompt first so the
   tool-approval prompts are out of the way (or allow the tools for the session).

### 4. Recording

- 1920×1080, SessionForge on the left two-thirds, Cursor on the right third (or switch between full-screen windows).
- Large font in Cursor's chat (zoom 125–150%). Hide bookmarks, notifications and personal tabs.
- Recorder: OBS, or the macOS screenshot toolbar, or `peek`/SimpleScreenRecorder on Linux. Record 30 fps.
- Do one full dry run; restore the bug (`git checkout server.mjs` or undo) before the real take.

## Shot list

| Time | Shot | On screen | Caption (burn in, short) |
|---|---|---|---|
| 0–5 s | SessionForge, two columns | Admin and Customer both show "Billing · MRR $12,400". Pane headers show the session names and colours | "Two real logins, side by side" |
| 5–10 s | Cursor chat | Type or paste: *"Customers can open /admin/billing. Reproduce it in SessionForge and fix it."* | "Ask your agent" |
| 10–18 s | Cursor tool calls | `list_sessions`, then `send_request_as(["Admin","Customer"], GET /api/admin/billing)` → both **200** | "Agent checks as both users: both 200 = bug" |
| 18–22 s | SessionForge | Pane headers show the 🤖 Agent indicator while the calls run | "You watch it work" |
| 22–30 s | Cursor editor | Diff: `role(req) !== undefined` → `role(req) === 'admin'` | "Fixes the guard" |
| 30–38 s | Cursor tool calls, then SessionForge | `reload` in both panes; `send_request_as` again → Admin **200**, Customer **403** | "Admin 200, Customer 403" |
| 38–45 s | SessionForge, hold | Customer pane shows red "Forbidden", Admin still shows billing. End card: name, one line, repo URL | "SessionForge, free and open source · github.com/<owner>/sessionforge" |

Cut the waiting between tool calls; keep each tool call's result visible for at least 1.5 s. If the agent
takes a different but correct path, keep it: honesty beats a scripted look.

## Exports

- `demo.mp4`, 1080p, for X and YouTube (no music needed; captions carry it).
- `docs/release/demo.gif`, 1200 px wide, 10–12 fps, under ~8 MB, for the README (ffmpeg command in
  LAUNCH_CHECKLIST.md step 9).
- One still frame (the 38 s shot) as the social preview image: repo Settings → General → Social preview.
