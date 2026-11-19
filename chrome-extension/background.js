// SessionForge Import Extension - Background Service Worker
// Logs the installation and does nothing else: all reading and sending happens in the popup, on a click.

chrome.runtime.onInstalled.addListener(() => {
  console.log('SessionForge Import extension installed');
});
