// The Chrome Web Store package: narrow permissions, every referenced file present, only 127.0.0.1 contacted
// (plus GitHub's release API and page from update-check.js), no eval or remote scripts.
import { test, expect } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const extDir = join(__dirname, '..', '..', 'chrome-extension')
const MANIFEST_SRC = readFileSync(join(extDir, 'manifest.json'), 'utf8')
const manifest = JSON.parse(MANIFEST_SRC)
const sources = readdirSync(extDir)
  .filter((f) => f.endsWith('.js') || f.endsWith('.html'))
  .map((f) => ({ f, src: readFileSync(join(extDir, f), 'utf8') }))

test('manifest: version 1.4.0, a short description, and only the narrow permissions', () => {
  expect(manifest.manifest_version).toBe(3)
  expect(manifest.version).toBe('1.4.0')
  expect(manifest.description.length).toBeLessThanOrEqual(132)
  expect(manifest.permissions).toEqual(['activeTab', 'cookies', 'scripting', 'storage'])
  expect(manifest.host_permissions).toEqual(['http://127.0.0.1:34567/*'])
  expect(manifest.optional_host_permissions).toEqual(['*://*/*'])
  expect(MANIFEST_SRC).not.toContain('<all_urls>')
  expect(manifest.content_scripts).toBeUndefined()
})

test('every file the manifest and the pages reference exists', () => {
  const files = [
    manifest.action.default_popup,
    manifest.background.service_worker,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons)
  ] as string[]
  for (const page of ['popup.html', 'grant.html']) {
    const html = readFileSync(join(extDir, page), 'utf8')
    files.push(page, ...[...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]))
  }
  for (const f of files) expect(existsSync(join(extDir, f)), f).toBe(true)
  // popup.js opens grant.html by name
  expect(readFileSync(join(extDir, 'popup.js'), 'utf8')).toContain("getURL('grant.html')")
})

const GITHUB_URLS = [
  'https://api.github.com/repos/Hamzasohail123/sessionforge/releases/latest',
  'https://github.com/Hamzasohail123/sessionforge/releases/latest'
]
test('the only http(s) URLs are the local SessionForge server and, in update-check.js only, the GitHub release check', () => {
  expect(sources.map((s) => s.f).sort()).toEqual(
    ['access.js', 'background.js', 'grant.html', 'grant.js', 'handoff.js', 'popup.html', 'popup.js', 'update-check.js']
  )
  const github: string[] = []
  for (const { f, src } of sources) {
    for (const [url] of src.matchAll(/https?:\/\/[^\s'"`)<]+/g)) {
      if (url.startsWith('http://127.0.0.1:34567')) continue
      expect(f === 'update-check.js' && GITHUB_URLS.includes(url), `${f}: ${url}`).toBe(true)
      github.push(url)
    }
  }
  expect(github.sort()).toEqual([...GITHUB_URLS].sort())
})
test('popup.html loads update-check.js before popup.js', () => {
  const html = readFileSync(join(extDir, 'popup.html'), 'utf8')
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])
  expect(scripts.indexOf('update-check.js')).toBeGreaterThan(-1)
  expect(scripts.indexOf('update-check.js')).toBeLessThan(scripts.indexOf('popup.js'))
})

test('no eval, new Function or remote scripts', () => {
  for (const { f, src } of sources) {
    expect(src, f).not.toMatch(/\beval\s*\(|new Function\b|<script src="(https?:)?\/\//)
  }
})
