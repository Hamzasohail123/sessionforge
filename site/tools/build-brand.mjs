// Favicons, app icons, og.png and the web manifest for the website, from the same master icon and
// Chromium pipeline as resources/branding/generate-icons.mjs.
// Usage: node site/tools/build-brand.mjs
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openMaster, pngFromDataUrl } from '../../resources/branding/generate-icons.mjs'

const SITE = fileURLToPath(new URL('..', import.meta.url))
const FONTS = {
  400: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  700: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
}

async function write(rel, data) {
  await mkdir(dirname(join(SITE, rel)), { recursive: true })
  await writeFile(join(SITE, rel), data)
  console.log(`wrote site/${rel} (${data.length} bytes)`)
}

/** ICO container with PNG payloads (6-byte header, 16-byte entry per image). */
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = 6 + 16 * pngs.length
  const entries = pngs.map(({ size, png }) => {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4) // colour planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
    return e
  })
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)])
}

for (const f of Object.values(FONTS)) if (!existsSync(f)) throw new Error(`Font missing: ${f} (install fonts-dejavu-core)`)
const { browser, page } = await openMaster()
try {
  const render = async (size) => pngFromDataUrl(await page.evaluate((s) => window.sfRender(s), size))
  await write('assets/img/icon-64.png', await render(64))
  await write('assets/img/icon-128.png', await render(128))
  await write('icon-192.png', await render(192))
  await write('icon-512.png', await render(512))
  await write('apple-touch-icon.png', await render(180))
  await write('favicon.ico', ico([{ size: 16, png: await render(16) }, { size: 32, png: await render(32) }]))

  const faces = []
  for (const [w, f] of Object.entries(FONTS)) {
    faces.push(`@font-face{font-family:'SF Site';font-weight:${w};src:url(data:font/ttf;base64,${(await readFile(f)).toString('base64')})}`)
  }
  const icon = await page.evaluate((s) => window.sfRender(s), 200)
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await og.setContent(`<!doctype html><style>${faces.join('')}
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#000;font-family:'SF Site'}
.grid{position:absolute;inset:0;background-image:linear-gradient(#1c1c1c 1px,transparent 1px),linear-gradient(90deg,#1c1c1c 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(ellipse at 30% 45%,#000 20%,transparent 75%)}
.glow{position:absolute;left:40px;top:120px;width:420px;height:420px;border-radius:50%;background:radial-gradient(#57d8e2 0,transparent 65%);opacity:.12}
.row{position:absolute;left:96px;top:150px;display:flex;align-items:center;gap:56px}
img{width:200px;height:200px}
h1{margin:0;font-size:72px;font-weight:700;color:#fff;letter-spacing:-2px}
p{margin:14px 0 0;font-size:40px;color:#a3a3a3}
.rule{width:64px;height:4px;background:#57d8e2;margin:0 0 26px}
.foot{position:absolute;left:96px;bottom:70px;font-size:24px;color:#8a8a8a}
</style><div class="grid"></div><div class="glow"></div>
<div class="row"><img src="${icon}" alt=""><div><div class="rule"></div><h1>SessionForge</h1><p>Every role. One window.</p></div></div>
<div class="foot">Free, open-source browser with an MCP server for Cursor, Codex and Claude Code</div>`)
  await og.evaluate(async () => {
    await document.fonts.load("700 20px 'SF Site'")
    await document.fonts.load("400 20px 'SF Site'")
    await document.fonts.ready
  })
  const png = await og.screenshot({ type: 'png', omitBackground: false })
  if (png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630 || png[25] !== 2) throw new Error('og.png must be 1200x630 RGB')
  await write('og.png', png)
} finally {
  await browser.close()
}

await write(
  'site.webmanifest',
  Buffer.from(
    JSON.stringify(
      {
        name: 'SessionForge',
        short_name: 'SessionForge',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ],
        theme_color: '#000000',
        background_color: '#000000',
        start_url: './',
        display: 'browser'
      },
      null,
      2
    ) + '\n'
  )
)
