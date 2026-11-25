// SessionForge Import Extension - Popup Script
// Sends the current tab's cookies and localStorage to the running SessionForge app, which opens
// the page in a new isolated session pane. When SessionForge asked for a login ("Sign in with
// Chrome"), it also offers to send the requested cookies into that waiting session.
// Until the user clicks Agree on the first-run notice (#consent), the popup reads and sends nothing.
// A site's cookies are only read after Chrome granted access to that site, asked on the Send click.

// The app's import server binds 127.0.0.1 (localhost may resolve to ::1 first)
const SESSIONFORGE_URL = 'http://127.0.0.1:34567/import';
const PENDING_URL = 'http://127.0.0.1:34567/pending';
const BUTTON_LABEL = 'Send to SessionForge';
const NEW_SESSION_LABEL = 'Send to new session';
const NOT_RUNNING = '❌ SessionForge is not running (could not reach 127.0.0.1:34567)';
const NOT_HTTP = '❌ Only http(s) pages can be sent (not chrome:// pages, the Web Store or files).';
// A grantAttempt marker older than this is ignored on the next open
const GRANT_ATTEMPT_MAX_AGE = 10 * 60 * 1000;
// access.js and handoff.js (loaded first) define consent, site access, the cookie conversion and the hand-off payload
const Access = self.SessionForgeAccess;
const HandOff = self.SessionForgeHandOff;
// update-check.js (loaded before this file) decides whether a newer SessionForge desktop is out
const Update = self.SessionForgeUpdate;
// The update notice is checked once per popup, even when /pending is asked again
let updateChecked = false;
// "Send to new session" while SessionForge has a request open, else the original label
let regularLabel = BUTTON_LABEL;
let pendingButtons = [];
// Set only from chrome.storage.local or after Agree was stored; every cookie read, localStorage read and fetch checks it
let consented = false;
let currentTab = null;
// Base domain of the current tab, or null when it is not an http(s) page
let site = null;
// chrome.permissions.contains for site, checked when the popup opens: a click handler must call
// chrome.permissions.request before any await, so it can only read a cached answer
let siteAccess = false;
// The domains the "Allow access in a tab" button asks for
let grantDomains = [];

function requireConsent() {
  if (!consented) throw new Error('Consent required');
}

function show(id, visible) {
  document.getElementById(id).style.display = visible ? 'block' : 'none';
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** The only cookie reader. */
async function getCookies(query) {
  requireConsent();
  return (await chrome.cookies.getAll(query)) || [];
}

/** Cookies sent to this page plus the site's domain cookies, deduplicated by name|domain|path. */
async function collectCookies(tab) {
  requireConsent();
  const url = new URL(tab.url);
  const [forUrl, forDomain] = await Promise.all([
    getCookies({ url: tab.url }),
    getCookies({ domain: Access.baseDomain(url.hostname) })
  ]);
  const seen = new Map();
  for (const c of [...forUrl, ...forDomain]) {
    const key = `${c.name}|${c.domain}|${c.path}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

async function getLocalStorage(tabId) {
  requireConsent();
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          data[key] = localStorage.getItem(key);
        }
        return data;
      }
    });
    return results[0]?.result || {};
  } catch (error) {
    console.error('Cannot access localStorage:', error);
    return {};
  }
}

/** The only POST to SessionForge. */
async function postToSessionForge(payload, signal) {
  requireConsent();
  return fetch(SESSIONFORGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });
}

/** The account e-mail in the tab title (Gmail titles contain it), else the hostname. */
function sessionNameFor(tab) {
  const email = (tab.title || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return email ? email[0] : new URL(tab.url).hostname;
}

/** The tab's favicon URL, or undefined for inline data: icons and URLs over the server's 4096 cap. */
function faviconFor(tab) {
  const icon = tab.favIconUrl;
  if (!icon || icon.startsWith('data:') || icon.length > 4096) return undefined;
  return icon;
}

function setStatus(kind, text) {
  const statusEl = document.getElementById('status');
  statusEl.className = 'status ' + kind;
  statusEl.textContent = text;
}

/** Whether Chrome already granted access to every domain's site. */
function hasAccess(domains) {
  return chrome.permissions.contains({ origins: Access.originsForDomains(domains) }).catch(() => false);
}

function showGrantButton(domains) {
  grantDomains = domains.slice();
  show('grant-btn', true);
}

/**
 * Asks Chrome for access to the domains' sites. Must be called before any await in a click handler:
 * chrome.permissions.request only works inside the user gesture. The grantAttempt marker tells the next
 * popup what happened if Chrome closes this popup while its prompt is open.
 */
async function askAccess(domains) {
  let granted = false;
  let failed = false;
  try {
    const asked = chrome.permissions.request({ origins: Access.originsForDomains(domains) });
    chrome.storage.session.set({ grantAttempt: { domains, at: Date.now() } }).catch(() => {});
    granted = await asked;
  } catch (error) {
    console.error('Cannot ask for site access:', error);
    failed = true;
  }
  await chrome.storage.session.remove('grantAttempt').catch(() => {});
  if (granted) {
    show('grant-btn', false);
    return true;
  }
  setStatus(
    'error',
    failed
      ? '❌ Chrome could not ask for access here. Click “Allow access in a tab”.'
      : `❌ Chrome did not allow access to ${domains.join(', ')}, so nothing was sent.`
  );
  showGrantButton(domains);
  return false;
}

/** After Chrome closed the popup during its prompt (the request never settled), say how it ended. */
async function checkGrantAttempt() {
  const { grantAttempt } = await chrome.storage.session.get('grantAttempt');
  if (!grantAttempt) return;
  await chrome.storage.session.remove('grantAttempt');
  const domains = Array.isArray(grantAttempt.domains) ? grantAttempt.domains.filter(Access.isValidDomain) : [];
  if (domains.length === 0 || !(Date.now() - grantAttempt.at < GRANT_ATTEMPT_MAX_AGE)) return;
  const list = domains.join(', ');
  if (await hasAccess(domains)) {
    setStatus('success', `✅ Access to ${list} allowed. Click the Send button again.`);
  } else {
    setStatus('info', `Chrome closed this popup while asking for access to ${list}. Click “Allow access in a tab”, then send again.`);
    showGrantButton(domains);
  }
}

async function sendSession() {
  const btnText = document.getElementById('btn-text');
  const btn = document.getElementById('import-btn');
  btn.disabled = true;
  btnText.innerHTML = 'Sending… <span class="loading"></span>';
  setStatus('info', 'Collecting session data...');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const tab = currentTab;
    const url = new URL(tab.url);
    const cookies = await collectCookies(tab);
    const localStorage = await getLocalStorage(tab.id);

    const payload = {
      action: 'import',
      sessionName: sessionNameFor(tab),
      storageState: {
        cookies: cookies.map(HandOff.toPlaywrightCookie),
        origins: [{
          origin: url.origin,
          localStorage: Object.entries(localStorage).map(([name, value]) => ({ name, value }))
        }]
      },
      metadata: { url: tab.url, title: (tab.title || '').slice(0, 500), favicon: faviconFor(tab) }
    };

    setStatus('info', 'Sending to SessionForge...');
    let response;
    try {
      response = await postToSessionForge(payload, controller.signal);
    } catch (error) {
      setStatus('error', NOT_RUNNING);
      return;
    }

    const body = await response.json().catch(() => ({}));
    if (response.status === 200) {
      const failed = body.cookies?.failed || 0;
      setStatus(
        'success',
        '✅ Sent to SessionForge — opened in a pane' + (failed > 0 ? ` ⚠️ ${failed} cookies rejected` : '')
      );
    } else if (response.status === 413) {
      setStatus('error', '❌ Session too large to import (over 5 MB)');
    } else {
      setStatus('error', '❌ ' + (body.error || `HTTP ${response.status}`));
    }
  } catch (error) {
    setStatus('error', '❌ ' + error.message);
  } finally {
    clearTimeout(timer);
    btn.disabled = false;
    btnText.textContent = regularLabel;
  }
}

/** "Send to SessionForge": ask for the site's access first if needed, then send. */
async function onSendClick() {
  if (!consented || !currentTab) return;
  if (!site) {
    setStatus('error', NOT_HTTP);
    return;
  }
  if (!siteAccess) {
    if (!(await askAccess([site]))) return;
    siteAccess = true;
    document.getElementById('site-access').textContent = 'Allowed';
  }
  await sendSession();
}

function setButtonsDisabled(disabled) {
  document.getElementById('import-btn').disabled = disabled;
  for (const b of pendingButtons) b.disabled = disabled;
}

/** One button per request SessionForge opened ("Sign in with Chrome"), in the session's colour. */
function renderPending(requests) {
  const box = document.getElementById('pending');
  box.replaceChildren();
  pendingButtons = [];
  for (const req of requests) {
    const btn = document.createElement('button');
    btn.className = 'pending-btn';
    btn.style.setProperty('--c', req.sessionColor);
    const dot = document.createElement('span');
    dot.className = 'dot';
    const text = document.createElement('span');
    text.className = 'pending-text';
    const label = document.createElement('span');
    label.textContent = `Send to ${req.sessionName} (SessionForge asked for this)`;
    // Show what will be sent before the click: an agent with Control can steer which site a
    // request is for, so the user must see the cookie domains, not only the session name
    const scope = document.createElement('span');
    scope.className = 'scope';
    const shown = req.cookieDomains.slice(0, 4).join(', ');
    const more = req.cookieDomains.length > 4 ? ` +${req.cookieDomains.length - 4} more` : '';
    scope.textContent = `Sends cookies for ${shown}${more} only`;
    text.appendChild(label);
    text.appendChild(scope);
    btn.appendChild(dot);
    btn.appendChild(text);
    btn.title = `Cookies for: ${req.cookieDomains.join(', ')}`;
    btn.addEventListener('click', () => onRequestClick(req));
    box.appendChild(btn);
    pendingButtons.push(btn);
  }
  regularLabel = requests.length > 0 ? NEW_SESSION_LABEL : BUTTON_LABEL;
  document.getElementById('btn-text').textContent = regularLabel;
}

/** Ask SessionForge which sessions wait for a login; a network error leaves the popup as it is. */
async function loadPending() {
  requireConsent();
  try {
    const res = await fetch(PENDING_URL, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return;
    const json = await res.json();
    const appVersion = Update.appVersionOf(json);
    const requests = HandOff.parsePending(json, Date.now());
    await Promise.all(requests.map(async (req) => {
      req.access = await hasAccess(req.cookieDomains);
    }));
    renderPending(requests);
    void showUpdateNotice(appVersion);
  } catch (error) {
    // SessionForge not running, or an older version without /pending
  }
}
/**
 * When the running SessionForge is older than the latest release, one line with a link to the
 * releases page. Asks GitHub at most once a day (cached); shows nothing when anything fails.
 */
async function showUpdateNotice(appVersion) {
  requireConsent();
  if (updateChecked || !appVersion) return;
  updateChecked = true;
  try {
    const version = await Update.check({
      storage: chrome.storage.local,
      fetch: (url, init) => fetch(url, init),
      now: Date.now(),
      appVersion
    });
    if (!version) return;
    const box = document.getElementById('update-notice');
    const link = document.createElement('a');
    link.href = Update.RELEASES_URL;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Download';
    link.addEventListener('click', (e) => {
      if (e) e.preventDefault();
      chrome.tabs.create({ url: Update.RELEASES_URL });
    });
    box.replaceChildren(document.createTextNode(`SessionForge desktop ${version} is available. `), link);
    show('update-notice', true);
  } catch (error) {
    console.warn('Cannot show the update notice:', error);
  }
}

/** A request button: ask for access to its cookie domains first if needed, then send. */
async function onRequestClick(req) {
  if (!consented) return;
  if (!req.access) {
    if (!(await askAccess(req.cookieDomains))) return;
    req.access = true;
  }
  await sendToRequest(req);
}

/** Send the requested domains' cookies into the waiting session (cookies only, no localStorage). */
async function sendToRequest(req) {
  setButtonsDisabled(true);
  setStatus('info', `Collecting cookies for ${req.cookieDomains.join(', ')}…`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const cookies = await HandOff.collectCookiesForDomains(getCookies, req.cookieDomains);
    let response;
    try {
      response = await postToSessionForge(HandOff.buildHandOffPayload(req.id, cookies), controller.signal);
    } catch (error) {
      console.error('SessionForge unreachable:', error);
      setStatus('error', NOT_RUNNING);
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (response.status === 200) {
      const failed = body.cookies?.failed || 0;
      setStatus(
        'success',
        `✅ Sent to ${req.sessionName}. Check the SessionForge pane.` + (failed > 0 ? ` ⚠️ ${failed} cookies rejected` : '')
      );
    } else if (response.status === 410) {
      setStatus('error', '❌ This request expired or was already used. Click “Sign in with Chrome” in SessionForge again.');
      await loadPending();
    } else if (response.status === 413) {
      setStatus('error', '❌ Session too large to import (over 5 MB)');
    } else {
      setStatus('error', '❌ ' + (body.error || `HTTP ${response.status}`));
    }
  } catch (error) {
    setStatus('error', '❌ ' + error.message);
  } finally {
    clearTimeout(timer);
    setButtonsDisabled(false);
  }
}

/** Opens grant.html in a tab: Chrome's prompt can't close a tab the way it can close this popup. */
function onGrantClick() {
  if (!consented || grantDomains.length === 0) return;
  chrome.tabs.create({
    url: chrome.runtime.getURL('grant.html') + '?' + Access.grantQuery(grantDomains, currentTab && currentTab.id)
  });
}

/** Tab info, cached site access, the outcome of an interrupted access prompt, then waiting requests. */
async function initMain() {
  currentTab = (await getCurrentTab()) || null;
  site = Access.siteDomain(currentTab && currentTab.url);
  siteAccess = site ? await hasAccess([site]) : false;
  document.getElementById('current-url').textContent = site ? new URL(currentTab.url).hostname : '—';
  document.getElementById('site-access').textContent = !site
    ? 'Not available on this page'
    : siteAccess ? 'Allowed' : 'Chrome asks the first time you send';
  show('session-info', true);
  await checkGrantAttempt();
  await loadPending();
}

async function onAgree() {
  const agree = document.getElementById('agree-btn');
  agree.disabled = true;
  try {
    await Access.recordConsent(chrome.storage.local, Date.now());
  } catch (error) {
    document.getElementById('consent-status').textContent = '❌ Could not save your choice: ' + error.message;
    agree.disabled = false;
    return;
  }
  consented = true;
  show('consent', false);
  show('main', true);
  await initMain();
}

function onNotNow() {
  document.getElementById('consent-status').textContent =
    'Nothing was read or sent. Open SessionForge Import again when you want to use it.';
}

/** Before consent only chrome.storage.local is read: no tab info, cookies, scripts or network. */
async function boot() {
  consented = await Access.hasConsent(chrome.storage.local).catch(() => false);
  show('consent', !consented);
  show('main', consented);
  if (consented) await initMain();
}

// Event listeners
document.getElementById('agree-btn').addEventListener('click', onAgree);
document.getElementById('not-now-btn').addEventListener('click', onNotNow);
document.getElementById('import-btn').addEventListener('click', onSendClick);
document.getElementById('grant-btn').addEventListener('click', onGrantClick);

// Initialize
boot().catch((error) => console.error('Cannot start the popup:', error));
