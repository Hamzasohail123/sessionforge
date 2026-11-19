// All-panes screenshot compositing (design §12). Pure: BGRA buffers in, one BGRA buffer out.

export interface CompositeItem {
  /** Target rect in canvas pixels */
  x: number
  y: number
  width: number
  height: number
  /** BGRA bitmap and its size; absent → masked (filled grey) */
  bitmap?: Buffer
  bitmapWidth?: number
  bitmapHeight?: number
}

export const MASK_BGRA = [0x80, 0x80, 0x80, 0xff] as const

export function composite(items: CompositeItem[], canvasW: number, canvasH: number): Buffer {
  const out = Buffer.alloc(canvasW * canvasH * 4)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = MASK_BGRA[0]
    out[i + 1] = MASK_BGRA[1]
    out[i + 2] = MASK_BGRA[2]
    out[i + 3] = MASK_BGRA[3]
  }
  for (const it of items) {
    const x0 = Math.max(0, Math.round(it.x))
    const y0 = Math.max(0, Math.round(it.y))
    const x1 = Math.min(canvasW, Math.round(it.x + it.width))
    const y1 = Math.min(canvasH, Math.round(it.y + it.height))
    if (x1 <= x0 || y1 <= y0 || !it.bitmap || !it.bitmapWidth || !it.bitmapHeight) continue
    const bw = it.bitmapWidth
    const bh = it.bitmapHeight
    const sx = bw / Math.max(1, it.width)
    const sy = bh / Math.max(1, it.height)
    const same = bw === x1 - x0 && Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9
    for (let y = y0; y < y1; y++) {
      const srcY = Math.min(bh - 1, Math.floor((y - it.y) * sy))
      if (same) {
        const start = (srcY * bw + Math.max(0, x0 - Math.round(it.x))) * 4
        it.bitmap.copy(out, (y * canvasW + x0) * 4, start, start + (x1 - x0) * 4)
        continue
      }
      for (let x = x0; x < x1; x++) {
        const srcX = Math.min(bw - 1, Math.floor((x - it.x) * sx))
        const s = (srcY * bw + srcX) * 4
        const d = (y * canvasW + x) * 4
        out[d] = it.bitmap[s]
        out[d + 1] = it.bitmap[s + 1]
        out[d + 2] = it.bitmap[s + 2]
        out[d + 3] = it.bitmap[s + 3]
      }
    }
  }
  return out
}
