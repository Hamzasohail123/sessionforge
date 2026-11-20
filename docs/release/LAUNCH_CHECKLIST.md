# v0.1.0 launch checklist

The steps an agent can't do for you, in order. Commands assume Linux or macOS, run from the project folder:

```bash
cd /path/to/sessionforge   # the folder with package.json
```

Replace `<owner>` with your GitHub user name everywhere below.

## 0. Before you start

- [ ] The Agent Bridge work is finished and the pending edits are applied (`package.json` scripts and version,
      `electron-builder.yml`, README hero and install section).
- [ ] Local checks pass:
      ```bash
      npm run typecheck
      npx playwright test --project=unit
      npm run test:e2e
      ```
- [ ] List every file that still has the `<owner>` placeholder (the whole tree, without build output,
      dependencies and this checklist, which keeps `<owner>` so the commands stay reusable):
      ```bash
      grep -rlI --exclude-dir={node_modules,.git,.agents,out,dist-electron,test-artifacts,test-results} --exclude=LAUNCH_CHECKLIST.md "<owner>" .
      ```
      Replace it with your GitHub name in all of them, for example (works on Linux and macOS):
      ```bash
      grep -rlI --exclude-dir={node_modules,.git,.agents,out,dist-electron,test-artifacts,test-results} --exclude=LAUNCH_CHECKLIST.md "<owner>" . \
        | xargs perl -pi -e 's/<owner>/YOUR_GITHUB_NAME/g'
      ```
      Run the first command again; it should print nothing. (A `release/…/app-update.yml` from an earlier local
      `npm run package` may still show up; `release/` is build output, git ignores it, and the next package
      run rewrites it.)

## 1. Create the GitHub repository

On https://github.com/new: name `sessionforge`, **no** README, license or .gitignore (the project has
them). Choose **Private** for now: you can check CI and the release build before anyone sees it, then
make it public in step 10.

**Watch the Actions minutes while the repo is private.** GitHub Actions is free for public repositories,
but a private repository on the Free plan gets 2,000 minutes a month, and a macOS minute counts as 10
([GitHub billing docs](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)).
One CI run (with the macOS e2e job) plus one tagged release (two macOS builds) can use several hundred of
those. If CI needs more than one or two fix-and-retry rounds, make the repo public first (step 10.1) and
keep iterating there; a brand-new public repo gets almost no visitors until you post about it.

With the GitHub CLI instead:
```bash
gh repo create <owner>/sessionforge --private --description "Multi-session browser for developers, QA and coding agents. Every role logged in, side by side." --homepage "https://github.com/<owner>/sessionforge"
```

## 2. git init

```bash
git init -b main
git config user.name "Your Name"
# Every commit shows this address publicly. To keep your real address private use GitHub's noreply
# address from https://github.com/settings/emails (looks like 12345+<owner>@users.noreply.github.com)
git config user.email "<id>+<owner>@users.noreply.github.com"
```

## 3. Check what will be committed (secrets)

```bash
git add -A
git status --short | less
```

Nothing of the following may appear in the list:
- `.agents/`, `node_modules/`, `out/`, `dist-electron/`, `release/`, `test-artifacts/`, `test-results/`
- any `*.db`, `*-storageState.json`, `*.playwright.json`, `.env`

Then search the staged files:
```bash
git diff --cached --name-only | grep -Ei '\.db$|storagestate|\.env|\.pem$|\.p12$|\.key$' ; echo "files check done"
git grep --cached -nIE 'ghp_[A-Za-z0-9]{20,}|github_pat_|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|xox[baprs]-' -- . ':!docs/release/LAUNCH_CHECKLIST.md' ; echo "token check done"
git grep --cached -nI "/home/$USER" ; echo "path check done"
git grep --cached -nI "/Users/$USER" ; echo "mac path check done"
```
Each command should print only its "done" line. (The token check skips this checklist, which contains the
patterns themselves.) If anything shows up, `git rm --cached <file>` or fix the file, `git add` it again,
and rerun the checks before committing.

## 4. First commit

```bash
git commit -s -m "feat: SessionForge v0.1.0"
```

## 5. Push

```bash
git remote add origin https://github.com/<owner>/sessionforge.git
git push -u origin main
```

Open https://github.com/<owner>/sessionforge/actions and wait for **CI** to go green. It runs typecheck
and unit tests on Linux, macOS and Windows, and the e2e suite on Linux and macOS. The macOS run is the first
time the suite runs on a Mac; fix any failures before tagging. (The **lint** job may fail; it doesn't block.)

## 6. Topics and repo settings

```bash
gh repo edit <owner>/sessionforge \
  --add-topic electron --add-topic browser --add-topic multi-session --add-topic qa \
  --add-topic testing --add-topic playwright --add-topic mcp --add-topic cursor \
  --add-topic codex --add-topic developer-tools \
  --enable-discussions --enable-issues
```
Or on the repo page: ⚙ next to "About" → Topics. In Settings → General, enable Discussions.

Also turn on Settings → Code security → **Private vulnerability reporting**, so SECURITY.md's reporting
link works, and check that CODE_OF_CONDUCT.md's "reported to the project maintainers" has a way to reach
you (for example an e-mail address you're happy to publish).

## 7. Tag v0.1.0 (builds the release)

```bash
git tag -a v0.1.0 -m "SessionForge v0.1.0"
git push origin v0.1.0
```

The **Release** workflow builds macOS arm64 and x64 DMGs, the Windows installer, and the Linux AppImage and
.deb, then creates a **draft** release with those files and `SHA256SUMS.txt`. It takes about 15–25 minutes.

## 8. Check and publish the draft release

1. Open https://github.com/<owner>/sessionforge/releases. The draft is only visible to you.
2. Download and try what you can:
   - Linux (Ubuntu 23.10 and later): `sudo apt install ./SessionForge-*-linux-amd64.deb`. The .deb's install
     script makes Chromium's `chrome-sandbox` helper setuid, so the app runs with the sandbox on.
   - Linux AppImage: `chmod +x SessionForge-*.AppImage && ./SessionForge-*.AppImage`. On Ubuntu 23.10+
     AppArmor blocks unprivileged user namespaces and the AppImage aborts with "The SUID sandbox helper
     binary was found, but is not configured correctly". `--no-sandbox` starts it, but turns off Chromium's
     sandbox for every page, so a browser exploit on a malicious page runs with your user's rights. An
     AppArmor profile that allows user namespaces for the AppImage keeps the sandbox. README → Installation
     says the same.
   - macOS (if you can borrow a Mac): open the DMG, drag to Applications, open it once, then
     System Settings → Privacy & Security → **Open Anyway**. Check `xattr -dr com.apple.quarantine /Applications/SessionForge.app` also works.
   - Windows: run the installer, then SmartScreen **More info → Run anyway**.
3. Edit the notes. Put the limitations at the top (copy from POSTS.md "Known limitations").
4. Click **Publish release**.

If a build failed: fix it, delete the tag (`git tag -d v0.1.0 && git push origin :refs/tags/v0.1.0`),
delete the draft on GitHub, and tag again.

## 9. Record the demo

Follow `docs/release/DEMO_SCRIPT.md`. Save:
- `docs/release/demo.mp4` (or upload to YouTube/X directly) and
- `docs/release/demo.gif` (README hero image, under ~8 MB), for example:
  ```bash
  ffmpeg -i demo.mp4 -vf "fps=12,scale=1200:-1:flags=lanczos" -loop 0 docs/release/demo.gif
  ```
`main` is protected, so add it through a pull request. Also put the image back in README.md: line 10
has it commented out (`<!-- Demo GIF goes here … -->`); replace that comment with the image line inside it.
```bash
git switch -c docs/demo-gif
git add docs/release/demo.gif README.md
git commit -s -m "docs: add demo GIF"
git push -u origin docs/demo-gif
gh pr create --fill
gh pr merge --squash --auto    # merges by itself once CI passes
```

## 10. Go public

1. Settings → General → Danger Zone → **Change visibility → Public**.
2. Check the README renders, the GIF plays, and the release is listed.
3. Open these in a private (logged-out) browser window and check that none is a 404. The Chrome Web Store
   reviewer opens them in step 11:
   - `https://github.com/<owner>/sessionforge`
   - `https://github.com/<owner>/sessionforge/issues`
   - `https://github.com/<owner>/sessionforge/blob/main/chrome-extension/store/PRIVACY.md`

## 11. Chrome Web Store (only after step 10)

The listing's privacy policy, homepage and support URLs point into the repository, so they only work once
it is public. Submitting earlier risks a rejection, and each review round can take days.

1. Pay the one-time **$5** developer registration fee at https://chrome.google.com/webstore/devconsole
   (Google account, accept the agreement, pay).
2. Build the upload zip (every runtime file, nothing from `store/` and no `*.md`/`*.txt` docs):
   ```bash
   cd chrome-extension
   zip ../sessionforge-extension-1.3.1.zip manifest.json popup.html popup.js access.js handoff.js grant.html grant.js background.js icon16.png icon48.png icon128.png
   cd ..
   ```
3. In the dashboard: **New item** → upload the zip.
4. Fill in the listing and the privacy tab from `chrome-extension/store/LISTING.md`. Upload
   `store/icon-128.png`, `store/promo-small-440x280.png`, and at least one 1280×800 screenshot that you take.
5. Privacy policy URL: `https://github.com/<owner>/sessionforge/blob/main/chrome-extension/store/PRIVACY.md`.
6. Paste the "How to verify (for reviewers)" paragraph from `LISTING.md` into the dashboard's **Test
   instructions** field.
7. Submit. The extension has no broad host permission at install, but the review may still be in-depth
   because it uses the cookies API (not verified), so it can take several days. You don't have to wait for it: the launch posts
   say the extension is "Load unpacked" until it is approved.

## 12. Post

1. Post, in this order, a few hours apart, and stay around to answer questions (drafts in `POSTS.md`):
   1. X thread
   2. Show HN (weekday morning US Eastern time is the usual advice)
   3. r/webdev and r/QualityAssurance (read each subreddit's self-promotion rules first)
   4. Cursor forum (Showcase category)
2. Collect bug reports in Issues; label the first ones `good first issue` where you can.
