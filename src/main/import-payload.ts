// Pure URL and payload helpers (zod, types and constants only, no electron runtime import), shared by IPC,
// the import server, the window manager and unit specs.
import { z } from 'zod'
import type { CookiesSetDetails } from 'electron'
import { SESSION_NAME_MAX } from './constants'

export const isHttpUrl = (u: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(u).protocol)
  } catch {
    return false
  }
}

/** http(s) URLs and view-source: of an http(s) URL, the only things a tab may open. */
export const isOpenableUrl = (u: string): boolean => {
  if (!/^(view-source:)?https?:\/\//i.test(u)) return false
  try {
    new URL(u.replace(/^view-source:/i, ''))
    return true
  } catch {
    return false
  }
}

export const DEFAULT_IMPORT_PORT = 34567

/** SESSIONFORGE_IMPORT_PORT: unset/empty → 34567; an integer 1-65535 → it; anything else → error log, 34567. */
export function resolveImportPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_IMPORT_PORT
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    if (n >= 1 && n <= 65535) return n
  }
  console.error(`[import] invalid SESSIONFORGE_IMPORT_PORT, using ${DEFAULT_IMPORT_PORT}`)
  return DEFAULT_IMPORT_PORT
}

type SameSite = 'strict' | 'lax' | 'no_restriction'
const SAME_SITE: Record<string, SameSite> = {
  strict: 'strict',
  Strict: 'strict',
  lax: 'lax',
  Lax: 'lax',
  unspecified: 'lax',
  none: 'no_restriction',
  None: 'no_restriction',
  no_restriction: 'no_restriction'
}

/** Playwright (Strict/Lax/None), Chrome and Electron (strict/lax/no_restriction/unspecified) values. */
const SameSiteIn = z.string().transform((v, ctx): SameSite => {
  const out = SAME_SITE[v]
  if (!out) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown sameSite value "${v}"` })
    return z.NEVER
  }
  return out
})

const CookieIn = z.object({
  name: z.string().min(1).max(4096),
  value: z.string().max(4096),
  domain: z.string().min(1).max(253),
  path: z.string().max(1024).default('/'),
  expires: z.number().default(-1),
  httpOnly: z.boolean().default(false),
  secure: z.boolean().default(false),
  sameSite: SameSiteIn.default('Lax')
})
export type CookieInput = z.output<typeof CookieIn>

// https://mail.google.com/ → https://mail.google.com, the form location.origin has in the seed script
const OriginIn = z
  .string()
  .url()
  .refine(isHttpUrl, 'Only http(s) origins')
  .transform((o) => new URL(o).origin)

export const StorageStateSchema = z.object({
  cookies: z.array(CookieIn).max(3000),
  origins: z
    .array(
      z.object({
        origin: OriginIn,
        localStorage: z
          .array(z.object({ name: z.string().max(1024), value: z.string().max(1_000_000) }))
          .max(5000)
      })
    )
    .max(50)
    .default([])
})
export type StorageStateInput = z.output<typeof StorageStateSchema>

export const ImportPayloadSchema = z.object({
  action: z.literal('import').optional(),
  sessionName: z.string().trim().min(1).max(100).optional(),
  storageState: StorageStateSchema,
  metadata: z.object({
    url: z.string().url().refine(isHttpUrl, 'Only http(s) URLs'),
    // Informational only: an over-long title is cut and a bad favicon (e.g. a large data: URI) is
    // dropped, so neither can fail the import
    title: z
      .string()
      .transform((t) => t.slice(0, 500))
      .optional()
      .catch(undefined),
    favicon: z.string().max(4096).optional().catch(undefined)
  })
})
export type ImportPayload = z.output<typeof ImportPayloadSchema>

/**
 * "Sign in with Chrome" hand-off: cookies for the session a pending request names. The client sends
 * only the request id; main decides the session, the cookie domains and the return URL. Unknown keys
 * (metadata, sessionName) are stripped.
 */
export const HandOffImportSchema = z.object({
  action: z.literal('import').optional(),
  requestId: z.string().uuid(),
  storageState: StorageStateSchema
})
export type HandOffImport = z.output<typeof HandOffImportSchema>

/** True for a JSON object that has its own requestId key (any value). */
export function isHandOffPayload(json: unknown): boolean {
  return typeof json === 'object' && json !== null && !Array.isArray(json) && Object.prototype.hasOwnProperty.call(json, 'requestId')
}

/** First 3 issues as "path: message", joined by '; '. */
export function formatZodIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 3)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ')
}

/** Imported cookies without an expiry (session cookies) are kept this long, so logins survive a restart. */
export const IMPORTED_SESSION_COOKIE_TTL_SEC = 30 * 24 * 60 * 60

/** Electron cookie details for a parsed cookie, or null when it has already expired (skipped). */
export function toElectronCookie(c: CookieInput, nowSec: number): CookiesSetDetails | null {
  if (c.expires > 0 && c.expires <= nowSec) return null
  const hostOnly = !c.domain.startsWith('.')
  const host = c.domain.replace(/^\./, '')
  const path = c.path.startsWith('/') ? c.path : '/'
  return {
    // A secure cookie must be set through an https URL; http keeps 127.0.0.1 test cookies valid
    url: `${c.secure ? 'https' : 'http'}://${host}${path}`,
    name: c.name,
    value: c.value,
    // Electron turns any supplied domain into a domain cookie, so host-only cookies omit it
    domain: hostOnly ? undefined : c.domain,
    path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    expirationDate: c.expires > 0 ? c.expires : nowSec + IMPORTED_SESSION_COOKIE_TTL_SEC
  }
}

/**
 * sessionName, else the page's hostname; " 2" … " 99" when taken, then a timestamp suffix. The base
 * is cut so the name with its suffix fits SESSION_NAME_MAX, the limit rename checks.
 */
export function deriveSessionName(
  payload: Pick<ImportPayload, 'sessionName' | 'metadata'>,
  existingNames: Set<string>
): string {
  const base = payload.sessionName ?? new URL(payload.metadata.url).hostname
  const fit = (suffix: string) => `${base.slice(0, SESSION_NAME_MAX - suffix.length).trimEnd()}${suffix}`
  const name = fit('')
  if (!existingNames.has(name)) return name
  for (let i = 2; i <= 99; i++) {
    const numbered = fit(` ${i}`)
    if (!existingNames.has(numbered)) return numbered
  }
  return fit(` ${Date.now()}`)
}

/** The first colour no session uses yet, cycling through the palette when all are used. */
export function pickSessionColor(palette: string[], usedColors: string[]): string {
  const used = new Set(usedColors)
  const free = palette.find((c) => !used.has(c))
  return free ?? palette[usedColors.length % palette.length]
}
