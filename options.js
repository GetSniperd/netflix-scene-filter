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
  function msg(t) { $('msg').textContent = t || ''; $('msg2').textContent = t || ''; }
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
    setSwitch($('autoSave'), s.autoSave);
    $('autoSaveTxt').textContent = 'Auto-save files: ' + (s.autoSave ? 'ON' : 'OFF');
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
    var groups = NSF.groupByShow(data.library);
    var names = Object.keys(groups);
    $('libInfo').textContent = names.length ? names.length + ' show(s) with saved scenes.' : 'No scenes saved yet.';
    var tb = $('lib'); tb.textContent = '';
    names.forEach(function (name) {
      var ids = groups[name];
      var n = 0;
      ids.forEach(function (id) { var e = data.library[id]; n += e && Array.isArray(e.segments) ? e.segments.length : 0; });
      var nameIn = el('input', { type: 'text', value: name, title: 'The show\'s name, also used for its file name. Change it if it is wrong.' });
      nameIn.style.width = '100%';
      nameIn.addEventListener('change', async function () {
        var nn = nameIn.value.trim();
        if (!nn || nn === name) { nameIn.value = name; return; }
        ids.forEach(function (id) { if (data.library[id]) data.library[id].showTitle = nn; });
        await NSF.setLibrary(data.library);
        NSF.writeShowFile(nn, false);
        renderLib();
      });
      var ex = el('button', { text: 'Save this show\'s file', title: 'Write this show\'s file to Downloads\\Netflix Scene Filter now' });
      ex.addEventListener('click', async function () {
        var r = await NSF.writeShowFile(name, true);
        msg(r && r.ok ? 'Saved to Downloads\\' + NSF.FOLDER + '\\' + r.file : 'Could not save the file' + (r && r.error ? ' (' + r.error + ')' : '') + '.');
      });
      var del = el('button', { text: 'Delete', title: 'Delete all scenes for this show' });
      del.addEventListener('click', async function () {
        if (!confirm('Delete all ' + n + ' scene(s) for "' + name + '"? (A file already saved in Downloads is not deleted.)')) return;
        ids.forEach(function (id) { delete data.library[id]; });
        await NSF.setLibrary(data.library); renderLib();
      });
      var tr = document.createElement('tr');
      tr.appendChild(td(nameIn));
      tr.appendChild(td(el('span', { class: 'muted', text: ids.length + ' episode(s), ' + n + ' scene(s)' })));
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
  $('autoSave').addEventListener('click', function () {
    data.settings.autoSave = !data.settings.autoSave; saveSettings(); renderSimple();
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
  $('exportAll').addEventListener('click', async function () {
    var rs = await NSF.writeAllShows(data.library);
    var bad = rs.filter(function (r) { return !r || !r.ok; }).length;
    msg(!rs.length ? 'Nothing to save yet.' : bad ? 'Could not save ' + bad + ' file(s).'
      : 'Saved ' + rs.length + ' show file(s) to Downloads\\' + NSF.FOLDER + '.');
  });
  async function doImport(obj) {
    try {
      var s = await NSF.importData(obj);
      msg(NSF.statsText(s)); NSF.writeShows(s.shows, false); init();
    } catch (e) { msg('Could not load that file: ' + (e && e.message || e)); }
  }
  async function pickAndImport() {
    try { await doImport(await NSF.pickJSONFile()); }
    catch (e) { msg('Could not load that file: ' + (e && e.message || e)); }
  }
  $('import').addEventListener('click', pickAndImport);
  $('import2').addEventListener('click', pickAndImport);

  // Drag a .json file onto the page instead of using the file picker.
  var dragDepth = 0;
  function hasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0;
  }
  function showDrop(on) { $('dropHint').style.display = on ? 'flex' : 'none'; }
  window.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; showDrop(true); });
  window.addEventListener('dragover', function (e) { if (!hasFiles(e)) return; e.preventDefault(); });
  window.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) showDrop(false); });
  window.addEventListener('drop', async function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; showDrop(false);
    var files = Array.prototype.slice.call(e.dataTransfer.files || []).filter(function (f) { return /\.json$/i.test(f.name) || f.type === 'application/json'; });
    if (!files.length) { msg('That is not a .json scene list.'); return; }
    for (var i = 0; i < files.length; i++) {
      try { await doImport(await NSF.readJSONFile(files[i])); }
      catch (err) { msg('Could not load ' + files[i].name + ': ' + (err && err.message || err)); }
    }
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
