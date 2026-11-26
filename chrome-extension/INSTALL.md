# Install SessionForge Import

## Chrome Web Store

Install [SessionForge Import](https://chromewebstore.google.com/detail/sessionforge-import/ofdnckgaoffbablejmfimchoifdlhjbf)
from the Chrome Web Store. No developer mode needed.

## Load unpacked (developer mode)

1. Open `chrome://extensions/`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `chrome-extension/` folder.
4. Optional: pin the extension from the puzzle-piece menu.

Chrome is the tested browser. Edge and Brave should work the same way (untested). Firefox isn't supported.

## Updating

After updating SessionForge, open `chrome://extensions` and click the reload icon on SessionForge Import.
It should show version 1.3.1. Versions before 1.2.0 have no "Send to <session> (SessionForge asked for
this)" button and can only create new sessions. 1.3.0 shows a first-run notice once, and Chrome asks for
access to each site the first time you send from it.

## Quick test

1. Start SessionForge (`npm run electron:dev` from the repo, or the installed app).
2. In Chrome, open a site where you're logged in.
3. Click the extension icon. The first time, read the notice and click **Agree**.
4. Click **Send to SessionForge**. The first time for this site, Chrome asks you to allow access to it:
   allow it.
5. SessionForge opens the page in a new session, in a pane, logged in. The popup shows
   "✅ Sent to SessionForge — opened in a pane".

## Sign in with Chrome (Google)

1. In SessionForge, open Gmail (or any Google sign-in) in a session. A banner appears above the page.
2. Click **Sign in with Chrome** and sign in in the browser that opens.
3. Click the extension icon, then **Send to <session> (SessionForge asked for this)**, and allow access to
   the domains shown when Chrome asks. The SessionForge pane continues, signed in. The regular button now
   says **Send to new session**.

## If it doesn't work

- "SessionForge is not running": start the app, and make sure port 34567 is free. The app logs
  `[import] listening on http://127.0.0.1:34567/import` when the import server is up.
- Extension missing after loading: check Developer mode is on, then click **Reload** on the extension.
- "Chrome did not allow access": click Send again and allow it, or click **Allow access in a tab**.
- More cases: [README.md → Troubleshooting](./README.md#troubleshooting).
