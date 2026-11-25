# SessionForge Import (Chrome extension)

Copies the login of the current Chrome tab into SessionForge with one click. SessionForge creates a new
isolated session from it and opens the page in a pane, already logged in.

## How it works

1. Log in to a site in Chrome as usual.
2. Click the SessionForge Import icon. The first time, the popup shows a short notice (what it reads, when,
   where it goes, how to stop it) with **Agree** and **Not now**. Nothing is read or sent until you click
   **Agree**; **Not now** stores nothing.
3. Click **Send to SessionForge**. The first time you send from a site, Chrome asks you to allow access to
   that site (for example "all google.com sites" for `mail.google.com`). The extension has no access to any
   website at install. If you don't allow it, nothing is read or sent and the popup says so.
   If Chrome closes the popup while it asks, open the popup again: it says what happened and offers
   **Allow access in a tab**, which opens a page that asks for the same access. Then click Send again.
4. The extension collects:
   - the cookies Chrome sends to the page, plus the cookies of its site's domain (for example
     `mail.google.com` also gets `.google.com` cookies), including httpOnly and secure ones;
   - the page's `localStorage` (current origin only);
   - the page URL, title and favicon URL.
5. It sends them in Playwright `storageState` format with
   `POST http://127.0.0.1:34567/import`. Your data goes nowhere else.
6. SessionForge creates a session, names it after the e-mail address in the tab title (Gmail titles have
   one) or else the hostname, adds " 2", " 3"… if the name is taken, and opens the URL in a free pane.

The popup then shows "✅ Sent to SessionForge — opened in a pane", plus a warning if some cookies were rejected.

Not copied: sessionStorage, IndexedDB, history, bookmarks, saved passwords.

Cookies without an expiry date (session cookies) are kept for 30 days in SessionForge, so imported logins
survive a restart.

## Sign in from SessionForge

Google blocks Google sign-in inside embedded browsers such as SessionForge. When a SessionForge pane
reaches a Google sign-in page, its banner offers **Sign in with Chrome**: SessionForge opens the sign-in
page (or, for "Sign in with Google" on another site, that site's page) in your browser and waits for the
login. After you sign in there, the popup shows a button per waiting session, in the session's colour:

- **Send to <session> (SessionForge asked for this)** sends the cookies of the domains SessionForge asked
  for (for example `google.com`, or the site's domain) into that existing session. The pane continues
  where it left off. The regular button is then labelled **Send to new session** and works as before.
- The popup asks `GET http://127.0.0.1:34567/pending` when it opens (after you agreed to the notice);
  SessionForge answers with the request id, the session's name and colour, the cookie domains, the
  expiry and its own version number, nothing else.
- The first time, Chrome asks you to allow access to the domains shown on the button.
- Only cookies are sent for a request, not localStorage. Sites that keep their login in localStorage or
  IndexedDB stay signed out after this hand-off; use **Send to new session** (which carries
  localStorage) or log in inside SessionForge.
- Firebase-style sign-ins (the site sends you to `<project>.firebaseapp.com/__/auth/handler` before Google)
  return to that handler page; navigate back to the app in the pane afterwards.
- A local app works on `http://localhost:<port>` (all `localhost` cookies of Chrome are sent, because
  cookies are not separated by port). Use `localhost`, not `[::1]`. Other plain-http hosts are refused.
- "❌ This request expired or was already used" (HTTP 410): a request lasts 10 minutes and works once. Click
  **Sign in with Chrome** in SessionForge again.
- SessionForge must use the default port 34567. If another SessionForge already holds it, or
  `SESSIONFORGE_IMPORT_PORT` is set, **Sign in with Chrome** explains why it can't start.

## Install

From the Chrome Web Store (once published): search for "SessionForge Import".

Or load it unpacked (developer mode):

1. Open `chrome://extensions/`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `chrome-extension/` folder.
4. Optional: pin it with the puzzle-piece icon in the toolbar.

Built and tested for Chrome. Other Chromium browsers (Edge, Brave) use the same extension format and
should work but haven't been tested. Firefox isn't supported: SessionForge only accepts imports from
`chrome-extension://` origins, and the manifest uses a Chrome service worker.

## Requirements

- SessionForge running on the same computer. At start it logs
  `[import] listening on http://127.0.0.1:34567/import`.
- Port 34567 free. The extension always uses 34567; if you start SessionForge with
  `SESSIONFORGE_IMPORT_PORT`, change `SESSIONFORGE_URL` and `PENDING_URL` in `popup.js` and the
  `host_permissions` entry in `manifest.json` to match, and reload the extension.
- Site access is asked per registrable domain, worked out without the Public Suffix List: the last two
  labels (`console.x.ai` → `x.ai`, `www.gmx.de` → `gmx.de`), or three when a known second-level label
  such as `co`, `com`, `org`, `ac` or `ne` sits under a two-letter country code (`www.bbc.co.uk` →
  `bbc.co.uk`, `x.example.com.au` → `example.com.au`). The list is `SECOND_LEVEL` in `access.js`.
  Access covers the domain and its subdomains, so cookies a site sets on its parent domain are
  included. On shared hosts such as `foo.github.io`, Chrome's prompt therefore asks for all `github.io`
  sites; you see that in the prompt before you allow it.

## Tips

- **One Google account per Chrome profile.** If several Google accounts are signed in to one Chrome
  profile, every import from that profile carries all of them, and signing out in one session can sign
  out the others. Use a separate Chrome profile per Google account.
- To import several accounts of the same site, use one Chrome profile per account and click
  **Send to SessionForge** in each.
- Google refuses sign-in inside SessionForge. Use **Sign in with Chrome** in the pane's banner, then
  **Send to <session>** here (see [Sign in from SessionForge](#sign-in-from-sessionforge)).

## Troubleshooting

| Message | What to do |
|---|---|
| ❌ SessionForge is not running (could not reach 127.0.0.1:34567) | Start SessionForge; check that nothing else uses port 34567 |
| ❌ Chrome did not allow access to …, so nothing was sent | Click Send again and allow access when Chrome asks, or click **Allow access in a tab** |
| ❌ Chrome could not ask for access here | Click **Allow access in a tab**, allow access on that page, then open the popup and click Send again |
| Chrome closed this popup while asking for access to … | Click **Allow access in a tab**, then send again |
| ❌ Only http(s) pages can be sent | The current tab is a `chrome://` page, the Web Store or a file; open the site itself |
| ❌ Session too large to import (over 5 MB) | The site stores a lot in localStorage; import from a page with less data, or log in inside SessionForge |
| ❌ Invalid URL, or ❌ Invalid payload: … | Only http(s) pages can be imported (not `chrome://` pages, the Web Store, or `file://` pages) |
| ❌ Origin not allowed | Something other than the extension sent the request; reload the extension |
| ❌ This request expired or was already used | Click **Sign in with Chrome** in SessionForge again (a request lasts 10 minutes and works once) |
| No "Send to <session>" button after "Sign in with Chrome" | Reload the extension in `chrome://extensions` (version 1.2.0 or later); check that SessionForge uses port 34567 |
| Imported but not logged in | Some sites keep auth outside cookies and localStorage (for example in IndexedDB or sessionStorage). Log in once inside SessionForge; the session keeps it |
| localStorage missing | Chrome blocks scripts on some pages; cookies are still sent |

## Privacy

The extension sends your data only to `127.0.0.1` on your computer. Its one other request, at most once a
day after you agreed, asks GitHub (`api.github.com`) for the latest SessionForge version number and carries
none of your data; when your desktop app is older, the popup shows a link to the releases page. It has no
analytics and makes no other network requests. It stores only your answer to the first-run notice and the
last version check (`chrome.storage.local`) and, until Chrome closes, the site it last asked access for (`chrome.storage.session`). To stop it, remove site access in
`chrome://extensions` → SessionForge Import → **Details** → **Site access**, or uninstall it. See
[store/PRIVACY.md](./store/PRIVACY.md).

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Manifest V3: permissions `activeTab`, `cookies`, `scripting`, `storage`; host access `http://127.0.0.1:34567/*`; other sites (`*://*/*`, optional) only when you allow them |
| `popup.html`, `popup.js` | The popup: first-run notice, site-access requests and the import logic |
| `access.js` | Consent and site-access helpers: `CONSENT_VERSION`, host patterns per domain, the `grant.html` link |
| `handoff.js` | "Sign in with Chrome" helpers: checks `/pending`, collects the requested cookies, builds the payload |
| `update-check.js` | New desktop version notice: reads the app version from `/pending`, asks GitHub's latest release at most once a day, compares versions |
| `grant.html`, `grant.js` | "Allow access in a tab": asks Chrome for site access in a tab when the popup can't; reads and sends nothing |
| `background.js` | Service worker (logs installation; no other work) |
| `icon16.png`, `icon48.png`, `icon128.png` | Toolbar and extension-page icons |
| `store/` | Chrome Web Store listing text, privacy statement, store images |

## Development

Edit the files, then click **Reload** on the extension in `chrome://extensions/`. Before committing, run
`node --check` on `access.js`, `handoff.js`, `update-check.js`, `popup.js`, `grant.js` and `background.js`, and
`npx playwright test --project=unit e2e/unit/extension-*.spec.ts`:
`extension-popup.spec.ts` runs `access.js`, `handoff.js`, `update-check.js` and `popup.js` together with a fake `chrome` and
`fetch`, `extension-access.spec.ts` covers `access.js` and `grant.js`, `extension-manifest.spec.ts` checks
the permissions and that only `127.0.0.1:34567` and the GitHub release check are contacted, and `extension-handoff.spec.ts` covers
`handoff.js`, and `extension-update.spec.ts` covers `update-check.js`. The server side is `src/main/import-server.ts` and `src/main/import-payload.ts` (and
`src/main/google-signin/` for "Sign in with Chrome").

If you change what the extension reads, when it reads it or where it sends it, update the notice in
`popup.html` (and `store/PRIVACY.md`, `store/LISTING.md`) and raise `CONSENT_VERSION` in `access.js`, so
every user sees the notice again and has to agree again.

## License

Apache-2.0, same as SessionForge.
