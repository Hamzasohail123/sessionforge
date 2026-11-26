// Turns the raw captures (test-artifacts/screenshots/site/*.png, 2x) into site/assets/shots/:
// <name>.webp (2400 or 1600 px), <name>-1200.webp and a <name>.png fallback (1600 px or less), plus crops.
// Prints each file's real size for the width/height attributes in the HTML.
// Usage: node site/tools/optimize.mjs (sharp from /tmp/sessionforge-site-tools, see encode-video.mjs)
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const sharp = createRequire(join(process.env.SF_SITE_TOOLS ?? '/tmp/sessionforge-site-tools', 'package.json'))('sharp')
const RAW = join(ROOT, 'test-artifacts', 'screenshots', 'site')
const OUT = join(ROOT, 'site', 'assets', 'shots')
mkdirSync(OUT, { recursive: true })

// name -> largest webp width
const SHOTS = { 'split-columns': 2400, grid: 2400, agent: 2400, 'settings-mcp': 1600, 'settings-editors': 1600, 'new-session': 1600 }
const { scale, crops } = JSON.parse(readFileSync(join(RAW, 'crops.json'), 'utf8'))

async function emit(name, input, maxWidth) {
  const meta = await sharp(input).metadata()
  const big = Math.min(maxWidth, meta.width)
  const outs = [
    [`${name}.webp`, (s) => s.resize({ width: big }).webp({ quality: 82, effort: 6 })],
    [`${name}-1200.webp`, (s) => s.resize({ width: Math.min(1200, meta.width) }).webp({ quality: 80, effort: 6 })],
    [`${name}.png`, (s) => s.resize({ width: Math.min(1600, meta.width) }).png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })]
  ]
  for (const [file, fn] of outs) {
    const info = await fn(sharp(input)).toFile(join(OUT, file))
    console.log(`${file}\t${info.width}x${info.height}\t${(statSync(join(OUT, file)).size / 1024).toFixed(0)} KB`)
  }
}

for (const [name, width] of Object.entries(SHOTS)) await emit(name, join(RAW, `${name}.png`), width)
for (const c of crops) {
  const b = c.box
  const region = { left: Math.round(b.x * scale), top: Math.round(b.y * scale), width: Math.round(b.width * scale), height: Math.round(b.height * scale) }
  const buf = await sharp(join(RAW, `${c.source}.png`)).extract(region).toBuffer()
  await emit(c.name, buf, 1600)
}
