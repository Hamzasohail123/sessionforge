// SessionForge Import Extension - consent and site-access helpers.
// Loaded by popup.html and grant.html before their own scripts, and require()-able by the unit specs.
// One IIFE: the only name it adds is self.SessionForgeAccess (or module.exports under Node).
//
// CONSENT_VERSION is the version of the first-run notice in popup.html (#consent). Raise it only when
// what the extension reads, when it reads it, or where it sends it changes: every user then sees the
// notice again, and nothing is read or sent until they click Agree.
(function () {
  'use strict';

  const CONSENT_VERSION = 1;
  // Lowercase hostname scopes (google.com, localhost, 127.0.0.1), as in handoff.js, or an IPv6 literal
  const DOMAIN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
  const IPV6 = /^\[[0-9a-f:.]+\]$/i;
  const IPV4 = /^\d+\.\d+\.\d+\.\d+$/;
  const MAX_DOMAINS = 4;
  // Country codes whose registry sells names under second-level labels (bbc.co.uk, example.com.au,
  // example.ne.jp). Other country codes (.nl, .de, .ai, .io …) register names directly, so ad.nl and
  // gmx.de are sites even though "ad" and "gmx" look short.
  const CC_WITH_SECOND_LEVEL = new Set([
    'ar', 'au', 'bd', 'br', 'cn', 'cy', 'eg', 'hk', 'id', 'il', 'in', 'jp', 'ke', 'kr', 'lk', 'mx', 'my', 'mt',
    'ng', 'np', 'nz', 'pe', 'ph', 'pk', 'sa', 'sg', 'th', 'tr', 'tw', 'ua', 'uk', 'uy', 've', 'vn', 'za'
  ]);
  // Second-level labels under those country codes that are suffixes, not sites.
  const SECOND_LEVEL = new Set([
    'ac', 'ad', 'co', 'com', 'ed', 'edu', 'go', 'gob', 'gov', 'gr', 'gv', 'lg', 'ltd', 'me', 'mil', 'ne', 'net',
    'nhs', 'nic', 'nom', 'or', 'org', 'plc', 'sch'
  ]);

  /** True only when the stored consent is for the current notice. */
  async function hasConsent(area) {
    const got = await area.get('consentVersion');
    return !!got && got.consentVersion === CONSENT_VERSION;
  }

  /** Stores the Agree click. */
  function recordConsent(area, now) {
    return area.set({ consentVersion: CONSENT_VERSION, consentAt: now });
  }

  /**
   * Registrable-ish domain without the Public Suffix List: the last two labels, or three when a known
   * second-level label sits under a country code that uses them (co.uk, com.au, ne.jp). Site access is asked for
   * this domain and its subdomains, so it must cover the parent-domain cookies a site sets (.x.ai for
   * console.x.ai): Chrome hides cookies whose domain the granted pattern does not cover.
   */
  function baseDomain(hostname) {
    if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) {
      return hostname;
    }
    const labels = hostname.split('.');
    if (labels.length <= 2) return hostname;
    const last = labels[labels.length - 1];
    const second = labels[labels.length - 2];
    const take = CC_WITH_SECOND_LEVEL.has(last) && SECOND_LEVEL.has(second) ? 3 : 2;
    return labels.slice(-take).join('.');
  }

  /** The site (base domain) of an http(s) URL, else null (chrome://, file:, no URL). */
  function siteDomain(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.hostname ? baseDomain(u.hostname) : null;
    } catch (error) {
      return null;
    }
  }

  function isValidDomain(d) {
    return typeof d === 'string' && (DOMAIN.test(d) || IPV6.test(d));
  }

  /**
   * Host patterns to ask Chrome for: the domain and its subdomains, http and https, any port.
   * localhost, IP addresses and single labels get their exact host (Chrome has no TLD-only patterns).
   */
  function originsForDomains(domains) {
    const out = [];
    for (const d of domains) {
      const exact = d === 'localhost' || IPV4.test(d) || IPV6.test(d) || !d.includes('.');
      const pattern = exact ? `*://${d}/*` : `*://*.${d}/*`;
      if (!out.includes(pattern)) out.push(pattern);
    }
    return out;
  }

  /** Query string for grant.html. */
  function grantQuery(domains, tabId) {
    let q = 'domains=' + encodeURIComponent(domains.join(','));
    if (Number.isInteger(tabId)) q += '&tab=' + tabId;
    return q;
  }

  /** grant.html's location.search → {domains (1-4 valid), tabId (integer or null)}, or null. */
  function parseGrantParams(search) {
    if (typeof search !== 'string') return null;
    const s = search.startsWith('?') ? search.slice(1) : search;
    let domainsRaw = null;
    let tabRaw = null;
    for (const part of s.split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      const key = eq < 0 ? part : part.slice(0, eq);
      let value;
      try {
        value = decodeURIComponent(eq < 0 ? '' : part.slice(eq + 1));
      } catch (error) {
        return null;
      }
      if (key === 'domains') domainsRaw = value;
      else if (key === 'tab') tabRaw = value;
    }
    if (domainsRaw === null) return null;
    const domains = domainsRaw.split(',');
    if (domains.length < 1 || domains.length > MAX_DOMAINS || !domains.every(isValidDomain)) return null;
    let tabId = null;
    if (tabRaw !== null) {
      if (!/^\d{1,10}$/.test(tabRaw)) return null;
      tabId = Number(tabRaw);
    }
    return { domains, tabId };
  }

  const api = {
    CONSENT_VERSION,
    hasConsent,
    recordConsent,
    baseDomain,
    siteDomain,
    isValidDomain,
    originsForDomains,
    grantQuery,
    parseGrantParams
  };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else self.SessionForgeAccess = api;
})();
