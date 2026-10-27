/*
 * content.js (ISOLATED world)
 *
 * Responsibilities:
 *  - track the current episode (videoId from /watch/<id>), SPA-safe
 *  - click-to-mark toolbar (+ optional hotkeys), category popover, toasts,
 *    "My scenes" panel (simple / advanced), first-run walkthrough
 *  - poll playback time ~10x/second and mute / blank / skip active scenes
 *  - automatic word filter: watches Netflix's on-screen subtitles and mutes bad words
 * Netflix's player API (seek, precise time) is reached via page-bridge.js.
 */
(function () {
  'use strict';
  if (window.top !== window || typeof NSF === 'undefined') return;
  if (window.__nsfContentLoaded) return;
  window.__nsfContentLoaded = true;

  var NONCE = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var POLL_MS = 100;

  var state = {
    categories: NSF.clone(NSF.DEFAULT_CATEGORIES),
    settings: NSF.normalizeSettings(null),
    library: {},
    videoId: null,
    markStart: null,     // seconds, set by "Mark start"
    pendingEnd: null,    // seconds, set when the user chose "pick start manually"
    pop: null,           // open popover: { kind:'category'|'howlong', start, end, note, selected }
    undo: null,          // { id, until } shown for 10s after a save
    showScenes: false,   // panel shows the scene list even in simple mode
    tourStep: -1,        // -1 = no walkthrough
    lastCat: null,       // last category id used (preselected in the popover)
    loaded: false
  };

  var lastPlayerT = null;   // last known playback time (s), for "save as scene"

  // ---------------------------------------------------------------- helpers
  function alive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }
  function getVideo() { return document.querySelector('video'); }
  function getVideoId() {
    var m = /^\/watch\/(\d+)/.exec(location.pathname);
    return m ? m[1] : null;
  }
  function getTitle() {
    var el = null, t = '';
    try { el = document.querySelector('[data-uia="video-title"]'); } catch (e) {}
    if (el && el.textContent) t = el.textContent.replace(/\s+/g, ' ').trim();
    var dt = (document.title || '').replace(/\s*[-|]\s*Netflix\s*$/i, '').trim();
    if (dt === 'Netflix') dt = '';
    return t || dt || '';
  }
  /** { show, episode } from Netflix's title element; either may be ''. Never throws. */
  function getShowInfo() {
    var show = '', ep = '';
    try {
      var el = document.querySelector('[data-uia="video-title"]');
      if (el) {
        var h4 = el.querySelector('h4');
        var parts = [];
        if (h4) {
          show = (h4.textContent || '').replace(/\s+/g, ' ').trim();
          Array.prototype.forEach.call(el.querySelectorAll('span'), function (sp) {
            if (h4.contains(sp)) return;
            var t = (sp.textContent || '').replace(/\s+/g, ' ').trim();
            if (t) parts.push(t);
          });
        } else {
          Array.prototype.forEach.call(el.childNodes, function (n) {
            if (n.nodeType === 3) {
              var t = (n.textContent || '').replace(/\s+/g, ' ').trim();
              if (t && !show) show = t;
            } else if (n.nodeType === 1 && n.tagName === 'SPAN') {
              var t2 = (n.textContent || '').replace(/\s+/g, ' ').trim();
              if (t2) parts.push(t2);
            }
          });
          if (!show && !parts.length) show = (el.textContent || '').replace(/\s+/g, ' ').trim();
          else if (!show) show = parts.shift();
        }
        ep = parts.join(' - ');
      }
    } catch (e) {}
    if (!show) {
      var dt = (document.title || '').replace(/\s*[-|]\s*Netflix\s*$/i, '').trim();
      if (dt && dt !== 'Netflix') show = dt;
    }
    return { show: show, episode: ep };
  }
  function currentShowName() {
    var ep = episode();
    return NSF.showNameOf(ep, state.videoId);
  }
  var savedToastShown = false;
  /** Mirror a show's file to disk. quiet=true for background auto-saves (toast only first time / on failure). */
  function mirror(showName, now) {
    if (!showName) return;
    NSF.writeShowFile(showName, now).then(function (r) {
      if (!r || r.skipped || r.superseded) { if (now && r && r.skipped) toast('Auto-save is off'); return; }
      if (r.ok) {
        if (now || !savedToastShown) {
          savedToastShown = true;
          toast('Saved to Downloads\\' + NSF.FOLDER + '\\' + (r.file || 'the show file'), 3500);
        }
      } else {
        toast('Could not save the file' + (r.error ? ' (' + r.error + ')' : '') + '. Your scenes are still kept in the add-on.', 5000);
      }
    });
  }

  function catMap() {
    var m = {};
    state.categories.forEach(function (c) { m[c.id] = c; });
    return m;
  }
  function episode() { return state.videoId ? state.library[state.videoId] || null : null; }
  function segments() {
    var ep = episode();
    return ep && Array.isArray(ep.segments) ? ep.segments : [];
  }
  function sortedSegments() {
    return segments().slice().sort(function (a, b) { return a.start - b.start || a.end - b.end; });
  }
  function effectiveAction(seg, cat) {
    return seg.action || (cat ? cat.action : 'off');
  }
  function lbl(c) { return NSF.catLabel(c); }
  function dur(sec) { return (Math.round(sec * 10) / 10) + 's'; }

  // ------------------------------------------------------- bridge messaging
  var pending = {};
  var seq = 0;
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.source !== 'nsf-bridge') return;
    if (d.event === 'urlchange') { checkUrl(); return; }
    if (d.nonce !== NONCE) return;
    var cb = pending[d.id];
    if (cb) { delete pending[d.id]; cb(d); }
  });

  function bridge(type, payload) {
    return new Promise(function (resolve) {
      var id = ++seq;
      var timer = setTimeout(function () {
        delete pending[id];
        resolve({ ok: false, error: 'timeout' });
      }, 400);
      pending[id] = function (msg) { clearTimeout(timer); resolve(msg); };
      try {
        window.postMessage({ source: 'nsf-content', nonce: NONCE, id: id, type: type, payload: payload }, location.origin);
      } catch (e) {
        clearTimeout(timer); delete pending[id];
        resolve({ ok: false, error: 'post' });
      }
    });
  }

  var bridgeFails = 0, bridgeDown = false, bridgeLastTry = 0;

  /** Reads {t (s), duration, playing, src}. Prefers Netflix API, falls back to <video>. */
  async function readPlayer() {
    var now = Date.now();
    var v = getVideo();
    if (!bridgeDown || now - bridgeLastTry > 5000) {
      bridgeLastTry = now;
      var r = await bridge('state');
      if (r.ok && r.result && typeof r.result.time === 'number') {
        bridgeDown = false; bridgeFails = 0;
        var playing = v ? !v.paused : !!r.result.playing;
        return { t: r.result.time / 1000, duration: (r.result.duration || 0) / 1000, playing: playing, src: 'api' };
      }
      if (++bridgeFails >= 3) bridgeDown = true;
    }
    if (v && isFinite(v.currentTime)) {
      return { t: v.currentTime, duration: v.duration, playing: !v.paused, src: 'video' };
    }
    return null;
  }

  async function seekTo(sec) {
    sec = Math.max(0, sec);
    var r = await bridge('seek', { ms: Math.round(sec * 1000) });
    if (r.ok) return true;
    var v = getVideo();     // best-effort fallback; Netflix often ignores this
    if (v) { try { v.currentTime = sec; return true; } catch (e) {} }
    return false;
  }

  // -------------------------------------------------------------- UI (shadow)
  var host = document.createElement('div');
  host.id = 'nsf-ui-host';
  host.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
  var root = host.attachShadow({ mode: 'open' });

  var CSS = '' +
    ':host,*{box-sizing:border-box}' +
    '*{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:13px;color:#eee}' +
    '.panel,.bar,.pop,.toast,.tour>*{pointer-events:auto}' +
    // buttons
    'button{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:3px 9px;cursor:pointer}' +
    'button:hover{background:rgba(255,255,255,.22)}button:disabled{opacity:.4;cursor:default}' +
    'button.sm{padding:1px 6px;font-size:12px;border-radius:6px}' +
    'button.go{background:#1f8f4e;border-color:#2fb86a}button.go:hover{background:#27a85c}' +
    'button.sel{outline:2px solid #fff}' +
    'button.link{background:none;border:0;padding:0;color:#7db7ff;text-decoration:underline}' +
    'select,input[type=text]{background:#111;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:3px 5px;color:#eee;min-width:0}' +
    '.muted{opacity:.7;font-size:12px}' +
    // toolbar
    '.bar{position:absolute;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;padding:6px 8px;max-width:96vw;' +
    'background:rgba(18,18,22,.94);border:1px solid rgba(255,255,255,.2);border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.6);user-select:none}' +
    '.bar.marking{background:rgba(70,46,6,.96);border-color:#f5a623;box-shadow:0 0 0 2px rgba(245,166,35,.6),0 6px 24px rgba(0,0,0,.6)}' +
    '.bar .b{min-height:36px;padding:0 12px;font-size:14px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}' +
    '.bar .b.amber{background:#b9770e;border-color:#f5a623;font-weight:600}' +
    '.bar .b.ready{background:#1f8f4e;border-color:#2fb86a;font-weight:600}' +
    '.bar .b.dim{opacity:.7}' +
    '.bar .b.ico{min-width:36px;justify-content:center;padding:0 8px;font-size:16px}' +
    '.bar .grip{cursor:move;width:18px;min-height:36px;display:flex;align-items:center;justify-content:center;opacity:.55;font-size:16px}' +
    '.bar .sep{width:1px;align-self:stretch;background:rgba(255,255,255,.18);margin:2px 2px}' +
    '.bar .grp{display:inline-flex;gap:6px}' +
    '.bar .chips{display:inline-flex;gap:6px;flex-wrap:wrap}' +
    '.pill{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:0 10px;border-radius:999px;background:#5a2a8a;border:1px solid #9b6ad0;font-size:13px;font-weight:600}' +
    '.pill button.link{font-weight:400}' +
    // switch
    '.sw{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 6px;background:none;border:0;font-size:14px;font-weight:600}' +
    '.sw:hover{background:rgba(255,255,255,.08)}' +
    '.sw .trk{width:44px;height:24px;border-radius:12px;background:#8f2f2f;position:relative;flex:none;transition:background .15s}' +
    '.sw .trk::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}' +
    '.sw.on .trk{background:#1f8f4e}.sw.on .trk::after{left:23px}' +
    '.sw.big{min-height:52px;font-size:18px;width:100%;justify-content:flex-start;padding:0 10px;border:1px solid rgba(255,255,255,.16);border-radius:10px}' +
    '.sw.big .trk{width:60px;height:32px;border-radius:16px}.sw.big .trk::after{width:26px;height:26px;top:3px;left:3px}' +
    '.sw.big.on .trk::after{left:31px}' +
    // popover
    '.pop{position:absolute;width:340px;max-width:94vw;max-height:80vh;overflow:auto;background:rgba(18,18,22,.98);border:1px solid rgba(255,255,255,.25);' +
    'border-radius:12px;padding:12px;box-shadow:0 10px 40px rgba(0,0,0,.7);display:flex;flex-direction:column;gap:6px}' +
    '.pop h3{margin:0;font-size:15px}' +
    '.opt{display:flex;align-items:center;gap:8px;padding:6px 8px;min-height:36px;border-radius:8px;cursor:pointer;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);text-align:left;width:100%}' +
    '.opt:hover{background:rgba(255,255,255,.14)}.opt.sel{border-color:#fff}' +
    '.opt .k{width:18px;height:18px;border-radius:4px;background:rgba(255,255,255,.18);text-align:center;line-height:18px;font-size:12px;flex:none}' +
    '.dot{width:12px;height:12px;border-radius:50%;flex:none}' +
    '.quick{display:flex;flex-wrap:wrap;gap:6px}.quick button{min-height:40px;padding:0 14px;font-size:14px}' +
    '.footer{display:flex;gap:6px;flex-wrap:wrap}' +
    // toast
    '.toast{position:absolute;left:50%;bottom:160px;transform:translateX(-50%);background:rgba(18,18,22,.95);border:1px solid rgba(255,255,255,.22);' +
    'padding:9px 16px;border-radius:10px;font-size:14px;opacity:0;transition:opacity .15s;pointer-events:none;max-width:84vw;text-align:center}' +
    '.toast.show{opacity:1}' +
    // panel
    '.panel{position:absolute;width:420px;max-width:96vw;max-height:80vh;display:flex;flex-direction:column;background:rgba(18,18,22,.95);' +
    'border:1px solid rgba(255,255,255,.16);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.6);overflow:hidden}' +
    '.head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,.06);cursor:move;user-select:none}' +
    '.head .t{flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.body{overflow:auto;padding:10px;display:flex;flex-direction:column;gap:10px}' +
    '.collapsed .body{display:none}' +
    '.presets{display:flex;gap:6px}.presets button{flex:1;min-height:40px;font-size:14px;font-weight:600}' +
    '.presets button.cur{background:#2a5fb0;border-color:#6aa0ff}' +
    '.h4{font-weight:600;font-size:13px;margin:2px 0 0}' +
    '.crow{display:flex;align-items:center;gap:6px}.crow .n{flex:1}' +
    '.row{border:1px solid rgba(255,255,255,.1);border-left-width:4px;border-radius:8px;padding:5px 6px;display:flex;flex-direction:column;gap:4px}' +
    '.row .l1,.row .l2{display:flex;align-items:center;gap:5px}' +
    '.row .time{flex:1;cursor:pointer;font-variant-numeric:tabular-nums;font-weight:600}' +
    '.row .time:hover{text-decoration:underline}' +
    '.row .l2 input{flex:1}.row .l2 select{max-width:120px}' +
    // walkthrough
    '.tour{position:absolute;inset:0;background:rgba(0,0,0,.55);pointer-events:auto}' +
    '.tour .ring{position:absolute;border:3px solid #f5a623;border-radius:12px;box-shadow:0 0 0 4px rgba(245,166,35,.3);pointer-events:none}' +
    '.tour .arrow{position:absolute;width:0;height:0;border:11px solid transparent;border-top:16px solid #f5a623;border-bottom:0;pointer-events:none}' +
    '.tour .card{position:absolute;width:340px;max-width:92vw;background:#1c1c22;border:2px solid #f5a623;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px}' +
    '.tour .card p{margin:0;font-size:15px;line-height:1.4}' +
    '.tour .card .footer button{min-height:36px;padding:0 14px;font-size:14px}';

  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  root.appendChild(styleEl);

  var panelEl = document.createElement('div');
  panelEl.className = 'panel';
  var barEl = document.createElement('div');
  barEl.className = 'bar';
  var toastEl = document.createElement('div');
  toastEl.className = 'toast';
  var popEl = null;
  var tourEl = null;
  root.appendChild(panelEl);
  root.appendChild(barEl);
  root.appendChild(toastEl);

  // Keep Netflix's own key handlers from seeing typing inside our text fields / menus
  // (but let Space, arrows etc. through when a button has focus so the player still works).
  ['keydown', 'keyup', 'keypress'].forEach(function (n) {
    host.addEventListener(n, function (e) {
      try {
        var t = e.composedPath && e.composedPath()[0];
        if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) e.stopPropagation();
      } catch (err) {}
    });
  });
  // Clicking our buttons must not steal keyboard focus from the video player.
  host.addEventListener('mousedown', function (e) {
    try {
      var t = e.composedPath && e.composedPath()[0];
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'OPTION')) return;
      if (t && t.closest && t.closest('.grip,.head')) return;   // those handle their own mousedown
      e.preventDefault();
    } catch (err) {}
  });

  // Blank-scene overlay (below our UI, above Netflix).
  var overlay = document.createElement('div');
  overlay.id = 'nsf-blank-overlay';
  overlay.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483646!important;background:#000!important;' +
    'color:#888!important;display:none;align-items:center;justify-content:center;font:16px system-ui,sans-serif!important;pointer-events:none!important;';

  /** Fullscreen only paints descendants of the fullscreen element, so re-parent as needed. */
  function mount() {
    var parent = document.fullscreenElement || document.documentElement;
    if (!parent) return;
    [overlay, host].forEach(function (el) {
      if (el.parentNode !== parent) { try { parent.appendChild(el); } catch (e) {} }
    });
  }
  document.addEventListener('fullscreenchange', function () { mount(); layout(); });
  window.addEventListener('resize', function () { layout(); });

  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      if (k === 'class') el.className = props[k];
      else if (k === 'text') el.textContent = props[k];
      else if (k === 'style') el.style.cssText = props[k];
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), props[k]);
      else if (props[k] !== null && props[k] !== undefined) el.setAttribute(k, props[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  /** A switch-style button. */
  function switchBtn(text, on, title, onclick, big) {
    var b = h('button', { class: 'sw' + (on ? ' on' : '') + (big ? ' big' : ''), title: title, role: 'switch',
      'aria-checked': on ? 'true' : 'false', onclick: onclick },
      h('span', { class: 'trk' }), h('span', { text: text }));
    return b;
  }

  // ------------------------------------------------------------------ toast
  var toastTimer = null;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2400);
  }

  // ---------------------------------------------------------------- storage
  async function updateEpisode(fn) {
    if (!state.videoId) return;
    var all = await NSF.getAll();
    var lib = all.library;
    var ep = lib[state.videoId];
    if (!ep || !Array.isArray(ep.segments)) ep = { videoId: state.videoId, title: '', segments: [], updatedAt: 0 };
    fn(ep);
    var t = getTitle();
    if (t) ep.title = t;
    var info = getShowInfo();
    if (!ep.showTitle && info.show) ep.showTitle = info.show;
    if (!ep.episodeLabel && info.episode) ep.episodeLabel = info.episode;
    ep.updatedAt = Date.now();
    lib[state.videoId] = ep;
    state.library = lib;
    await NSF.setLibrary(lib);
    renderPanel();
    mirror(NSF.showNameOf(ep, state.videoId), false);
  }

  /** Rename the show this episode belongs to (all its episodes move together). */
  async function renameShow(newName) {
    newName = String(newName || '').trim();
    if (!newName || !state.videoId) return;
    var all = await NSF.getAll();
    var lib = all.library;
    var cur = lib[state.videoId];
    if (!cur) { cur = lib[state.videoId] = { videoId: state.videoId, title: '', segments: [], updatedAt: Date.now() }; }
    var oldName = NSF.showNameOf(cur, state.videoId);
    var g = NSF.groupByShow(lib)[oldName] || [state.videoId];
    g.forEach(function (id) { if (lib[id]) lib[id].showTitle = newName; });
    state.library = lib;
    await NSF.setLibrary(lib);
    renderPanel();
    mirror(newName, false);
    toast('Show renamed to "' + newName + '"');
  }

  function saveSettings() { return NSF.setSettings(state.settings); }

  async function loadAll() {
    var all = await NSF.getAll();
    state.categories = all.categories;
    state.settings = all.settings;
    state.library = all.library;
    state.loaded = true;
    renderAll();
    maybeStartTour();
  }

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes.library) state.library = changes.library.newValue || {};
      if (changes.categories) state.categories = NSF.normalizeCategories(changes.categories.newValue);
      if (changes.settings) state.settings = NSF.normalizeSettings(changes.settings.newValue);
      renderAll();
    });
  } catch (e) {}

  function renderAll() { renderToolbar(); renderPanel(); }

  // ---------------------------------------------------------------- toolbar
  var refs = { markGroup: null, sw: null, chipBox: null, markStartBtn: null, markEndBtn: null };
  var lastChipKey = null;
  var barDragging = false;

  function toolbarVisible() {
    return state.loaded && !!state.videoId && state.settings.toolbar.visible;
  }

  function renderToolbar() {
    if (barDragging) return;
    var st = state.settings;
    if (!toolbarVisible()) {
      barEl.style.display = 'none';
      closePop(true);
      return;
    }
    barEl.style.display = 'flex';
    var marking = state.markStart !== null;
    barEl.className = 'bar' + (marking ? ' marking' : '');

    var grip = h('div', { class: 'grip', title: 'Drag to move this bar (double-click to put it back)', text: '⠿' });
    makeBarDraggable(grip);

    var sw = switchBtn(st.filteringEnabled ? 'Filter: ON' : 'Filter: OFF', st.filteringEnabled,
      'Turn filtering on or off. When OFF the whole show plays untouched.', toggleFilter);
    refs.sw = sw;

    // Mark start: becomes "Start 12:34.5 ✓" once clicked.
    var startBtn = h('button', { class: 'b' + (marking ? ' amber' : ''),
      title: marking ? 'Start saved. Click again to move the start to the current moment.'
        : 'Click at the moment a scene you want to filter BEGINS.',
      text: marking ? 'Start ' + NSF.fmtTime(state.markStart) + ' ✓' : 'Mark start', onclick: markStart });
    var endBtn = h('button', { class: 'b' + (marking ? ' ready' : ' dim'),
      title: marking ? 'Click at the moment the scene ENDS.'
        : 'Click when the scene ends. (If you have not marked a start, you can say how long it was.)',
      text: 'Mark end', onclick: markEnd });
    refs.markStartBtn = startBtn; refs.markEndBtn = endBtn;
    var markGroup = h('span', { class: 'grp' }, startBtn, endBtn);
    if (marking) markGroup.appendChild(h('button', { class: 'b ico', title: 'Forget the start I marked', text: '↺',
      onclick: function () { state.markStart = null; renderToolbar(); toast('Start cleared'); } }));
    refs.markGroup = markGroup;

    function nudge(sec, text, title) {
      return h('button', { class: 'b', title: title, text: text, onclick: function () { nudgeBy(sec); } });
    }
    var nudges = h('span', { class: 'grp' },
      nudge(-5, '-5s', 'Jump back 5 seconds'), nudge(-1, '-1s', 'Jump back 1 second'),
      nudge(1, '+1s', 'Jump forward 1 second'), nudge(5, '+5s', 'Jump forward 5 seconds'));

    var chipBox = h('span', { class: 'chips' });
    refs.chipBox = chipBox;
    lastChipKey = null;

    barEl.textContent = '';
    [grip, sw, h('span', { class: 'sep' }), markGroup, h('span', { class: 'sep' }), nudges, h('span', { class: 'sep' })]
      .forEach(function (x) { barEl.appendChild(x); });

    if (state.undo && Date.now() < state.undo.until) {
      barEl.appendChild(h('button', { class: 'b', title: 'Remove the scene you just saved', text: 'Undo last', onclick: undoLast }));
    }
    barEl.appendChild(h('button', { class: 'b', title: 'Open the list of scenes marked in this show and the filter settings',
      text: 'My scenes ▾', onclick: function () { openScenes(); } }));
    barEl.appendChild(h('button', { class: 'b ico', title: 'Help: show the quick tour', text: '?', onclick: function () { startTour(); } }));
    barEl.appendChild(h('button', { class: 'b ico', title: 'Settings (opens in a new tab)', text: '⚙', onclick: openOptions }));
    barEl.appendChild(h('button', { class: 'b ico', title: 'Hide this bar (bring it back from the extension icon or with ' + st.hotkeys.toggleToolbar + ')',
      text: '×', onclick: function () { setToolbarVisible(false); } }));
    barEl.appendChild(chipBox);

    layout();
    updateChips(true);
  }

  /** Position the bar (dock bottom-centre, or where the user dragged it) and the popover. */
  function layout() {
    try {
      var t = state.settings.toolbar;
      if (typeof t.x === 'number' && typeof t.y === 'number') {
        var w = barEl.offsetWidth || 400, hh = barEl.offsetHeight || 50;
        barEl.style.left = Math.max(0, Math.min(t.x, window.innerWidth - Math.min(w, 120))) + 'px';
        barEl.style.top = Math.max(0, Math.min(t.y, window.innerHeight - hh)) + 'px';
        barEl.style.bottom = 'auto';
        barEl.style.transform = 'none';
      } else {
        barEl.style.left = '50%';
        barEl.style.top = 'auto';
        barEl.style.bottom = '96px';          // sits above Netflix's own control bar
        barEl.style.transform = 'translateX(-50%)';
      }
      placePop();
      placeTour();
    } catch (e) {}
  }

  function makeBarDraggable(handle) {
    handle.addEventListener('dblclick', function () {
      state.settings.toolbar.x = null; state.settings.toolbar.y = null; saveSettings(); layout();
    });
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var r = barEl.getBoundingClientRect();
      var dx = e.clientX - r.left, dy = e.clientY - r.top;
      barDragging = true;
      function move(ev) {
        barEl.style.transform = 'none'; barEl.style.bottom = 'auto';
        barEl.style.left = Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - 120)) + 'px';
        barEl.style.top = Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - 40)) + 'px';
        placePop();
      }
      function up() {
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('mouseup', up, true);
        barDragging = false;
        var r2 = barEl.getBoundingClientRect();
        state.settings.toolbar.x = Math.round(r2.left);
        state.settings.toolbar.y = Math.round(r2.top);
        saveSettings();
      }
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    });
  }

  function setToolbarVisible(v) {
    state.settings.toolbar.visible = v;
    saveSettings();
    renderAll();
    if (!v) toast('Toolbar hidden. Bring it back from the extension icon, or press ' + state.settings.hotkeys.toggleToolbar + '.', 4000);
  }

  function openOptions() {
    try { chrome.runtime.sendMessage({ type: 'nsf-openOptions' }); } catch (e) { toast('Open Settings from the extension icon'); }
  }

  function openScenes() {
    state.showScenes = true;
    state.settings.panel.visible = true;
    state.settings.panel.collapsed = false;
    saveSettings();
    renderPanel();
  }

  // Nudge playback position via the bridge.
  async function nudgeBy(sec) {
    var p = await readPlayer();
    if (!p) { toast('The player is not ready yet'); return; }
    var ok = await seekTo(Math.max(0, p.t + sec));
    if (!ok) toast('Could not move the video');
  }

  // ------------------------------------------------------ chips (while active)
  var activeSegChips = [];   // e.g. ["Muted: bad words"]

  /** Re-draws the chip strip only when its content changed. */
  function updateChips(force) {
    if (!refs.chipBox) return;
    var wordShown = wf.active || (wf.lastHit && Date.now() - wf.lastHit < 6000);
    var key = activeSegChips.join('|') + '#' + (wordShown ? (wf.active ? 'a' : 'r') : '');
    if (!force && key === lastChipKey) return;
    lastChipKey = key;
    var box = refs.chipBox;
    box.textContent = '';
    activeSegChips.forEach(function (t) { box.appendChild(h('span', { class: 'pill', text: t })); });
    if (wordShown) {
      box.appendChild(h('span', { class: 'pill', title: 'A word from your word list was heard in the subtitles' },
        h('span', { text: wf.active ? 'Muted: bad words (auto)' : 'Muted a bad word' }),
        h('button', { class: 'link', title: 'Remember this spot as a scene so it is muted even without subtitles',
          text: 'Save as scene', onclick: saveWordAsScene })));
    }
  }

  // ------------------------------------------------------------------ panel
  function renderPanel() {
    if (!state.loaded) return;
    var st = state.settings;
    var onWatch = !!state.videoId;
    panelEl.style.display = (onWatch && st.panel.visible) ? '' : 'none';
    panelEl.className = 'panel' + (st.panel.collapsed ? ' collapsed' : '');
    var x = st.panel.x, y = st.panel.y;
    if (typeof x !== 'number') x = Math.max(8, window.innerWidth - 440);
    panelEl.style.left = Math.max(0, Math.min(x, window.innerWidth - 60)) + 'px';
    panelEl.style.top = Math.max(0, Math.min(typeof y === 'number' ? y : 80, window.innerHeight - 40)) + 'px';
    if (panelEl.style.display === 'none') return;

    // Don't clobber a text field the user is typing in.
    var active = root.activeElement;
    if (active && active.tagName === 'INPUT' && panelEl.contains(active) && active.dataset.dirty === '1') return;

    var advanced = st.ui.mode === 'advanced';
    var cats = catMap();
    var preset = NSF.detectPreset(state.categories);

    var head = h('div', { class: 'head' },
      h('span', { class: 't', text: 'Scene Filter' + (getTitle() ? ' - ' + getTitle() : '') }),
      h('button', { class: 'sm', title: st.panel.collapsed ? 'Expand' : 'Collapse', text: st.panel.collapsed ? '+' : '-', onclick: function () {
        st.panel.collapsed = !st.panel.collapsed; saveSettings(); renderPanel();
      } }),
      h('button', { class: 'sm', title: 'Close this window', text: '×', onclick: function () {
        st.panel.visible = false; state.showScenes = false; saveSettings(); renderPanel();
      } })
    );
    makeDraggable(head);

    // --- Simple part (always shown) ---
    var presetRow = h('div', { class: 'presets' });
    NSF.PRESET_ORDER.forEach(function (id) {
      presetRow.appendChild(h('button', { class: preset === id ? 'cur' : '', title: NSF.PRESETS[id].desc, text: NSF.PRESETS[id].label,
        onclick: function () { applyPresetNow(id); } }));
    });
    var presetDesc = preset === 'custom'
      ? 'Custom: you picked your own mix of things to filter (see Advanced).'
      : NSF.PRESETS[preset].desc;

    var body = h('div', { class: 'body' },
      switchBtn(st.filteringEnabled ? 'Filter is ON' : 'Filter is OFF', st.filteringEnabled,
        'Turn all filtering on or off', toggleFilter, true),
      presetRow,
      h('div', { class: 'muted', text: presetDesc }),
      switchBtn('Automatic word filter: ' + (st.wordFilter.enabled ? 'ON' : 'OFF'), st.wordFilter.enabled,
        'Mutes bad words by reading Netflix subtitles. Turn subtitles on in Netflix for this to work.', function () {
          st.wordFilter.enabled = !st.wordFilter.enabled; saveSettings(); renderAll();
        }),
      h('div', { style: 'display:flex;gap:14px;flex-wrap:wrap' },
        h('button', { class: 'link', title: st.toolbar.visible ? 'Hide the marking bar' : 'Show the marking bar at the bottom of the video',
          text: st.toolbar.visible ? 'Hide marking tools' : 'Show marking tools',
          onclick: function () { setToolbarVisible(!st.toolbar.visible); } }),
        h('button', { class: 'link', title: advanced ? 'Go back to the simple view' : 'Show every option',
          text: advanced ? 'Simple view ▴' : 'Advanced ▾',
          onclick: function () { st.ui.mode = advanced ? 'simple' : 'advanced'; saveSettings(); renderPanel(); } })));

    // --- Advanced part ---
    if (advanced) {
      body.appendChild(h('div', { class: 'h4', text: 'What to filter' }));
      state.categories.forEach(function (c) { body.appendChild(catRow(c)); });
    }

    if (advanced || state.showScenes) {
      var nameIn = h('input', { type: 'text', style: 'width:100%;box-sizing:border-box', value: currentShowName(),
        title: 'The name used for this show\'s file. Change it if Netflix\'s title is not what you want.' });
      nameIn.addEventListener('input', function () { nameIn.dataset.dirty = '1'; });
      nameIn.addEventListener('change', function () { nameIn.dataset.dirty = '0'; renameShow(nameIn.value); });
      body.appendChild(h('div', { class: 'h4', text: 'Show name (used for the saved file)' }));
      body.appendChild(nameIn);
      var segs = sortedSegments();
      body.appendChild(h('div', { class: 'h4', text: 'Scenes marked in this show (' + segs.length + ')' }));
      var list = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
      if (!segs.length) list.appendChild(h('div', { class: 'muted', text: 'No scenes yet. Use "Mark start" and "Mark end" on the bar while the show plays.' }));
      segs.forEach(function (s) { list.appendChild(segRow(s, cats)); });
      body.appendChild(list);
    }

    if (advanced) {
      body.appendChild(h('div', { class: 'footer' },
        h('button', { title: 'Write this show\'s file now (Downloads\\Netflix Scene Filter)', text: 'Save my list to a file', onclick: exportEpisode }),
        h('button', { title: 'Write one file per show', text: 'Save all my shows', onclick: exportLibrary }),
        h('button', { title: 'Add scenes from a file someone shared with you', text: 'Load a list from a file', onclick: importFile })));
      var hk = st.hotkeys;
      body.appendChild(h('div', { class: 'muted', text: 'Keyboard shortcuts (optional): ' + hk.markStart + ' mark start, ' + hk.markEnd +
        ' mark end, ' + hk.toggleFilter + ' filter on/off, ' + hk.toggleToolbar + ' show/hide bar, ' + hk.deleteLast + ' undo. Change them in Settings.' }));
    }

    panelEl.textContent = '';
    panelEl.appendChild(head);
    panelEl.appendChild(body);
  }

  function catRow(c) {
    var cb = h('input', { type: 'checkbox', title: 'Filter "' + lbl(c) + '" scenes' });
    cb.checked = c.enabled;
    cb.addEventListener('change', function () { c.enabled = cb.checked; NSF.setCategories(state.categories); renderPanel(); });
    var sel = h('select', { title: 'What happens during a "' + lbl(c) + '" scene' });
    NSF.ACTIONS.forEach(function (a) {
      var o = h('option', { value: a, text: NSF.ACTION_LABELS[a] }); if (a === c.action) o.selected = true; sel.appendChild(o);
    });
    sel.addEventListener('change', function () { c.action = sel.value; NSF.setCategories(state.categories); renderPanel(); });
    return h('div', { class: 'crow', title: c.help || '' }, cb, h('span', { class: 'dot', style: 'background:' + c.color }),
      h('span', { class: 'n', text: lbl(c) }), sel);
  }

  function applyPresetNow(id) {
    NSF.applyPreset(state.categories, id);
    NSF.setCategories(state.categories);
    toast(NSF.PRESETS[id].label + ' filter selected');
    renderPanel();
  }

  function segRow(s, cats) {
    var cat = cats[s.category];
    var color = cat ? cat.color : '#888';

    var catSel = h('select', { title: 'What kind of scene this is' });
    var seen = false;
    state.categories.forEach(function (c) {
      var o = h('option', { value: c.id, text: lbl(c) });
      if (c.id === s.category) { o.selected = true; seen = true; }
      catSel.appendChild(o);
    });
    if (!seen) { var o2 = h('option', { value: s.category, text: s.category + ' (?)' }); o2.selected = true; catSel.appendChild(o2); }
    catSel.addEventListener('change', function () {
      updateEpisode(function (ep) { var t = find(ep, s.id); if (t) t.category = catSel.value; });
    });

    var actSel = h('select', { title: 'What happens during this scene (overrides the usual choice)' });
    actSel.appendChild(h('option', { value: '', text: 'Usual' + (cat ? ' (' + NSF.ACTION_LABELS[cat.action] + ')' : '') }));
    NSF.ACTIONS.forEach(function (a) {
      var o = h('option', { value: a, text: NSF.ACTION_LABELS[a] });
      if (s.action === a) o.selected = true;
      actSel.appendChild(o);
    });
    actSel.addEventListener('change', function () {
      updateEpisode(function (ep) {
        var t = find(ep, s.id);
        if (!t) return;
        if (actSel.value) t.action = actSel.value; else delete t.action;
      });
    });

    var note = h('input', { type: 'text', placeholder: 'note', title: 'A note to remind you why', value: s.note || '' });
    note.addEventListener('input', function () { note.dataset.dirty = '1'; });
    note.addEventListener('change', function () {
      note.dataset.dirty = '0';
      updateEpisode(function (ep) { var t = find(ep, s.id); if (t) t.note = note.value; });
    });

    return h('div', { class: 'row', style: 'border-left-color:' + color },
      h('div', { class: 'l1' },
        h('span', { class: 'time', title: 'Click to jump to just before this scene', text: NSF.fmtTime(s.start) + '  →  ' + NSF.fmtTime(s.end),
          onclick: function () { seekTo(Math.max(0, s.start - 1)).then(function () { toast('Jumped to ' + NSF.fmtTime(s.start)); }); } }),
        h('button', { class: 'sm', title: 'Make the scene start at the current moment', text: 'Start = now', onclick: function () { setBound(s.id, 'start'); } }),
        h('button', { class: 'sm', title: 'Make the scene end at the current moment', text: 'End = now', onclick: function () { setBound(s.id, 'end'); } }),
        h('button', { class: 'sm', title: 'Delete this scene', text: 'Delete', onclick: function () {
          updateEpisode(function (ep) { ep.segments = ep.segments.filter(function (x) { return x.id !== s.id; }); });
          toast('Deleted the scene at ' + NSF.fmtTime(s.start));
        } })),
      h('div', { class: 'l2' }, catSel, actSel, note));
  }

  function find(ep, id) {
    for (var i = 0; i < ep.segments.length; i++) if (ep.segments[i].id === id) return ep.segments[i];
    return null;
  }

  async function setBound(id, which) {
    var p = await readPlayer();
    if (!p) { toast('The player is not ready yet'); return; }
    var ok = true;
    await updateEpisode(function (ep) {
      var t = find(ep, id);
      if (!t) return;
      if (which === 'start' && p.t >= t.end) { ok = false; return; }
      if (which === 'end' && p.t <= t.start) { ok = false; return; }
      t[which] = p.t;
    });
    toast(ok ? (which === 'start' ? 'Start' : 'End') + ' set to ' + NSF.fmtTime(p.t) : 'The start has to come before the end');
  }

  function makeDraggable(handle) {
    handle.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      var r = panelEl.getBoundingClientRect();
      var dx = e.clientX - r.left, dy = e.clientY - r.top;
      function move(ev) {
        panelEl.style.left = Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - 60)) + 'px';
        panelEl.style.top = Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - 40)) + 'px';
      }
      function up() {
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('mouseup', up, true);
        var r2 = panelEl.getBoundingClientRect();
        state.settings.panel.x = Math.round(r2.left);
        state.settings.panel.y = Math.round(r2.top);
        saveSettings();
      }
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    });
  }

  // --------------------------------------------------------------- actions
  async function markStart() {
    if (!state.videoId) return;
    var p = await readPlayer();
    if (!p) { toast('The player is not ready yet'); return; }
    // They said "pick start manually" earlier: this click is that start.
    if (state.pendingEnd !== null) {
      var end = state.pendingEnd;
      if (p.t < end) { state.pendingEnd = null; state.markStart = null; openPop({ kind: 'category', start: p.t, end: end }); return; }
      toast('The start has to be before ' + NSF.fmtTime(end) + '. Jump back a little and try again.');
      return;
    }
    state.markStart = p.t;
    toast('Start marked at ' + NSF.fmtTime(p.t) + '. Now play to the end of the scene and click "Mark end".');
    renderToolbar();
  }

  async function markEnd() {
    if (!state.videoId) return;
    var p = await readPlayer();
    if (!p) { toast('The player is not ready yet'); return; }
    if (state.markStart === null) {
      // No start yet: treat "now" as the end and ask how long the scene was.
      openPop({ kind: 'howlong', end: p.t });
      return;
    }
    if (p.t <= state.markStart) { toast('The end has to come after the start (' + NSF.fmtTime(state.markStart) + ')'); return; }
    openPop({ kind: 'category', start: state.markStart, end: p.t });
  }

  async function deleteLast() {
    var segs = segments();
    if (!segs.length) { toast('There are no scenes to undo'); return; }
    var latest = segs[0];
    segs.forEach(function (s) { if ((s.created || 0) >= (latest.created || 0)) latest = s; });
    var label = NSF.fmtTime(latest.start) + '–' + NSF.fmtTime(latest.end);
    await updateEpisode(function (ep) { ep.segments = ep.segments.filter(function (x) { return x.id !== latest.id; }); });
    toast('Removed the scene ' + label);
  }

  async function undoLast() {
    if (!state.undo) return;
    var id = state.undo.id;
    state.undo = null;
    await updateEpisode(function (ep) { ep.segments = ep.segments.filter(function (x) { return x.id !== id; }); });
    toast('Scene removed');
    renderToolbar();
  }

  function toggleFilter() {
    state.settings.filteringEnabled = !state.settings.filteringEnabled;
    saveSettings();
    if (!state.settings.filteringEnabled) clearApplied();
    toast('Filtering ' + (state.settings.filteringEnabled ? 'ON' : 'OFF'));
    renderAll();
  }

  function togglePanel() {
    state.settings.panel.visible = !state.settings.panel.visible;
    if (!state.settings.panel.visible) state.showScenes = false;
    saveSettings();
    renderPanel();
  }

  function exportEpisode() {
    var ep = episode();
    if (!ep) { toast('There is nothing to save yet'); return; }
    mirror(currentShowName(), true);
  }
  async function exportLibrary() {
    var names = Object.keys(NSF.groupByShow(state.library));
    if (!names.length) { toast('There is nothing to save yet'); return; }
    var rs = await NSF.writeShows(names, true);
    var bad = rs.filter(function (r) { return !r || !r.ok; }).length;
    savedToastShown = true;
    toast(bad ? 'Could not save ' + bad + ' of ' + names.length + ' file(s)'
      : 'Saved ' + names.length + ' show file(s) to Downloads\\' + NSF.FOLDER, 3500);
  }
  async function importFile() {
    try {
      var s = await NSF.importData(await NSF.pickJSONFile());
      var all = await NSF.getAll();
      state.library = all.library; state.categories = all.categories;
      toast(NSF.statsText(s), 5000);
      renderAll();
      NSF.writeShows(s.shows, false);
    } catch (e) { toast('Could not load that file: ' + (e && e.message || e), 5000); }
  }

  // ---------------------------------------------------------------- popover
  function openPop(p) {
    closePop(true);
    p.note = ''; p.selected = state.lastCat;
    state.pop = p;
    renderPop();
  }
  function closePop(silent) {
    state.pop = null;
    if (popEl && popEl.parentNode) popEl.parentNode.removeChild(popEl);
    popEl = null;
  }
  function cancelPop() {
    var p = state.pop;
    if (p && p.kind === 'howlong') state.pendingEnd = null;
    closePop();
    toast('Cancelled');
  }

  function renderPop() {
    var pk = state.pop;
    if (!pk) return;
    if (popEl && popEl.parentNode) popEl.parentNode.removeChild(popEl);
    popEl = h('div', { class: 'pop' });

    if (pk.kind === 'howlong') {
      popEl.appendChild(h('h3', { text: 'How long was it?' }));
      popEl.appendChild(h('div', { class: 'muted', text: 'The scene ends right now (' + NSF.fmtTime(pk.end) + '). How far back did it start?' }));
      var q = h('div', { class: 'quick' });
      [[5, '5s'], [10, '10s'], [30, '30s'], [60, '1 min']].forEach(function (x) {
        q.appendChild(h('button', { title: 'The scene started ' + x[1] + ' ago', text: x[1], onclick: function () {
          var start = Math.max(0, pk.end - x[0]);
          openPop({ kind: 'category', start: start, end: pk.end });
        } }));
      });
      q.appendChild(h('button', { title: 'Jump back yourself, then click "Mark start"', text: 'Pick start manually', onclick: function () {
        state.pendingEnd = pk.end; closePop();
        toast('Jump back to where it started and click "Mark start".', 5000);
      } }));
      popEl.appendChild(q);
      popEl.appendChild(h('div', { class: 'footer' }, h('button', { text: 'Cancel', onclick: cancelPop })));
    } else {
      popEl.appendChild(h('h3', { text: 'Saving ' + dur(pk.end - pk.start) + ' scene' }));
      popEl.appendChild(h('div', { class: 'muted', text: NSF.fmtTime(pk.start) + ' → ' + NSF.fmtTime(pk.end) + '. What kind of scene is it?' }));
      state.categories.forEach(function (c, i) {
        popEl.appendChild(h('button', { class: 'opt' + (pk.selected === c.id ? ' sel' : ''),
          title: (c.help ? c.help + '. ' : '') + 'Click to save this scene as "' + lbl(c) + '".',
          onclick: function () { savePop(c.id); } },
          h('span', { class: 'k', text: i < 9 ? String(i + 1) : '·' }),
          h('span', { class: 'dot', style: 'background:' + c.color }),
          h('span', { style: 'flex:1', text: lbl(c) }),
          h('span', { class: 'muted', text: '· ' + NSF.ACTION_SHORT[c.action] })));
      });
      var note = h('input', { type: 'text', placeholder: 'Optional note (for example: "swearing at the dinner table")', title: 'A note to remind you later (optional)' });
      note.value = pk.note;
      note.addEventListener('input', function () { pk.note = note.value; });
      popEl.appendChild(note);
      popEl.appendChild(h('div', { class: 'footer' },
        h('button', { class: 'go', title: pk.selected ? 'Save using the highlighted choice' : 'Pick a kind of scene above first (or press 1-9)',
          text: 'Save', onclick: function () { savePop(pk.selected); } }),
        h('button', { title: 'Throw this scene away', text: 'Cancel', onclick: cancelPop })));
    }
    root.appendChild(popEl);
    placePop();
  }

  /** Put the popover right above the bar (or below it when there is no room). */
  function placePop() {
    if (!popEl) return;
    try {
      var br = barEl.getBoundingClientRect();
      var w = popEl.offsetWidth || 340, ph = popEl.offsetHeight || 300;
      var left = br.left + br.width / 2 - w / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      popEl.style.left = left + 'px';
      if (br.top > ph + 16) {
        popEl.style.top = 'auto'; popEl.style.bottom = (window.innerHeight - br.top + 8) + 'px';
      } else {
        popEl.style.bottom = 'auto'; popEl.style.top = Math.min(br.bottom + 8, Math.max(8, window.innerHeight - ph - 8)) + 'px';
      }
    } catch (e) {}
  }

  async function savePop(catId) {
    var pk = state.pop;
    if (!pk || pk.kind !== 'category') return;
    var cat = catMap()[catId];
    if (!cat) { toast('Pick a kind of scene first'); return; }
    var seg = { id: NSF.uid(), start: pk.start, end: pk.end, category: cat.id, note: pk.note || '', created: Date.now() };
    closePop();
    state.markStart = null;
    state.lastCat = cat.id;
    state.undo = { id: seg.id, until: Date.now() + 10000 };
    setTimeout(renderToolbar, 10100);
    await updateEpisode(function (ep) { ep.segments.push(seg); });
    toast('Saved: ' + lbl(cat) + ', ' + dur(seg.end - seg.start) + ' (' + NSF.fmtTime(seg.start) + ' to ' + NSF.fmtTime(seg.end) + ')');
    renderToolbar();
  }

  // ------------------------------------------------------- first-run tour
  var TOUR = [
    { target: null, text: 'This bar lets you hide or mute parts of a show.' },
    { target: 'mark', text: 'When a scene starts that you want to filter, click "Mark start". When it ends, click "Mark end", then pick what kind of scene it was.' },
    { target: 'switch', text: 'This switch turns filtering on and off. Turn it off any time to watch everything.' },
    { target: null, text: 'Your scenes are saved as a file for each show (in your Downloads folder). To share with another parent, send them that file; they load it from Settings (the gear button).' }
  ];

  function maybeStartTour() {
    // Only the first time the toolbar appears on a watch page.
    if (state.settings.ui.firstRunDone || state.tourStep >= 0) return;
    if (!toolbarVisible()) return;
    setTimeout(function () {
      if (!state.settings.ui.firstRunDone && toolbarVisible() && state.tourStep < 0) startTour();
    }, 1200);
  }
  function startTour() {
    if (!state.videoId) return;
    if (!state.settings.toolbar.visible) { state.settings.toolbar.visible = true; saveSettings(); }
    renderToolbar();
    closePop(true);
    state.tourStep = 0;
    renderTour();
  }
  function endTour() {
    state.tourStep = -1;
    if (tourEl && tourEl.parentNode) tourEl.parentNode.removeChild(tourEl);
    tourEl = null;
    if (!state.settings.ui.firstRunDone) { state.settings.ui.firstRunDone = true; saveSettings(); }
  }
  function renderTour() {
    if (tourEl && tourEl.parentNode) tourEl.parentNode.removeChild(tourEl);
    tourEl = null;
    if (state.tourStep < 0) return;
    var i = state.tourStep, step = TOUR[i], last = i === TOUR.length - 1;
    tourEl = h('div', { class: 'tour' });
    tourEl.appendChild(h('div', { class: 'ring', style: 'display:none' }));
    tourEl.appendChild(h('div', { class: 'arrow', style: 'display:none' }));
    tourEl.appendChild(h('div', { class: 'card' },
      h('div', { class: 'muted', text: 'Step ' + (i + 1) + ' of ' + TOUR.length }),
      h('p', { text: step.text }),
      h('div', { class: 'footer' },
        i > 0 ? h('button', { text: 'Back', onclick: function () { state.tourStep--; renderTour(); } }) : null,
        h('button', { class: 'go', text: last ? 'Done' : 'Next', onclick: function () {
          if (last) endTour(); else { state.tourStep++; renderTour(); } } }),
        last ? null : h('button', { class: 'link', text: 'Skip', onclick: endTour }))));
    root.appendChild(tourEl);
    placeTour();
  }
  function placeTour() {
    if (!tourEl || state.tourStep < 0) return;
    try {
      var step = TOUR[state.tourStep];
      var ring = tourEl.querySelector('.ring'), arrow = tourEl.querySelector('.arrow'), card = tourEl.querySelector('.card');
      var el = step.target === 'mark' ? refs.markGroup : step.target === 'switch' ? refs.sw : null;
      var cw = card.offsetWidth || 340, ch = card.offsetHeight || 150;
      if (!el || !toolbarVisible()) {
        ring.style.display = 'none'; arrow.style.display = 'none';
        card.style.left = Math.max(8, (window.innerWidth - cw) / 2) + 'px';
        card.style.top = Math.max(8, (window.innerHeight - ch) / 2 - 40) + 'px';
        card.style.bottom = 'auto';
        return;
      }
      var r = el.getBoundingClientRect();
      ring.style.display = 'block';
      ring.style.left = (r.left - 5) + 'px'; ring.style.top = (r.top - 5) + 'px';
      ring.style.width = (r.width + 10) + 'px'; ring.style.height = (r.height + 10) + 'px';
      var cx = r.left + r.width / 2;
      var above = r.top > ch + 50;
      card.style.left = Math.max(8, Math.min(cx - cw / 2, window.innerWidth - cw - 8)) + 'px';
      arrow.style.display = 'block';
      arrow.style.left = (cx - 11) + 'px';
      if (above) {                         // card above the target, arrow pointing down at it
        card.style.top = 'auto'; card.style.bottom = (window.innerHeight - r.top + 30) + 'px';
        arrow.style.top = (r.top - 24) + 'px';
        arrow.style.transform = 'none';
      } else {                             // not enough room above: card below, arrow pointing up
        card.style.bottom = 'auto'; card.style.top = (r.bottom + 30) + 'px';
        arrow.style.top = (r.bottom + 8) + 'px';
        arrow.style.transform = 'rotate(180deg)';
      }
    } catch (e) {}
  }

  // ----------------------------------------------------------------- hotkeys
  window.addEventListener('keydown', function (e) {
    try {
      if (!state.loaded || !state.videoId) return;
      var path = e.composedPath ? e.composedPath() : [];
      var inField = path.length && path[0] && (path[0].tagName === 'INPUT' || path[0].tagName === 'SELECT');

      if (state.tourStep >= 0) {
        if (e.key === 'Escape') { eat(e); endTour(); }
        return;
      }

      if (state.pop) {
        if (e.key === 'Escape') { eat(e); cancelPop(); return; }
        if (state.pop.kind === 'category') {
          if (e.key === 'Enter') { eat(e); savePop(state.pop.selected); return; }
          if (inField) return;                    // typing a note
          if (/^[1-9]$/.test(e.key)) {
            eat(e);
            var c = state.categories[Number(e.key) - 1];
            if (c) { state.pop.selected = c.id; renderPop(); }
            return;
          }
        }
      }

      if (inField) return;
      var combo = NSF.comboFromEvent(e);
      if (!combo) return;
      var hk = state.settings.hotkeys;
      var fn = null;
      if (combo === hk.markStart) fn = markStart;
      else if (combo === hk.markEnd) fn = markEnd;
      else if (combo === hk.togglePanel) fn = togglePanel;
      else if (combo === hk.toggleFilter) fn = toggleFilter;
      else if (combo === hk.deleteLast) fn = deleteLast;
      else if (combo === hk.toggleToolbar) fn = function () { setToolbarVisible(!state.settings.toolbar.visible); };
      if (fn) { eat(e); if (!e.repeat) fn(); }
    } catch (err) { /* never break the page */ }
  }, true);

  function eat(e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }

  // ------------------------------------------------- mute reasons (shared)
  // Several things can want the sound off (a saved scene, a heard bad word).
  // We only un-mute when nobody needs it any more, and restore the user's own state.
  var muteReasons = {};
  var muteSaved = null;      // video.muted before we touched it (null = we are not muting)

  function setMuteReason(reason, on) {
    if (on) muteReasons[reason] = true; else delete muteReasons[reason];
    syncMute();
  }
  function syncMute() {
    var v = getVideo();
    var want = Object.keys(muteReasons).length > 0;
    if (!v) { if (!want) muteSaved = null; return; }
    try {
      if (want) {
        if (muteSaved === null) muteSaved = !!v.muted;
        if (!v.muted) v.muted = true;
      } else if (muteSaved !== null) {
        v.muted = muteSaved;
        muteSaved = null;
      }
    } catch (e) {}
  }

  // ------------------------------------------------ applying filters (poll)
  var applied = { blanking: false, lastSkip: 0 };

  function clearApplied() {
    muteReasons = {};
    wfReset();
    syncMute();
    muteSaved = null;
    setBlank(false);
    activeSegChips = [];
    updateChips();
  }

  function setBlank(on) {
    if (on === applied.blanking && (on ? overlay.style.display === 'flex' : overlay.style.display === 'none')) return;
    applied.blanking = on;
    if (on) {
      overlay.textContent = state.settings.blankText || '';
      overlay.style.setProperty('display', 'flex', 'important');
    } else {
      overlay.style.setProperty('display', 'none', 'important');
    }
  }

  /** Apply every active, enabled segment at time t. Overlaps combine: mute+blank+skip all honoured. */
  function applyAt(p) {
    var t = p.t;
    var wantMute = false, wantBlank = false, skipTo = null;
    var chips = [];
    if (state.settings.filteringEnabled) {
      var cats = catMap();
      segments().forEach(function (s) {
        if (!(t >= s.start && t < s.end)) return;
        var cat = cats[s.category];
        if (!cat || !cat.enabled) return;
        var a = effectiveAction(s, cat);
        if (a === 'off') return;
        if (a === 'mute') wantMute = true;
        else if (a === 'blank') wantBlank = true;
        else if (a === 'skip') skipTo = skipTo === null ? s.end : Math.max(skipTo, s.end);
        var chip = NSF.ACTION_PAST[a] + ': ' + lbl(cat).toLowerCase();
        if (chips.indexOf(chip) < 0) chips.push(chip);
      });
    }

    setMuteReason('segment', wantMute);
    setBlank(wantBlank || (skipTo !== null && p.playing));
    activeSegChips = chips;

    if (skipTo !== null && p.playing && Date.now() - applied.lastSkip > 600) {
      applied.lastSkip = Date.now();
      seekTo(skipTo + 0.05);
    }
  }

  // ------------------------------------------------------ automatic word filter
  // Netflix draws subtitles into the page (.player-timedtext). We watch those nodes,
  // and mute while a caption contains a word from the user's list.
  var wf = {
    re: null, key: null,
    active: false,          // currently muting because of a word
    lastHit: 0,             // ms timestamp of last matching caption
    hitT: null,             // playback time (s) when the word first appeared
    scanTimer: null, releaseTimer: null,
    observer: null
  };
  var subtitleHintShown = false;
  var subEmptyMs = 0, subCheckAt = 0;

  function wfEnabled() {
    return state.loaded && !!state.videoId && state.settings.filteringEnabled && state.settings.wordFilter.enabled;
  }
  function wfRegex() {
    var words = state.settings.wordFilter.words;
    var key = words.join('\n');
    if (key !== wf.key) { wf.key = key; wf.re = NSF.compileWords(words); }
    return wf.re;
  }
  /** All caption text currently on screen, joined. */
  function captionText() {
    var out = [];
    try {
      var roots = document.querySelectorAll('.player-timedtext');
      for (var i = 0; i < roots.length; i++) {
        var cs = roots[i].querySelectorAll('.player-timedtext-text-container');
        if (cs.length) { for (var j = 0; j < cs.length; j++) out.push(cs[j].textContent || ''); }
        else if (roots[i].textContent) out.push(roots[i].textContent);
      }
    } catch (e) {}
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }
  function wfReset() {
    wf.active = false;
    clearTimeout(wf.releaseTimer); wf.releaseTimer = null;
  }

  function scanCaptions() {
    wf.scanTimer = null;
    try {
      if (!wfEnabled()) {
        if (wf.active) { wfReset(); setMuteReason('word', false); updateChips(); }
        return;
      }
      var text = captionText();
      var re = wfRegex();
      var hit = !!(re && text && re.test(text));
      if (hit) {
        clearTimeout(wf.releaseTimer); wf.releaseTimer = null;
        wf.lastHit = Date.now();
        if (!wf.active) { wf.active = true; wf.hitT = lastPlayerT; }
        setMuteReason('word', true);
        updateChips();
      } else if (wf.active && !wf.releaseTimer) {
        // Caption no longer matches: keep muted a little longer (the spoken word can outlast the text).
        var hold = Math.max(800, state.settings.wordFilter.holdMs || 1200);
        wf.releaseTimer = setTimeout(function () {
          wf.releaseTimer = null;
          var again = wfRegex();
          if (again && again.test(captionText())) { scanCaptions(); return; }
          wf.active = false;
          setMuteReason('word', false);
          updateChips();
        }, hold);
      }
    } catch (e) { /* never break the page */ }
  }
  function scheduleScan() {
    if (wf.scanTimer) return;
    wf.scanTimer = setTimeout(scanCaptions, 40);     // debounce bursts of DOM changes
  }

  function nodeInCaptions(n) {
    try {
      if (!n) return false;
      var el = n.nodeType === 1 ? n : n.parentElement;
      if (!el) return false;
      if (el.closest && el.closest('.player-timedtext')) return true;
      // a whole caption block being added/removed
      return n.nodeType === 1 && !!(n.querySelector && n.querySelector('.player-timedtext'));
    } catch (e) { return false; }
  }

  function startObserver() {
    if (wf.observer) return;
    var target = document.body || document.documentElement;   // body may not exist yet at document_start
    if (!target) return;
    try {
      wf.observer = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (nodeInCaptions(m.target)) { scheduleScan(); return; }
          for (var j = 0; j < m.addedNodes.length; j++) if (nodeInCaptions(m.addedNodes[j])) { scheduleScan(); return; }
          for (var k = 0; k < m.removedNodes.length; k++) {
            var rn = m.removedNodes[k];
            if (rn.nodeType === 1 && rn.classList && rn.classList.contains('player-timedtext')) { scheduleScan(); return; }
          }
        }
      });
      wf.observer.observe(target, { subtree: true, childList: true, characterData: true });
    } catch (e) { wf.observer = null; }
  }

  /** One-time hint if no subtitles show up for 20s of playback. */
  function checkSubtitles(p) {
    var now = Date.now();
    if (subtitleHintShown || !wfEnabled() || !p.playing) { subCheckAt = now; return; }
    if (now - subCheckAt < 500) return;
    var gap = now - subCheckAt; subCheckAt = now;
    if (captionText()) subEmptyMs = 0; else subEmptyMs += Math.min(gap, 2000);
    if (subEmptyMs > 20000) {
      subtitleHintShown = true;
      toast('Turn on subtitles (any language) so the word filter can hear the show', 8000);
    }
  }

  async function saveWordAsScene() {
    var start = Math.max(0, (wf.hitT !== null ? wf.hitT : (lastPlayerT || 0)) - (state.settings.wordFilter.leadMs || 0) / 1000);
    var cat = catMap().language || state.categories.filter(function (c) { return c.action === 'mute'; })[0] || state.categories[0];
    if (!cat || !state.videoId) return;
    var seg = { id: NSF.uid(), start: start, end: start + 2, category: cat.id, note: 'Word heard in subtitles', created: Date.now() };
    var dup = segments().some(function (o) { return o.category === cat.id && o.start < seg.end && o.end > seg.start; });
    if (dup) { toast('That spot is already saved'); return; }
    await updateEpisode(function (ep) { ep.segments.push(seg); });
    toast('Saved as a scene (' + NSF.fmtTime(seg.start) + ')');
  }

  // ------------------------------------------------------------- main poll
  var busy = false;
  async function tick() {
    if (busy) return;
    if (!alive()) { clearInterval(pollTimer); clearInterval(urlTimer); if (wf.observer) wf.observer.disconnect(); return; }
    busy = true;
    try {
      mount();
      if (!state.videoId || !state.loaded) { if (applied.blanking || Object.keys(muteReasons).length) clearApplied(); return; }
      var p = await readPlayer();
      if (!p) { clearApplied(); return; }
      lastPlayerT = p.t;
      applyAt(p);
      if (!wfEnabled() && wf.active) scanCaptions();     // word filter was just turned off
      checkSubtitles(p);
      syncMute();                                         // re-assert if Netflix unmuted behind our back
      updateChips();
    } catch (e) {
      /* swallow */
    } finally { busy = false; }
  }

  // ---------------------------------------------------- SPA / URL handling
  var lastUrl = '';
  function checkUrl() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    var id = getVideoId();
    if (id !== state.videoId) {
      state.videoId = id;
      state.markStart = null; state.pendingEnd = null; state.undo = null; state.showScenes = false;
      closePop(true);
      clearApplied();
      subEmptyMs = 0;
      bridgeDown = false; bridgeFails = 0;
      renderAll();
      maybeStartTour();
    }
  }

  window.addEventListener('popstate', checkUrl);
  window.addEventListener('hashchange', checkUrl);
  var urlTimer = setInterval(checkUrl, 500);
  var pollTimer = setInterval(tick, POLL_MS);

  // ----------------------------------------------- messages from the popup
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'nsf-status') {
        var ep = episode();
        sendResponse({
          onWatch: !!state.videoId, videoId: state.videoId, title: getTitle(),
          segments: ep ? ep.segments.length : 0, bridge: !bridgeDown
        });
      } else if (msg.type === 'nsf-togglePanel') {
        openScenes();
        sendResponse({ ok: true });
      } else if (msg.type === 'nsf-showToolbar') {
        setToolbarVisible(true);
        sendResponse({ ok: true });
      }
    });
  } catch (e) {}

  // -------------------------------------------------------------------- go
  function start() {
    mount();
    checkUrl();
    startObserver();
    loadAll();
  }
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
