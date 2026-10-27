/* Popup: simple view (switch + presets) and an advanced view (categories, scenes, files). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var data = null;
  var tabInfo = null;       // response from the Netflix tab, or null

  function msg(t) { $('msg').textContent = t || ''; }
  function setSwitch(btn, on) {
    btn.classList.toggle('on', on);
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  function renderSimple() {
    var s = data.settings;
    setSwitch($('filtering'), s.filteringEnabled);
    $('filteringTxt').textContent = s.filteringEnabled ? 'Filter is ON' : 'Filter is OFF';
    var cur = NSF.detectPreset(data.categories);
    var box = $('presets'); box.textContent = '';
    NSF.PRESET_ORDER.forEach(function (id) {
      var b = document.createElement('button');
      b.textContent = NSF.PRESETS[id].label;
      b.title = NSF.PRESETS[id].desc;
      if (cur === id) b.className = 'cur';
      b.addEventListener('click', async function () {
        NSF.applyPreset(data.categories, id);
        await NSF.setCategories(data.categories);
        render();
      });
      box.appendChild(b);
    });
    $('presetDesc').textContent = cur === 'custom'
      ? 'Custom: you picked your own mix (see Advanced).' : NSF.PRESETS[cur].desc;
    var adv = s.ui.mode === 'advanced';
    $('adv').classList.toggle('show', adv);
    $('advToggle').textContent = adv ? 'Simple view ▴' : 'Advanced ▾';
  }

  function renderAdvanced() {
    var s = data.settings;
    setSwitch($('wordFilter'), s.wordFilter.enabled);
    $('wordFilterTxt').textContent = 'Automatic word filter: ' + (s.wordFilter.enabled ? 'ON' : 'OFF');

    var box = $('cats'); box.textContent = '';
    data.categories.forEach(function (c) {
      var row = document.createElement('div'); row.className = 'crow'; row.title = c.help || '';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = c.enabled;
      cb.title = 'Filter "' + NSF.catLabel(c) + '" scenes';
      cb.addEventListener('change', async function () { c.enabled = cb.checked; await NSF.setCategories(data.categories); renderSimple(); });
      var dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = c.color;
      var n = document.createElement('span'); n.className = 'n'; n.textContent = NSF.catLabel(c);
      var sel = document.createElement('select'); sel.title = 'What happens during a "' + NSF.catLabel(c) + '" scene';
      NSF.ACTIONS.forEach(function (a) {
        var o = document.createElement('option'); o.value = a; o.textContent = NSF.ACTION_LABELS[a];
        if (a === c.action) o.selected = true; sel.appendChild(o);
      });
      sel.addEventListener('change', async function () { c.action = sel.value; await NSF.setCategories(data.categories); });
      [cb, dot, n, sel].forEach(function (x) { row.appendChild(x); });
      box.appendChild(row);
    });

    // Scenes for the episode open in the Netflix tab.
    var sc = $('scenes'); sc.textContent = '';
    var ep = tabInfo && tabInfo.onWatch && tabInfo.videoId ? data.library[tabInfo.videoId] : null;
    var segs = ep && Array.isArray(ep.segments) ? ep.segments.slice().sort(function (a, b) { return a.start - b.start; }) : [];
    if (!segs.length) { sc.className = 'muted'; sc.textContent = tabInfo && tabInfo.onWatch ? 'No scenes marked yet.' : 'Open a Netflix show to see its scenes.'; return; }
    sc.className = '';
    var cm = {}; data.categories.forEach(function (c) { cm[c.id] = c; });
    segs.forEach(function (g) {
      var r = document.createElement('div'); r.className = 'scene';
      var t = document.createElement('span'); t.className = 't';
      t.textContent = NSF.fmtTime(g.start) + ' → ' + NSF.fmtTime(g.end) + '  ' + (cm[g.category] ? NSF.catLabel(cm[g.category]) : g.category);
      var d = document.createElement('button'); d.className = 'sm'; d.textContent = 'Delete'; d.title = 'Delete this scene';
      d.addEventListener('click', async function () {
        ep.segments = ep.segments.filter(function (x) { return x.id !== g.id; });
        ep.updatedAt = Date.now();
        await NSF.setLibrary(data.library);
        NSF.writeShowFile(NSF.showNameOf(ep, tabInfo.videoId), false);
        renderAdvanced(); status();
      });
      r.appendChild(t); r.appendChild(d); sc.appendChild(r);
    });
  }

  async function render() {
    data = await NSF.getAll();
    renderSimple(); renderAdvanced();
  }

  function queryTab(message) {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          var tab = tabs && tabs[0];
          if (!tab || !tab.id) return resolve(null);
          chrome.tabs.sendMessage(tab.id, message, function (resp) {
            void chrome.runtime.lastError;
            resolve(resp || null);
          });
        });
      } catch (e) { resolve(null); }
    });
  }

  async function status() {
    tabInfo = await queryTab({ type: 'nsf-status' });
    var el = $('status');
    var r = tabInfo;
    if (!r) { el.textContent = 'Open a show on Netflix to mark scenes. (If one is already open, reload that tab.)'; $('showTools').disabled = true; $('panel').disabled = true; }
    else if (!r.onWatch) { el.textContent = 'Start playing a show on Netflix to use the marking tools.'; $('showTools').disabled = true; $('panel').disabled = true; }
    else {
      el.textContent = (r.title || 'This show') + ' - ' + r.segments + ' scene(s) marked' +
        (r.bridge ? '' : ' - skipping may not work right now');
      $('showTools').disabled = false; $('panel').disabled = false;
    }
    if (data) renderAdvanced();
  }

  $('filtering').addEventListener('click', async function () {
    await NSF.updateSettings(function (s) { s.filteringEnabled = !s.filteringEnabled; });
    render();
  });
  $('wordFilter').addEventListener('click', async function () {
    await NSF.updateSettings(function (s) { s.wordFilter.enabled = !s.wordFilter.enabled; });
    render();
  });
  $('advToggle').addEventListener('click', async function () {
    await NSF.updateSettings(function (s) { s.ui.mode = s.ui.mode === 'advanced' ? 'simple' : 'advanced'; });
    render();
  });
  $('showTools').addEventListener('click', async function () {
    await queryTab({ type: 'nsf-showToolbar' });
    window.close();
  });
  $('panel').addEventListener('click', async function () {
    await queryTab({ type: 'nsf-togglePanel' });
    window.close();
  });
  $('export').addEventListener('click', async function () {
    var rs = await NSF.writeAllShows(data.library);
    var bad = rs.filter(function (r) { return !r || !r.ok; }).length;
    msg(bad ? 'Could not save ' + bad + ' file(s).' : 'Saved ' + rs.length + ' show file(s) to Downloads\\' + NSF.FOLDER + '.');
  });
  $('import').addEventListener('click', async function () {
    try {
      var s = await NSF.importData(await NSF.pickJSONFile());
      msg(NSF.statsText(s));
      NSF.writeShows(s.shows, false);
      render(); status();
    } catch (e) { msg('Could not load that file: ' + (e && e.message || e)); }
  });
  $('opts').addEventListener('click', function () {
    try { chrome.runtime.openOptionsPage(); } catch (e) {}
    window.close();
  });

  // Keep in sync if the page changes things while the popup is open.
  try { chrome.storage.onChanged.addListener(function () { render(); }); } catch (e) {}

  render().then(status);
})();
