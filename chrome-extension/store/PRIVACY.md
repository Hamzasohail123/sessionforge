# SessionForge Import: privacy statement

Last updated: 2026-11-18

SessionForge Import is a Chrome extension that copies a login from Chrome into the SessionForge desktop
app on your own computer.

## First-run notice

The first time you open the extension, it shows a notice with the points below and two buttons, **Agree**
and **Not now**. Until you click Agree, the extension reads nothing and sends nothing; it only checks
whether you agreed before. **Not now** stores nothing. If these practices ever change, the notice is
shown again and you have to agree again.

## What the extension reads

- **Send to SessionForge** (or **Send to new session**): the cookies of the site you send (the cookies
  Chrome would send to that page, plus the cookies of its site's domain), that page's `localStorage`
  (current origin only), and the page URL, title and favicon URL. If the title contains an e-mail address
  (Gmail titles do), SessionForge names the session after it.
- **Send to <session> (SessionForge asked for this)**, shown when a SessionForge session asked for a login
  ("Sign in with Chrome"): only the cookies of the domains shown on that button. No localStorage, URL or
  title.

## When

Only when you click a Send button. Nothing is read in the background and nothing from other tabs. When you
open the popup after agreeing, it shows the current tab's address, which stays in the popup, and asks
SessionForge whether a session is waiting for a login (see below).

## Where the data goes

Only to the SessionForge app on this computer: one `POST` request to `http://127.0.0.1:34567/import`.
`127.0.0.1` never leaves your machine. After you agreed, opening the popup also sends
`GET http://127.0.0.1:34567/pending` to the same app, to list sessions waiting for a login; that request
carries none of your data.

The extension makes no other network requests. It has no analytics, no telemetry, no ads and no remote
code. The data never goes to us or to any other server. Nothing is sold or shared with anyone.

## Site access

The extension has no access to any website when you install it. The first time you send from a site,
Chrome asks you to allow access to that site (and its subdomains); for a sign-in request, to the domains
shown on the button. If you don't allow it, nothing is read or sent. You can remove site access at any
time in `chrome://extensions` → SessionForge Import → **Details** → **Site access**.

## What is stored

- In `chrome.storage.local`: your choice on the notice (`consentVersion`, `consentAt`).
- In `chrome.storage.session`, until Chrome closes: the site the extension last asked access for, so the
  popup can explain if Chrome closed it while asking.

SessionForge saves the imported cookies and storage in its own profile folder on your computer, as a
session you can delete at any time in the app (deleting a session deletes its data).

## Your control

- Nothing is read or sent unless you click Agree once and then a Send button.
- Remove site access in `chrome://extensions` → SessionForge Import → Details → Site access.
- Uninstalling the extension removes it and what it stored.
- Imported sessions live only in SessionForge on your computer; delete them there.

SessionForge Import's use of this data complies with the Chrome Web Store User Data Policy, including the
Limited Use requirements.

## Contact

Questions or concerns: open an issue at https://github.com/Hamzasohail123/sessionforge/issues. For security
problems, follow SECURITY.md in the repository.
