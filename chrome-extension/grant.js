// SessionForge Import Extension - "Allow access in a tab" page.
// The popup opens this tab when Chrome refused to ask for site access in the popup, or closed the popup
// while its prompt was open. A tab stays open during Chrome's prompt. This page only asks for access: it
// never reads cookies or page data and never contacts SessionForge. The user sends from the popup afterwards.
'use strict';

// access.js (loaded first) parses the link and builds the host patterns
const Access = self.SessionForgeAccess;
const params = Access.parseGrantParams(location.search);
let consented = false;

function show(id, visible) {
  document.getElementById(id).style.display = visible ? 'block' : 'none';
}

function setStatus(kind, text) {
  const el = document.getElementById('status');
  el.className = 'status ' + kind;
  el.textContent = text;
  show('status', true);
}

function showGranted() {
  setStatus('success', '✅ Access allowed. Go back to your tab, click the SessionForge Import icon and click Send again.');
  show('allow-btn', false);
  show('back-btn', true);
}

async function init() {
  if (!params) {
    setStatus('error', '❌ This link is not valid. Open SessionForge Import from the toolbar and try again.');
    return;
  }
  consented = await Access.hasConsent(chrome.storage.local);
  if (!consented) {
    setStatus('info', 'Open SessionForge Import from the toolbar and click Agree first.');
    return;
  }
  document.getElementById('grant-text').textContent =
    `SessionForge Import needs your permission to read cookies of ${params.domains.join(', ')} (and their ` +
    'subdomains). Click Allow access; Chrome then asks you to confirm. Nothing is read or sent from this page.';
  if (await chrome.permissions.contains({ origins: Access.originsForDomains(params.domains) })) showGranted();
  else show('allow-btn', true);
}

/** chrome.permissions.request is the first call: it only works inside the click's user gesture. */
async function onAllowClick() {
  if (!params || !consented) return;
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: Access.originsForDomains(params.domains) });
  } catch (error) {
    console.error('Cannot ask for site access:', error);
  }
  if (granted) showGranted();
  else setStatus('error', '❌ Chrome did not allow access, so nothing will be sent.');
}

/** Back to the tab the popup was opened on, and close this one. */
async function onBackClick() {
  if (params && params.tabId !== null) {
    try {
      await chrome.tabs.update(params.tabId, { active: true });
    } catch (error) {
      // That tab was closed in the meantime
    }
  }
  const current = await chrome.tabs.getCurrent();
  if (current) await chrome.tabs.remove(current.id);
}

document.getElementById('allow-btn').addEventListener('click', onAllowClick);
document.getElementById('back-btn').addEventListener('click', onBackClick);

init().catch((error) => setStatus('error', '❌ ' + error.message));
