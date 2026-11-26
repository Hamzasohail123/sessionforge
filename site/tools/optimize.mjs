// Turns the raw captures (test-artifacts/screenshots/site/*.png, deviceScaleFactor 2, 1440x900 CSS px windows)
// into site/assets/shots/. Full windows: <name>.webp (2880 px, 2x) and <name>-1440.webp (1x), lossy q92.
// Focused crops of UI details: <name>.webp (2x) and <name>-1x.webp, lossless so small text stays crisp.
// Every output is tagged sRGB like the capture, so colours match the app.
// Prints each file's pixel size and its natural CSS size (2x pixels / 2) for the HTML width/height.
// Usage: node site/tools/optimize.mjs (sharp from /tmp/sessionforge-site-tools, see encode-video.mjs)
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const sharp = createRequire(join(process.env.SF_SITE_TOOLS ?? '/tmp/sessionforge-site-tools', 'package.json'))('sharp')
const RAW = join(ROOT, 'test-artifacts', 'screenshots', 'site')
const OUT = join(ROOT, 'site', 'assets', 'shots')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const { scale, crops: recorded } = JSON.parse(readFileSync(join(RAW, 'crops.json'), 'utf8'))

// Full windows, shown wide (hero-sized sections and article pages)
const FULL = ['split-columns', 'grid', 'agent']
// Focused crops in CSS px of the 1440x900 window. capture.spec.ts fixes the window size, so these boxes are
// stable; the agent header box comes from the spec (crops.json).
const agent = recorded.find((c) => c.name === 'agent-header').box
const CROPS = [
  // Session bar with Admin, Customer, Guest and the focused Admin (prod) session and its red PROD label
  { name: 'prod-bar', source: 'grid', box: { x: 0, y: 0, width: 720, height: 136 } },
  // The pane header with the Agent label and Stop, plus the search box the agent typed into
  { name: 'agent-header', source: 'agent', box: { x: agent.x, y: agent.y, width: Math.min(agent.width, 600), height: 330 } },
  // Settings: each tab as the whole modal over the dimmed app (-modal) and the right-hand panel only (-panel),
  // boxes measured by capture.spec.ts
  ...recorded.filter((c) => c.name.startsWith('settings-')),
  // The New Session dialog
  { name: 'new-session-dialog', source: 'new-session', box: { x: 456, y: 246, width: 528, height: 408 } }
]

const srgb = (s) => s.withIccProfile('srgb')
const kb = (f) => `${(statSync(join(OUT, f)).size / 1024).toFixed(0)} KB`

for (const name of FULL) {
  const input = join(RAW, `${name}.png`)
  const { width, height } = await sharp(input).metadata()
  await srgb(sharp(input).removeAlpha()).webp({ quality: 92, effort: 6, smartSubsample: true }).toFile(join(OUT, `${name}.webp`))
  await srgb(sharp(input).removeAlpha().resize({ width: width / scale, kernel: 'lanczos3' })).webp({ quality: 92, effort: 6 }).toFile(join(OUT, `${name}-1440.webp`))
  console.log(`${name}.webp\t${width}x${height}\tCSS ${width / scale}x${height / scale}\t${kb(`${name}.webp`)} + ${kb(`${name}-1440.webp`)}`)
}
// One PNG for the JSON-LD screenshot URL
await srgb(sharp(join(RAW, 'split-columns.png')).removeAlpha().resize({ width: 1440 })).png({ compressionLevel: 9 }).toFile(join(OUT, 'split-columns.png'))

for (const c of CROPS) {
  const b = c.box
  const region = { left: Math.round(b.x * scale), top: Math.round(b.y * scale), width: Math.round(b.width * scale), height: Math.round(b.height * scale) }
  const buf = await sharp(join(RAW, `${c.source}.png`)).extract(region).removeAlpha().toBuffer()
  await srgb(sharp(buf)).webp({ lossless: true, effort: 6 }).toFile(join(OUT, `${c.name}.webp`))
  await srgb(sharp(buf).resize({ width: Math.round(region.width / scale), kernel: 'lanczos3' })).webp({ lossless: true, effort: 6 }).toFile(join(OUT, `${c.name}-1x.webp`))
  console.log(`${c.name}.webp\t${region.width}x${region.height}\tCSS ${region.width / scale}x${region.height / scale}\t${kb(`${c.name}.webp`)} + ${kb(`${c.name}-1x.webp`)}`)
}
// Extension captures (capture.spec.ts "extension"): popups whole, the app side cropped. Window 1400x900 CSS px.
const EXT = join(RAW, 'extension')
const EXT_SHOTS = [
  ...['popup-consent', 'popup-ready', 'popup-sent', 'popup-request', 'popup-request-sent'].map((n) => ({ name: n, source: n, box: null })),
  // Pane header with the Sign in with Chrome banner (offer, then waiting)
  { name: 'ext-banner', source: 'app-signin-banner', box: { x: 0, y: 132, width: 700, height: 136 } },
  { name: 'ext-waiting', source: 'app-signin-waiting', box: { x: 0, y: 132, width: 700, height: 136 } },
  // A login sent from Chrome: the new session and its pane, with SessionForge's "Imported" notice
  { name: 'ext-imported', source: 'app-imported', box: { x: 0, y: 0, width: 1400, height: 400 } },
  // After the hand-off: the Admin pane continued, logged in, with "Login sent from Chrome: Admin"
  { name: 'ext-signin-done', source: 'app-signin-done', box: { x: 0, y: 0, width: 1400, height: 540 } }
]
for (const c of EXT_SHOTS) {
  const input = join(EXT, `${c.source}.png`)
  let img = sharp(input).removeAlpha()
  const meta = await sharp(input).metadata()
  const region = c.box
    ? { left: c.box.x * scale, top: c.box.y * scale, width: c.box.width * scale, height: c.box.height * scale }
    : { left: 0, top: 0, width: meta.width, height: meta.height }
  const buf = await img.extract(region).toBuffer()
  await srgb(sharp(buf)).webp({ lossless: true, effort: 6 }).toFile(join(OUT, `${c.name}.webp`))
  await srgb(sharp(buf).resize({ width: Math.round(region.width / scale), kernel: 'lanczos3' })).webp({ lossless: true, effort: 6 }).toFile(join(OUT, `${c.name}-1x.webp`))
  console.log(`${c.name}.webp\t${region.width}x${region.height}\tCSS ${region.width / scale}x${region.height / scale}\t${kb(`${c.name}.webp`)} + ${kb(`${c.name}-1x.webp`)}`)
}
const total = readdirSync(OUT).reduce((s, f) => s + statSync(join(OUT, f)).size, 0)
console.log(`shots total ${(total / 1048576).toFixed(2)} MB`)
