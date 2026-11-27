# Website verification

Branch `feat/website`, worktree `.worktrees/website`. Not pushed, no PR yet (this step's instructions). All evidence below was produced on this machine on 2026-11-26. Screenshots are in `verify/` (next to this file); inspection crops in `inspect/`.

## What was built

- `site/`: static HTML, one stylesheet, vanilla JS, no build step in CI. 31 pages: home, `extension/`, 3 use cases, 2 comparisons, a 23-page docs section (`docs/`), plus `404.html`, `.nojekyll`, `sitemap.xml` (30 URLs), `robots.txt` (all crawlers incl. GPTBot, ClaudeBot, PerplexityBot etc. allowed), `llms.txt`, favicons, `og.png` 1200x630, manifest.
- Generators (committed, not deployed): `site/tools/build-docs.mjs` (docs pages, search index, sitemap, llms.txt docs list from `site/tools/docs-src/`), `sync-partials.mjs` (shared head/header/footer and the home FAQPage JSON-LD), `check.mjs` (static checks, run in the Pages workflow), `serve.mjs`, `verify.mjs`, `build-brand.mjs`, `optimize.mjs`, `encode-video.mjs`, `capture/` (Playwright spec + "Acme Admin" demo app).
- `.github/workflows/pages.yml`: push to main on `site/**` plus `workflow_dispatch`; permissions `contents: read, pages: write, id-token: write`; concurrency group `pages`; runs the three zero-dep checks, uploads `site/` minus `tools/`. CI (`ci.yml`) is unchanged.
- README: one line changed, `[Website](https://hamzasohail123.github.io/sessionforge/) · ` prepended to the links row. `git diff main -- README.md` shows 1 insertion, 1 deletion. Shortcuts table untouched.
- `package.json` / `package-lock.json`: unchanged. sharp, ffmpeg-static and axe-core came from a throwaway prefix `/tmp/sessionforge-site-tools`.

## How the pictures and video were made (all real)

`npm run electron:build && npm run rebuild:native`, then
`SF_CAPTURE_DISPLAY=:99 npx playwright test -c site/tools/capture/playwright.config.ts` (3 tests: screenshots, video, extension; 3 passed, home-guard "real editor config files unchanged").

- The app ran from `launchApp()` (temp profile under /tmp, `SESSIONFORGE_E2E=1`, temp editor-config home) on a nested Xephyr X server (`Xephyr :99 -screen 3000x4400`), because a 2x 1440x900 window is larger than this laptop's screen and the window manager shrank it.
- Pages: only the local demo app (`site/tools/capture/demo-app.ts`, fictional names, `@example.com`). `assertLocalOnly` checks every tab URL before every capture. The extension test asserts Chrome made no request outside localhost/127.0.0.1.
- Screenshots at deviceScaleFactor 2 (PNG width asserted 2880). MCP port is the real default 34568 (the test refuses to run if 34568 is taken). `assertNoToken` checks the renderer text before Settings captures; a second check fails if the visible Settings text contains the home directory (this is why the Chrome Import panel is not shown: it prints the extension folder path).
- Settings image (Addendum 5): one capture, the modal at its normal width (1100 px) on MCP Server → Overview, the window made tall enough that the panel has no inner scrollbar (asserted: no vertical or horizontal overflow), shown over the dimmed app with a 40 px margin. Shows "Listening on http://127.0.0.1:34568/mcp", "1 connected", client `demo-agent 1.0.0`. The token is not on this tab at all.
- Extension popups: real popup UI of an unpacked copy of `chrome-extension/` in Chrome for Testing 153 (`~/.cache/ms-playwright/chromium-1243`, branded Chrome ignores `--load-extension`), opened with `chrome.action.openPopup()` and captured through CDP. The copy differs only in the import port (the test app's free port, as README "Requirements" documents) and in localhost + google.com site access granted in the manifest, which stands in for clicking Allow in Chrome's permission prompt (automation can't click it). States captured for real: consent, ready, sent, "Send to Admin (SessionForge asked for this)", sent to Admin. Not captured: the update notice (it needs a newer release from GitHub; the run blocks api.github.com).
- Sign in with Chrome: `SESSIONFORGE_TEST_GOOGLE_ORIGIN` pointed at a local stub page that says it stands in for Google; `SESSIONFORGE_TEST_BROWSER_LOG` received the URL. Banner offer and waiting states, and the pane continuing to the demo app after the hand-off, are real. No Google account or page was used. The caption says so.
- Video: 220 frames (shell + pane views captured separately, composited with sharp, real per-frame durations), 19.2 s. `demo.mp4` H.264 High 1280x800 30 fps, no audio, 356 KB; `demo.webm` VP9 424 KB; poster `demo-poster.webp` (frame at 12 s, Agent label and Stop visible). An MCP client really drives the Admin pane (list_sessions, open, snapshot, type, click Refund) and the Customer pane shows "Refunded".
- Optimise: full windows as lossy WebP q92 at 2880 (2x) and 1440 (1x); UI crops as lossless WebP 2x and 1x. All tagged sRGB. Colour check against the raw capture (mean RGB per image, raw vs output): split-columns 192.5/195.5/201.0 vs 192.1/195.3/200.8; grid 197.5/198.3/202.6 vs 197.1/198.1/202.3. No tint. The earlier "blue" look came from the old palette PNG fallback (pixel samples off by up to 50 levels in the tab bar); those PNGs are gone.

Every image was opened and inspected: no Google or real site, no token, no home path, PROD visible in the grid and session bar, text legible.

## Commands and results

| Command | Result |
|---|---|
| `node site/tools/build-docs.mjs --check` | docs up to date |
| `node site/tools/sync-partials.mjs --check` | partials in sync |
| `node site/tools/check.mjs` | site check passed: 31 pages, 4.85 MB deployed (planted "robust" made it fail, then removed) |
| `node site/tools/serve.mjs` + `node site/tools/verify.mjs` | all browser checks passed, exit 0 |
| `npm run typecheck` | exit 0 |
| `npx eslint --no-eslintrc -c .eslintrc.cjs . --ext ts,tsx --report-unused-disable-directives --max-warnings 0` | exit 0 (plain `npm run lint` fails in a nested worktree because ESLint also loads the parent's config; CI uses a normal checkout) |
| `npx playwright test --project=unit` | 463 passed |
| `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/pages.yml'))"` | parses; jobs `deploy`, permissions as required |

`check.mjs` covers per page: one h1, unique title ≤ 60 and description 120-160 chars, canonical = OG URL, OG/Twitter tags, JSON-LD parses (home: SoftwareApplication + FAQPage equal to the visible FAQ; extension: SoftwareApplication BrowserApplication; others: BreadcrumbList + TechArticle), every relative href/src/srcset/poster resolves incl. #anchors, no root-absolute paths except 404, no off-site scripts/images, no inline scripts or styles, every img has alt/width/height, no `target="_blank"`, no banned words or em dash in visible text, MCP snippets equal the README byte for byte (12 blocks), sitemap = all pages, size budget ≤ 10 MB and each video ≤ 4 MB.

`verify.mjs` (Playwright driving `/usr/bin/google-chrome`, site served under `/sessionforge/`):
- Main pages at 375/768/1440 in dark and light, docs pages at 1440 dark and 375 light: HTTP 200, no console errors, no failed requests, no third-party requests, no horizontal overflow, all images load, axe WCAG 2 A/AA with no serious or critical violations.
- Screenshot sizes: no image upscaled at dpr 1 or 2; at 1440 every image renders at ≥ 80% of its CSS size (most at 100%). Rendered/natural CSS width at 1440 and 375:

| Page | Image | 1440 | 375 |
|---|---|---|---|
| home | grid (full window) | 1198/1440 | 333/1440 |
| home | agent-header | 714/714 | 333/714 |
| home | prod-bar | 720/720 | 333/720 |
| home | popup-ready | 352/352 | 333/352 |
| home | settings-overview-modal | 1098/1098 | 333/1098 |
| extension | popups (5) | 352/352 | 333/352 |
| extension | ext-banner, ext-waiting | 700/700 | 333/700 |
| extension | ext-imported, ext-signin-done | 1198/1400 | 333/1400 |
| use cases | grid, agent, split-columns | 1198/1440 | 333/1440 |
| use cases | new-session-dialog | 528/528 | 333/528 |
| docs | prod-bar, ext-banner | 670/720, 670/700 | 333 |
| docs | other crops | 100% | 333 |

  At 375 px every image is scaled to the column (333 px); click to zoom opens the 2x file.
- Lightbox: opens on Enter, shows the 2x file, Escape closes, focus returns to the link.
- Docs: three columns at 1440 (sidebar, article, On this page), TOC hidden at 1024, drawer closed by default at 375 and opens/closes with Menu and Escape (`verify/docs/*`). TOC highlights the right heading for all 7 headings on MCP setup. Search: Ctrl+K and "/" open it; "stdio" → stdio bridge and Enter navigates there; "keyboard", "approvals", "permissions", "set_layout", "notarized", "roadmap" all return a page. Prev/next and sidebar order match `nav.json` on all 23 pages.
- Alignment (Addendum 5): with a debug outline on every `.container` (added through the CSSOM for the check only; screenshots `verify/edges-*.png`), the home page has all 16 containers at x 120-1320 at 1440 and 20-355 at 375; the docs page has all at the same edges; no figure, code block, table or image sits outside its container, and every image is inside its frame. Inspected by eye: edges line up, section spacing is uniform, #mcp holds only the steps, the editor tabs and one snippet, with no image.
- Theme toggle flips `data-theme`, persists in `localStorage['sf-theme']` across reload and to another page; no cookies set.
- Download label: macOS, Windows and Linux user agents get "Download for macOS/Windows/Linux".
- Copy buttons write the exact snippet (clipboard read back equals the code text) for export, Cursor, Codex and Claude Code; tabs work with ArrowRight/End/Home; the first Tab reaches the skip link with a 2 px outline.
- Video: WebM plays muted and looped (readyState 4, duration 19.23 s, poster set); MP4 metadata loads (19.23 s); with `reducedMotion: 'reduce'` the video stays paused on its poster.
- Hero (three.js 0.187.0, self-hosted, MIT LICENSE alongside): starts after load on idle; 58.5 fps in headless Chrome on SwiftShader (software GL), 0 frames rendered while off-screen; reduced motion: no WebGL module requested, static CSS still shown; no JS: still shown and the page works. three.js is 185 KB gzipped plus hero.js 4.4 KB (under the 200 KB budget). No WebGL warnings other than Playwright's own screenshot readback ("GPU stall due to ReadPixels"), which the script excludes.
- 404: `/sessionforge/missing/page` returns 404 with the styled page.
- Links: 160 same-origin URLs from all pages answer 200 and all anchors exist. External links open in the same tab.
- Favicon (Addendum 6): `site/favicon.svg` is a 32-unit, integer-snapped 2x2 grid of cyan panes on #0b112b; `favicon.ico` (16/32/48), `favicon-16.png` and `favicon-32.png` are rendered from it. `inspect/favicon-8x.png` shows the old favicon at 16 px (left, the dots and star blur) next to the new one at 16 and 32 px, 8x nearest-neighbour: crisp. All icon and manifest links on home, docs and the 404 page answer 200. Tags come from the shared head partial on every page.
- Header logo: the same mark as inline SVG at 28x28 CSS px; measured position is integer at 1440 and 375, dpr 1 and 2. `inspect/logos.png` (4x / 2x nearest-neighbour, dark and light) shows sharp edges and a clear tile on both themes. Gap 10 px, wordmark 17 px semibold. Same mark in the footer and on the 404 page.

Per-page transfer size (1440 dark, no Lighthouse run; images lazy-load, so this is what loads after scrolling the whole page): home 862 KB (incl. three.js and the video's first range), extension 313 KB, use cases 119-165 KB, comparisons 58 KB, docs 94-142 KB.

## Not verified / open points

- Lighthouse was not run; per-page transfer sizes are reported instead.
- Real GPU FPS was not measured (headless SwiftShader only). Safari and Firefox were not tested.
- The extension's update notice was not captured (see above).
- README says production sessions get a "red banner"; the app shows a red PROD label. The site says "red PROD label". README left as is (out of scope); mention in the PR.
- `robots.txt` under `/sessionforge/` is informational: crawlers read robots.txt only at the host root.
- Branch also carries `adf66a4 chore: ignore .worktrees`.
- GitHub Pages is not enabled yet and nothing is pushed; the first deploy happens after merge.

## Review fixes (review.json, 6 findings)

What changed:
1. Header, footer and 404 logo: the inline mark is redrawn on a 28-unit viewBox (`rx 6`, panes at 3 and 16, 9x9 outer with 2-unit strokes and 2-unit radii), shown at 28 px, so every edge lands on a whole pixel at dpr 1 and 2. The favicon files keep the 32-unit mark. `sync-partials.mjs` rewrote all 31 pages.
2. Frame titles: `.frame-bar span` now sits between `inset-inline: 72px` (the dots end at 61 px) with ellipsis, so it never covers the dots.
3. Coding-agent page: the sidebar-less `settings-overview-panel` image is removed (files deleted, capture spec no longer produces it); the page links to the Settings image on the home page. Swapping in the modal there was tried, but the article column shows it at 69% (verify.mjs fails it as unreadable), so the link is the readable option.
4. Settings image: re-cropped to the modal itself, just inside its 1 px border (1098x942 CSS, from the same capture), so the site frame is the modal edge and no dimmed app fragments show. It is left-aligned at the container edge (x 120 at 1440) instead of centred.
5. `agent-header`: the crop now spans the whole Admin pane (714 CSS px, inside its focus border), so the right edge is the pane edge; "Morgan Lee · Admin", the Refunds card and the Refund button are whole.
6. Narrow images: one rule, left-aligned with the text column (feature-row images `justify-self: start`, `.shot-row` `justify-content: flex-start`, `.stack-shots` `justify-items: start`). Popup cards in a row stretch to the same height; the popup area fills with the popup's white so all captions sit on one baseline.

Run (the machine rebooted mid-pass, so `/tmp/sessionforge-site-tools` was reinstalled with `npm install --prefix /tmp/sessionforge-site-tools sharp@0.35 axe-core@4`):

| Command | Result |
|---|---|
| `node site/tools/sync-partials.mjs --check` | partials in sync |
| `node site/tools/check.mjs` | site check passed: 31 pages, 4.69 MB deployed |
| `node site/tools/serve.mjs 4321` + `node site/tools/verify.mjs` | all browser checks passed, exit 0 (53 checks; log in `verify.log`). A first run failed on the modal at 69% on the coding-agent page, which led to fix 3. |

Visual checks (viewport-clipped slices, each under 1600 px tall, opened by eye):
- Logo at 1440, dpr 1 and 2, dark and light, on home, docs and 404: mark box is 28x28 at integer x 120, y 18. A pixel row through the top panes reads only two values (17 background, 211 stroke): 2 px strokes at dpr 1, 4 px at dpr 2, no half-tone columns. 8x nearest-neighbour zoom shows square, even outlines.
- 375 px frame bars (dpr 2): on home, coding-agent and extension pages the title starts at x 93, the dots end at x 82; long titles end in "…" ("Admin · Customer · Guest …").
- Home 1440: agent row (pane crop whole, right edge clean), production crop and extension popup left-aligned at x 658 / 120 in their columns, Settings modal from x 120 with no dimmed margin.
- Extension 1440: both popup rows start at x 120, cards share one height with captions aligned at the bottom; sign-in banners start at x 120.
- Docs MCP 1440: agent-header fits the article column (672 px) with its caption.


## Addendum 5 follow-up: every section spans the full container width

User feedback: some sections sat on the left (short image or content) while the header and 4-step cards span the container.

What changed:
- Home `#production`: now a two-column `feature-row` (text left, 5fr/7fr like its neighbours); the PROD session-bar crop sits centred on a `.panel` (dotted backdrop card) that fills the right column.
- Home `#extension` and `#agent`: the popup and the Agent-header crop sit on a `.panel` that fills the image column.
- Home `#settings`: intro text keeps its 720px measure; the modal image sits on a full-container `.panel`.
- Home `#mcp`: `mcp-body` (760px max) replaced by `mcp-grid` at the same 5fr/7fr split: steps, export line and docs link left, editor tabs and snippet right. No image. Stacks below 1024px.
- Home `#faq`: removed the 820px cap on the list (answers keep a 720px measure).
- Extension page: each popup is a `.panel` with its caption; popup rows are equal-width grid columns spanning the container, with captions on one line via subgrid (the 3-popup row stacks at 900-1023px). The two sign-in banners stack, one full-width panel each (side by side they shrank to 74%, which verify.mjs rejected).
- Multi-role use case: the New Session dialog sits on a panel that fills the text column.
- Compare pages: removed the 1120px `.wide` cap from the comparison table.
- Images are never drawn wider than their file (measured); srcset 2x keeps them sharp.

Measurement (`node site/tools/measure-widths.mjs`, Playwright + /usr/bin/google-chrome, viewport height 900, lazy images forced to load). Gap = container content right edge minus the right edge of the block's widest visual element (img, video, pre, .code, .tabs, .frame, .panel, .cards, .steps, .check-list, .table-wrap, .faq, .cta-band), from getBoundingClientRect, tolerance 2px. "text" = section has no visual element. Prose rows measure against the text column. Before the fix, 30 blocks failed (for example #production 478px, #mcp 440px, #extension 309px at 1440).

| Page | Block | 1440 | 1280 | 1024 | 768 | 375 |
|---|---|---|---|---|---|---|
| / | #hero | text | text | text | text | text |
| / | #demo | 0 | 0 | 0 | 0 | 0 |
| / | #platforms | text | text | text | text | text |
| / | #features | 0 | 0 | 0 | 0 | 0 |
| / | #agent | 0 | 0 | 0 | 0 | 0 |
| / | #production | 0 | 0 | 0 | 0 | 0 |
| / | #extension | 0 | 0 | 0 | 0 | 0 |
| / | #settings | 0 | 0 | 0 | 0 | 0 |
| / | #how-it-works | 0 | 0 | 0 | 0 | 0 |
| / | #mcp | 0 | 0 | 0 | 0 | 0 |
| / | #security | 0 | 0 | 0 | 0 | 0 |
| / | #use-cases | 0 | 0 | 0 | 0 | 0 |
| / | #download | 0 | 0 | 0 | 0 | 0 |
| / | #faq | 0 | 0 | 0 | 0 | 0 |
| /extension/ | block 2 shot-row | 0 | 0 | 0 | 0 | 0 |
| /extension/ | block 3 frame | 0 | 0 | 0 | 0 | 0 |
| /extension/ | block 6 stack-shots | 0 | 0 | 0 | 0 | 0 |
| /extension/ | block 7 shot-row | 0 | 0 | 0 | 0 | 0 |
| /extension/ | block 8 frame | 0 | 0 | 0 | 0 | 0 |
| /extension/ | block 10 prose > table-wrap | 0 | 0 | 0 | 0 | 0 |
| /extension/ | block 11 cta-band | 0 | 0 | 0 | 0 | 0 |
| /use-cases/multi-role-testing/ | block 1 frame | 0 | 0 | 0 | 0 | 0 |
| /use-cases/multi-role-testing/ | block 3 prose > panel | 0 | 0 | 0 | 0 | 0 |
| /use-cases/multi-role-testing/ | block 4 cta-band | 0 | 0 | 0 | 0 | 0 |
| /use-cases/coding-agent-browser/ | block 1 frame | 0 | 0 | 0 | 0 | 0 |
| /use-cases/coding-agent-browser/ | block 3 prose > code | 0 | 0 | 0 | 0 | 0 |
| /use-cases/coding-agent-browser/ | block 4 cta-band | 0 | 0 | 0 | 0 | 0 |
| /use-cases/exploratory-qa/ | block 1 frame | 0 | 0 | 0 | 0 | 0 |
| /use-cases/exploratory-qa/ | block 3 cta-band | 0 | 0 | 0 | 0 | 0 |
| /compare/chrome-profiles/ | block 1 table-wrap | 0 | 0 | 0 | 0 | 0 |
| /compare/chrome-profiles/ | block 3 cta-band | 0 | 0 | 0 | 0 | 0 |
| /compare/playwright/ | block 1 table-wrap | 0 | 0 | 0 | 0 | 0 |
| /compare/playwright/ | block 3 cta-band | 0 | 0 | 0 | 0 | 0 |

Gap = container right edge minus the widest visual element's right edge, in px (tolerance 2).
All blocks reach the container edge.


Other checks:
| Command | Result |
|---|---|
| `node site/tools/sync-partials.mjs --check` | partials in sync |
| `node site/tools/check.mjs` | site check passed: 31 pages, 4.70 MB deployed |
| `node site/tools/verify.mjs` | all browser checks passed (first run flagged the side-by-side banners at 74%; fixed by stacking) |
| `npm run lint` | clean when ESLint uses only the worktree config (`--no-eslintrc -c .eslintrc.cjs`); plain `npm run lint` in the nested worktree also loads the parent checkout's `.eslintrc.cjs` and errors on a duplicate plugin, which is local only |

Screenshots (viewport only, opened by eye): home #production, #mcp, #settings at 1440 dark; extension page popup row at 1440 dark; #production and #mcp at 375 dark; #extension at 1440 light. All visual blocks end at the header's right edge (x 1320 at 1440); mobile stacks text then panel cleanly.
