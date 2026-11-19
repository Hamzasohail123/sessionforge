// SessionForge Import Extension - "Sign in with Chrome" hand-off helpers.
// Loaded by popup.html before popup.js, and require()-able by the unit specs. One IIFE: the only name
// it adds is self.SessionForgeHandOff (or module.exports under Node), so it cannot clash with popup.js.
(function () {
  'use strict';

  const SAME_SITE = { no_restriction: 'None', lax: 'Lax', strict: 'Strict', unspecified: 'Lax' };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const COLOR = /^#[0-9a-f]{6}$/i;
  // Lowercase hostname scopes only (google.com, localhost, 127.0.0.1)
  const DOMAIN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
  const DEFAULT_COLOR = '#3b82f6';
  const MAX_REQUESTS = 3;

  /** chrome.cookies.Cookie → Playwright storageState cookie. */
  function toPlaywrightCookie(c) {
    return {
      name: c.name,
      value: c.value,
      domain: c.hostOnly
        ? c.domain.replace(/^\./, '')
        : c.domain.startsWith('.') ? c.domain : '.' + c.domain,
      path: c.path,
      expires: c.session ? -1 : c.expirationDate,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: SAME_SITE[c.sameSite] || 'Lax'
    };
  }

  /** The requests of a GET /pending answer that are well-formed and not expired (at most 3). */
  function parsePending(json, now) {
    const list = json && Array.isArray(json.requests) ? json.requests : [];
    const out = [];
    for (const r of list) {
      if (out.length >= MAX_REQUESTS) break;
      if (!r || typeof r !== 'object') continue;
      if (typeof r.id !== 'string' || !UUID.test(r.id)) continue;
      if (typeof r.sessionName !== 'string') continue;
      const domains = r.cookieDomains;
      if (!Array.isArray(domains) || domains.length < 1 || domains.length > 4) continue;
      if (!domains.every((d) => typeof d === 'string' && DOMAIN.test(d))) continue;
      if (typeof r.expiresAt !== 'number' || !(r.expiresAt > now)) continue;
      out.push({
        id: r.id,
        sessionName: r.sessionName.slice(0, 100),
        sessionColor: typeof r.sessionColor === 'string' && COLOR.test(r.sessionColor) ? r.sessionColor : DEFAULT_COLOR,
        cookieDomains: domains.slice(),
        expiresAt: r.expiresAt
      });
    }
    return out;
  }

  /** Every cookie of the given domains (and their subdomains), deduplicated by name|domain|path. */
  async function collectCookiesForDomains(getAll, domains) {
    const seen = new Map();
    for (const domain of domains) {
      const list = (await getAll({ domain })) || [];
      for (const c of list) {
        const key = `${c.name}|${c.domain}|${c.path}`;
        if (!seen.has(key)) seen.set(key, c);
      }
    }
    return [...seen.values()];
  }

  /** Cookies only: SessionForge ignores localStorage on a hand-off. */
  function buildHandOffPayload(requestId, cookies) {
    return {
      action: 'import',
      requestId,
      storageState: { cookies: cookies.map(toPlaywrightCookie), origins: [] }
    };
  }

  const api = { SAME_SITE, toPlaywrightCookie, parsePending, collectCookiesForDomains, buildHandOffPayload };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else self.SessionForgeHandOff = api;
})();
