// Rate limits (design §8.7). Pure, with an injectable clock.

export type Clock = () => number

export class TokenBucket {
  private tokens: number
  private last: number

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: Clock = Date.now
  ) {
    this.tokens = capacity
    this.last = now()
  }

  private refill(): void {
    const t = this.now()
    const elapsed = Math.max(0, t - this.last) / 1000
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec)
    this.last = t
  }

  /** Take one token. Returns 0 on success, otherwise the milliseconds until one is available. */
  take(): number {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens -= 1
      return 0
    }
    return Math.ceil(((1 - this.tokens) / this.refillPerSec) * 1000)
  }
}

export class ConcurrencyGate {
  private running = 0
  constructor(private readonly max: number) {}

  tryEnter(): boolean {
    if (this.running >= this.max) return false
    this.running++
    return true
  }

  leave(): void {
    this.running = Math.max(0, this.running - 1)
  }

  get active(): number {
    return this.running
  }
}

/** One holder at a time; waiters queue in order and give up after waitMs. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve()

  async acquire(waitMs: number, signal?: AbortSignal): Promise<(() => void) | null> {
    let release!: () => void
    const mine = new Promise<void>((r) => (release = r))
    const prev = this.tail
    this.tail = prev.then(() => mine)
    let timer: NodeJS.Timeout | undefined
    let onAbort: (() => void) | undefined
    const ok = await Promise.race([
      prev.then(() => true),
      new Promise<boolean>((r) => {
        timer = setTimeout(() => r(false), waitMs)
        if (signal) {
          onAbort = () => r(false)
          signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    ])
    clearTimeout(timer)
    if (signal && onAbort) signal.removeEventListener('abort', onAbort)
    if (!ok) {
      // Keep the chain intact: release our slot as soon as the previous holder finishes
      void prev.then(release)
      return null
    }
    return release
  }
}
