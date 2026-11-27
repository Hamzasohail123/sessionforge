// Fills the shared header and footer into every page and rebuilds the home page's FAQPage JSON-LD from
// the visible FAQ, so the committed HTML is final (GitHub Pages serves it as is, no build step).
// Usage: node site/tools/sync-partials.mjs          write the pages
//        node site/tools/sync-partials.mjs --check  exit 1 if any page would change
// Zero dependencies.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = fileURLToPath(new URL('..', import.meta.url))
const check = process.argv.includes('--check')
const partials = {
  header: readFileSync(join(SITE, 'tools', 'partials', 'header.html'), 'utf8').trimEnd(),
  footer: readFileSync(join(SITE, 'tools', 'partials', 'footer.html'), 'utf8').trimEnd(),
  head: readFileSync(join(SITE, 'tools', 'partials', 'head.html'), 'utf8').trimEnd()
}

export function htmlPages(dir = SITE) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === 'tools' || name === 'assets') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...htmlPages(p))
    else if (name.endsWith('.html')) out.push(p)
  }
  return out
}

/** Site-relative directory of a page, '' for the home page and 404.html */
const pageDir = (file) => {
  const rel = relative(SITE, file).split(sep).join('/')
  return rel.endsWith('index.html') ? rel.slice(0, -'index.html'.length) : ''
}

function render(name, file) {
  const is404 = file.endsWith('404.html')
  const dir = pageDir(file)
  const depth = dir.split('/').filter(Boolean).length
  // 404.html has <base href="/sessionforge/">, so its links are relative to the site root
  const root = is404 ? './' : depth ? '../'.repeat(depth) : './'
  let html = partials[name].replaceAll('{{root}}', root)
  if (!is404 && dir) {
    html = html.replace(new RegExp(`<a href="${root.replace(/\./g, '\\.')}${dir}"`, 'g'), `<a href="${root}${dir}" aria-current="page"`)
  }
  if (!is404 && !dir) html = html.replaceAll('<a class="brand" href="./"', '<a class="brand" href="./" aria-current="page"')
  return html
}

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

export function visibleFaq(html) {
  const items = []
  const re = /<details class="faq-item">\s*<summary>([\s\S]*?)<\/summary>\s*<div class="faq-a">([\s\S]*?)<\/div>\s*<\/details>/g
  let m
  while ((m = re.exec(html))) items.push({ q: strip(m[1]), a: strip(m[2]) })
  return items
}

function faqJsonLd(html) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: visibleFaq(html).map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
  }
  return JSON.stringify(data, null, 2).replace(/</g, '\\u003c')
}

function main() {
let changed = 0
for (const file of htmlPages()) {
  const before = readFileSync(file, 'utf8')
  let after = before
  for (const name of Object.keys(partials)) {
    const re = new RegExp(`(<!-- partial:${name} -->)[\\s\\S]*?(<!-- /partial:${name} -->)`)
    if (!re.test(after)) throw new Error(`${relative(SITE, file)}: missing <!-- partial:${name} --> block`)
    after = after.replace(re, (_, a, b) => `${a}\n${render(name, file)}\n${b}`)
  }
  after = after.replace(
    /(<script type="application\/ld\+json" id="ld-faq">)[\s\S]*?(<\/script>)/,
    (_, a, b) => `${a}\n${faqJsonLd(after)}\n${b}`
  )
  if (after !== before) {
    changed++
    if (check) console.error(`out of sync: ${relative(SITE, file)}`)
    else writeFileSync(file, after)
  }
}
if (check && changed) process.exit(1)
console.log(check ? 'partials in sync' : `updated ${changed} page(s)`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
