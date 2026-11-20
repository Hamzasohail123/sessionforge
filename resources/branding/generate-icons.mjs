// Build every SessionForge icon and the store promo tile from the master PNG, with the installed Chromium.
// Usage: node resources/branding/generate-icons.mjs
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(new URL('../..', import.meta.url).pathname)
const BRANDING = join(ROOT, 'resources', 'branding')
// The artwork as delivered (1254x1254 RGB): a navy rounded square edge to edge, black outside its corners
const SOURCE = join(BRANDING, 'sessionforge-icon-source.png')
// How far (source pixels, along the diagonal) the transparent corner mask sits inside the artwork's own
// rounded edge, so no black from the source corners survives
const MASK_INSET = 2
// Unsharp amount for icons of 32 px and below, where the window outlines otherwise blur into the navy
const SMALL_SHARPEN = 0.6
// The promo text uses these files, never a fallback font. DejaVu ships with practically every Linux.
const PROMO_FONTS = {
  400: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  700: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
}
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean)
const executablePath = chromeCandidates.find((candidate) => existsSync(candidate))

if (!executablePath) {
  throw new Error('No local Chromium-compatible browser found. Set CHROME_PATH to a browser executable.')
}
for (const file of Object.values(PROMO_FONTS)) {
  if (!existsSync(file)) throw new Error(`Promo font missing: ${file} (install fonts-dejavu-core)`)
}

// Desktop app icons (Linux, Windows): about 5% transparent margin per side, like other app icons
const desktopMargin = (size) => Math.round(size * 0.05)
// [output, canvas size, transparent margin per side]
const icons = [
  // Chrome toolbar and extensions page: little or no margin so the 16 px icon stays legible
  ['chrome-extension/icon16.png', 16, 0],
  ['chrome-extension/icon48.png', 48, 2],
  ['chrome-extension/icon128.png', 128, 4],
  // Chrome Web Store icon: 96x96 artwork with 16 px transparent padding
  ['chrome-extension/store/icon-128.png', 128, 16],
  // macOS: Apple's 1024 template, 824x824 artwork centred
  ['build/icon-mac.png', 1024, 100],
  // Windows .ico
  ['build/icon.png', 1024, desktopMargin(1024)],
  // Linux packages: electron-builder installs each NxN.png into /usr/share/icons/hicolor/NxN/apps
  ...[16, 24, 32, 48, 64, 128, 256, 512].map((size) => [`build/icons/${size}x${size}.png`, size, desktopMargin(size)]),
  // BrowserWindow icon on Linux (window list and title bar)
  ['resources/icon.png', 256, desktopMargin(256)],
  // Renderer favicon, served from Vite's public folder
  ['src/renderer/public/sessionforge-icon.png', 64, 0]
]
const promo = { source: 'sessionforge-promo.svg', output: 'chrome-extension/store/promo-small-440x280.png', width: 440, height: 280, icon: 164 }

/** Runs in the page: masks the source corners and installs window.sfRender(size, margin, sharpen). */
async function prepareMaster({ src, inset }) {
  const img = new Image()
  img.src = src
  await img.decode()
  const n = img.naturalWidth
  if (n !== img.naturalHeight) throw new Error(`Source must be square, got ${n}x${img.naturalHeight}`)
  const canvas = (size) => Object.assign(document.createElement('canvas'), { width: size, height: size })
  const master = canvas(n)
  const ctx = master.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const px = ctx.getImageData(0, 0, n, n).data
  const level = (x, y) => px[(y * n + x) * 4] + px[(y * n + x) * 4 + 1] + px[(y * n + x) * 4 + 2]
  // The navy fill where the tile meets the middle of the top edge
  const fill = level(n >> 1, 2)
  // Walk in from each corner along the diagonal to where black turns into navy (half way, sub-pixel)
  const corners = [[0, 0, 1, 1], [n - 1, 0, -1, 1], [0, n - 1, 1, -1], [n - 1, n - 1, -1, -1]]
  const reach = corners.map(([x0, y0, dx, dy]) => {
    for (let i = 1; i < n / 2; i++) {
      const cur = level(x0 + dx * i, y0 + dy * i)
      if (cur >= fill / 2) {
        const prev = level(x0 + dx * (i - 1), y0 + dy * (i - 1))
        return i - 0.5 + (fill / 2 - prev) / (cur - prev)
      }
    }
    throw new Error('No rounded corner found on the diagonal')
  })
  // A rounded square flush with the canvas crosses its diagonal at radius * (1 - 1/√2) from the corner
  const k = 1 - Math.SQRT1_2
  const edge = Math.max(...reach)
  const maskRadius = (edge + inset) / k
  ctx.globalCompositeOperation = 'destination-in'
  ctx.beginPath()
  ctx.roundRect(0, 0, n, n, maskRadius)
  ctx.fill()

  // Mild unsharp mask on the colour only. Neighbours count by their alpha, so the transparent corners
  // never pull dark into the edge, and alpha stays as the resize left it.
  const sharpen = (target, amount) => {
    const c = target.getContext('2d')
    const image = c.getImageData(0, 0, target.width, target.height)
    const src = image.data.slice()
    const w = target.width
    const h = target.height
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (src[i + 3] === 0) continue
        const blur = [0, 0, 0]
        let weight = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
            const j = (yy * w + xx) * 4
            const w3 = (dx ? 1 : 2) * (dy ? 1 : 2) * src[j + 3]
            for (let ch = 0; ch < 3; ch++) blur[ch] += w3 * src[j + ch]
            weight += w3
          }
        }
        for (let ch = 0; ch < 3; ch++) image.data[i + ch] = src[i + ch] + amount * (src[i + ch] - blur[ch] / weight)
      }
    }
    c.putImageData(image, 0, 0)
  }

  window.sfRender = (size, margin, sharpenAmount = 0) => {
    const art = size - 2 * margin
    // Halve while more than twice too big, then one final high-quality step
    let cur = master
    while (cur.width > art * 2) {
      const next = canvas(Math.round(cur.width / 2))
      const c = next.getContext('2d')
      c.imageSmoothingQuality = 'high'
      c.drawImage(cur, 0, 0, next.width, next.height)
      cur = next
    }
    const out = canvas(size)
    const c = out.getContext('2d')
    c.imageSmoothingQuality = 'high'
    c.drawImage(cur, margin, margin, art, art)
    if (sharpenAmount) sharpen(out, sharpenAmount)
    return out.toDataURL('image/png')
  }
  return { size: n, fill, reach, radius: edge / k, maskRadius }
}

const pngFromDataUrl = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')

async function write(outputName, png) {
  await mkdir(dirname(join(ROOT, outputName)), { recursive: true })
  await writeFile(join(ROOT, outputName), png)
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox']
})

try {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><title>SessionForge icons</title>')
  const source = await readFile(SOURCE)
  const master = await page.evaluate(prepareMaster, { src: `data:image/png;base64,${source.toString('base64')}`, inset: MASK_INSET })
  console.log(
    `source ${master.size}x${master.size}: corner reach ${master.reach.map((r) => r.toFixed(1)).join('/')} px, ` +
      `radius ${master.radius.toFixed(1)} px, mask radius ${master.maskRadius.toFixed(1)} px`
  )

  for (const [outputName, size, margin] of icons) {
    const sharpen = size <= 32 ? SMALL_SHARPEN : 0
    await write(outputName, pngFromDataUrl(await page.evaluate((args) => window.sfRender(...args), [size, margin, sharpen])))
    console.log(`wrote ${outputName} (${size}x${size}, margin ${margin}${sharpen ? `, sharpen ${sharpen}` : ''})`)
  }

  // Promo tile: the SVG with the processed icon and the embedded fonts, captured opaque
  const promoIcon = await page.evaluate((s) => window.sfRender(s, 0), promo.icon)
  const svg = (await readFile(join(BRANDING, promo.source), 'utf8')).replace('href="sessionforge-icon-source.png"', `href="${promoIcon}"`)
  if (!svg.includes(promoIcon)) throw new Error(`${promo.source} has no <image href="sessionforge-icon-source.png">`)
  const fontFaces = []
  for (const [weight, file] of Object.entries(PROMO_FONTS)) {
    const data = (await readFile(file)).toString('base64')
    fontFaces.push(`@font-face{font-family:'SessionForge Promo';font-weight:${weight};src:url(data:font/ttf;base64,${data})}`)
  }
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
  await write(promo.output, await promoPage.screenshot({ type: 'png' }))
  console.log(`wrote ${promo.output} (${promo.width}x${promo.height})`)
} finally {
  await browser.close()
}
