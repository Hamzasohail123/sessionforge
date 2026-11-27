// Browser checks for the website against the local server (node site/tools/serve.mjs).
// Playwright from the repo's devDependencies driving the system Chrome; axe-core from the throwaway prefix.
// Usage: node site/tools/serve.mjs & node site/tools/verify.mjs [outDir]
// Writes screenshots and results.json to outDir (default .agents/tasks/website/verify/).
import { chromium } from 'playwright'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const OUT = process.argv[2] ?? join(ROOT, '.agents', 'tasks', 'website', 'verify')
mkdirSync(OUT, { recursive: true })
const ORIGIN = process.env.SITE_ORIGIN ?? 'http://127.0.0.1:4321'
const BASE = `${ORIGIN}/sessionforge/`
const axeSource = readFileSync(
  createRequire(join(process.env.SF_SITE_TOOLS ?? '/tmp/sessionforge-site-tools', 'package.json')).resolve('axe-core/axe.min.js'),
  'utf8'
)
const executablePath = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p))
// Main pages get every width and theme; docs pages (generated, same template) 1440 dark and 375 light
const SITEMAP = readFileSync(join(ROOT, 'site', 'sitemap.xml'), 'utf8')
const ALL = [...SITEMAP.matchAll(/<loc>https:\/\/hamzasohail123\.github\.io\/sessionforge\/([^<]*)<\/loc>/g)].map((m) => m[1])
const nameOf = (p) => (p === '' ? 'home' : p.replace(/\/$/, '').replace(/\//g, '_'))
const PAGES = Object.fromEntries(ALL.map((p) => [nameOf(p), p]))
const VIEWS = (path) =>
  path.startsWith('docs/') && !['docs/', 'docs/mcp-setup/'].includes(path)
    ? [[1440, 'dark'], [375, 'light']]
    : [375, 768, 1440].flatMap((w) => [[w, 'dark'], [w, 'light']])
const UAS = {
  macOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
}

const results = { problems: [], pages: {}, checks: {} }
const problem = (msg) => {
  results.problems.push(msg)
  console.log(`✗ ${msg}`)
}
const ok = (msg) => console.log(`✓ ${msg}`)

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
})

/** A page with console, request and failure tracking. */
async function open(path, opts = {}) {
  const context = await browser.newContext({
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    colorScheme: opts.scheme ?? 'dark',
    reducedMotion: opts.reducedMotion ?? 'no-preference',
    userAgent: opts.userAgent,
    deviceScaleFactor: 1
  })
  if (opts.clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
  const page = await context.newPage()
  const log = { console: [], warnings: [], failed: [], thirdParty: [], requests: [] }
  page.on('console', (m) => {
    if (m.type() === 'error') log.console.push(m.text())
    if (m.type() === 'warning') log.warnings.push(m.text())
  })
  page.on('pageerror', (e) => log.console.push(String(e)))
  page.on('request', (r) => {
    log.requests.push(r.url())
    const u = new URL(r.url())
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol !== 'data:') log.thirdParty.push(r.url())
  })
  page.on('requestfailed', (r) => {
    // A video element aborting a range request when it already has what it needs is not a failure
    if (!/\.(mp4|webm)$/.test(r.url())) log.failed.push(`${r.url()} ${r.failure()?.errorText}`)
  })
  page.on('response', (r) => {
    if (r.status() >= 400 && !opts.expect404) log.failed.push(`${r.url()} HTTP ${r.status()}`)
  })
  const response = await page.goto(BASE + path, { waitUntil: 'load' })
  return { context, page, log, response }
}

function report(label, log) {
  if (log.console.length) problem(`${label}: console errors: ${log.console.join(' | ')}`)
  // "GPU stall due to ReadPixels" comes from Playwright's screenshot readback, not from the page
  const gl = log.warnings.filter((w) => /webgl|gl_|three/i.test(w) && !/GPU stall due to ReadPixels/.test(w))
  const stalls = log.warnings.filter((w) => /GPU stall due to ReadPixels/.test(w))
  if (stalls.length) results.readPixelsStalls = (results.readPixelsStalls ?? 0) + stalls.length
  if (gl.length) problem(`${label}: WebGL warnings: ${gl.join(' | ')}`)
  if (log.failed.length) problem(`${label}: failed requests: ${log.failed.join(' | ')}`)
  if (log.thirdParty.length) problem(`${label}: third-party requests: ${log.thirdParty.join(' | ')}`)
}

/** Scroll through the page so lazy images load, then report images that did not decode. */
async function showAll(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight * 0.7) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 250))
    }
    document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-visible'))
    await Promise.race([
      Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r })))),
      new Promise((r) => setTimeout(r, 5000))
    ])
    window.scrollTo(0, 0)
  })
  return page.evaluate(() => [...document.images].filter((i) => !i.closest('dialog') && !(i.naturalWidth > 0)).map((i) => i.currentSrc || i.src))
}

// ---- 1. Every page, three widths, both themes: errors, overflow, screenshots ----
for (const [name, path] of Object.entries(PAGES)) {
  results.pages[name] = {}
  for (const [width, scheme] of VIEWS(path)) {
    {
      const { context, page, log, response } = await open(path, { width, scheme, height: width === 375 ? 812 : 900 })
      const label = `${name} ${width} ${scheme}`
      if (response.status() !== 200) problem(`${label}: HTTP ${response.status()}`)
      await page.waitForTimeout(name === 'home' ? 2500 : 400)
      const m = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        heroLive: document.documentElement.classList.contains('hero-live'),
        imgsNoAlt: [...document.images].filter((i) => !i.closest('dialog')).filter((i) => !i.hasAttribute('alt')).length,
        transfer: performance.getEntriesByType('navigation').concat(performance.getEntriesByType('resource')).reduce((s, e) => s + (e.transferSize || e.encodedBodySize || 0), 0)
      }))
      if (m.theme !== scheme) problem(`${label}: data-theme ${m.theme}`)
      if (m.scrollWidth > m.innerWidth) problem(`${label}: horizontal overflow ${m.scrollWidth} > ${m.innerWidth}`)
      if (m.imgsNoAlt) problem(`${label}: ${m.imgsNoAlt} images without alt`)
      if (name === 'home' && !m.heroLive) problem(`${label}: hero animation did not start`)
      // Overflowing elements (wider than the viewport), for diagnosis
      const wide = await page.evaluate(() =>
        [...document.querySelectorAll('body *')]
          .filter((e) => {
            const r = e.getBoundingClientRect()
            return r.right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.table-wrap, pre, .tablist, .hero-canvas, .hero')
          })
          .slice(0, 5)
          .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`)
      )
      if (wide.length) problem(`${label}: elements past the right edge: ${wide.join(', ')}`)
      report(label, log)
      if (name === 'home') await page.screenshot({ path: join(OUT, `${name}-${width}-${scheme}-hero.png`) })
      const broken = await showAll(page)
      if (broken.length) problem(`${label}: images did not load: ${broken.join(', ')}`)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(OUT, `${name}-${width}-${scheme}.png`), fullPage: true })
      results.pages[name][`${width}-${scheme}`] = { transferBytes: m.transfer, heroLive: m.heroLive }
      // axe (WCAG 2 A/AA) at 375 and 1440
      if (width !== 768) {
        // evaluate() is not subject to the page's CSP (an injected <script> would be)
        await page.evaluate(axeSource)
        const axe = await page.evaluate(async () => {
          // eslint-disable-next-line no-undef
          const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
          return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))
        })
        const bad = axe.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        if (bad.length) problem(`${label}: axe ${JSON.stringify(bad)}`)
        results.pages[name][`${width}-${scheme}`].axe = axe
      }
      await context.close()
    }
  }
  ok(`${name}: ${VIEWS(path).length} views checked`)
}

// ---- 1b. Screenshots: rendered size vs natural size, section screenshots at 1440 and 375 ----
mkdirSync(join(OUT, 'sections'), { recursive: true })
results.images = {}
for (const [name, path] of Object.entries(PAGES)) {
  if (!/<img/.test(readFileSync(join(ROOT, 'site', path, 'index.html'), 'utf8').split('<main')[1] ?? '')) continue
  for (const width of [1440, 375]) {
    for (const dpr of [1, 2]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'dark', deviceScaleFactor: dpr })
      const page = await context.newPage()
      await page.goto(BASE + path)
      await showAll(page)
      const imgs = await page.evaluate(() =>
        [...document.querySelectorAll('main a[data-zoom] img')].map((i) => ({
          file: (i.currentSrc || i.src).split('/').pop(),
          renderedCss: Math.round(i.getBoundingClientRect().width),
          cssNatural: Number(i.getAttribute('width')),
          devicePixelsAvailable: i.naturalWidth * window.devicePixelRatio,
          scale: +(i.getBoundingClientRect().width / Number(i.getAttribute('width'))).toFixed(3)
        }))
      )
      for (const im of imgs) {
        // The browser must not upscale: the chosen file needs at least as many pixels as the image covers on screen
        const needed = im.renderedCss * dpr
        const filePx = im.devicePixelsAvailable
        if (filePx + 2 < needed) problem(`${name} ${width} dpr${dpr}: ${im.file} upscaled (${filePx} px file for ${needed} device px)`)
        if (width === 1440 && im.scale < 0.8) problem(`${name} 1440: ${im.file} shown at ${(im.scale * 100).toFixed(0)}% of its CSS size (app text below ~11 px)`)
      }
      results.images[`${name}-${width}-dpr${dpr}`] = imgs
      if (dpr === 2) {
        const figures = page.locator('main figure:has(a[data-zoom])')
        const n = await figures.count()
        for (let i = 0; i < n; i++) {
          const fig = figures.nth(i)
          await fig.scrollIntoViewIfNeeded()
          await page.waitForTimeout(200)
          // The figure plus its row (text beside or above it), as the reader sees it
          const target = (await fig.evaluate((f) => !!f.closest('.feature-row'))) ? fig.locator('xpath=ancestor::div[contains(@class,"feature-row")][1]') : fig
          await target.screenshot({ path: join(OUT, 'sections', `${name}-${width}-${i + 1}.png`) })
        }
      }
      await context.close()
    }
  }
}
ok(`screenshot sizes checked (${Object.values(results.images).flat().length} image views); section shots in sections/`)

// ---- 1c. Lightbox: opens, shows the 2x file, Esc closes, focus returns ----
{
  const { context, page } = await open('', {})
  const link = page.locator('main a[data-zoom]').nth(0)
  await link.scrollIntoViewIfNeeded()
  await link.focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => { const d = document.querySelector('dialog.lightbox'); const i = d && d.querySelector('img'); return d && d.open && i.complete && i.naturalWidth > 0 }, null, { timeout: 8000 }).catch(() => null)
  const opened = await page.evaluate(() => { const d = document.querySelector('dialog.lightbox'); const i = d.querySelector('img'); return { open: d.open, src: i.src.split('/').pop(), naturalWidth: i.naturalWidth, shownWidth: Math.round(i.getBoundingClientRect().width), focus: document.activeElement.textContent } })
  await page.screenshot({ path: join(OUT, 'lightbox-open.png') })
  await page.keyboard.press('Escape')
  const closed = await page.evaluate(() => ({ open: document.querySelector('dialog.lightbox').open, focusIsLink: document.activeElement.matches('a[data-zoom]') }))
  results.checks.lightbox = { opened, closed }
  if (!opened.open || !opened.naturalWidth || closed.open || !closed.focusIsLink) problem(`lightbox: ${JSON.stringify(results.checks.lightbox)}`)
  else ok(`lightbox: ${JSON.stringify(results.checks.lightbox)}`)
  await context.close()
}


// ---- 1d. Docs: layout per width, drawer, TOC highlight, search, prev/next order ----
mkdirSync(join(OUT, 'docs'), { recursive: true })
{
  const nav = JSON.parse(readFileSync(join(ROOT, 'site', 'tools', 'docs-src', 'nav.json'), 'utf8')).flatMap((g) => g.pages)
  const docsOrder = nav.map((s) => (s ? `docs/${s}/` : 'docs/'))
  for (const path of ['docs/', 'docs/mcp-setup/']) {
    for (const [width, height] of [[1440, 900], [1024, 800], [375, 812]]) {
      for (const scheme of ['dark', 'light']) {
        const { context, page } = await open(path, { width, height, scheme })
        const cols = await page.evaluate(() => ({
          nav: getComputedStyle(document.querySelector('.docs-nav')).visibility !== 'hidden' && document.querySelector('.docs-nav').getBoundingClientRect().width > 0 && getComputedStyle(document.querySelector('.docs-nav')).position !== 'fixed',
          toc: getComputedStyle(document.querySelector('.docs-toc')).display !== 'none',
          menu: getComputedStyle(document.querySelector('.docs-menu')).display !== 'none'
        }))
        const want = width >= 1200 ? { nav: true, toc: true, menu: false } : width >= 900 ? { nav: true, toc: false, menu: false } : { nav: false, toc: false, menu: true }
        if (JSON.stringify(cols) !== JSON.stringify(want)) problem(`${path} ${width} ${scheme}: columns ${JSON.stringify(cols)}, want ${JSON.stringify(want)}`)
        const tag = `${nameOf(path)}-${width}-${scheme}`
        await page.screenshot({ path: join(OUT, 'docs', `${tag}.png`) })
        if (width === 375) {
          await page.click('[data-docs-menu]')
          await page.waitForTimeout(350)
          const opened = await page.evaluate(() => [document.querySelector('[data-docs-menu]').getAttribute('aria-expanded'), document.querySelector('.docs-nav').getBoundingClientRect().left])
          await page.screenshot({ path: join(OUT, 'docs', `${tag}-drawer.png`) })
          await page.keyboard.press('Escape')
          await page.waitForTimeout(300)
          const closed = await page.evaluate(() => document.querySelector('[data-docs-menu]').getAttribute('aria-expanded'))
          if (opened[0] !== 'true' || opened[1] < -1 || closed !== 'false') problem(`${path} 375 drawer: ${JSON.stringify({ opened, closed })}`)
        }
        await context.close()
      }
    }
  }
  // TOC: scroll to each h2 and check which link is current
  {
    const { context, page } = await open('docs/mcp-setup/', { width: 1440, height: 900 })
    const ids = await page.evaluate(() => [...document.querySelectorAll('.docs-toc a')].map((a) => a.getAttribute('href').slice(1)))
    const wrong = []
    for (const id of ids) {
      await page.evaluate((i) => { const h = document.getElementById(i); window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 90) }, id)
      await page.waitForTimeout(250)
      const cur = await page.evaluate(() => document.querySelector('.docs-toc a[aria-current="true"]')?.getAttribute('href') ?? null)
      if (cur !== `#${id}`) wrong.push(`${id} -> ${cur}`)
    }
    await page.screenshot({ path: join(OUT, 'docs', 'toc-highlight.png') })
    results.checks.toc = { headings: ids.length, wrong }
    if (wrong.length) problem(`TOC highlight: ${wrong.join(', ')}`)
    else ok(`TOC highlights the right heading for all ${ids.length} headings`)
    // Search: Ctrl+K and "/" open it, a keyword finds the page, Enter goes there
    await page.keyboard.press('Control+k')
    await page.waitForSelector('dialog.docs-search[open]')
    await page.keyboard.type('stdio')
    await page.waitForTimeout(150)
    const first = await page.evaluate(() => document.querySelector('.docs-results li a')?.getAttribute('href'))
    await page.screenshot({ path: join(OUT, 'docs', 'search.png') })
    await page.keyboard.press('Enter')
    await page.waitForURL(/stdio-bridge/, { timeout: 5000 }).catch(() => null)
    await page.waitForLoadState('load')
    const landed = page.url()
    await page.keyboard.press('/')
    const slashOpens = await page.evaluate(() => !!document.querySelector('dialog.docs-search[open]'))
    await page.keyboard.press('Escape')
    const queries = {}
    for (const q of ['keyboard', 'approvals', 'permissions', 'set_layout', 'notarized', 'roadmap']) {
      await page.keyboard.press('Control+k')
      await page.fill('#docs-q', q)
      queries[q] = await page.evaluate(() => document.querySelector('.docs-results li a')?.getAttribute('href') ?? null)
      await page.keyboard.press('Escape')
    }
    results.checks.search = { stdioFirst: first, landed, slashOpens, queries }
    if (!/stdio-bridge/.test(landed) || !slashOpens || Object.values(queries).some((v) => !v)) problem(`search: ${JSON.stringify(results.checks.search)}`)
    else ok(`search: ${JSON.stringify(results.checks.search)}`)
    await context.close()
  }
  // Prev/next follows the sidebar order
  {
    const { context, page } = await open('docs/', {})
    const bad = []
    for (let i = 0; i < docsOrder.length; i++) {
      await page.goto(BASE + docsOrder[i])
      const [prev, next, sidebar] = await page.evaluate(() => [
        document.querySelector('.docs-pager .prev')?.href ?? null,
        document.querySelector('.docs-pager .next')?.href ?? null,
        [...document.querySelectorAll('.docs-nav li a')].map((a) => a.href)
      ])
      const want = (k) => (k >= 0 && k < docsOrder.length ? BASE + docsOrder[k] : null)
      if (prev !== want(i - 1) || next !== want(i + 1)) bad.push(`${docsOrder[i]}: ${prev} / ${next}`)
      if (JSON.stringify(sidebar) !== JSON.stringify(docsOrder.map((u) => BASE + u))) bad.push(`${docsOrder[i]}: sidebar order`)
    }
    results.checks.pager = { pages: docsOrder.length, bad }
    if (bad.length) problem(`prev/next: ${bad.join(' | ')}`)
    else ok(`prev/next and sidebar order match nav.json on all ${docsOrder.length} docs pages`)
    await context.close()
  }
}

// ---- 1e. Shared edges: every section's content starts and ends on the same x (debug outline screenshot) ----
{
  for (const [path, width] of [['', 1440], ['', 375], ['docs/mcp-setup/', 1440], ['docs/mcp-setup/', 375]]) {
    const { context, page } = await open(path, { width, height: 900 })
    await showAll(page)
    const edges = await page.evaluate(() => {
      // Debug outline through the CSSOM (the page CSP blocks <style> elements; element.style is allowed)
      for (const c of document.querySelectorAll('.container')) { c.style.outline = '1px solid rgb(255 0 0 / .7)'; c.style.outlineOffset = '-1px' }
      for (const m of document.querySelectorAll('main figure, main .code, main .table-wrap, main .link-card, main .steps li')) m.style.outline = '1px dashed rgb(0 160 255 / .8)'
      const rows = []
      for (const c of document.querySelectorAll('.container')) {
        const r = c.getBoundingClientRect()
        const cs = getComputedStyle(c)
        if (r.height === 0) continue
        rows.push({ cls: c.className, left: Math.round(r.left + parseFloat(cs.paddingLeft)), right: Math.round(r.right - parseFloat(cs.paddingRight)) })
      }
      // Media inside the content box must not stick out of it
      const out = []
      for (const el of document.querySelectorAll('main figure, main .code, main .table-wrap, main img')) {
        const c = el.closest('.container')
        if (!c) continue
        const cr = c.getBoundingClientRect(), cs = getComputedStyle(c), r = el.getBoundingClientRect()
        const L = cr.left + parseFloat(cs.paddingLeft) - 1, R = cr.right - parseFloat(cs.paddingRight) + 1
        if (r.width && (r.left < L || r.right > R)) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.left)}-${Math.round(r.right)} outside ${Math.round(L)}-${Math.round(R)}`)
        if (el.tagName === 'IMG') {
          const f = el.closest('figure')
          if (f) {
            const fr = f.getBoundingClientRect()
            if (r.left < fr.left - 0.5 || r.right > fr.right + 0.5 || r.top < fr.top - 0.5) out.push(`img outside its frame: ${el.currentSrc.split('/').pop()}`)
          }
        }
      }
      return { rows, out }
    })
    const lefts = [...new Set(edges.rows.map((r) => r.left))]
    const rights = [...new Set(edges.rows.map((r) => r.right))]
    const tag = `${nameOf(path)}-${width}`
    await page.screenshot({ path: join(OUT, `edges-${tag}.png`), fullPage: true })
    results.checks[`edges-${tag}`] = { lefts, rights, outside: edges.out }
    if (lefts.length !== 1 || rights.length !== 1 || edges.out.length) problem(`edges ${tag}: ${JSON.stringify(results.checks[`edges-${tag}`])}`)
    else ok(`edges ${tag}: all ${edges.rows.length} containers at ${lefts[0]}-${rights[0]}, no media outside`)
    await context.close()
  }
}

// ---- 1f. Favicon requests and the header logo, zoomed 4x nearest-neighbour ----
{
  const favs = {}
  for (const path of ['', 'docs/mcp-setup/', 'missing/page']) {
    const { context, page } = await open(path, { expect404: path === 'missing/page' })
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')].map((l) => l.href))
    for (const h of hrefs) favs[h] = (await fetch(h)).status
    for (const dpr of [1, 2]) {
      for (const width of [1440, 375]) {
        const c2 = await browser.newContext({ viewport: { width, height: 200 }, deviceScaleFactor: dpr, colorScheme: 'dark' })
        const p2 = await c2.newPage()
        await p2.goto(BASE + (path === 'missing/page' ? '' : path))
        for (const scheme of ['dark', 'light']) {
          await p2.evaluate((t) => document.documentElement.setAttribute('data-theme', t), scheme)
          const box = await p2.locator('.site-header .brand').boundingBox()
          const mark = await p2.locator('.site-header .logo-mark').boundingBox()
          if (!mark || mark.width !== 28 || mark.x % 1 || mark.y % 1) problem(`logo ${width} dpr${dpr}: ${JSON.stringify(mark)}`)
          if (path === '') await p2.screenshot({ path: join(OUT, `logo-${width}-dpr${dpr}-${scheme}.png`), clip: { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 } })
        }
        await c2.close()
      }
    }
    await context.close()
  }
  results.checks.favicons = favs
  if (Object.values(favs).some((s) => s !== 200)) problem(`favicon requests: ${JSON.stringify(favs)}`)
  else ok(`favicon and icon links answer 200: ${Object.keys(favs).length} URLs`)
}

// ---- 2. Theme toggle persists across reloads ----
{
  const { context, page } = await open('', { scheme: 'dark' })
  await page.click('[data-theme-toggle]')
  const after = await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('sf-theme'), document.querySelector('[data-theme-toggle]').getAttribute('aria-label')])
  await page.reload()
  const reloaded = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.goto(BASE + 'compare/playwright/')
  const other = await page.evaluate(() => document.documentElement.dataset.theme)
  results.checks.themeToggle = { after, reloaded, otherPage: other }
  if (after[0] !== 'light' || after[1] !== 'light' || reloaded !== 'light' || other !== 'light') problem(`theme toggle: ${JSON.stringify(results.checks.themeToggle)}`)
  else ok('theme toggle persists (reload and other page)')
  const cookies = await context.cookies()
  results.checks.cookies = cookies.length
  if (cookies.length) problem(`cookies set: ${cookies.length}`)
  await context.close()
}

// ---- 3. Download label per OS ----
results.checks.download = {}
for (const [os, ua] of Object.entries(UAS)) {
  const { context, page } = await open('', { userAgent: ua })
  const label = await page.textContent('.hero [data-download-label]')
  results.checks.download[os] = label
  if (label !== `Download for ${os}`) problem(`download label for ${os}: ${label}`)
  await context.close()
}
ok(`download labels: ${JSON.stringify(results.checks.download)}`)

// ---- 4. Tabs with the keyboard, copy buttons ----
{
  const { context, page } = await open('', { clipboard: true })
  await page.focus('#tab-cursor')
  await page.keyboard.press('ArrowRight')
  const codex = await page.evaluate(() => [document.activeElement.id, document.getElementById('tab-codex').getAttribute('aria-selected'), document.getElementById('panel-codex').hidden, document.getElementById('panel-cursor').hidden])
  await page.keyboard.press('End')
  const end = await page.evaluate(() => document.activeElement.id)
  await page.keyboard.press('Home')
  const home = await page.evaluate(() => document.activeElement.id)
  results.checks.tabs = { afterArrowRight: codex, end, home }
  if (codex.join() !== 'tab-codex,true,false,true' || end !== 'tab-claude' || home !== 'tab-cursor') problem(`tabs: ${JSON.stringify(results.checks.tabs)}`)
  else ok('tabs: ArrowRight, End, Home')
  results.checks.copy = {}
  for (const id of ['snippet-export', 'snippet-cursor', 'snippet-codex', 'snippet-claude']) {
    const panel = await page.evaluate((i) => document.getElementById(i).closest('[role="tabpanel"]')?.id ?? null, id)
    if (panel) await page.click(`[aria-controls="${panel}"]`)
    await page.click(`[data-copy="${id}"]`)
    await page.waitForTimeout(150)
    const [clip, text, label] = await page.evaluate(async (i) => [await navigator.clipboard.readText(), document.getElementById(i).textContent, document.querySelector(`[data-copy="${i}"] .copy-label`).textContent], id)
    results.checks.copy[id] = { equal: clip === text, label }
    if (clip !== text || label !== 'Copied') problem(`copy ${id}: equal=${clip === text} label=${label}`)
  }
  ok(`copy buttons: ${JSON.stringify(results.checks.copy)}`)
  // Keyboard focus: the first Tab reaches the skip link, with a visible outline
  await page.goto(BASE)
  await page.keyboard.press('Tab')
  const focus = await page.evaluate(() => {
    const e = document.activeElement
    const s = getComputedStyle(e)
    return { cls: e.className, outline: s.outlineStyle, width: s.outlineWidth, top: e.getBoundingClientRect().top }
  })
  await page.screenshot({ path: join(OUT, 'focus-skip-link.png') })
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const focus2 = await page.evaluate(() => {
    const e = document.activeElement
    const s = getComputedStyle(e)
    return { text: e.textContent.trim().slice(0, 30), outline: s.outlineStyle, width: s.outlineWidth }
  })
  await page.screenshot({ path: join(OUT, 'focus-nav.png') })
  results.checks.focus = { first: focus, third: focus2 }
  if (focus.cls !== 'skip-link' || focus.outline === 'none' || focus.top < 0 || focus2.outline === 'none') problem(`focus: ${JSON.stringify(results.checks.focus)}`)
  else ok(`keyboard focus visible: ${JSON.stringify(results.checks.focus)}`)
  await context.close()
}

// ---- 5. Mobile menu ----
{
  const { context, page } = await open('', { width: 375, height: 812 })
  await page.click('[data-menu-toggle]')
  const open1 = await page.evaluate(() => [document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded'), getComputedStyle(document.getElementById('site-nav')).display])
  await page.screenshot({ path: join(OUT, 'mobile-menu-open.png') })
  await page.keyboard.press('Escape')
  const closed = await page.evaluate(() => document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded'))
  results.checks.mobileMenu = { open: open1, afterEscape: closed }
  if (open1[0] !== 'true' || open1[1] === 'none' || closed !== 'false') problem(`mobile menu: ${JSON.stringify(results.checks.mobileMenu)}`)
  else ok('mobile menu opens and closes')
  await context.close()
}

// ---- 6. Video and hero, with and without reduced motion; FPS ----
{
  const { context, page, log } = await open('', {})
  await page.locator('video').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v.readyState >= 2 && !v.paused }, null, { timeout: 15000 }).catch(() => null)
  const video = await page.evaluate(() => { const v = document.querySelector('video'); return { readyState: v.readyState, paused: v.paused, duration: v.duration, currentSrc: v.currentSrc.split('/').pop(), poster: v.getAttribute('poster'), muted: v.muted, loop: v.loop } })
  results.checks.video = video
  if (video.readyState < 2 || video.paused || !(video.duration > 15)) problem(`video: ${JSON.stringify(video)}`)
  else ok(`video plays: ${JSON.stringify(video)}`)
  // MP4 also decodes (Chrome picks WebM first)
  const mp4 = await page.evaluate(async () => {
    const v = document.createElement('video')
    v.muted = true
    v.src = 'assets/video/demo.mp4'
    await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 8000) })
    return { readyState: v.readyState, duration: v.duration, error: v.error && v.error.code }
  })
  results.checks.mp4 = mp4
  if (!(mp4.duration > 15)) problem(`mp4: ${JSON.stringify(mp4)}`)
  else ok(`mp4 metadata: ${JSON.stringify(mp4)}`)
  // Hero FPS: frames rendered over 3 s with the hero in view
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(800)
  const fps = await page.evaluate(async () => {
    const f0 = window.__sfHeroFrames
    let raf = 0
    const t0 = performance.now()
    await new Promise((r) => { const tick = () => { raf++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else r() }; requestAnimationFrame(tick) })
    const secs = (performance.now() - t0) / 1000
    return { heroFps: (window.__sfHeroFrames - f0) / secs, rafFps: raf / secs, gl: (() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); const d = g && g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown' })() }
  })
  // Paused off-screen
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(600)
  const offA = await page.evaluate(() => window.__sfHeroFrames)
  await page.waitForTimeout(1000)
  const offB = await page.evaluate(() => window.__sfHeroFrames)
  fps.framesWhileOffscreen = offB - offA
  results.checks.hero = fps
  if (fps.framesWhileOffscreen > 0) problem(`hero keeps rendering off-screen: ${fps.framesWhileOffscreen} frames`)
  ok(`hero fps ${fps.heroFps.toFixed(1)} (rAF ${fps.rafFps.toFixed(1)}), renderer ${fps.gl}, off-screen frames ${fps.framesWhileOffscreen}`)
  const three = log.requests.filter((u) => u.includes('three.module.min.js')).length
  results.checks.threeLoaded = three
  await context.close()
}
{
  const { context, page, log } = await open('', { reducedMotion: 'reduce' })
  await page.waitForTimeout(2500)
  const r = await page.evaluate(() => { const v = document.querySelector('video'); return { videoPaused: v.paused, poster: v.getAttribute('poster'), heroLive: document.documentElement.classList.contains('hero-live'), heroFrames: window.__sfHeroFrames ?? null, still: getComputedStyle(document.querySelector('.hero-still')).display } })
  r.threeRequested = log.requests.some((u) => u.includes('three.module.min.js'))
  results.checks.reducedMotion = r
  await page.screenshot({ path: join(OUT, 'home-1440-dark-reduced-motion.png') })
  if (!r.videoPaused || !r.poster || r.heroLive || r.heroFrames !== null || r.threeRequested || r.still === 'none') problem(`reduced motion: ${JSON.stringify(r)}`)
  else ok(`reduced motion: ${JSON.stringify(r)}`)
  report('home reduced motion', log)
  await context.close()
}
{
  // No JS at all: content still there, still image shown
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const page = await context.newPage()
  await page.goto(BASE)
  const r = await page.evaluate(() => ({ h1: document.querySelector('h1').textContent, still: getComputedStyle(document.querySelector('.hero-still')).display }))
  await page.screenshot({ path: join(OUT, 'home-1440-dark-nojs.png') })
  results.checks.noJs = r
  ok(`no JS: ${JSON.stringify(r)}`)
  await context.close()
}

// ---- 7. 404 ----
{
  const { context, page, response, log } = await open('missing/page', { expect404: true })
  const r = { status: response.status(), h1: await page.textContent('h1'), bg: await page.evaluate(() => getComputedStyle(document.body).backgroundColor), css: log.failed.length === 0 }
  await page.screenshot({ path: join(OUT, '404-1440-dark.png') })
  results.checks.notFound = r
  if (r.status !== 404 || r.h1 !== 'Page not found' || r.bg !== 'rgb(0, 0, 0)') problem(`404: ${JSON.stringify(r)}`)
  else ok(`404: ${JSON.stringify(r)}`)
  await context.close()
}

// ---- 8. Live link check: every same-origin link from every page answers 200, anchors exist ----
{
  const { context, page } = await open('')
  const seen = new Map()
  for (const path of Object.values(PAGES).concat(['404.html'])) {
    await page.goto(BASE + path)
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href], link[href], img[src], source[src], source[srcset], video[poster], script[src]')].flatMap((e) => {
      if (e.srcset) return e.srcset.split(',').map((s) => new URL(s.trim().split(/\s+/)[0], document.baseURI).href)
      return [e.href || e.src || new URL(e.getAttribute('poster'), document.baseURI).href]
    }))
    for (const href of links) if (href.startsWith(ORIGIN) && !seen.has(href)) seen.set(href, path)
  }
  const bad = []
  for (const [href, from] of seen) {
    const u = new URL(href)
    const res = await fetch(u.origin + u.pathname, { method: 'GET' })
    if (res.status !== 200) bad.push(`${href} (from ${from || 'home'}): ${res.status}`)
    else if (u.hash) {
      const html = await res.text()
      if (!html.includes(`id="${decodeURIComponent(u.hash.slice(1))}"`)) bad.push(`${href} (from ${from || 'home'}): missing anchor`)
    }
  }
  results.checks.links = { checked: seen.size, broken: bad }
  if (bad.length) problem(`broken links: ${bad.join(' | ')}`)
  else ok(`links: ${seen.size} same-origin URLs answer 200, anchors exist`)
  await context.close()
}

await browser.close()
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
console.log(results.problems.length ? `\n${results.problems.length} problem(s)` : '\nall browser checks passed')
process.exit(results.problems.length ? 1 : 0)
