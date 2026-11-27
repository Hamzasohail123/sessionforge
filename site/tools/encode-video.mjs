// Builds site/assets/video/demo.{mp4,webm} and the poster from the frames capture.spec.ts recorded.
// Each frame is the shell plus its pane views, composited here with sharp; every frame keeps its real
// on-screen duration. Tools come from a throwaway prefix (not the app's package.json):
//   npm install --prefix /tmp/sessionforge-site-tools sharp@0.35 ffmpeg-static@5 axe-core@4
// Usage: node site/tools/encode-video.mjs
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const toolsReq = createRequire(join(process.env.SF_SITE_TOOLS ?? '/tmp/sessionforge-site-tools', 'package.json'))
const sharp = toolsReq('sharp')
const ffmpeg = toolsReq('ffmpeg-static')

const FRAMES = join(ROOT, 'test-artifacts', 'screenshots', 'site-video')
const OUT = join(ROOT, 'site', 'assets', 'video')
const MAX_BYTES = 4 * 1024 * 1024
const WIDTH = 1280

const { marks, frames } = JSON.parse(readFileSync(join(FRAMES, 'frames.json'), 'utf8'))
if (frames.length < 60) throw new Error(`only ${frames.length} frames`)

const work = join(tmpdir(), 'sessionforge-video-frames')
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
mkdirSync(OUT, { recursive: true })

// Composite: shell at device pixels, each view drawn at its bounds times the shell scale
const composed = []
for (const [i, f] of frames.entries()) {
  const shell = sharp(join(FRAMES, f.file))
  const meta = await shell.metadata()
  const scale = meta.width / f.width
  const layers = []
  for (const v of f.views) {
    const w = Math.round(v.width * scale)
    const h = Math.round(v.height * scale)
    if (w < 1 || h < 1) continue
    layers.push({
      input: await sharp(join(FRAMES, v.file)).resize(w, h, { fit: 'fill' }).toBuffer(),
      left: Math.round(v.x * scale),
      top: Math.round(v.y * scale)
    })
  }
  const file = join(work, `c${String(i).padStart(5, '0')}.png`)
  await shell.composite(layers).resize({ width: WIDTH }).png({ compressionLevel: 1 }).toFile(file)
  composed.push({ file, t: f.t })
}

// Concat list with real durations (the last frame holds until marks.end)
const lines = []
for (const [i, c] of composed.entries()) {
  const next = i + 1 < composed.length ? composed[i + 1].t : Math.max(marks.end, c.t + 100)
  lines.push(`file '${c.file}'`, `duration ${((next - c.t) / 1000).toFixed(3)}`)
}
lines.push(`file '${composed.at(-1).file}'`)
const list = join(work, 'list.txt')
writeFileSync(list, lines.join('\n'))
const total = (Math.max(marks.end, composed.at(-1).t) - composed[0].t) / 1000
console.log(`${composed.length} frames, ${total.toFixed(1)} s`)

const vf = `scale=${WIDTH}:-2:flags=lanczos,fps=30,format=yuv420p`
const encode = (out, codecArgs) =>
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', vf, '-an', ...codecArgs, out], {
    stdio: 'inherit'
  })

for (let crf = 22; ; crf += 2) {
  const out = join(OUT, 'demo.mp4')
  encode(out, ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high', '-movflags', '+faststart'])
  const size = statSync(out).size
  console.log(`demo.mp4 crf ${crf}: ${(size / 1024).toFixed(0)} KB`)
  if (size <= MAX_BYTES) break
}
for (let crf = 32; ; crf += 2) {
  const out = join(OUT, 'demo.webm')
  encode(out, ['-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-row-mt', '1', '-deadline', 'good'])
  const size = statSync(out).size
  console.log(`demo.webm crf ${crf}: ${(size / 1024).toFixed(0)} KB`)
  if (size <= MAX_BYTES) break
}

// Poster: shortly after the agent's Refund click, with the Agent pill and Stop in pane 1
const posterAt = marks.refund + 1500
const poster = composed.reduce((a, b) => (Math.abs(b.t - posterAt) < Math.abs(a.t - posterAt) ? b : a))
await sharp(poster.file).webp({ quality: 80, effort: 6 }).toFile(join(OUT, 'demo-poster.webp'))
const pm = await sharp(poster.file).metadata()
console.log(`poster ${pm.width}x${pm.height} from ${((poster.t - composed[0].t) / 1000).toFixed(1)} s`)
// Keep three composited frames for inspection
for (const s of [2, 9, 16]) {
  const at = composed[0].t + s * 1000
  const c = composed.reduce((a, b) => (Math.abs(b.t - at) < Math.abs(a.t - at) ? b : a))
  await sharp(c.file).toFile(join(FRAMES, `check-${s}s.png`))
}
