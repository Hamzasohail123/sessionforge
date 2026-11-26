// Builds the docs section (site/docs/**) from the page sources in site/tools/docs-src/, plus the search index
// (site/assets/js/docs-index.js), sitemap.xml and the docs list in llms.txt. Zero dependencies.
// Each source file starts with one comment holding its metadata:
//   <!-- {"title": "...", "description": "...", "lead": "..."} -->
// The order and groups come from docs-src/nav.json. Run node site/tools/sync-partials.mjs afterwards
// (it fills the header and footer). Usage: node site/tools/build-docs.mjs [--check]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(SITE, 'tools', 'docs-src')
const BASE = 'https://hamzasohail123.github.io/sessionforge/'
const REPO = 'https://github.com/Hamzasohail123/sessionforge'
const check = process.argv.includes('--check')
const nav = JSON.parse(readFileSync(join(SRC, 'nav.json'), 'utf8'))

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const strip = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
const slugify = (s) =>
  strip(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// Flat page list in sidebar order; '' is the docs landing page
const pages = []
for (const group of nav) {
  for (const slug of group.pages) {
    const raw = readFileSync(join(SRC, `${slug || 'index'}.html`), 'utf8')
    const m = /^<!--\s*(\{[\s\S]*?\})\s*-->\n?/.exec(raw)
    if (!m) throw new Error(`${slug}: missing metadata comment`)
    const meta = JSON.parse(m[1])
    for (const k of ['title', 'description', 'lead']) if (!meta[k]) throw new Error(`${slug}: missing ${k}`)
    pages.push({ slug, group: group.title, ...meta, body: raw.slice(m[0].length), file: `site/tools/docs-src/${slug || 'index'}.html` })
  }
}

const COPY_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>'

/** Heading ids and anchor links, code blocks with copy buttons and language labels. */
function transform(page) {
  const toc = []
  const used = new Set()
  let n = 0
  let body = page.body.replace(/<(h[23])>([\s\S]*?)<\/\1>/g, (_, tag, inner) => {
    let id = slugify(inner)
    while (used.has(id)) id += '-2'
    used.add(id)
    toc.push({ level: tag === 'h2' ? 2 : 3, id, text: strip(inner) })
    return `<${tag} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></${tag}>`
  })
  body = body.replace(/<pre data-lang="([\w-]+)"><code((?: [^>]*)?)>([\s\S]*?)<\/code><\/pre>/g, (_, lang, attrs, code) => {
    const id = /\sid="([^"]+)"/.exec(attrs)?.[1] ?? `code-${page.slug.replace(/\W/g, '-') || 'docs'}-${++n}`
    const rest = attrs.replace(/\sid="[^"]+"/, '')
    return (
      `<div class="code"><span class="code-lang">${lang}</span>` +
      `<button class="copy" type="button" data-copy="${id}">${COPY_ICON}<span class="copy-label">Copy</span></button>` +
      `<span class="copy-status visually-hidden" aria-live="polite"></span>` +
      `<pre tabindex="0"><code id="${id}"${rest}>${code}</code></pre></div>`
    )
  })
  return { body, toc }
}

const urlOf = (slug) => (slug ? `docs/${slug}/` : 'docs/')

function sidebar(current, root) {
  let html = ''
  for (const group of nav) {
    html += `<div class="docs-group"><p class="docs-group-title">${esc(group.title)}</p><ul>`
    for (const slug of group.pages) {
      const p = pages.find((x) => x.slug === slug)
      const cur = slug === current ? ' aria-current="page"' : ''
      html += `<li><a href="${root}${urlOf(slug)}"${cur}>${esc(p.nav ?? p.title)}</a></li>`
    }
    html += '</ul></div>'
  }
  return html
}

function render(page, i) {
  const depth = page.slug ? 2 : 1
  const root = '../'.repeat(depth)
  const url = BASE + urlOf(page.slug)
  const { body: raw, toc } = transform(page)
  const body = raw.replaceAll('{{root}}', root)
  const prev = pages[i - 1]
  const next = pages[i + 1]
  const title = `${page.title} · SessionForge docs`
  const crumbs = page.slug
    ? `<li><a href="${root}">Home</a></li><li><a href="${root}docs/">Docs</a></li><li>${esc(page.group)}</li><li aria-current="page">${esc(page.nav ?? page.title)}</li>`
    : `<li><a href="${root}">Home</a></li><li aria-current="page">Docs</li>`
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: BASE },
          { '@type': 'ListItem', position: 2, name: 'Docs', item: BASE + 'docs/' },
          ...(page.slug ? [{ '@type': 'ListItem', position: 3, name: page.title, item: url }] : [])
        ]
      },
      { '@type': 'TechArticle', headline: page.title, description: page.description, about: { '@type': 'SoftwareApplication', name: 'SessionForge' }, url }
    ]
  }
  const tocHtml = toc.length
    ? `<aside class="docs-toc" aria-label="On this page"><p class="docs-group-title">On this page</p><ul>${toc
        .map((t) => `<li class="toc-${t.level}"><a href="#${t.id}">${esc(t.text)}</a></li>`)
        .join('')}</ul></aside>`
    : '<aside class="docs-toc" aria-hidden="true"></aside>'
  const pager =
    `<nav class="docs-pager" aria-label="Previous and next page">` +
    (prev ? `<a class="prev" href="${root}${urlOf(prev.slug)}"><span>Previous</span>${esc(prev.nav ?? prev.title)}</a>` : '<span></span>') +
    (next ? `<a class="next" href="${root}${urlOf(next.slug)}"><span>Next</span>${esc(next.nav ?? next.title)}</a>` : '<span></span>') +
    '</nav>'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${esc(title)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SessionForge">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${BASE}og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="SessionForge icon with the text: Every role. One window.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(page.description)}">
<meta name="twitter:image" content="${BASE}og.png">
<!-- partial:head -->
<!-- /partial:head -->
<link rel="stylesheet" href="${root}assets/css/site.css">
<script src="${root}assets/js/theme.js"></script>
<script src="${root}assets/js/site.js" defer></script>
<script src="${root}assets/js/docs-index.js" defer></script>
<script src="${root}assets/js/docs.js" defer></script>
<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>
</head>
<body class="docs-page" data-root="${root}">
<!-- partial:header -->
<!-- /partial:header -->

<div class="container docs-layout">
  <aside class="docs-nav" id="docs-nav" aria-label="Docs">
    <button class="docs-search-btn" type="button" data-docs-search><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Search docs</span><kbd>Ctrl K</kbd></button>
    ${sidebar(page.slug, root)}
  </aside>
  <main id="main" class="docs-main">
    <button class="btn btn-secondary btn-sm docs-menu" type="button" data-docs-menu aria-expanded="false" aria-controls="docs-nav">Menu</button>
    <nav class="crumbs" aria-label="Breadcrumb"><ol>${crumbs}</ol></nav>
    <article class="docs-article">
      <h1>${esc(page.title)}</h1>
      <p class="lead">${page.lead}</p>
${body.trim()}
    </article>
    <p class="docs-edit"><a href="${REPO}/edit/main/${page.file}">Edit this page on GitHub</a></p>
    ${pager}
  </main>
  ${tocHtml}
</div>

<!-- partial:footer -->
<!-- /partial:footer -->
</body>
</html>
`
}

const outputs = new Map()
pages.forEach((p, i) => outputs.set(join(SITE, urlOf(p.slug), 'index.html'), render(p, i)))

// Search index: title, URL (from the site root), headings and the page text, trimmed
const index = pages.map((p) => {
  const { body, toc } = transform(p)
  return { t: p.title, g: p.group, u: urlOf(p.slug), h: toc.map((x) => [x.text, x.id]), x: strip(p.lead + ' ' + body).slice(0, 2400) }
})
outputs.set(
  join(SITE, 'assets', 'js', 'docs-index.js'),
  `// Generated by site/tools/build-docs.mjs. The docs search index (no network request needed).\nwindow.SF_DOCS_INDEX = ${JSON.stringify(index)}\n`
)

// sitemap.xml: every page except 404, lastmod = today (UTC)
const otherPages = ['', 'extension/', 'use-cases/multi-role-testing/', 'use-cases/coding-agent-browser/', 'use-cases/exploratory-qa/', 'compare/chrome-profiles/', 'compare/playwright/']
const allUrls = [...otherPages, ...pages.map((p) => urlOf(p.slug))]
const sitemapPath = join(SITE, 'sitemap.xml')
const lastmod = existsSync(sitemapPath) && check ? /<lastmod>([^<]+)<\/lastmod>/.exec(readFileSync(sitemapPath, 'utf8'))?.[1] : new Date().toISOString().slice(0, 10)
outputs.set(
  sitemapPath,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${allUrls
    .map((u) => `  <url><loc>${BASE}${u}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join('\n')}\n</urlset>\n`
)

// llms.txt: the docs list between markers
const llmsPath = join(SITE, 'llms.txt')
const llms = readFileSync(llmsPath, 'utf8')
const list = pages.filter((p) => p.slug).map((p) => `- [${p.title}](${BASE}${urlOf(p.slug)}): ${p.description}`).join('\n')
outputs.set(llmsPath, llms.replace(/<!-- docs -->[\s\S]*?<!-- \/docs -->/, `<!-- docs -->\n${list}\n<!-- /docs -->`))

let changed = 0
for (const [file, content] of outputs) {
  // Pages get their header/footer from sync-partials.mjs: compare with the partial blocks emptied
  const norm = (s) => s.replace(/(<!-- partial:(\w+) -->)[\s\S]*?(<!-- \/partial:\2 -->)/g, '$1$3')
  const before = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (norm(before) === norm(content)) continue
  changed++
  if (check) console.error(`out of date: ${file.slice(SITE.length)}`)
  else {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content)
  }
}
if (check && changed) process.exit(1)
console.log(check ? 'docs up to date' : `docs: ${pages.length} pages, ${changed} file(s) written`)
