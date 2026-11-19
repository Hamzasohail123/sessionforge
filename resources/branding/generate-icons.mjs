// Rasterize the self-contained SessionForge SVG sources with the installed Chromium renderer.
// Usage: node resources/branding/generate-icons.mjs
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const ROOT = resolve(new URL('../..', import.meta.url).pathname)
const BRANDING = join(ROOT, 'resources', 'branding')
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

const outputs = [
  ['sessionforge-icon.svg', 'chrome-extension/icon16.png', 16],
  ['sessionforge-icon.svg', 'chrome-extension/icon48.png', 48],
  ['sessionforge-icon.svg', 'chrome-extension/icon128.png', 128],
  ['sessionforge-icon.svg', 'chrome-extension/store/icon-128.png', 128],
  ['sessionforge-icon.svg', 'build/icon.png', 512],
  ['sessionforge-promo.svg', 'chrome-extension/store/promo-small-440x280.png', 440, 280]
]

await mkdir(join(ROOT, 'chrome-extension', 'store'), { recursive: true })
await mkdir(join(ROOT, 'build'), { recursive: true })

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox']
})

try {
  for (const [sourceName, outputName, width, height = width] of outputs) {
    const source = await readFile(join(BRANDING, sourceName), 'utf8')
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1
    })
    await page.setContent(`<!doctype html><style>html,body{margin:0;width:${width}px;height:${height}px;background:transparent;overflow:hidden}svg{display:block;width:${width}px;height:${height}px}</style>${source}`)
    await page.screenshot({ path: join(ROOT, outputName), type: 'png', omitBackground: true })
    await page.close()
    console.log(`wrote ${outputName} (${width}x${height})`)
  }
} finally {
  await browser.close()
}
