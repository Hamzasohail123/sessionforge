// Chrome-format user agent (pure, no electron import: unit specs load this in plain Node).
// Built from parts in Chrome's reduced form (Chrome/<major>.0.0.0, frozen platform tokens), so
// sites see what real Chrome sends and nothing mentions Electron or the app name.

const PLATFORM_TOKENS: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'Windows NT 10.0; Win64; x64',
  darwin: 'Macintosh; Intel Mac OS X 10_15_7'
}

export function buildChromeUserAgent(chromeVersion: string, platform: NodeJS.Platform): string {
  const major = parseInt(String(chromeVersion).split('.')[0], 10)
  if (Number.isNaN(major)) throw new Error('Invalid Chrome version')
  const token = PLATFORM_TOKENS[platform] ?? 'X11; Linux x86_64'
  return `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}

let cached: string | undefined

/** The UA for this Electron build. Built on first call, so importing this module never throws. */
export function getChromeUserAgent(): string {
  return (cached ??= buildChromeUserAgent(process.versions.chrome, process.platform))
}
