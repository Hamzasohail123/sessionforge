# Chrome Web Store listing: SessionForge Import

Paste these into the Chrome Web Store Developer Dashboard (https://chrome.google.com/webstore/devconsole).
Package: zip of the extension's runtime files only, without `store/` and the docs (command in
`docs/release/LAUNCH_CHECKLIST.md` step 11).

## Store listing tab

**Name** (from manifest.json): SessionForge Import

**Summary** (from manifest.json `description`, max 132 characters):
> Send the current tab's login to the SessionForge desktop app on this computer (localhost only)

**Category**: Developer Tools

**Language**: English

**Description**:

> SessionForge Import is the companion extension for SessionForge, a free, open-source desktop browser for
> developers and QA engineers that keeps many logged-in sessions (Admin, Customer, Guest…) side by side.
>
> Click "Send to SessionForge" on any page where you're logged in. The extension copies that tab's
> cookies and localStorage to the SessionForge app running on your computer. SessionForge creates a new,
> isolated session from it and opens the page in a pane, already logged in. No need to log in again.
>
> First use: the extension shows a short notice that says what it reads, when, and where it sends it.
> Nothing is read or sent until you click Agree. The first time you send from a site, Chrome asks you to
> allow access to that site; the extension has no access to any website when you install it.
>
> Sign in with Chrome: Google blocks sign-in inside embedded browsers such as SessionForge. When a
> SessionForge session asks for a Google login, the popup shows a "Send to <session>" button. It sends only
> the cookies of the domains shown on the button into that waiting session.
>
> What it copies: the cookies for the current page and its site domain, the current origin's
> localStorage, and the page URL, title and favicon URL. If the title contains an e-mail address, that
> address becomes the session's name.
>
> Where it goes: only to http://127.0.0.1:34567, the SessionForge app on the same computer. The extension
> makes no other network requests and has no analytics. It stores only your Agree choice (and, until
> Chrome closes, the site it last asked access for).
>
> Requirements: the SessionForge desktop app (macOS, Windows, Linux), running. Get it at
> https://github.com/Hamzasohail123/sessionforge
>
> Limitations: only http(s) pages; sessionStorage and IndexedDB aren't copied; some sites keep their
> login elsewhere and need one more sign-in inside SessionForge. If several Google accounts share one
> Chrome profile, every import carries all of them, so use one Chrome profile per Google account.
>
> Open source (Apache-2.0).

**Icon**: `store/icon-128.png` (128×128, the artwork edge to edge with transparent corners).

**Screenshots** (required, at least 1; 1280×800 or 640×400, PNG or JPEG): **not generated, the user must
capture them.** Suggested:
1. Chrome with the extension popup open over a logged-in page, "Send to SessionForge" visible.
2. SessionForge right after the import: the new session in the session bar and the page in a pane.
3. SessionForge split view with two imported sessions side by side.

**Small promo tile** (440×280, 24-bit PNG, no alpha): `store/promo-small-440x280.png`.
**Marquee promo tile** (1400×560, 24-bit PNG, no alpha): `store/promo-marquee-1400x560.png`.

**Homepage URL**: `https://github.com/Hamzasohail123/sessionforge`
**Support URL**: `https://github.com/Hamzasohail123/sessionforge/issues`

## Privacy practices tab

**Single purpose**:
> Copy the login state (cookies and localStorage) of a site the user chooses into the SessionForge desktop
> app on the same computer, either as a new isolated session or into a SessionForge session that asked for
> that login.

**Permission justifications** (every permission in manifest.json):

| Permission | Justification |
|---|---|
| `activeTab` | When the user opens the popup, it reads the active tab's URL, title and favicon URL to name the session and to know which site to ask access for. On the user's Send click it runs the localStorage read in that tab. Temporary, current tab only. |
| `cookies` | Read only, on the user's Send click, and only for sites the user granted access to: the active tab's page and its site domain, or the domains shown on a SessionForge sign-in request. Cookies are never changed or deleted. |
| `scripting` | On the user's Send click, runs one function in the active tab that returns that page's `localStorage` (many sites keep login tokens there). No content scripts. |
| `storage` | `chrome.storage.local` keeps `consentVersion` and `consentAt` (the user's Agree on the first-run notice). `chrome.storage.session` keeps `grantAttempt`, the domains the popup last asked access for, so the next popup can explain if Chrome closed it during the prompt; it is cleared when Chrome closes. |
| Host permission `http://127.0.0.1:34567/*` | The SessionForge import server on the user's own computer, the only place data is sent. |
| Optional host permission `*://*/*` | Nothing is granted at install. On the user's Send click (or Allow access on the extension's own fallback page, `grant.html`, which the popup opens for the same domains), the extension asks Chrome for one site only (`*://*.example.com/*`), or for the domains shown on a sign-in request. http and https only, narrower than `<all_urls>`. The cookies API only returns cookies for hosts the extension has permission for. |

**Remote code**: No, I am not using remote code. All JavaScript is in the package; no `eval`, no remote scripts.

**Data usage**, collected data types to tick:
- **Authentication information**: cookies and localStorage values can contain login tokens.
- **Website content**: localStorage contents, page title.
- **Web history**: the URL of the current tab (one URL, on the user's click).
- **Personally identifiable information**: if the tab title contains an e-mail address (Gmail titles
  do), the extension uses it as the new session's name (`sessionNameFor()` in `popup.js`) and sends it,
  with the title, to the local app.

The data is sent only to the SessionForge app on the user's own computer (`127.0.0.1`); the developer
never receives it. Tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**: `https://github.com/Hamzasohail123/sessionforge/blob/main/chrome-extension/store/PRIVACY.md`

**How to verify (for reviewers)** (paste into the dashboard's **Test instructions** field):
> The full source is public at https://github.com/Hamzasohail123/sessionforge/tree/main/chrome-extension and
> matches the package (plain JavaScript, no build step). The only network destination is
> http://127.0.0.1:34567, the SessionForge desktop app on the same computer (loopback; searching the
> sources for "http" shows no other URL). No data reaches the developer. To test: install the SessionForge
> desktop app from https://github.com/Hamzasohail123/sessionforge and start it; open any site you are logged in to
> in Chrome; click the extension icon → Agree → Send to SessionForge → allow access when Chrome asks. The
> page opens logged in, in a SessionForge pane. Without the app running, the popup shows "SessionForge is
> not running" and nothing is sent.

## Before you submit

- Check that the URLs above point at your GitHub account (LAUNCH_CHECKLIST.md step 0 fills in the name)
  and open in a logged-out browser window.
- The extension has no broad host permission at install, only the local server. The review may still be
  in-depth because it uses the cookies API (not verified). Submit right after the repository is public
  (LAUNCH_CHECKLIST.md step 11), not before: the privacy policy, homepage and support URLs above are 404
  while the repo is private.
