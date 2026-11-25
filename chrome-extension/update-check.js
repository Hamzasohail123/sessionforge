// SessionForge Import Extension - "a newer SessionForge desktop is out" check.
// Loaded by popup.html before popup.js, and require()-able by the unit specs. One IIFE: the only name
// it adds is self.SessionForgeUpdate (or module.exports under Node), so it cannot clash with popup.js.
// It asks GitHub for the latest release number at most once a day and sends nothing about the user.
// GitHub's API answers with Access-Control-Allow-Origin: *, so no host permission is needed.
(function () {
  'use strict';
  const LATEST_URL = 'https://api.github.com/repos/Hamzasohail123/sessionforge/releases/latest';
  const RELEASES_URL = 'https://github.com/Hamzasohail123/sessionforge/releases/latest';
  const CACHE_KEY = 'desktopRelease';
  const CHECK_INTERVAL = 86400000;
  const FETCH_TIMEOUT = 5000;
  // The only desktop release whose /pending has no appVersion field
  const FIRST_VERSION = '0.1.0';

  /** Strict X.Y.Z with an optional leading 'v' → [x, y, z], else null. */
  function parseVersion(value) {
    if (typeof value !== 'string') return null;
    const m = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/.exec(value);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }
  function compareVersions(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }
  /** True only when both parse and latest is strictly newer. */
  function isNewer(latest, current) {
    const l = parseVersion(latest);
    const c = parseVersion(current);
    return !!l && !!c && compareVersions(l, c) > 0;
  }
  function normalize(value) {
    const v = parseVersion(value);
    return v ? v.join('.') : null;
  }
  /**
   * The desktop version from a /pending body: its appVersion, or 0.1.0 when a valid body has none.
   * null (show nothing) for anything else, including a malformed appVersion.
   */
  function appVersionOf(json) {
    if (!json || typeof json !== 'object' || !Array.isArray(json.requests)) return null;
    if (!Object.prototype.hasOwnProperty.call(json, 'appVersion')) return FIRST_VERSION;
    return normalize(json.appVersion);
  }
  /** Due when nothing is cached, the time is unreadable or in the future, or a day has passed. */
  function isDue(cache, now) {
    const at = cache && cache.checkedAt;
    if (typeof at !== 'number' || !Number.isFinite(at) || at > now) return true;
    return now - at >= CHECK_INTERVAL;
  }
  /** GitHub's releases/latest body → "X.Y.Z", ignoring drafts, pre-releases and odd tags. */
  function latestFromRelease(json) {
    if (!json || typeof json !== 'object') return null;
    if (json.draft === true || json.prerelease === true) return null;
    return normalize(json.tag_name);
  }
  /**
   * The newer desktop version to show, or null. Never throws. Writes the cache whenever GitHub
   * answered (any HTTP status); a network error writes nothing, so the next open retries.
   */
  async function check({ storage, fetch, now, appVersion }) {
    try {
      if (!parseVersion(appVersion)) return null;
      const stored = (await storage.get(CACHE_KEY))[CACHE_KEY];
      let cache = stored && typeof stored === 'object' ? stored : null;
      if (isDue(cache, now)) {
        let res = null;
        try {
          res = await fetch(LATEST_URL, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT) });
        } catch (error) {
          console.warn('SessionForge update check: GitHub unreachable', error && error.message);
        }
        if (res) {
          const latest = res.ok ? latestFromRelease(await res.json().catch(() => null)) : null;
          cache = { checkedAt: now, latest: latest || normalize(cache && cache.latest) };
          await storage.set({ [CACHE_KEY]: cache });
        }
      }
      const latest = normalize(cache && cache.latest);
      return latest && isNewer(latest, appVersion) ? latest : null;
    } catch (error) {
      console.warn('SessionForge update check failed', error && error.message);
      return null;
    }
  }
  const api = {
    LATEST_URL,
    RELEASES_URL,
    CACHE_KEY,
    CHECK_INTERVAL,
    parseVersion,
    compareVersions,
    isNewer,
    appVersionOf,
    isDue,
    latestFromRelease,
    check
  };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else self.SessionForgeUpdate = api;
})();
