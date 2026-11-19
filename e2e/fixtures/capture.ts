import type { ElectronApplication } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectRoot, wm } from './app'

export const screenshotDir = join(projectRoot, 'test-artifacts', 'screenshots')

export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * Composite screenshot of the app window: window.capturePage() excludes child WebContentsViews,
 * so main captures the shell and every visible view and draws them on a canvas in a hidden scratch
 * window (about:blank has no app CSP, so data: images load). Writes test-artifacts/screenshots/<name>.png.
 */
export async function capture(app: ElectronApplication, name: string): Promise<string> {
  const dataUrl = await wm(app, async (sf, _arg: undefined, { BrowserWindow }) => {
    const win = sf.window
    const shellImg = await win.webContents.capturePage()
    const shell = shellImg.toPNG().toString('base64')
    const scale = shellImg.getSize().width / win.getContentBounds().width
    const views: Array<{ x: number; y: number; width: number; height: number; png: string }> = []
    for (const v of win.contentView.children) {
      if (!v.getVisible() || !('webContents' in v)) continue
      const wc = (v as Electron.WebContentsView).webContents
      const img = await wc.capturePage()
      views.push({ ...v.getBounds(), png: img.toPNG().toString('base64') })
    }
    const scratch = new BrowserWindow({ show: false, width: 200, height: 200 })
    try {
      await scratch.loadURL('about:blank')
      return (await scratch.webContents.executeJavaScript(`(async () => {
        const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src })
        const base = await load('data:image/png;base64,${shell}')
        const c = document.createElement('canvas'); c.width = base.width; c.height = base.height
        const ctx = c.getContext('2d'); ctx.drawImage(base, 0, 0)
        const s = ${scale}
        for (const v of ${JSON.stringify(views)}) {
          const img = await load('data:image/png;base64,' + v.png)
          ctx.drawImage(img, v.x * s, v.y * s, v.width * s, v.height * s)
        }
        return c.toDataURL('image/png')
      })()`)) as string
    } finally {
      scratch.destroy()
    }
  })
  await mkdir(screenshotDir, { recursive: true })
  const file = join(screenshotDir, `${name}.png`)
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
  return file
}

/** RGB of a tab's own rendered page at a view-relative point (default: the view centre). */
export async function sampleTab(app: ElectronApplication, tabId: string, point?: { x: number; y: number }): Promise<Rgb> {
  return wm(
    app,
    async (sf, { tabId, point }) => {
      const view = sf.windowManager.getViewForTest(tabId)
      if (!view) throw new Error('No live view for tab ' + tabId)
      const img = await view.webContents.capturePage()
      const { width, height } = img.getSize()
      const b = view.getBounds()
      const sx = width / Math.max(1, b.width)
      const sy = height / Math.max(1, b.height)
      const x = Math.min(width - 1, Math.round((point ? point.x : b.width / 2) * sx))
      const y = Math.min(height - 1, Math.round((point ? point.y : b.height / 2) * sy))
      const buf = img.toBitmap() // BGRA
      const i = (y * width + x) * 4
      return { r: buf[i + 2], g: buf[i + 1], b: buf[i] }
    },
    { tabId, point }
  )
}

/**
 * RGB of the shell (React UI) at a DIP point: a 1×1 capturePage, scaled by the shell capture-size
 * ratio the same way sampleTab is. Views are not in the shell capture, so this sees DOM only.
 */
export async function sampleShell(app: ElectronApplication, point: { x: number; y: number }): Promise<Rgb> {
  return wm(
    app,
    async (sf, p) => {
      const win = sf.window
      const img = await win.webContents.capturePage({ x: p.x, y: p.y, width: 1, height: 1 })
      const { width, height } = img.getSize()
      const buf = img.toBitmap() // BGRA; at a scale factor > 1 the 1×1 DIP rect is several pixels
      const i = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4
      return { r: buf[i + 2], g: buf[i + 1], b: buf[i] }
    },
    point
  )
}

/** The sample point for a pane's 2 px focus band: 1 px inside its left edge, at mid-height. */
export function bandPoint(rect: { left: number; top: number; height: number }): { x: number; y: number } {
  return { x: Math.floor(rect.left) + 1, y: Math.round(rect.top + rect.height / 2) }
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function colorMatches(actual: Rgb, hex: string, tolerance = 12): boolean {
  const want = hexToRgb(hex)
  return (
    Math.abs(actual.r - want.r) <= tolerance &&
    Math.abs(actual.g - want.g) <= tolerance &&
    Math.abs(actual.b - want.b) <= tolerance
  )
}
