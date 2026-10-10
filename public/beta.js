// Beta features, shown only when an admin switches on "Try beta" in the header.
// With the switch off the app behaves exactly as the standard version.
// Uses the page's globals (processedData, getVisibleResults, parseDate, ...)
// and the calculations in beta-logic.js.
(function () {
  'use strict';
  const L = window.iqcBetaLogic;
  const KEYS = {
    enabled: 'iqcBetaEnabled', specs: 'iqcBetaSpecs', theme: 'iqcBetaTheme',
    hiddenCols: 'iqcBetaHiddenCols', dense: 'iqcBetaDense',
  };
  const SPEC_FIELDS = [
    { key: 'teaPct', label: 'TEa %' },
    { key: 'cvWarnPct', label: 'CV warn %' },
    { key: 'cvHighPct', label: 'CV high %' },
    { key: 'lotShiftPct', label: 'Lot shift %' },
  ];
  const INSTRUMENTS = ['AU/DxI-1', 'AU/DxI-2', 'AU/DxI-3', 'AU/DxI-4'];
  const STATUS_ICON = { reject: '✕', high: '▲', warn: '!', ok: '✓' };
  const REMOVAL_REASONS = ['Clot or fibrin', 'Wrong sample or level', 'Instrument fault', 'Reagent or calibration issue', 'Transcription or entry error', 'Other'];
  const KEEP_OPEN = Symbol('keep dialog open');

  let enabled = false;
  let specsCache = null;
  let reviewCache = { data: null, key: null, reviews: [] };
  let lastReviews = [];
  let lastLotRows = [];
  let splitCharts = [];
  let chipActions = [];

  // ---------- storage (per browser; wrapped because storage can be blocked) ----------
  function storageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function storageSet(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* storage unavailable: setting lasts for this page only */ }
  }
  function getSpecs() {
    if (!specsCache) {
      try { specsCache = JSON.parse(storageGet(KEYS.specs)) || {}; } catch { specsCache = {}; }
    }
    return specsCache;
  }
  function saveSpecs(specs) {
    specsCache = specs;
    storageSet(KEYS.specs, JSON.stringify(specs));
  }

  const isAdmin = () => typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin';
  const el = id => document.getElementById(id);
  const fmt = (v, dp) => (v === null || v === undefined || !Number.isFinite(v)) ? '-' : v.toFixed(dp);
  const signed = (v, dp) => (v === null || !Number.isFinite(v)) ? '-' : (v > 0 ? '+' : '') + v.toFixed(dp);
  const timeOf = r => parseDate(r.date).getTime();
  const tabVisible = name => !el(`tab-${name}`).classList.contains('hidden');
  const goToTab = name => document.querySelector(`.tab[data-tab="${name}"]`).click();

  // ---------- toggle ----------
  function onAuth() {
    el('betaToggleWrap').style.display = isAdmin() ? '' : 'none';
    setEnabled(isAdmin() && storageGet(KEYS.enabled) === '1', false);
  }

  function setEnabled(on, persist = true) {
    enabled = on;
    if (persist) storageSet(KEYS.enabled, on ? '1' : null);
    el('betaToggle').checked = on;
    document.body.classList.toggle('beta-on', on);
    closeMenus();
    applyTheme();
    applyTableTools();
    const active = document.querySelector('.tab.active');
    if (!on && active && active.classList.contains('beta-only')) goToTab('results');
    // CV colours in the results table follow the per-analyte limits while beta is on
    if (resultsData.length) renderResultsTable();
    if (tabVisible('charts') && processedData.length) renderLJChart();
    if (on && !el('settingsSection').classList.contains('hidden')) renderSpecsEditor();
  }

  // CV% thresholds for the results table colours; null means "use 5/10".
  function cvLimits(parameter) {
    if (!enabled) return null;
    const spec = L.specFor(getSpecs(), parameter);
    return { warn: spec.cvWarnPct, high: spec.cvHighPct };
  }

  // Rows behind the results table as currently filtered (analyte, search, CV%).
  function visibleRows() {
    const keys = new Set(getVisibleResults().map(r => r.parameter + '|' + r.level));
    return processedData.filter(r => keys.has(r.parameter + '|' + r.level));
  }

  // Reviewed series for the current filters, shared by Overview and QC Review.
  // Recomputed only when the data, the visible analytes or the specs change.
  function currentReviews() {
    const visible = getVisibleResults();
    const specs = getSpecs();
    const key = visible.map(r => r.parameter + '|' + r.level).join('\n') + '\u0000' + JSON.stringify(specs);
    if (reviewCache.data !== processedData || reviewCache.key !== key) {
      const keys = new Set(visible.map(r => r.parameter + '|' + r.level));
      const rows = processedData.filter(r => keys.has(r.parameter + '|' + r.level));
      const reviews = L.groupSeries(rows, timeOf).map(s => Object.assign(L.reviewSeries(s, specs), { points: s.points }));
      reviewCache = { data: processedData, key, reviews };
    }
    return reviewCache.reviews;
  }

  // Every data or filter change re-renders the results table, which calls this.
  function onDataChanged() {
    if (!enabled) return;
    renderChips();
    if (tabVisible('overview')) renderOverview();
    if (tabVisible('qcreview')) renderQCReview();
    if (tabVisible('lotcompare')) renderLotComparison();
  }

  // A new file set or a loaded report lands on the Overview.
  function onDataLoaded() {
    if (enabled) goToTab('overview');
  }

  function renderTab(name) {
    if (!enabled) return;
    if (name === 'overview') renderOverview();
    if (name === 'qcreview') renderQCReview();
    if (name === 'lotcompare') renderLotComparison();
  }

  // ---------- header menus ----------
  function closeMenus() {
    document.querySelectorAll('.beta-menu.open').forEach(m => {
      m.classList.remove('open');
      m.querySelector(':scope > .btn').setAttribute('aria-expanded', 'false');
    });
  }

  function openMenu(menu) {
    // Mirror the state of the buttons the items stand in for
    menu.querySelectorAll('[data-proxy]').forEach(item => {
      const target = el(item.dataset.proxy);
      item.disabled = !!target.disabled;
      item.hidden = item.dataset.proxy === 'btnSettings' && !isAdmin();
    });
    const theme = storageGet(KEYS.theme) || 'auto';
    menu.querySelectorAll('[data-theme]').forEach(item => item.setAttribute('aria-checked', String(item.dataset.theme === theme)));
    menu.classList.add('open');
    menu.querySelector(':scope > .btn').setAttribute('aria-expanded', 'true');
    const first = menu.querySelector('.beta-menu-list button:not(:disabled):not([hidden])');
    if (first) first.focus();
  }

  function menuItems(menu) {
    return [...menu.querySelectorAll('.beta-menu-list button')].filter(b => !b.disabled && !b.hidden);
  }

  document.querySelectorAll('.beta-menu').forEach(menu => {
    const button = menu.querySelector(':scope > .btn');
    button.addEventListener('click', e => {
      e.stopPropagation();
      const wasOpen = menu.classList.contains('open');
      closeMenus();
      if (!wasOpen) openMenu(menu);
    });
    menu.querySelector('.beta-menu-list').addEventListener('click', e => {
      e.stopPropagation();
      const item = e.target.closest('button');
      if (!item || item.disabled) return;
      closeMenus();
      button.focus();
      if (item.dataset.proxy) el(item.dataset.proxy).click();
      else if (item.dataset.action === 'print') printView();
      else if (item.dataset.action === 'docs') showDoc('readme');
      else if (item.dataset.theme) { storageSet(KEYS.theme, item.dataset.theme); applyTheme(); }
    });
    menu.addEventListener('keydown', e => {
      if (!menu.classList.contains('open')) return;
      const items = menuItems(menu);
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Escape') { e.stopPropagation(); closeMenus(); button.focus(); }
    });
  });
  document.addEventListener('click', closeMenus);

  // Keep the filter bar just under the sticky header, whose height changes as it wraps
  if (window.ResizeObserver) {
    const header = document.querySelector('.app-header');
    new ResizeObserver(() => document.body.style.setProperty('--beta-header-h', header.offsetHeight + 'px')).observe(header);
  }

  // ---------- theme ----------
  const lightQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function applyTheme() {
    const pref = storageGet(KEYS.theme) || 'auto';
    const light = enabled && (pref === 'light' || (pref === 'auto' && !!lightQuery && lightQuery.matches));
    document.body.classList.toggle('theme-light', light);
  }
  if (lightQuery && lightQuery.addEventListener) lightQuery.addEventListener('change', applyTheme);

  // ---------- print ----------
  function fillPrintHeader() {
    if (!enabled) return;
    const active = document.querySelector('.tab.active');
    const tabName = active ? active.textContent.replace(' (beta)', '') : '';
    const range = el('statsBar').textContent.replace(/\s+/g, ' ').replace('Date Range', '').trim();
    const filters = chipActions.map(c => c.label).join(' · ');
    el('betaPrintHeader').innerHTML =
      `<h2>IQC Summary Statistics: ${escapeHtml(tabName)}</h2>` +
      `<div>Date range: ${escapeHtml(range || 'N/A')}${filters ? ' · Filters: ' + escapeHtml(filters) : ''}</div>` +
      `<div>Printed ${escapeHtml(new Date().toLocaleString('en-GB'))}${currentUser ? ' by ' + escapeHtml(currentUser.email) : ''}</div>`;
  }
  function printView() {
    fillPrintHeader();
    window.print();
  }
  window.addEventListener('beforeprint', fillPrintHeader);

  // ---------- toasts and dialogs ----------
  function toast(message, type = 'info') {
    let root = el('betaToasts');
    if (!root) {
      root = document.createElement('div');
      root.id = 'betaToasts';
      root.className = 'beta-toasts';
      root.setAttribute('role', 'status');
      root.setAttribute('aria-live', 'polite');
      document.body.appendChild(root);
    }
    const item = document.createElement('div');
    item.className = `beta-toast ${type}`;
    const text = document.createElement('div');
    text.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    item.append(text, close);
    root.appendChild(item);
    const remove = () => item.remove();
    close.addEventListener('click', remove);
    setTimeout(remove, type === 'error' ? 9000 : 5000);
  }

  // Resolves with onConfirm()'s value (or true), or with cancelValue when cancelled.
  // onConfirm can return KEEP_OPEN to keep the dialog up after a validation error.
  function openDialog({ title, body, confirmLabel = 'OK', danger = false, onConfirm, cancelValue = null }) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'beta-dialog-overlay';
      overlay.innerHTML = `<div class="beta-dialog" role="dialog" aria-modal="true" aria-labelledby="betaDialogTitle">
        <h3 id="betaDialogTitle"></h3>
        <div class="beta-dialog-body"></div>
        <div class="beta-dialog-actions">
          <button type="button" class="btn" data-act="cancel">Cancel</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok"></button>
        </div>
      </div>`;
      overlay.querySelector('h3').textContent = title;
      overlay.querySelector('.beta-dialog-body').append(...[].concat(body));
      overlay.querySelector('[data-act="ok"]').textContent = confirmLabel;
      const previousFocus = document.activeElement;

      const close = value => {
        overlay.remove();
        if (previousFocus && previousFocus.focus) previousFocus.focus();
        resolve(value);
      };
      const confirm = () => {
        const value = onConfirm ? onConfirm() : true;
        if (value !== KEEP_OPEN) close(value);
      };
      overlay.addEventListener('click', e => {
        const act = e.target.closest('[data-act]');
        if (e.target === overlay || (act && act.dataset.act === 'cancel')) close(cancelValue);
        else if (act && act.dataset.act === 'ok') confirm();
      });
      overlay.addEventListener('keydown', e => {
        // Keep Escape from also closing a modal underneath
        e.stopPropagation();
        if (e.key === 'Escape') close(cancelValue);
        else if (e.key === 'Enter' && !['TEXTAREA', 'BUTTON', 'SELECT'].includes(e.target.tagName)) { e.preventDefault(); confirm(); }
        else if (e.key === 'Tab') {
          const focusables = [...overlay.querySelectorAll('select, input, textarea, button')];
          const first = focusables[0], last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });
      document.body.appendChild(overlay);
      (overlay.querySelector('select, input, textarea') || overlay.querySelector('[data-act="ok"]')).focus();
    });
  }

  function node(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function confirmDialog(message, confirmLabel = 'Delete') {
    const p = document.createElement('p');
    p.textContent = message;
    return openDialog({ title: 'Please confirm', body: p, confirmLabel, danger: true, cancelValue: false });
  }

  function removalReasonDialog(point) {
    const summary = node(`<div class="beta-point"></div>`);
    summary.textContent = `${point.parameter} level ${point.level} · ${point.instrument} · ${formatDate(point.date)} · value ${point.value}`;
    const reasonLabel = node(`<label>Reason<select><option value="">Choose a reason…</option>
      ${REMOVAL_REASONS.map(r => `<option>${escapeHtml(r)}</option>`).join('')}</select></label>`);
    const detailsLabel = node(`<label><span>Details <span class="beta-dim">(required for Other)</span></span><textarea maxlength="180"></textarea></label>`);
    const note = node(`<div class="beta-dim" style="font-size:12px">Recorded in the activity log, saved with the report and listed in the PDF.</div>`);
    const error = node(`<div class="beta-dialog-error" role="alert"></div>`);
    const select = reasonLabel.querySelector('select');
    const details = detailsLabel.querySelector('textarea');
    return openDialog({
      title: 'Remove data point', body: [summary, reasonLabel, detailsLabel, note, error], confirmLabel: 'Remove', danger: true,
      onConfirm: () => {
        const reason = select.value;
        const extra = details.value.trim();
        if (!reason) { error.textContent = 'Choose a reason.'; select.focus(); return KEEP_OPEN; }
        if (reason === 'Other' && !extra) { error.textContent = 'Describe the reason in Details.'; details.focus(); return KEEP_OPEN; }
        return extra ? `${reason}: ${extra}` : reason;
      },
    });
  }

  function passwordDialog(email) {
    const intro = node(`<p></p>`);
    intro.textContent = `Set a new password for ${email}. They should change it after signing in.`;
    const first = node(`<label>New password<input type="password" autocomplete="new-password"></label>`);
    const second = node(`<label>Confirm password<input type="password" autocomplete="new-password"></label>`);
    const error = node(`<div class="beta-dialog-error" role="alert"></div>`);
    return openDialog({
      title: 'Reset password', body: [intro, first, second, error], confirmLabel: 'Reset password',
      onConfirm: () => {
        const a = first.querySelector('input').value, b = second.querySelector('input').value;
        if (a.length < 8) { error.textContent = 'Use at least 8 characters.'; return KEEP_OPEN; }
        if (a !== b) { error.textContent = 'The passwords do not match.'; return KEEP_OPEN; }
        return a;
      },
    });
  }

  // ---------- Overview ----------
  function renderOverview() {
    const kpis = el('betaKpis');
    const heat = el('betaHeatmap');
    if (!processedData.length) {
      kpis.innerHTML = '';
      heat.innerHTML = '<div class="beta-empty">Load data to see the overview.</div>';
      return;
    }
    const visible = getVisibleResults();
    const reviews = currentReviews();
    const byKey = new Map(reviews.map(r => [`${r.parameter}|${r.level}|${r.instrument}`, r]));
    const flagged = reviews.filter(r => r.rejections > 0).length;
    const highCv = reviews.filter(r => r.cvStatus === 'high').length;
    const lotChanges = reviews.filter(r => L.splitByTargetChange(r.points)).length;
    const worst = reviews.reduce((w, r) => (r.n > 1 && (!w || r.cv > w.cv) ? r : w), null);
    let minT = Infinity, maxT = -Infinity, results = 0;
    for (const r of reviews) {
      results += r.n;
      for (const p of r.points) {
        const t = timeOf(p);
        if (t > 0 && t < minT) minT = t;
        if (t > maxT) maxT = t;
      }
    }
    const day = t => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    const tile = (label, value, sub, opts = {}) => {
      const tag = opts.go ? 'button' : 'div';
      return `<${tag} class="beta-kpi${opts.alert ? ' alert' : ''}"${opts.go ? ` type="button" data-go="${opts.go}"` : ''}>
        <div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></${tag}>`;
    };
    kpis.innerHTML = [
      tile('Results in view', results.toLocaleString(), `${visible.length} analyte/level groups`),
      tile('Westgard violations', flagged, `of ${reviews.length} instrument series`, { alert: flagged > 0, go: 'qc-flagged' }),
      tile('CV above high limit', highCv, 'instrument series', { alert: highCv > 0, go: 'qc' }),
      worst ? tile('Highest CV', `${worst.cv.toFixed(1)}%`, escapeHtml(`${worst.parameter} L${worst.level} · ${worst.instrument}`), { go: 'chart-worst' }) : '',
      tile('Lot changes', lotChanges, 'series with a new Target/SD', { go: 'lot' }),
      tile('Date range', minT === Infinity ? 'N/A' : day(minT), minT === Infinity ? '' : `to ${day(maxT)}`),
    ].join('');
    kpis.dataset.worst = worst ? JSON.stringify([worst.parameter, worst.level, worst.instrument]) : '';

    const cell = r => {
      if (!r) return '<td class="cell s-none">—</td>';
      const status = L.seriesStatus(r);
      const title = `${r.parameter} L${r.level} ${r.instrument}: CV ${r.cv.toFixed(2)}%, n=${r.n}` +
        (r.rejections ? `, ${r.rejections} Westgard rule violation(s)` : '');
      return `<td class="cell s-${status}" tabindex="0" role="button" title="${escapeHtml(title)}"
        data-param="${escapeHtml(r.parameter)}" data-level="${escapeHtml(r.level)}" data-inst="${escapeHtml(r.instrument)}">${STATUS_ICON[status]} ${r.cv.toFixed(1)}%</td>`;
    };
    const combinedCell = row => {
      const c = row.combined;
      if (!c || !c.count) return '<td class="cell s-none">—</td>';
      const spec = L.specFor(getSpecs(), row.parameter);
      const status = c.cv > spec.cvHighPct ? 'high' : c.cv > spec.cvWarnPct ? 'warn' : 'ok';
      return `<td class="cell s-${status}" tabindex="0" role="button" title="${escapeHtml(`${row.parameter} L${row.level} combined: CV ${c.cv.toFixed(2)}%, n=${c.count}`)}"
        data-param="${escapeHtml(row.parameter)}" data-level="${escapeHtml(row.level)}" data-inst="">${STATUS_ICON[status]} ${c.cv.toFixed(1)}%</td>`;
    };
    let html = `<table class="beta-heat"><thead><tr><th style="text-align:left">Analyte</th><th>Lvl</th>
      ${INSTRUMENTS.map(i => `<th>${i}</th>`).join('')}<th>Combined</th></tr></thead><tbody>`;
    for (const row of visible) {
      html += `<tr><td style="text-align:left;font-weight:500">${escapeHtml(row.parameter)}</td><td>${escapeHtml(row.level)}</td>
        ${INSTRUMENTS.map(i => cell(byKey.get(`${row.parameter}|${row.level}|${i}`))).join('')}${combinedCell(row)}</tr>`;
    }
    heat.innerHTML = html + '</tbody></table>';
  }

  // Open the Levey-Jennings chart for one series (instrument '' = all instruments)
  function openChart(param, level, instrument) {
    el('chartAnalyte').value = param;
    el('chartLevel').value = level;
    document.querySelectorAll('#chartInstruments input').forEach(cb => { cb.checked = !instrument || cb.value === instrument; });
    const hasTarget = processedData.some(r => r.parameter === param && r.level === level && r.sd > 0);
    el('chartReference').value = hasTarget ? 'target' : 'observed';
    goToTab('charts');
    // Scroll the tabs to just below the sticky header
    const header = document.querySelector('.app-header').offsetHeight;
    const top = document.querySelector('.tabs').getBoundingClientRect().top + window.scrollY - header - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  el('betaKpis').addEventListener('click', e => {
    const tile = e.target.closest('[data-go]');
    if (!tile) return;
    const go = tile.dataset.go;
    if (go === 'qc-flagged' || go === 'qc') { el('betaOnlyFlagged').checked = go === 'qc-flagged'; goToTab('qcreview'); }
    else if (go === 'lot') { el('betaLotMode').value = 'target'; goToTab('lotcompare'); }
    else if (go === 'chart-worst' && el('betaKpis').dataset.worst) openChart(...JSON.parse(el('betaKpis').dataset.worst));
  });
  const heatOpen = e => {
    const td = e.target.closest('td.cell:not(.s-none)');
    if (td) openChart(td.dataset.param, td.dataset.level, td.dataset.inst);
  };
  el('betaHeatmap').addEventListener('click', heatOpen);
  el('betaHeatmap').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); heatOpen(e); }
  });

  // ---------- Levey-Jennings additions ----------
  // Marker style per point from the Westgard rules it completes; null when beta is off.
  function ljMarkers(points) {
    if (!enabled) return null;
    return L.pointFlags(points).map(f => ({
      rules: f.rules,
      radius: f.level === 'reject' ? 7 : f.level === 'warn' ? 6 : 3,
      style: f.level === 'reject' ? 'crossRot' : f.level === 'warn' ? 'triangle' : 'circle',
      color: f.level === 'reject' ? '#ef4444' : f.level === 'warn' ? '#f59e0b' : null,
    }));
  }

  // One chart per instrument. Returns false (and shows the single chart) unless
  // beta is on with the split layout chosen.
  function renderLJSplit(param, level, insts) {
    splitCharts.forEach(c => c.destroy());
    splitCharts = [];
    const split = enabled && el('chartLayout').value === 'split';
    const grid = el('ljSplit');
    grid.style.display = split ? '' : 'none';
    el('ljMainWrap').style.display = split ? 'none' : '';
    grid.innerHTML = '';
    if (!split) return false;
    if (!insts.length) {
      grid.innerHTML = '<div class="beta-empty">Select at least one instrument.</div>';
      return true;
    }
    const reference = el('chartReference').value;
    for (const inst of insts) {
      const card = node(`<div class="beta-split-card"><h4></h4><div class="beta-dim"></div><div class="chart-wrapper"><canvas></canvas></div></div>`);
      card.querySelector('h4').textContent = inst;
      grid.appendChild(card);
      const result = drawLJChart(card.querySelector('canvas'), param, level, [inst], reference);
      card.querySelector('.beta-dim').textContent = result.note;
      if (result.chart) splitCharts.push(result.chart);
      else card.querySelector('.chart-wrapper').remove();
    }
    return true;
  }
  el('chartLayout').addEventListener('change', renderLJChart);

  // ---------- results table: filter chips, column groups, density ----------
  function renderChips() {
    const chips = [];
    const fire = (id, type = 'change') => el(id).dispatchEvent(new Event(type));
    if (selectedProtocols.size) chips.push({
      label: selectedProtocols.size === 1 ? `Protocol: ${[...selectedProtocols][0]}` : `${selectedProtocols.size} protocols`,
      clear: () => { el('protocolSelectAll').checked = true; fire('protocolSelectAll'); },
    });
    if (selectedAnalytes.size) chips.push({
      label: selectedAnalytes.size === 1 ? `Analyte: ${[...selectedAnalytes][0]}` : `${selectedAnalytes.size} analytes`,
      clear: () => { el('analyteSelectAll').checked = true; fire('analyteSelectAll'); },
    });
    const search = el('filterSearch').value.trim();
    if (search) chips.push({ label: `Search: "${search}"`, clear: () => { el('filterSearch').value = ''; fire('filterSearch', 'input'); } });
    const status = el('filterStatus').value;
    if (status !== 'accepted') chips.push({
      label: status === 'all' ? 'All statuses' : 'Rejected only',
      clear: () => { el('filterStatus').value = 'accepted'; fire('filterStatus'); },
    });
    const cv = el('filterCV').value;
    if (cv !== 'all') chips.push({ label: cv === 'high' ? 'Any CV > 10%' : 'Any CV > 5%', clear: () => { el('filterCV').value = 'all'; fire('filterCV'); } });
    if (!el('filterExcludeEval').checked) chips.push({
      label: 'Evaluation runs included',
      clear: () => { el('filterExcludeEval').checked = true; fire('filterExcludeEval'); },
    });
    const from = el('filterDateFrom').value, to = el('filterDateTo').value;
    if (from) chips.push({ label: `From ${isoToUK(from)}`, clear: () => { el('filterDateFrom').value = ''; fire('filterDateFrom'); } });
    if (to) chips.push({ label: `To ${isoToUK(to)}`, clear: () => { el('filterDateTo').value = ''; fire('filterDateTo'); } });
    if (exclusions.length) chips.push({
      label: `${exclusions.length} instrument exclusion${exclusions.length > 1 ? 's' : ''}`,
      clear: () => { exclusions.splice(0); renderExclusions(); applyFilters(); },
    });
    chipActions = chips;
    el('betaChips').innerHTML = chips.length
      ? 'Filters: ' + chips.map((c, i) => `<span class="beta-chip"><span>${escapeHtml(c.label)}</span><button type="button" data-chip="${i}" aria-label="Remove filter: ${escapeHtml(c.label)}">×</button></span>`).join('') +
        (chips.length > 1 ? '<button type="button" class="beta-link" data-chip="all">Clear all</button>' : '')
      : '<span>No filters applied</span>';
  }
  el('betaChips').addEventListener('click', e => {
    const b = e.target.closest('[data-chip]');
    if (!b) return;
    const actions = chipActions;
    if (b.dataset.chip === 'all') actions.forEach(c => c.clear());
    else actions[Number(b.dataset.chip)].clear();
  });

  function applyTableTools() {
    let hidden = [];
    try { hidden = JSON.parse(storageGet(KEYS.hiddenCols)) || []; } catch { hidden = []; }
    document.querySelectorAll('#betaTableTools input[data-group]').forEach(cb => {
      cb.checked = !hidden.includes(cb.dataset.group);
      el('resultsTable').classList.toggle('hide-' + cb.dataset.group, hidden.includes(cb.dataset.group));
    });
    const dense = storageGet(KEYS.dense) === '1';
    el('betaDense').checked = dense;
    document.body.classList.toggle('beta-dense', dense);
  }
  el('betaTableTools').addEventListener('change', e => {
    if (e.target.id === 'betaDense') storageSet(KEYS.dense, e.target.checked ? '1' : null);
    else {
      const hidden = [...document.querySelectorAll('#betaTableTools input[data-group]')].filter(cb => !cb.checked).map(cb => cb.dataset.group);
      storageSet(KEYS.hiddenCols, JSON.stringify(hidden));
    }
    applyTableTools();
  });

  // ---------- QC Review: bias, z-scores, Westgard, sigma ----------
  function renderQCReview() {
    const body = el('betaQCReviewBody');
    const summary = el('betaQCReviewSummary');
    el('betaQCDetail').innerHTML = '';
    if (!processedData.length) {
      summary.textContent = '';
      body.innerHTML = '<div class="beta-empty">Load data to review it.</div>';
      lastReviews = [];
      return;
    }

    const all = currentReviews();
    const flagged = all.filter(r => r.rejections > 0).length;
    const noTarget = all.filter(r => r.target === null).length;
    summary.textContent =
      `${all.length} analyte/level/instrument series reviewed · ${flagged} with Westgard rejection-rule violations` +
      (noTarget ? ` · ${noTarget} without Target/SD in the data (no bias or Westgard check)` : '');

    let rows = all;
    if (el('betaOnlyFlagged').checked) rows = rows.filter(r => r.rejections > 0);
    rows = rows.slice().sort((a, b) => b.rejections - a.rejections);
    lastReviews = rows;

    if (!rows.length) {
      body.innerHTML = '<div class="beta-empty">No series match.</div>';
      return;
    }

    let html = `<table class="beta-table"><thead><tr>
      <th style="text-align:left">Analyte</th><th>Lvl</th><th>Instrument</th><th>n</th>
      <th>Mean</th><th>Target</th><th>Bias %</th><th>Mean z</th><th>CV %</th>
      <th>TEa %</th><th>Sigma</th><th style="text-align:left">Westgard (rejection rules)</th><th>1-2s</th>
    </tr></thead><tbody>`;
    rows.forEach((r, i) => {
      const dp = decimalsFor(r.parameter);
      const sigmaClass = r.sigma === null ? '' : r.sigma < 3 ? 'cv-high' : r.sigma < 4 ? 'cv-warn' : r.sigma >= 6 ? 'cv-ok' : '';
      const cvClass = r.cvStatus === 'high' ? 'cv-high' : r.cvStatus === 'warn' ? 'cv-warn' : 'cv-ok';
      const rules = L.REJECTION_RULES.filter(rule => r.counts[rule])
        .map(rule => `<span class="beta-rule">${rule} ×${r.counts[rule]}</span>`).join(' ');
      const targetNote = r.targetPairs > 1
        ? ` <span class="beta-note" title="${r.targetPairs} different Target/SD pairs in range (most frequent shown); each result is checked against its own target">*</span>` : '';
      html += `<tr class="beta-row beta-clickable" data-index="${i}" tabindex="0">
        <td style="text-align:left;font-weight:500">${escapeHtml(r.parameter)}</td>
        <td>${escapeHtml(r.level)}</td>
        <td>${escapeHtml(r.instrument)}</td>
        <td>${r.n}</td>
        <td>${fmt(r.mean, dp)}</td>
        <td>${r.target === null ? '-' : fmt(r.target, dp) + targetNote}</td>
        <td>${signed(r.biasPct, 1)}</td>
        <td>${signed(r.zMean, 2)}</td>
        <td class="${cvClass}">${fmt(r.cv, 2)}</td>
        <td>${r.teaPct === null ? '-' : fmt(r.teaPct, 1)}</td>
        <td class="${sigmaClass}">${fmt(r.sigma, 1)}</td>
        <td style="text-align:left">${rules || (r.target === null ? '<span class="beta-dim">no target</span>' : '<span class="cv-ok">none</span>')}</td>
        <td>${r.warnings || ''}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    body.innerHTML = html;
  }

  function showQCDetail(index) {
    const r = lastReviews[index];
    const detail = el('betaQCDetail');
    if (!r) { detail.innerHTML = ''; return; }
    const dp = decimalsFor(r.parameter);
    const rejections = r.violations.filter(v => L.REJECTION_RULES.includes(v.rule));
    detail.innerHTML = `
      <div class="beta-detail-head">
        <b>${escapeHtml(r.parameter)} level ${escapeHtml(r.level)} · ${escapeHtml(r.instrument)}</b>
        <span class="beta-dim">${rejections.length
          ? `${rejections.length} rule violation(s), shown at the result that completes each rule`
          : 'No Westgard rejection-rule violations'}</span>
        <button type="button" class="btn" data-open-chart>Open Levey-Jennings chart</button>
      </div>
      ${rejections.length ? `<table class="beta-table"><thead><tr>
        <th>Date</th><th>Value</th><th>Target</th><th>SD</th><th>z</th><th>Rule</th><th style="text-align:left">Protocol</th>
      </tr></thead><tbody>
      ${rejections.map(v => `<tr>
        <td>${escapeHtml(formatDate(v.point.date))}</td>
        <td>${fmt(v.point.value, dp)}</td>
        <td>${v.point.sd > 0 ? fmt(v.point.target, dp) : fmt(r.target, dp)}</td>
        <td>${v.point.sd > 0 ? fmt(v.point.sd, dp) : fmt(r.targetSD, dp)}</td>
        <td>${signed(v.z, 2)}</td>
        <td><span class="beta-rule">${v.rule}</span></td>
        <td style="text-align:left">${escapeHtml(v.point.protocol)}</td>
      </tr>`).join('')}
      </tbody></table>` : ''}`;
    detail.querySelector('[data-open-chart]').addEventListener('click', () => openChart(r.parameter, r.level, r.instrument));
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function exportQCReview() {
    const head = ['Analyte', 'Level', 'Instrument', 'n', 'Mean', 'Target', 'Target SD', 'Bias %', 'Mean z', 'CV %', 'TEa %', 'Sigma',
      ...L.REJECTION_RULES, '1-2s warnings'];
    const rows = lastReviews.map(r => {
      const dp = decimalsFor(r.parameter);
      return [r.parameter, r.level, r.instrument, r.n, fmt(r.mean, dp), fmt(r.target, dp), fmt(r.targetSD, dp),
        fmt(r.biasPct, 2), fmt(r.zMean, 2), fmt(r.cv, 2), fmt(r.teaPct, 1), fmt(r.sigma, 2),
        ...L.REJECTION_RULES.map(rule => r.counts[rule] || 0), r.warnings];
    });
    downloadCSV('QCReview', head, rows);
  }

  // ---------- Lot comparison ----------
  function lotPeriodPoints(points, fromId, toId) {
    const from = el(fromId).value, to = el(toId).value;
    if (!from || !to) return null;
    const start = parseISODateLocal(from).getTime();
    const end = parseISODateLocal(to);
    end.setHours(23, 59, 59, 999);
    return points.filter(p => { const t = timeOf(p); return t >= start && t <= end.getTime(); });
  }

  function renderLotComparison() {
    const body = el('betaLotBody');
    const summary = el('betaLotSummary');
    const mode = el('betaLotMode').value;
    el('betaLotDates').style.display = mode === 'dates' ? '' : 'none';
    lastLotRows = [];
    if (!processedData.length) {
      summary.textContent = '';
      body.innerHTML = '<div class="beta-empty">Load data to compare lots.</div>';
      return;
    }
    const minN = Math.max(1, parseInt(el('betaLotMinN').value, 10) || 1);
    const specs = getSpecs();

    if (mode === 'dates' && !(el('betaLotAFrom').value && el('betaLotATo').value && el('betaLotBFrom').value && el('betaLotBTo').value)) {
      summary.textContent = '';
      body.innerHTML = '<div class="beta-empty">Pick a start and end date for both periods.</div>';
      return;
    }

    for (const s of L.groupSeries(visibleRows(), timeOf)) {
      let a, b, aTarget = null, bTarget = null;
      if (mode === 'target') {
        const split = L.splitByTargetChange(s.points);
        if (!split) continue;
        ({ a, b, aTarget, bTarget } = split);
      } else {
        a = lotPeriodPoints(s.points, 'betaLotAFrom', 'betaLotATo');
        b = lotPeriodPoints(s.points, 'betaLotBFrom', 'betaLotBTo');
        if (!a.length && !b.length) continue;
      }
      const limit = L.specFor(specs, s.parameter).lotShiftPct;
      lastLotRows.push({ ...s, aTarget, bTarget, ...L.compareLots(a, b, limit, minN) });
    }

    if (!lastLotRows.length) {
      summary.textContent = '';
      body.innerHTML = mode === 'target'
        ? '<div class="beta-empty">No Target/SD changes found in the filtered data. Reports saved before targets were stored have none; use two date ranges instead.</div>'
        : '<div class="beta-empty">No results fall in either period.</div>';
      return;
    }

    const order = { fail: 0, pass: 1, insufficient: 2 };
    lastLotRows.sort((x, y) => order[x.result] - order[y.result]);
    const count = k => lastLotRows.filter(r => r.result === k).length;
    summary.textContent = `${lastLotRows.length} series compared · ${count('fail')} fail · ${count('pass')} pass · ${count('insufficient')} with fewer than ${minN} results on a side`;

    const targetCols = mode === 'target';
    let html = `<table class="beta-table"><thead><tr>
      <th rowspan="2" style="text-align:left">Analyte</th><th rowspan="2">Lvl</th><th rowspan="2">Instrument</th>
      <th colspan="${targetCols ? 4 : 3}" class="group-header">${targetCols ? 'Previous target' : 'Period A'}</th>
      <th colspan="${targetCols ? 4 : 3}" class="group-header">${targetCols ? 'Current target' : 'Period B'}</th>
      <th rowspan="2">Mean shift %</th><th rowspan="2">CV change</th><th rowspan="2">Limit %</th><th rowspan="2">Result</th>
    </tr><tr>
      ${targetCols ? '<th>Target</th>' : ''}<th>n</th><th>Mean</th><th>CV %</th>
      ${targetCols ? '<th>Target</th>' : ''}<th>n</th><th>Mean</th><th>CV %</th>
    </tr></thead><tbody>`;
    for (const r of lastLotRows) {
      const dp = decimalsFor(r.parameter);
      const badge = `<span class="beta-result beta-${r.result}">${r.result === 'insufficient' ? 'Too few' : r.result === 'pass' ? 'Pass' : 'Fail'}</span>`;
      html += `<tr>
        <td style="text-align:left;font-weight:500">${escapeHtml(r.parameter)}</td>
        <td>${escapeHtml(r.level)}</td><td>${escapeHtml(r.instrument)}</td>
        ${targetCols ? `<td>${fmt(r.aTarget, dp)}</td>` : ''}<td>${r.a.n}</td><td>${r.a.n ? fmt(r.a.mean, dp) : '-'}</td><td>${r.a.n > 1 ? fmt(r.a.cv, 2) : '-'}</td>
        ${targetCols ? `<td>${fmt(r.bTarget, dp)}</td>` : ''}<td>${r.b.n}</td><td>${r.b.n ? fmt(r.b.mean, dp) : '-'}</td><td>${r.b.n > 1 ? fmt(r.b.cv, 2) : '-'}</td>
        <td class="${r.result === 'fail' ? 'cv-high' : ''}">${signed(r.shiftPct, 2)}</td>
        <td>${signed(r.cvChange, 2)}</td>
        <td>±${fmt(r.limitPct, 1)}</td>
        <td>${badge}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    body.innerHTML = html;
  }

  function exportLotComparison() {
    const head = ['Analyte', 'Level', 'Instrument', 'A target', 'A n', 'A mean', 'A CV %', 'B target', 'B n', 'B mean', 'B CV %',
      'Mean shift %', 'CV change', 'Limit %', 'Result'];
    const rows = lastLotRows.map(r => {
      const dp = decimalsFor(r.parameter);
      return [r.parameter, r.level, r.instrument, fmt(r.aTarget, dp), r.a.n, fmt(r.a.mean, dp), fmt(r.a.cv, 2),
        fmt(r.bTarget, dp), r.b.n, fmt(r.b.mean, dp), fmt(r.b.cv, 2), fmt(r.shiftPct, 2), fmt(r.cvChange, 2), fmt(r.limitPct, 1), r.result];
    });
    downloadCSV('LotComparison', head, rows);
  }

  // ---------- Quality specifications editor (Settings) ----------
  function renderSpecsEditor() {
    const specs = getSpecs();
    const analytes = [...new Set([
      ...resultsData.map(r => r.parameter),
      ...Object.keys(specs).filter(k => k !== '*'),
    ])].sort();
    const defaults = L.DEFAULT_SPEC;
    const input = (key, field, placeholder) => {
      const v = specs[key] && specs[key][field.key];
      return `<td><input type="number" step="any" min="0" class="beta-spec-input" data-key="${escapeHtml(key)}" data-field="${field.key}"
        aria-label="${escapeHtml(`${key === '*' ? 'Default' : key} ${field.label}`)}"
        value="${v === null || v === undefined ? '' : escapeHtml(v)}" placeholder="${escapeHtml(placeholder)}"></td>`;
    };
    const defaultRow = specs['*'] || {};
    let html = `<table class="beta-table"><thead><tr><th style="text-align:left">Analyte</th>
      ${SPEC_FIELDS.map(f => `<th>${f.label}</th>`).join('')}</tr></thead><tbody>
      <tr><td style="text-align:left"><b>Default (all analytes)</b></td>
        ${SPEC_FIELDS.map(f => input('*', f, defaults[f.key] === null ? 'not set' : String(defaults[f.key]))).join('')}</tr>`;
    for (const a of analytes) {
      html += `<tr><td style="text-align:left">${escapeHtml(a)}</td>
        ${SPEC_FIELDS.map(f => {
          const inherited = defaultRow[f.key] !== undefined && defaultRow[f.key] !== '' ? defaultRow[f.key] : defaults[f.key];
          return input(a, f, inherited === null ? 'not set' : String(inherited));
        }).join('')}</tr>`;
    }
    html += '</tbody></table>';
    if (!analytes.length) html += '<div class="beta-dim" style="margin-top:8px">Load data to list its analytes here.</div>';
    el('betaSpecsTable').innerHTML = html;
  }

  function collectSpecs() {
    const specs = {};
    document.querySelectorAll('.beta-spec-input').forEach(inp => {
      if (inp.value === '') return;
      const v = Number(inp.value);
      if (!Number.isFinite(v) || v < 0) return;
      (specs[inp.dataset.key] = specs[inp.dataset.key] || {})[inp.dataset.field] = v;
    });
    return specs;
  }

  function specsMessage(text, ok) {
    const m = el('betaSpecsMessage');
    m.textContent = text;
    m.style.color = ok ? 'var(--success)' : 'var(--danger)';
  }

  // ---------- shared ----------
  function downloadCSV(name, head, rows) {
    const csv = [head, ...rows].map(r => r.map(csvField).join(',')).join('\n') + '\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-${toISODateLocal(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- wiring ----------
  el('betaToggle').addEventListener('change', e => setEnabled(e.target.checked));
  el('betaOnlyFlagged').addEventListener('change', renderQCReview);
  el('betaExportQC').addEventListener('click', exportQCReview);
  const qcOpen = e => {
    const row = e.target.closest('.beta-row');
    if (row) showQCDetail(Number(row.dataset.index));
  };
  el('betaQCReviewBody').addEventListener('click', qcOpen);
  el('betaQCReviewBody').addEventListener('keydown', e => { if (e.key === 'Enter') qcOpen(e); });
  ['betaLotMode', 'betaLotMinN', 'betaLotAFrom', 'betaLotATo', 'betaLotBFrom', 'betaLotBTo']
    .forEach(id => el(id).addEventListener('change', renderLotComparison));
  el('betaExportLot').addEventListener('click', exportLotComparison);

  el('btnSettings').addEventListener('click', () => { if (enabled) renderSpecsEditor(); });
  el('betaSpecsSave').addEventListener('click', () => {
    saveSpecs(collectSpecs());
    renderSpecsEditor();
    specsMessage('Saved in this browser.', true);
    if (resultsData.length) renderResultsTable();
  });
  el('betaSpecsExport').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(getSpecs(), null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `IQC-quality-specs-${toISODateLocal(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  el('betaSpecsImport').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a specs object');
      // Keep only known fields with non-negative numbers
      const clean = {};
      for (const [key, row] of Object.entries(parsed)) {
        if (!row || typeof row !== 'object') continue;
        for (const f of SPEC_FIELDS) {
          const v = Number(row[f.key]);
          if (row[f.key] !== '' && row[f.key] != null && Number.isFinite(v) && v >= 0) (clean[key] = clean[key] || {})[f.key] = v;
        }
      }
      saveSpecs(clean);
      renderSpecsEditor();
      specsMessage(`Imported ${Object.keys(clean).length} row(s).`, true);
      if (resultsData.length) renderResultsTable();
    } catch (err) {
      specsMessage('Could not import: ' + err.message, false);
    }
  });

  window.iqcBeta = {
    onAuth, cvLimits, onDataChanged, onDataLoaded, renderTab, isEnabled: () => enabled,
    toast, confirmDialog, removalReasonDialog, passwordDialog, ljMarkers, renderLJSplit,
  };
  // The page may have finished its auth check before this script loaded
  if (typeof currentUser !== 'undefined' && currentUser) onAuth();
})();
