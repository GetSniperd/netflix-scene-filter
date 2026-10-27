/*
 * background.js (service worker)
 *  - opens the options page for the content script
 *  - mirrors each show's scenes to a plain .json file in Downloads\Netflix Scene Filter
 */
importScripts('shared.js');

var WRITE_DELAY_MS = 1500;
var pending = {};   // show name -> { timer, waiters: [sendResponse, ...] }

function downloadShow(show) {
  return NSF.getAll().then(function (all) {
    var file = NSF.safeFileName(show) + '.json';
    var json = JSON.stringify(NSF.buildShowFile(all.library, all.categories, show), null, 2);
    var url = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
    return new Promise(function (resolve) {
      try {
        chrome.downloads.download({
          url: url,
          filename: NSF.FOLDER + '/' + file,
          conflictAction: 'overwrite',
          saveAs: false
        }, function (id) {
          var err = chrome.runtime.lastError;
          if (err || typeof id !== 'number') resolve({ ok: false, file: file, error: (err && err.message) || 'Download refused.' });
          else resolve({ ok: true, file: file });
        });
      } catch (e) { resolve({ ok: false, file: file, error: String(e && e.message || e) }); }
    });
  }).catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
}

function flush(show) {
  var p = pending[show];
  if (!p) return;
  delete pending[show];
  downloadShow(show).then(function (r) {
    p.waiters.forEach(function (w, i) {
      // Earlier callers were superseded by the last one, which carries the real result.
      try { w(i === p.waiters.length - 1 ? r : { ok: true, superseded: true, file: r.file }); } catch (e) {}
    });
  });
}

function schedule(show, respond) {
  var p = pending[show];
  if (p) clearTimeout(p.timer); else p = pending[show] = { timer: null, waiters: [] };
  p.waiters.push(respond);
  p.timer = setTimeout(function () { flush(show); }, WRITE_DELAY_MS);
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return;
  if (msg.type === 'nsf-openOptions') {
    try { chrome.runtime.openOptionsPage(); } catch (e) {}
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'writeShowFile') {
    var show = typeof msg.show === 'string' ? msg.show : '';
    if (!show) { sendResponse({ ok: false, error: 'No show name.' }); return; }
    NSF.getAll().then(function (all) {
      if (!msg.now && !all.settings.autoSave) { sendResponse({ ok: true, skipped: true }); return; }
      if (msg.now) {
        // Explicit "save now": cancel any waiting write and do it immediately.
        var p = pending[show];
        if (p) { clearTimeout(p.timer); var ws = p.waiters; delete pending[show]; ws.forEach(function (w) { try { w({ ok: true, superseded: true }); } catch (e) {} }); }
        downloadShow(show).then(sendResponse);
      } else {
        schedule(show, sendResponse);
      }
    }).catch(function () { sendResponse({ ok: false, error: 'Could not read saved scenes.' }); });
    return true;
  }
});
