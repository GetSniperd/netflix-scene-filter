/* Settings page: Simple section on top, Advanced below. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var data = null;

  function el(tag, props) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') e.textContent = props[k]; else if (k === 'class') e.className = props[k]; else e[k] = props[k];
    });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) e.appendChild(arguments[i]);
    return e;
  }
  function td(child) { var t = document.createElement('td'); if (child) t.appendChild(child); return t; }
  function msg(t) { $('msg').textContent = t || ''; }
  function setSwitch(btn, on) {
    btn.classList.toggle('on', on);
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  var saveCats = function () { return NSF.setCategories(data.categories); };
  var saveSettings = function () { return NSF.setSettings(data.settings); };

  function renderSimple() {
    var s = data.settings;
    setSwitch($('filtering'), s.filteringEnabled);
    $('filteringTxt').textContent = s.filteringEnabled ? 'Filter is ON' : 'Filter is OFF';
    var cur = NSF.detectPreset(data.categories);
    var box = $('presets'); box.textContent = '';
    NSF.PRESET_ORDER.forEach(function (id) {
      var b = el('button', { text: NSF.PRESETS[id].label, title: NSF.PRESETS[id].desc, className: cur === id ? 'cur' : '' });
      b.addEventListener('click', function () {
        NSF.applyPreset(data.categories, id); saveCats(); renderSimple(); renderCats();
      });
      box.appendChild(b);
    });
    $('presetDesc').textContent = cur === 'custom' ? 'Custom: you picked your own mix (see Advanced below).' : NSF.PRESETS[cur].desc;
    setSwitch($('wordFilter'), s.wordFilter.enabled);
    $('wordFilterTxt').textContent = 'Automatic word filter: ' + (s.wordFilter.enabled ? 'ON' : 'OFF');
    $('toolbarVisible').checked = s.toolbar.visible;
  }

  function renderCats() {
    var tb = $('cats'); tb.textContent = '';
    data.categories.forEach(function (c, i) {
      var color = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#aaaaaa', title: 'Color used for this kind of scene' });
      color.addEventListener('change', function () { c.color = color.value; saveCats(); });
      var name = el('input', { type: 'text', value: NSF.catLabel(c), title: c.help || 'The name shown on the bar' });
      name.addEventListener('change', function () { c.label = name.value.trim() || c.name || c.id; name.value = c.label; saveCats(); });
      var act = el('select', { title: 'What happens during this kind of scene' });
      NSF.ACTIONS.forEach(function (a) {
        var o = el('option', { value: a, text: NSF.ACTION_LABELS[a] }); if (a === c.action) o.selected = true; act.appendChild(o);
      });
      act.addEventListener('change', function () { c.action = act.value; saveCats(); });
      var en = el('input', { type: 'checkbox', checked: c.enabled, title: 'Filter this kind of scene' });
      en.addEventListener('change', function () { c.enabled = en.checked; saveCats(); renderSimple(); });
      var del = el('button', { text: 'Delete', title: 'Remove this kind of scene' });
      del.addEventListener('click', function () {
        if (!confirm('Delete "' + NSF.catLabel(c) + '"? Scenes of this kind stay saved but will no longer be filtered.')) return;
        data.categories.splice(i, 1); saveCats(); renderCats(); renderSimple();
      });
      var tr = document.createElement('tr');
      [color, name, act, en, del].forEach(function (x) { tr.appendChild(td(x)); });
      tb.appendChild(tr);
    });
  }

  function renderWords() {
    $('words').value = data.settings.wordFilter.words.join('\n');
    $('leadMs').value = data.settings.wordFilter.leadMs;
    $('holdMs').value = data.settings.wordFilter.holdMs;
  }

  function renderHotkeys() {
    var tb = $('hotkeys'); tb.textContent = '';
    Object.keys(NSF.HOTKEY_LABELS).forEach(function (k) {
      var inp = el('input', { type: 'text', className: 'hk', readOnly: true, value: data.settings.hotkeys[k], title: 'Click, then press the keys you want' });
      inp.addEventListener('keydown', function (e) {
        e.preventDefault();
        if (e.key === 'Escape') { inp.blur(); return; }
        var combo = NSF.comboFromEvent(e);
        if (!combo) return;
        data.settings.hotkeys[k] = combo; inp.value = combo; saveSettings();
      });
      var tr = document.createElement('tr');
      tr.appendChild(td(el('span', { text: NSF.HOTKEY_LABELS[k] })));
      tr.appendChild(td(inp));
      tb.appendChild(tr);
    });
  }

  function renderLib() {
    var ids = Object.keys(data.library);
    $('libInfo').textContent = ids.length ? ids.length + ' show(s) with saved scenes.' : 'No scenes saved yet.';
    var tb = $('lib'); tb.textContent = '';
    ids.forEach(function (id) {
      var ep = data.library[id];
      var n = ep && Array.isArray(ep.segments) ? ep.segments.length : 0;
      var ex = el('button', { text: 'Save to a file', title: 'Save this show\'s scenes to a file you can share' });
      ex.addEventListener('click', function () {
        NSF.downloadJSON('scene-filter-' + id + '.json', NSF.buildExport(data.library, data.categories, [id]));
      });
      var del = el('button', { text: 'Delete', title: 'Delete all scenes for this show' });
      del.addEventListener('click', async function () {
        if (!confirm('Delete all ' + n + ' scene(s) for "' + ((ep && ep.title) || id) + '"?')) return;
        delete data.library[id]; await NSF.setLibrary(data.library); renderLib();
      });
      var tr = document.createElement('tr');
      tr.appendChild(td(el('span', { text: ((ep && ep.title) || 'Untitled') + '  (' + id + ')' })));
      tr.appendChild(td(el('span', { class: 'muted', text: n + ' scene(s)' })));
      tr.appendChild(td(ex)); tr.appendChild(td(del));
      tb.appendChild(tr);
    });
  }

  async function init() {
    data = await NSF.getAll();
    $('blankText').value = data.settings.blankText;
    renderSimple(); renderCats(); renderWords(); renderHotkeys(); renderLib();
  }

  // Simple controls
  $('filtering').addEventListener('click', function () {
    data.settings.filteringEnabled = !data.settings.filteringEnabled; saveSettings(); renderSimple();
  });
  $('wordFilter').addEventListener('click', function () {
    data.settings.wordFilter.enabled = !data.settings.wordFilter.enabled; saveSettings(); renderSimple();
  });
  $('toolbarVisible').addEventListener('change', function () {
    data.settings.toolbar.visible = $('toolbarVisible').checked; saveSettings();
  });

  // Advanced controls
  $('addCat').addEventListener('click', function () {
    var name = prompt('What should this kind of scene be called?');
    if (!name || !name.trim()) return;
    var base = NSF.slug(name), id = base, n = 2;
    while (data.categories.some(function (c) { return c.id === id; })) id = base + '-' + n++;
    data.categories.push({ id: id, name: name.trim(), label: name.trim(), help: '', action: 'blank', enabled: true,
      color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') });
    saveCats(); renderCats(); renderSimple();
  });
  $('resetCats').addEventListener('click', function () {
    if (!confirm('Go back to the original list of scene types?')) return;
    data.categories = NSF.clone(NSF.DEFAULT_CATEGORIES); saveCats(); renderCats(); renderSimple();
  });
  $('words').addEventListener('change', function () {
    data.settings.wordFilter.words = $('words').value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    saveSettings();
  });
  $('leadMs').addEventListener('change', function () {
    var v = Number($('leadMs').value); data.settings.wordFilter.leadMs = isFinite(v) ? Math.max(0, Math.min(3000, v)) : 300;
    $('leadMs').value = data.settings.wordFilter.leadMs; saveSettings();
  });
  $('holdMs').addEventListener('change', function () {
    var v = Number($('holdMs').value); data.settings.wordFilter.holdMs = isFinite(v) ? Math.max(800, Math.min(10000, v)) : 1200;
    $('holdMs').value = data.settings.wordFilter.holdMs; saveSettings();
  });
  $('resetWords').addEventListener('click', function () {
    data.settings.wordFilter.words = NSF.DEFAULT_WORDS.slice(); saveSettings(); renderWords();
  });
  $('resetHk').addEventListener('click', function () {
    data.settings.hotkeys = NSF.clone(NSF.DEFAULT_SETTINGS.hotkeys); saveSettings(); renderHotkeys();
  });
  $('blankText').addEventListener('change', function () {
    data.settings.blankText = $('blankText').value; saveSettings();
  });
  $('exportAll').addEventListener('click', function () {
    NSF.downloadJSON('scene-filter-all-my-shows.json', NSF.buildExport(data.library, data.categories));
  });
  $('import').addEventListener('click', async function () {
    try {
      var s = await NSF.importData(await NSF.pickJSONFile());
      msg(NSF.statsText(s)); init();
    } catch (e) { msg('Could not load that file: ' + (e && e.message || e)); }
  });

  // Stay in sync with changes made on the Netflix page (so we never write back stale settings).
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !data) return;
      if (changes.settings) { data.settings = NSF.normalizeSettings(changes.settings.newValue); renderSimple(); }
      if (changes.categories) { data.categories = NSF.normalizeCategories(changes.categories.newValue); renderSimple(); }
      if (changes.library) { data.library = changes.library.newValue || {}; renderLib(); }
    });
  } catch (e) {}

  init();
})();
