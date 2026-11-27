// Checks that every section's widest visual element reaches the right edge of the content container
// (the same edge as the header). Text may stay narrower; images, code, tabs, cards and tables may not.
// Usage: node site/tools/serve.mjs 4321 & node site/tools/measure-widths.mjs [baseUrl]
// Needs Playwright and a system Chrome/Chromium (CHROME_PATH, /usr/bin/google-chrome or /usr/bin/chromium).
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://127.0.0.1:4321/sessionforge/'
const PAGES = [
  '',
  'extension/',
  'use-cases/multi-role-testing/',
  'use-cases/coding-agent-browser/',
  'use-cases/exploratory-qa/',
  'compare/chrome-profiles/',
  'compare/playwright/'
]
const WIDTHS = [1440, 1280, 1024, 768, 375]
const TOLERANCE = 2

const executablePath = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find((p) => p && existsSync(p))
if (!executablePath) throw new Error('No Chrome or Chromium found; set CHROME_PATH')

// Runs in the page. Returns one row per section (home) or per top-level block (article pages).
function measure() {
  const VISUAL = 'img, video, pre, .code, .tabs, .frame, .panel, .cards, .steps, .check-list, .table-wrap, .faq, .cta-band, .bento'
  const contentRight = (el) => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight)
  const header = contentRight(document.querySelector('.site-header .container'))
  const widest = (root) => {
    let best = null
    for (const el of root.matches(VISUAL) ? [root, ...root.querySelectorAll(VISUAL)] : root.querySelectorAll(VISUAL)) {
      if (el.closest('[hidden]') || el.closest('.prose')) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      if (!best || r.right > best.right) best = { right: r.right, what: el.className || el.tagName.toLowerCase() }
    }
    return best
  }
  const rows = []
  const add = (name, el, containerRight) => {
    const w = widest(el)
    rows.push(w
      ? { name, what: String(w.what).split(' ')[0], gap: Math.round((containerRight - w.right) * 10) / 10 }
      : { name, what: 'text only', gap: null })
  }
  const article = document.querySelector('.container.article')
  if (article) {
    const right = contentRight(article)
    let i = 0
    for (const child of article.children) {
      i++
      if (child.matches('.prose')) {
        // Text column: readable line length on purpose. Visuals inside it must fill the column.
        const prose = child.getBoundingClientRect().right
        for (const v of child.querySelectorAll('.panel, .code, .table-wrap, .frame')) {
          if (v.parentElement.closest('.panel, .code, .table-wrap, .frame')) continue
          rows.push({ name: `block ${i} prose > ${v.className.split(' ')[0]}`, what: 'fills text column', gap: Math.round((prose - v.getBoundingClientRect().right) * 10) / 10 })
        }
        continue
      }
      if (child.matches('.caption')) continue
      add(`block ${i} ${child.className.split(' ')[0] || child.tagName.toLowerCase()}`, child, right)
    }
  } else {
    for (const s of document.querySelectorAll('main > section, main > nav')) {
      const c = s.matches('.container') ? s : s.querySelector('.container')
      add(`#${s.id || s.className.split(' ')[0]}`, s, contentRight(c))
    }
  }
  // At device pixel ratio 1, no image may be drawn wider than the file the browser picked
  const upscaled = [...document.images]
    .filter((img) => img.naturalWidth && img.getBoundingClientRect().width > img.naturalWidth + 1)
    .map((img) => img.currentSrc.split('/').pop())
  return { header, rows, upscaled }
}

const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
let failures = 0
const lines = ['| Page | Block | ' + WIDTHS.map((w) => `${w}`).join(' | ') + ' |', '|---|---|' + WIDTHS.map(() => '---').join('|') + '|']
for (const path of PAGES) {
  const table = new Map()
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.goto(BASE + path, { waitUntil: 'load' })
    // Lazy images have no width until they load, so load them all first
    await page.evaluate(() => document.querySelectorAll('img[loading="lazy"]').forEach((img) => { img.loading = 'eager' }))
    await page.waitForFunction(() => [...document.images].every((img) => img.complete))
    const { rows, upscaled } = await page.evaluate(measure)
    for (const name of upscaled) { failures++; console.log(`FAIL upscaled at ${width}: /${path} ${name}`) }
    for (const r of rows) {
      if (!table.has(r.name)) table.set(r.name, {})
      const ok = r.gap === null || Math.abs(r.gap) <= TOLERANCE
      if (!ok) failures++
      table.get(r.name)[width] = r.gap === null ? 'text' : `${ok ? '' : 'FAIL '}${r.gap}`
    }
    await page.close()
  }
  for (const [name, cells] of table) lines.push(`| /${path} | ${name} | ` + WIDTHS.map((w) => cells[w] ?? '-').join(' | ') + ' |')
}
await browser.close()
console.log(lines.join('\n'))
console.log(`\nGap = container right edge minus the widest visual element's right edge, in px (tolerance ${TOLERANCE}).`)
console.log(failures ? `${failures} FAIL` : 'All blocks reach the container edge.')
process.exit(failures ? 1 : 0)
