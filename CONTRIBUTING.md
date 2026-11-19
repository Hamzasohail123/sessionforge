# Contributing to SessionForge

Thanks for helping. SessionForge is Apache-2.0 and welcomes issues, docs fixes and pull requests.

- [Code of Conduct](#code-of-conduct)
- [Set up](#set-up)
- [Find something to work on](#find-something-to-work-on)
- [Make the change](#make-the-change)
- [Test it](#test-it)
- [Commit and open a pull request](#commit-and-open-a-pull-request)
- [Coding standards](#coding-standards)
- [Becoming a maintainer](#becoming-a-maintainer)

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By taking part you agree to it.

## Set up

1. Fork the repository and clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/sessionforge.git
   cd sessionforge
   ```
2. Install and build the native module for Electron:
   ```bash
   npm install
   npm run rebuild:native
   ```
3. Start the app with hot reload:
   ```bash
   npm run electron:dev
   ```
4. Check your setup: create two sessions, log in to the same site in each, and confirm they stay separate.

Requirements, commands, the project layout and common problems are in [DEVELOPMENT.md](./DEVELOPMENT.md).

## Find something to work on

- Issues labelled `good first issue` or `help wanted`.
- [ROADMAP.md](./ROADMAP.md) lists the planned milestones (M2 network log and request rules is next).
- For a new feature, open an issue or a discussion first. The roadmap has a "Not building" list; features
  on it (cloud sync, telemetry, a full Postman, anti-detection) won't be merged.

## Make the change

1. Comment on the issue so others know you're on it.
2. Branch from `main`: `git checkout -b feat/short-name`.
3. Keep the change focused. Update docs when behaviour changes.

## Test it

```bash
npm run typecheck
npx playwright test --project=unit   # fast unit specs
npm run test:e2e                     # builds the app, then unit + Electron e2e specs
```

CI runs typecheck and unit specs on Linux, macOS and Windows, and the e2e suite on Linux and macOS.
Add or update specs for what you change: pure logic goes in `e2e/unit/`, behaviour you can see in the app
goes in an `e2e/*.spec.ts` that loads pages from the local test server (`e2e/fixtures/test-server.ts`).

**Isolation is the core promise.** If your change touches sessions, partitions, popups or window handling,
`e2e/isolation.spec.ts` must pass, and do the manual check in
[DEVELOPMENT.md → Tests](./DEVELOPMENT.md#tests).

Manual checks before you open the PR, where relevant:

- [ ] Create, rename and delete sessions
- [ ] Open, navigate and close tabs; back, forward, reload
- [ ] Switch layouts (single, columns, rows, grid) and focus panes with `Cmd/Ctrl+1`–`4`
- [ ] "Send to SessionForge" from the Chrome extension opens the session in a pane
- [ ] A production session shows its banner
- [ ] Restarting keeps sessions, tabs and layout
- [ ] DevTools open for a tab

## Commit and open a pull request

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description

Longer explanation if needed.

Fixes #123
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`.
Scopes: `sessions`, `tabs`, `layout`, `ui`, `ipc`, `database`, `import`, `extension`, `agent`, `playwright`,
`security`, `build`, `docs`.

Sign off every commit ([Developer Certificate of Origin](https://developercertificate.org/)):

```bash
git commit -s -m "fix(tabs): keep popups in the parent session"
```

Pull requests:

1. Describe what changed and why, how to test it, and the related issue.
2. CI must pass.
3. Changes to isolation, the import server or the Agent Bridge security model need a maintainer review.
4. Answer review comments with new commits; don't force-push during review.

Never commit cookies, tokens or exported `storageState` files. `.gitignore` excludes `*-storageState.json`
and `*.playwright.json`, but check `git status` before you commit.

## Coding standards

**TypeScript**: strict mode; avoid `any`; validate anything that crosses a process or network boundary with zod.

**Electron**
- Main process is trusted; the renderer has no Node.js; web content is untrusted and sandboxed.
- Every IPC handler validates its input with zod (`src/main/ipc.ts`).
- Popups and new windows go through the window-open handler so they stay in their session.
- Local servers bind `127.0.0.1` only and reject requests from web pages (see `import-server.ts` and
  `agent/http-guard.ts`).

**React**: function components with hooks; zustand for UI state, TanStack Query for data from main.
Page views are drawn above the DOM, so dialogs and panels use the overlay pattern (`useViewOverlay`) or
shrink the pane rects.

**Security**: no `dangerouslySetInnerHTML`, no remote content in the UI, no secrets in logs (agent output
goes through `agent/redact.ts`).

## Becoming a maintainer

After about 5 non-trivial merged PRs over 2 or more months, and a good grasp of the codebase and goals,
you may be invited to become a maintainer (review, merge, triage, releases).

## Questions

- Questions and ideas: GitHub Discussions
- Bugs: GitHub Issues
- Security problems: see [SECURITY.md](./SECURITY.md); please don't open a public issue
