// The Agent Bridge bearer token (design §6.4): 256 random bits, encrypted with safeStorage under
// userData/agent-bridge/token.bin. Falls back to an in-memory token when the OS keyring is unavailable.
import { safeStorage } from 'electron'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

export const TOKEN_RE = /^sfa_[A-Za-z0-9_-]{43}$/

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest()

export function newToken(): string {
  return 'sfa_' + randomBytes(32).toString('base64url')
}

export class TokenStore {
  private token = ''
  private _persisted = false
  private _regenerated = false

  constructor(private readonly dir: string) {}

  get file(): string {
    return join(this.dir, 'token.bin')
  }

  get persisted(): boolean {
    return this._persisted
  }

  get regenerated(): boolean {
    return this._regenerated
  }

  load(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      this.token = newToken()
      this._persisted = false
      console.warn('[agent] OS keyring unavailable; the agent token is not saved and changes on every start')
      return
    }
    if (existsSync(this.file)) {
      try {
        const t = safeStorage.decryptString(readFileSync(this.file))
        if (!TOKEN_RE.test(t)) throw new Error('bad token format')
        this.token = t
        this._persisted = true
        return
      } catch {
        console.warn('[agent] stored token unreadable; created a new one')
        this._regenerated = true
      }
    }
    this.token = newToken()
    this.save()
  }

  private save(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      this._persisted = false
      return
    }
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 })
      const tmp = this.file + '.tmp'
      writeFileSync(tmp, safeStorage.encryptString(this.token), { mode: 0o600 })
      chmodSync(tmp, 0o600)
      renameSync(tmp, this.file)
      this._persisted = true
    } catch (e) {
      this._persisted = false
      console.warn('[agent] could not save the agent token:', (e as Error).message)
    }
  }

  rotate(): void {
    this.token = newToken()
    this._regenerated = false
    this.save()
  }

  get(): string {
    return this.token
  }

  hint(): string {
    return this.token.slice(-4)
  }

  matches(presented: string): boolean {
    if (!this.token) return false
    return timingSafeEqual(sha(presented), sha(this.token))
  }
}
