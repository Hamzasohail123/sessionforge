// Build every SessionForge icon and the store promo tiles from the master PNG, with the installed Chromium.
// Every icon is the source artwork edge to edge, downscaled; the only change is that the black outside the
// rounded corners becomes transparent.
// Usage: node resources/branding/generate-icons.mjs
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const BRANDING = join(ROOT, 'resources', 'branding')
// The artwork as delivered (1254x1254 RGB): a navy rounded square edge to edge, black outside its corners
export const SOURCE = join(BRANDING, 'sessionforge-icon-source.png')
// A source pixel counts as the black background when no channel is above this
const BLACK_MAX = 3
// The promo text uses these files, never a fallback font. DejaVu ships with practically every Linux.
const PROMO_FONTS = {
  400: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  700: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
}
// [output, size]. All full bleed, like the source.
const icons = [
  // Chrome toolbar, extensions page and Web Store
  ['chrome-extension/icon16.png', 16],
  ['chrome-extension/icon48.png', 48],
  ['chrome-extension/icon128.png', 128],
  ['chrome-extension/store/icon-128.png', 128],
  // Windows .ico and macOS .icns (electron-builder.yml win.icon / mac.icon)
  ['build/icon.png', 1024],
  // Linux packages: electron-builder installs each NxN.png into /usr/share/icons/hicolor/NxN/apps
  ...[16, 24, 32, 48, 64, 128, 256, 512].map((size) => [`build/icons/${size}x${size}.png`, size]),
  // BrowserWindow icon on Linux (window list and title bar)
  ['resources/icon.png', 256],
  // Renderer favicon, served from Vite's public folder
  ['src/renderer/public/sessionforge-icon.png', 64]
]
// Chrome Web Store promo tiles: JPEG or 24-bit PNG, no alpha. The marquee is the small tile's layout scaled 2.4x.
const promos = [
  { source: 'sessionforge-promo.svg', output: 'chrome-extension/store/promo-small-440x280.png', width: 440, height: 280, icon: 164 },
  { source: 'sessionforge-promo-marquee.svg', output: 'chrome-extension/store/promo-marquee-1400x560.png', width: 1400, height: 560, icon: 394 },
  // README banner, not a store tile: transparent outside its rounded card so it suits GitHub's light and dark themes
  { source: 'sessionforge-readme-banner.svg', output: 'docs/assets/readme-banner.png', width: 1280, height: 400, icon: 280, alpha: true }
]

/**
 * Runs in the page: makes the source's black corners transparent and installs window.sfRender(size).
 *
 * The edge comes from the source pixels, not from a fitted shape. Black connected to a canvas corner
 * becomes transparent. The anti-aliased edge (pixels reached from that black through pixels darker than
 * any navy fill pixel) gets alpha = level / fill level, with its colour divided by that alpha, so over
 * black it is the source pixel again. Every other pixel keeps its source RGB and alpha 255.
 */
export async function prepareMaster({ src, blackMax }) {
  const img = new Image()
  img.src = src
  await img.decode()
  const n = img.naturalWidth
  if (n !== img.naturalHeight) throw new Error(`Source must be square, got ${n}x${img.naturalHeight}`)
  const canvas = (size) => Object.assign(document.createElement('canvas'), { width: size, height: size })
  const master = canvas(n)
  const ctx = master.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const image = ctx.getImageData(0, 0, n, n)
  const px = image.data
  const level = (p) => px[p * 4] + px[p * 4 + 1] + px[p * 4 + 2]
  const isBlack = (p) => px[p * 4] <= blackMax && px[p * 4 + 1] <= blackMax && px[p * 4 + 2] <= blackMax

  // The navy fill along the middle of each side, 11 px deep: its darkest and its median level
  const fillLevels = []
  for (let k = 0; k <= 10; k++) {
    for (let t = Math.round(n * 0.3); t < Math.round(n * 0.7); t++) {
      for (const [x, y] of [[t, k], [t, n - 1 - k], [k, t], [n - 1 - k, t]]) fillLevels.push(level(y * n + x))
    }
  }
  fillLevels.sort((a, b) => a - b)
  const fillMin = fillLevels[0]
  const fill = fillLevels[fillLevels.length >> 1]
  if (fillMin <= 3 * blackMax) throw new Error(`The source's sides are not filled edge to edge (darkest level ${fillMin})`)

  // 0 = untouched, 1 = black background, 2 = anti-aliased edge
  const kind = new Uint8Array(n * n)
  const flood = (seeds, mark, accept, neighbours) => {
    const queue = []
    for (const p of seeds) {
      if (!kind[p] && accept(p)) {
        kind[p] = mark
        queue.push(p)
      }
    }
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i] % n
      const y = (queue[i] / n) | 0
      for (const [dx, dy] of neighbours) {
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue
        const q = yy * n + xx
        if (!kind[q] && accept(q)) {
          kind[q] = mark
          queue.push(q)
        }
      }
    }
    return queue
  }
  const side = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  const around = [...side, [1, 1], [1, -1], [-1, 1], [-1, -1]]
  const background = flood([0, n - 1, n * (n - 1), n * n - 1], 1, isBlack, side)
  if (!background.length) throw new Error('The source has no black corners')
  const edge = flood(
    background.flatMap((p) => around.map(([dx, dy]) => p + dy * n + dx).filter((q) => q >= 0 && q < n * n && Math.abs((q % n) - (p % n)) <= 1)),
    2,
    (p) => level(p) < fillMin,
    around
  )

  for (const p of background) px[p * 4 + 3] = 0
  for (const p of edge) {
    const alpha = level(p) / fill
    if (alpha > 0) for (let ch = 0; ch < 3; ch++) px[p * 4 + ch] = Math.min(255, Math.round(px[p * 4 + ch] / alpha))
    px[p * 4 + 3] = Math.round(alpha * 255)
  }
  ctx.putImageData(image, 0, 0)

  window.sfRender = (size) => {
    // Halve while more than twice too big, then one final high-quality step
    let cur = master
    while (cur.width > size * 2) {
      const next = canvas(Math.round(cur.width / 2))
      const c = next.getContext('2d')
      c.imageSmoothingQuality = 'high'
      c.drawImage(cur, 0, 0, next.width, next.height)
      cur = next
    }
    const out = canvas(size)
    const c = out.getContext('2d')
    c.imageSmoothingQuality = 'high'
    c.drawImage(cur, 0, 0, size, size)
    return out.toDataURL('image/png')
  }
  return { size: n, fill, fillMin, background: background.length, edge: edge.length }
}

/** Opens a Chromium page with the masked master loaded (window.sfRender). Close the browser when done. */
export async function openMaster() {
  const executablePath = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .filter(Boolean)
    .find((candidate) => existsSync(candidate))
  if (!executablePath) {
    throw new Error('No local Chromium-compatible browser found. Set CHROME_PATH to a browser executable.')
  }
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setContent('<!doctype html><title>SessionForge icons</title>')
  const source = await readFile(SOURCE)
  const master = await page.evaluate(prepareMaster, { src: `data:image/png;base64,${source.toString('base64')}`, blackMax: BLACK_MAX })
  return { browser, page, master }
}

export const pngFromDataUrl = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')

async function write(outputName, png) {
  await mkdir(dirname(join(ROOT, outputName)), { recursive: true })
  await writeFile(join(ROOT, outputName), png)
}

async function main() {
  for (const file of Object.values(PROMO_FONTS)) {
    if (!existsSync(file)) throw new Error(`Promo font missing: ${file} (install fonts-dejavu-core)`)
  }
  const { browser, page, master } = await openMaster()
  try {
    console.log(
      `source ${master.size}x${master.size}: fill level ${master.fill} (darkest ${master.fillMin}), ` +
        `${master.background} background pixels transparent, ${master.edge} edge pixels partly transparent`
    )

    for (const [outputName, size] of icons) {
      await write(outputName, pngFromDataUrl(await page.evaluate((s) => window.sfRender(s), size)))
      console.log(`wrote ${outputName} (${size}x${size})`)
    }

    const fontFaces = []
    for (const [weight, file] of Object.entries(PROMO_FONTS)) {
      const data = (await readFile(file)).toString('base64')
      fontFaces.push(`@font-face{font-family:'SessionForge Promo';font-weight:${weight};src:url(data:font/ttf;base64,${data})}`)
    }
    for (const promo of promos) {
      // Promo tile: the SVG with the icon at its layout size and the embedded fonts, captured opaque
      const promoIcon = await page.evaluate((s) => window.sfRender(s), promo.icon)
      const svg = (await readFile(join(BRANDING, promo.source), 'utf8')).replace('href="sessionforge-icon-source.png"', `href="${promoIcon}"`)
      if (!svg.includes(promoIcon)) throw new Error(`${promo.source} has no <image href="sessionforge-icon-source.png">`)
      const promoPage = await browser.newPage({ viewport: { width: promo.width, height: promo.height }, deviceScaleFactor: 1 })
      await promoPage.setContent(`<!doctype html><style>${fontFaces.join('')}html,body{margin:0;overflow:hidden}svg{display:block}</style>${svg}`)
      const missing = await promoPage.evaluate(async (weights) => {
        const result = []
        for (const weight of weights) {
          const faces = await document.fonts.load(`${weight} 20px 'SessionForge Promo'`)
          if (!faces.some((face) => face.status === 'loaded')) result.push(weight)
        }
        await document.fonts.ready
        return result
      }, Object.keys(PROMO_FONTS))
      if (missing.length) throw new Error(`Promo font weights did not load: ${missing.join(', ')}`)
      const png = await promoPage.screenshot({ type: 'png', omitBackground: Boolean(promo.alpha) })
      // IHDR: width, height, bit depth, colour type. The store wants 8-bit truecolour (type 2), no alpha;
      // the README banner is 8-bit truecolour with alpha (type 6).
      const [width, height, depth, colourType] = [png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]]
      const wantType = promo.alpha ? 6 : 2
      const wantName = promo.alpha ? '8-bit RGBA' : '8-bit RGB'
      if (width !== promo.width || height !== promo.height || depth !== 8 || colourType !== wantType) {
        throw new Error(`${promo.output}: got ${width}x${height}, ${depth}-bit colour type ${colourType}; need ${promo.width}x${promo.height} ${wantName}`)
      }
      await write(promo.output, png)
      await promoPage.close()
      console.log(`wrote ${promo.output} (${promo.width}x${promo.height}, ${promo.alpha ? '32-bit RGBA' : '24-bit RGB'})`)
    }
  } finally {
    await browser.close()
  }
}

// Run only when executed directly, so verification scripts can import openMaster
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
