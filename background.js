/*
 * background.js (service worker)
 * Content scripts cannot open the extension's options page themselves, so the
 * toolbar's settings button sends a message here.
 */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'nsf-openOptions') {
    try { chrome.runtime.openOptionsPage(); } catch (e) {}
    sendResponse({ ok: true });
  }
});
