import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const LABEL_COLORS: Record<string, string> = {
  A: '#ef4444',
  B: '#3b82f6',
  C: '#10b981',
  D: '#eab308'
}

export interface TestServer {
  port: number
  /** http://127.0.0.1:<port> */
  base: string
  /** http://localhost:<port>: same server, second origin */
  localBase: string
  /** Last request headers seen per path (without query) */
  lastHeaders: Map<string, IncomingHttpHeaders>
  close: () => Promise<void>
}

// Recorded before any other page script runs, plus helpers the specs call through executeJavaScript
const PAGE_SCRIPT = `
window.__firstLocalStorage = localStorage.getItem('seeded');
window.__ua = navigator.userAgent;
window.__ctrlKeys = 0; window.__escKeys = 0; window.__lastCtrlKey = null;
addEventListener('keydown', (e) => {
  if (e.ctrlKey) { window.__ctrlKeys++; window.__lastCtrlKey = (e.shiftKey ? 'Shift+' : '') + (e.altKey ? 'Alt+' : '') + e.key }
  if (e.key === 'Escape') window.__escKeys++;
}, true);
const idb = (mode, fn) => new Promise((resolve, reject) => {
  const open = indexedDB.open('sf', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('kv');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => { open.result.close(); resolve(req.result ?? null) };
    tx.onerror = () => reject(tx.error);
  };
});
window.sfWrite = async (v) => {
  document.cookie = 'sf=' + v + '; max-age=3600; path=/';
  localStorage.sf = v; sessionStorage.sf = v;
  await idb('readwrite', (s) => s.put(v, 'sf'));
  return true;
};
window.sfRead = async () => ({
  cookie: document.cookie,
  local: localStorage.getItem('sf'),
  session: sessionStorage.getItem('sf'),
  idb: await idb('readonly', (s) => s.get('sf'))
});
`

function colorPage(label: string, extraScript = ''): string {
  const color = LABEL_COLORS[label] ?? '#6b7280'
  // Label sits in the top-left corner so the centre pixel is always the background colour
  return `<!doctype html><html><head><title>Page ${label}</title><script>${PAGE_SCRIPT}${extraScript}</script></head>
<body style="margin:0;background:${color};height:100vh;overflow:hidden">
<div style="position:absolute;left:16px;top:8px;font:bold 120px sans-serif;color:#fff">${label}</div></body></html>`
}

const DEV_PAGE = `<!doctype html><title>Dev page</title>
<style>body{margin:0;font:20px sans-serif} #plain{position:absolute;left:400px;top:300px}
a,input,img,p{position:absolute;left:20px} a{top:20px} input{top:80px;width:300px} img{top:140px;width:100px;height:100px} p{top:260px}</style>
<a id="link" href="/page?label=B">A link</a>
<input id="field" value="some text">
<img id="img" src="/dot.png">
<p id="text">Selectable words here</p>
<div id="plain">empty area</div>
<script>console.log('hello from page')</script>`

const DOT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
)

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export async function startTestServer(): Promise<TestServer> {
  const lastHeaders = new Map<string, IncomingHttpHeaders>()
  const slow = new Set<ServerResponse>()
  // Set once listening; the sign-in stubs link to http://localhost:<port>
  let port = 0

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    lastHeaders.set(url.pathname, req.headers)
    const html = (body: string) => {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(body)
    }

    switch (url.pathname) {
      case '/page':
        return html(colorPage(url.searchParams.get('label') ?? 'A'))
      case '/opener':
        return html(
          colorPage(
            url.searchParams.get('label') ?? 'A',
            "window.openPopup = () => window.open('/page?label=C&popup=1');"
          )
        )
      case '/headers':
        return html(`<!doctype html><title>Headers</title>
<pre id="ua">${escapeHtml(req.headers['user-agent'] ?? '')}</pre>
<pre id="cookie">${escapeHtml(req.headers.cookie ?? '')}</pre>`)
      case '/slow':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.write('<!doctype html><title>Slow page</title>')
        slow.add(res)
        setTimeout(() => {
          if (!res.writableEnded) res.end('<p>done</p>')
          slow.delete(res)
        }, 3000)
        return
      case '/dev':
        return html(DEV_PAGE)
      case '/dot.png':
        res.setHeader('content-type', 'image/png')
        return res.end(DOT_PNG)
      // Google sign-in stubs (served on localBase, the e2e test "Google" origin; no real Google)
      case '/ServiceLogin':
        res.writeHead(302, { location: `/v3/signin/identifier${url.search}` })
        return res.end()
      case '/v3/signin/identifier':
        return html(`<!doctype html><title>Sign in</title>
<body style="margin:0;background:#ffffff;height:100vh"><h1 style="margin:0;padding:8px;font:24px sans-serif">Sign in</h1>
<script>window.reject = () => history.pushState(null, '', '/v3/signin/rejected' + location.search)</script></body>`)
      case '/o/oauth2/v2/auth': {
        const q = new URLSearchParams({
          flowName: 'GeneralOAuthFlow',
          client_id: 'test',
          continue: `http://localhost:${port}/signin/oauth/v3/consent`
        })
        res.writeHead(302, { location: `/v3/signin/identifier?${q}` })
        return res.end()
      }
      case '/o/oauth2/v2/bare':
        res.writeHead(302, { location: '/v3/signin/identifier' })
        return res.end()
      case '/site':
        return html(`<!doctype html><title>Site</title>
<body style="margin:0;background:#10b981;height:100vh"><h1 style="margin:0;padding:8px;font:24px sans-serif">Site</h1>
<script>
window.openGooglePopup = () => window.open('http://localhost:${port}/o/oauth2/v2/auth?client_id=test');
window.openBarePopup = () => window.open('http://localhost:${port}/o/oauth2/v2/bare');
</script></body>`)
      default:
        res.statusCode = 404
        res.end('not found')
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port

  return {
    port,
    base: `http://127.0.0.1:${port}`,
    localBase: `http://localhost:${port}`,
    lastHeaders,
    close: async () => {
      for (const res of slow) res.destroy()
      slow.clear()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
