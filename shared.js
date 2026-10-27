/*
 * shared.js - code shared by the content script, popup and options page.
 * Exposes a single global: NSF.
 */
var NSF = (function () {
  'use strict';

  // `name` is kept for backward compatibility with saved data; `label` is what people see.
  var DEFAULT_CATEGORIES = [
    { id: 'language',   name: 'Language',   label: 'Bad words',       help: 'Swearing and rude language',             action: 'mute',  enabled: true, color: '#f5a623' },
    { id: 'fanservice', name: 'Fanservice', label: 'Suggestive',      help: 'Revealing or romantic scenes',           action: 'blank', enabled: true, color: '#ff6fa8' },
    { id: 'blood',      name: 'Blood',      label: 'Blood & gore',    help: 'Blood, wounds and graphic violence',     action: 'blank', enabled: true, color: '#e5383b' },
    { id: 'death',      name: 'Death',      label: 'Death',           help: 'Characters dying or dead bodies',        action: 'skip',  enabled: true, color: '#9b8cff' },
    { id: 'scary',      name: 'Scary',      label: 'Scary',           help: 'Frightening images or jump scares',      action: 'blank', enabled: true, color: '#4cc9f0' },
    { id: 'drugs',      name: 'Drugs',      label: 'Drugs & alcohol', help: 'Drinking, smoking or drug use',          action: 'skip',  enabled: true, color: '#7bd88f' },
    { id: 'other',      name: 'Other',      label: 'Other',           help: 'Anything else you would rather not see', action: 'blank', enabled: true, color: '#aaaaaa' }
  ];

  var DEFAULT_WORDS = ['damn*', 'goddamn*', 'hell', 'crap*', 'shit*', 'bullshit', 'ass', 'asshole*',
    'bastard*', 'bitch*', 'piss*', 'dick', 'fuck*', 'wtf'];

  var DEFAULT_SETTINGS = {
    filteringEnabled: true,
    blankText: 'Filtered scene',
    hotkeys: {
      markStart: 'Alt+[',
      markEnd: 'Alt+]',
      togglePanel: 'Alt+M',
      toggleFilter: 'Alt+F',
      deleteLast: 'Alt+Backspace',
      toggleToolbar: 'Alt+B'
    },
    panel: { x: null, y: 80, collapsed: false, visible: false },
    ui: { mode: 'simple', firstRunDone: false },          // mode: 'simple' | 'advanced'
    toolbar: { visible: true, x: null, y: null },
    wordFilter: { enabled: true, words: DEFAULT_WORDS.slice(), leadMs: 300, holdMs: 1200 }
  };

  var HOTKEY_LABELS = {
    markStart: 'Mark the start of a scene',
    markEnd: 'Mark the end of a scene (opens the choices)',
    togglePanel: 'Open / close "My scenes"',
    toggleFilter: 'Turn filtering on / off',
    deleteLast: 'Undo the most recent scene',
    toggleToolbar: 'Show / hide the toolbar'
  };

  // Plain-English wording for actions (internal keys stay mute/blank/skip/off).
  var ACTION_LABELS = { mute: 'Mute sound', blank: 'Hide picture', skip: 'Skip ahead', off: "Don't filter" };
  var ACTION_SHORT  = { mute: 'mutes', blank: 'hides picture', skip: 'skips ahead', off: "doesn't filter" };
  var ACTION_PAST   = { mute: 'Muted', blank: 'Hidden', skip: 'Skipped', off: 'Ignored' };

  // Presets only set the "enabled" flag of categories.
  var PRESETS = {
    little: { label: 'Little kids', on: 'all',
      desc: 'Filters everything: bad words, suggestive scenes, blood, death, scary parts, drugs and anything else you marked.' },
    tweens: { label: 'Tweens', on: ['language', 'fanservice', 'blood', 'death', 'drugs'],
      desc: 'Filters bad words, suggestive scenes, blood & gore, death, and drugs & alcohol. Scary scenes are allowed.' },
    teens:  { label: 'Teens', on: ['fanservice', 'drugs'],
      desc: 'Filters only suggestive scenes and drugs & alcohol.' }
  };
  var PRESET_ORDER = ['little', 'tweens', 'teens'];

  var ACTIONS = ['mute', 'blank', 'skip', 'off'];
  var FORMAT = 'netflix-scene-filter';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------- storage ----------
  function storageGet(keys) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(keys, function (r) { resolve(r || {}); });
      } catch (e) { resolve({}); }
    });
  }
  function storageSet(obj) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.set(obj, function () { resolve(true); });
      } catch (e) { resolve(false); }
    });
  }

  function normalizeSettings(s) {
    var out = clone(DEFAULT_SETTINGS);
    if (s && typeof s === 'object') {
      if (typeof s.filteringEnabled === 'boolean') out.filteringEnabled = s.filteringEnabled;
      if (typeof s.blankText === 'string') out.blankText = s.blankText;
      if (s.hotkeys && typeof s.hotkeys === 'object') {
        Object.keys(out.hotkeys).forEach(function (k) {
          if (typeof s.hotkeys[k] === 'string' && s.hotkeys[k]) out.hotkeys[k] = s.hotkeys[k];
        });
      }
      if (s.panel && typeof s.panel === 'object') {
        Object.keys(out.panel).forEach(function (k) {
          if (typeof s.panel[k] !== 'undefined') out.panel[k] = s.panel[k];
        });
      }
      if (s.ui && typeof s.ui === 'object') {
        if (s.ui.mode === 'advanced' || s.ui.mode === 'simple') out.ui.mode = s.ui.mode;
        if (typeof s.ui.firstRunDone === 'boolean') out.ui.firstRunDone = s.ui.firstRunDone;
      }
      if (s.toolbar && typeof s.toolbar === 'object') {
        if (typeof s.toolbar.visible === 'boolean') out.toolbar.visible = s.toolbar.visible;
        ['x', 'y'].forEach(function (k) {
          out.toolbar[k] = (typeof s.toolbar[k] === 'number' && isFinite(s.toolbar[k])) ? s.toolbar[k] : null;
        });
      }
      if (s.wordFilter && typeof s.wordFilter === 'object') {
        var w = s.wordFilter;
        if (typeof w.enabled === 'boolean') out.wordFilter.enabled = w.enabled;
        if (Array.isArray(w.words)) {
          out.wordFilter.words = w.words.filter(function (x) { return typeof x === 'string' && x.trim(); })
            .map(function (x) { return x.trim(); });
        }
        if (isFinite(Number(w.leadMs))) out.wordFilter.leadMs = Math.max(0, Math.min(3000, Number(w.leadMs)));
        if (isFinite(Number(w.holdMs))) out.wordFilter.holdMs = Math.max(800, Math.min(10000, Number(w.holdMs)));
      }
    }
    return out;
  }

  function defaultCat(id) {
    for (var i = 0; i < DEFAULT_CATEGORIES.length; i++) if (DEFAULT_CATEGORIES[i].id === id) return DEFAULT_CATEGORIES[i];
    return null;
  }

  function normalizeCategories(c) {
    if (!Array.isArray(c) || !c.length) return clone(DEFAULT_CATEGORIES);
    return c.filter(function (x) { return x && typeof x.id === 'string' && x.id; }).map(function (x) {
      var d = defaultCat(x.id);
      var name = typeof x.name === 'string' && x.name ? x.name : (d ? d.name : x.id);
      var label = typeof x.label === 'string' && x.label.trim() ? x.label.trim() : null;
      if (!label) {
        // Older saved data has no labels: keep a user's own rename, otherwise use the friendly default.
        label = (d && name === d.name) ? d.label : name;
      }
      return {
        id: x.id,
        name: name,
        label: label,
        help: typeof x.help === 'string' ? x.help : (d ? d.help : ''),
        action: ACTIONS.indexOf(x.action) >= 0 ? x.action : 'blank',
        enabled: x.enabled !== false,
        color: typeof x.color === 'string' ? x.color : (d ? d.color : '#aaaaaa')
      };
    });
  }

  /** What people see for a category. */
  function catLabel(c) { return (c && (c.label || c.name || c.id)) || ''; }

  async function getAll() {
    var r = await storageGet(['library', 'categories', 'settings']);
    return {
      library: (r.library && typeof r.library === 'object') ? r.library : {},
      categories: normalizeCategories(r.categories),
      settings: normalizeSettings(r.settings)
    };
  }
  function setLibrary(lib) { return storageSet({ library: lib }); }
  function setCategories(c) { return storageSet({ categories: c }); }
  function setSettings(s) { return storageSet({ settings: s }); }
  /** Read-modify-write on settings so concurrent writers (popup / page) don't clobber each other. */
  async function updateSettings(fn) {
    var all = await getAll();
    fn(all.settings);
    await setSettings(all.settings);
    return all.settings;
  }

  // ---------- presets ----------
  /** Sets `enabled` flags on categories (mutates, returns them). */
  function applyPreset(cats, presetId) {
    var p = PRESETS[presetId];
    if (!p) return cats;
    cats.forEach(function (c) { c.enabled = p.on === 'all' ? true : p.on.indexOf(c.id) >= 0; });
    return cats;
  }
  /** Returns the preset id whose flags match the categories exactly, else 'custom'. */
  function detectPreset(cats) {
    for (var i = 0; i < PRESET_ORDER.length; i++) {
      var p = PRESETS[PRESET_ORDER[i]];
      var ok = cats.every(function (c) {
        return c.enabled === (p.on === 'all' ? true : p.on.indexOf(c.id) >= 0);
      });
      if (ok) return PRESET_ORDER[i];
    }
    return 'custom';
  }

  // ---------- automatic word filter ----------
  /**
   * Compiles a list of words/phrases into one RegExp (or null if the list is empty).
   * Case-insensitive, whole-word; `*` matches any run of letters/digits/apostrophes.
   */
  function compileWords(words) {
    var parts = [];
    (words || []).forEach(function (w) {
      w = String(w || '').trim();
      if (!w) return;
      var pieces = w.split('*').map(function (p) {
        return p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      });
      parts.push(pieces.join("[\\p{L}\\p{N}']*"));
    });
    if (!parts.length) return null;
    try {
      return new RegExp('(?<![\\p{L}\\p{N}])(?:' + parts.join('|') + ')(?![\\p{L}\\p{N}])', 'iu');
    } catch (e) { return null; }
  }

  // ---------- utilities ----------
  function uid() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** seconds -> mm:ss.s  (h:mm:ss.s when >= 1 hour) */
  function fmtTime(sec) {
    if (typeof sec !== 'number' || !isFinite(sec)) return '--:--.-';
    var neg = sec < 0; sec = Math.abs(sec);
    var tenths = Math.floor(sec * 10 + 1e-6);
    var s = (tenths / 10) % 60;
    var m = Math.floor(tenths / 600) % 60;
    var h = Math.floor(tenths / 36000);
    var ss = (s < 10 ? '0' : '') + s.toFixed(1);
    var mm = (m < 10 ? '0' : '') + m;
    return (neg ? '-' : '') + (h ? h + ':' : '') + (h ? mm : String(m).padStart(2, '0')) + ':' + ss;
  }

  function slug(name) {
    var s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'cat';
  }

  // ---------- hotkeys ----------
  function keyName(e) {
    var c = e.code || '';
    if (c.indexOf('Key') === 0) return c.slice(3);
    if (c.indexOf('Digit') === 0) return c.slice(5);
    var map = { BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Semicolon: ';',
      Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`' };
    if (map[c]) return map[c];
    if (c) return c;
    return (e.key && e.key.length === 1) ? e.key.toUpperCase() : (e.key || '');
  }
  /** Normalized combo string for a keyboard event, e.g. "Alt+[" ; null for bare modifiers. */
  function comboFromEvent(e) {
    if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].indexOf(e.key) >= 0) return null;
    var p = [];
    if (e.ctrlKey) p.push('Ctrl');
    if (e.altKey) p.push('Alt');
    if (e.shiftKey) p.push('Shift');
    if (e.metaKey) p.push('Meta');
    p.push(keyName(e));
    return p.join('+');
  }

  // ---------- segments ("scenes") / import / export ----------
  function normalizeSegment(s) {
    if (!s || typeof s !== 'object') return null;
    var start = Number(s.start), end = Number(s.end);
    if (!isFinite(start) || !isFinite(end)) return null;
    if (end < start) { var t = start; start = end; end = t; }
    if (end - start <= 0) return null;
    var out = {
      id: typeof s.id === 'string' && s.id ? s.id : uid(),
      start: start,
      end: end,
      category: typeof s.category === 'string' && s.category ? s.category : 'other',
      note: typeof s.note === 'string' ? s.note : ''
    };
    if (ACTIONS.indexOf(s.action) >= 0) out.action = s.action;
    if (typeof s.created === 'number') out.created = s.created;
    return out;
  }

  function overlaps(a, b) { return a.start < b.end && a.end > b.start; }

  /** Pulls {library:{videoId:episode}, categories:[]} out of any supported file shape. */
  function parseImport(obj) {
    var lib = {}, cats = [];
    function addEp(ep, keyHint) {
      if (!ep || typeof ep !== 'object' || !Array.isArray(ep.segments)) return;
      var id = String(ep.videoId || keyHint || '');
      if (!id) return;
      lib[id] = { videoId: id, title: typeof ep.title === 'string' ? ep.title : '', segments: ep.segments };
    }
    if (!obj || typeof obj !== 'object') return { library: lib, categories: cats };
    if (Array.isArray(obj.categories)) cats = obj.categories;
    if (obj.library && typeof obj.library === 'object') {
      if (Array.isArray(obj.library)) obj.library.forEach(function (e) { addEp(e); });
      else Object.keys(obj.library).forEach(function (k) { addEp(obj.library[k], k); });
    } else if (Array.isArray(obj.episodes)) {
      obj.episodes.forEach(function (e) { addEp(e); });
    } else if (Array.isArray(obj.segments)) {
      addEp(obj);
    } else {
      Object.keys(obj).forEach(function (k) { addEp(obj[k], k); });
    }
    return { library: lib, categories: cats };
  }

  /** Merge incoming episodes into lib (mutates). Dedupes by overlap + category. */
  function mergeLibrary(lib, incoming) {
    var stats = { episodes: 0, added: 0, skipped: 0 };
    Object.keys(incoming).forEach(function (id) {
      var src = incoming[id];
      var ep = lib[id];
      if (!ep || !Array.isArray(ep.segments)) ep = lib[id] = { videoId: id, title: src.title || '', segments: [], updatedAt: 0 };
      if (!ep.title && src.title) ep.title = src.title;
      var taken = {};
      ep.segments.forEach(function (s) { taken[s.id] = true; });
      var addedHere = 0;
      src.segments.forEach(function (raw) {
        var seg = normalizeSegment(raw);
        if (!seg) { stats.skipped++; return; }
        var dup = ep.segments.some(function (o) { return o.category === seg.category && overlaps(o, seg); });
        if (dup) { stats.skipped++; return; }
        if (taken[seg.id]) seg.id = uid();
        taken[seg.id] = true;
        ep.segments.push(seg);
        addedHere++; stats.added++;
      });
      if (addedHere) ep.updatedAt = Date.now();
      stats.episodes++;
    });
    return stats;
  }

  /** Full import pipeline against storage. Returns stats. Throws on bad input. */
  async function importData(obj) {
    var parsed = parseImport(obj);
    if (!Object.keys(parsed.library).length) throw new Error('No scenes found in that file.');
    var all = await getAll();
    // Make sure every referenced category exists locally.
    var known = {};
    all.categories.forEach(function (c) { known[c.id] = true; });
    var addedCats = 0;
    Object.keys(parsed.library).forEach(function (id) {
      parsed.library[id].segments.forEach(function (s) {
        var cid = s && typeof s.category === 'string' ? s.category : null;
        if (!cid || known[cid]) return;
        var def = parsed.categories.filter(function (c) { return c && c.id === cid; })[0];
        var cat = normalizeCategories(def ? [def] : [{ id: cid, name: cid }])[0];
        all.categories.push(cat); known[cid] = true; addedCats++;
      });
    });
    var stats = mergeLibrary(all.library, parsed.library);
    stats.categoriesAdded = addedCats;
    await setLibrary(all.library);
    if (addedCats) await setCategories(all.categories);
    return stats;
  }

  function buildExport(library, categories, videoIds) {
    var lib = {};
    (videoIds || Object.keys(library)).forEach(function (id) { if (library[id]) lib[id] = library[id]; });
    return { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), categories: categories, library: lib };
  }

  function downloadJSON(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function pickJSONFile() {
    return new Promise(function (resolve, reject) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,application/json';
      inp.style.display = 'none';
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        inp.remove();
        if (!f) return reject(new Error('No file chosen.'));
        var rd = new FileReader();
        rd.onload = function () {
          try { resolve(JSON.parse(String(rd.result))); } catch (e) { reject(new Error('That does not look like a scene list.')); }
        };
        rd.onerror = function () { reject(new Error('Could not read that file.')); };
        rd.readAsText(f);
      });
      (document.body || document.documentElement).appendChild(inp);
      inp.click();
    });
  }

  function statsText(s) {
    return 'Loaded ' + s.added + ' scene(s) for ' + s.episodes + ' show(s); ' + s.skipped +
      ' already there or not usable' + (s.categoriesAdded ? '; ' + s.categoriesAdded + ' new type(s) of scene added' : '') + '.';
  }

  return {
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES, DEFAULT_SETTINGS: DEFAULT_SETTINGS, DEFAULT_WORDS: DEFAULT_WORDS,
    HOTKEY_LABELS: HOTKEY_LABELS, ACTIONS: ACTIONS, FORMAT: FORMAT,
    ACTION_LABELS: ACTION_LABELS, ACTION_SHORT: ACTION_SHORT, ACTION_PAST: ACTION_PAST,
    PRESETS: PRESETS, PRESET_ORDER: PRESET_ORDER, applyPreset: applyPreset, detectPreset: detectPreset,
    compileWords: compileWords, catLabel: catLabel,
    clone: clone, getAll: getAll, setLibrary: setLibrary, setCategories: setCategories, setSettings: setSettings,
    updateSettings: updateSettings,
    normalizeSettings: normalizeSettings, normalizeCategories: normalizeCategories,
    uid: uid, fmtTime: fmtTime, slug: slug, comboFromEvent: comboFromEvent,
    normalizeSegment: normalizeSegment, parseImport: parseImport, mergeLibrary: mergeLibrary,
    importData: importData, buildExport: buildExport, downloadJSON: downloadJSON,
    pickJSONFile: pickJSONFile, statsText: statsText
  };
})();
