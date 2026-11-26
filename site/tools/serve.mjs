// Tiny static server for previewing the site the way GitHub Pages serves it: site/ under /sessionforge/,
// directories map to index.html, and unknown paths get 404.html with status 404. Zero dependencies.
// Usage: node site/tools/serve.mjs [port]   (default 4321, 127.0.0.1 only)
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = fileURLToPath(new URL('..', import.meta.url))
const PREFIX = '/sessionforge/'
const port = Number(process.argv[2] ?? process.env.PORT ?? 4321)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
}

async function fileFor(urlPath) {
  if (!urlPath.startsWith(PREFIX)) return null
  const rel = decodeURIComponent(urlPath.slice(PREFIX.length))
  const p = normalize(join(SITE, rel))
  if (!p.startsWith(SITE) || p.split(sep).includes('tools')) return null
  try {
    const s = await stat(p)
    if (s.isDirectory()) {
      if (!urlPath.endsWith('/')) return { redirect: `${urlPath}/` }
      return { file: join(p, 'index.html') }
    }
    return { file: p }
  } catch {
    return null
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/' || url.pathname === '/sessionforge') {
    res.writeHead(301, { location: PREFIX })
    return res.end()
  }
  const hit = await fileFor(url.pathname)
  if (hit?.redirect) {
    res.writeHead(301, { location: hit.redirect })
    return res.end()
  }
  try {
    const file = hit?.file
    if (!file) throw new Error('not found')
    const body = await readFile(file)
    const type = TYPES[extname(file)] ?? 'application/octet-stream'
    // Range support so <video> can seek like on Pages
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range && type.startsWith('video/')) {
      const start = range[1] ? Number(range[1]) : 0
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${body.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 })
      return res.end(body.subarray(start, end + 1))
    }
    res.writeHead(200, { 'content-type': type, 'content-length': body.length, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch {
    const body = await readFile(join(SITE, '404.html'))
    res.writeHead(404, { 'content-type': TYPES['.html'] })
    res.end(body)
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}${PREFIX}`))
