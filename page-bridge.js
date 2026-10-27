/*
 * page-bridge.js  (runs in the page's MAIN world)
 *
 * Netflix ignores `video.currentTime = x` from content scripts, so seeking has
 * to go through Netflix's own player API, which only exists in the page's JS
 * world. This script exposes a tiny request/response protocol over
 * window.postMessage:
 *
 *   content.js -> bridge : { source:'nsf-content', nonce, id, type, payload }
 *   bridge -> content.js : { source:'nsf-bridge',  nonce, id, ok, result|error }
 *
 * Supported types: ping, state, seek.  Times are milliseconds on the wire.
 * It also emits { source:'nsf-bridge', event:'urlchange' } when the SPA changes
 * URL via pushState/replaceState (history hooks must live in the MAIN world).
 */
(function () {
  'use strict';
  if (window.__nsfBridgeInstalled) return;
  window.__nsfBridgeInstalled = true;

  /** Returns Netflix's current player object, or null. Never throws. */
  function getPlayer() {
    try {
      var vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      if (!vp) return null;
      var ids = vp.getAllPlayerSessionIds();
      if (!ids || !ids.length) return null;
      return vp.getVideoPlayerBySessionId(ids[0]) || null;
    } catch (e) {
      return null;
    }
  }

  function safe(fn) {
    try { return fn(); } catch (e) { return undefined; }
  }

  var handlers = {
    ping: function () {
      return { hasPlayer: !!getPlayer() };
    },
    state: function () {
      var p = getPlayer();
      if (!p) throw new Error('noplayer');
      var t = safe(function () { return p.getCurrentTime(); });
      if (typeof t !== 'number' || !isFinite(t)) throw new Error('notime');
      return {
        time: t,
        duration: safe(function () { return p.getDuration(); }),
        playing: safe(function () { return p.isPlaying(); })
      };
    },
    seek: function (payload) {
      var p = getPlayer();
      if (!p) throw new Error('noplayer');
      var ms = payload && Number(payload.ms);
      if (!isFinite(ms) || ms < 0) throw new Error('badtime');
      p.seek(ms);
      return true;
    }
  };

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.source !== 'nsf-content' || typeof d.id === 'undefined') return;
    var reply = { source: 'nsf-bridge', nonce: d.nonce, id: d.id, ok: false };
    try {
      var h = handlers[d.type];
      if (!h) throw new Error('unknown');
      reply.result = h(d.payload);
      reply.ok = true;
    } catch (e) {
      reply.error = String((e && e.message) || e);
    }
    window.postMessage(reply, window.location.origin);
  });

  // Tell the content script when the SPA navigates.
  function notifyUrl() {
    try { window.postMessage({ source: 'nsf-bridge', event: 'urlchange' }, window.location.origin); } catch (e) {}
  }
  ['pushState', 'replaceState'].forEach(function (name) {
    try {
      var orig = history[name];
      history[name] = function () {
        var r = orig.apply(this, arguments);
        setTimeout(notifyUrl, 0);
        return r;
      };
    } catch (e) {}
  });
})();
