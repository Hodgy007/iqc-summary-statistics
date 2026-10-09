// Beta features, shown only when an admin switches on "Try beta" in the header.
// With the switch off the app behaves exactly as the standard version.
// Uses the page's globals (processedData, getVisibleResults, parseDate, ...)
// and the calculations in beta-logic.js.
(function () {
  'use strict';
  const L = window.iqcBetaLogic;
  const ENABLED_KEY = 'iqcBetaEnabled';
  const SPECS_KEY = 'iqcBetaSpecs';
  const SPEC_FIELDS = [
    { key: 'teaPct', label: 'TEa %' },
    { key: 'cvWarnPct', label: 'CV warn %' },
    { key: 'cvHighPct', label: 'CV high %' },
    { key: 'lotShiftPct', label: 'Lot shift %' },
  ];

  let enabled = false;
  let specsCache = null;
  let lastReviews = [];
  let lastLotRows = [];

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
      try { specsCache = JSON.parse(storageGet(SPECS_KEY)) || {}; } catch { specsCache = {}; }
    }
    return specsCache;
  }
  function saveSpecs(specs) {
    specsCache = specs;
    storageSet(SPECS_KEY, JSON.stringify(specs));
  }

  const isAdmin = () => typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin';
  const el = id => document.getElementById(id);
  const fmt = (v, dp) => (v === null || v === undefined || !Number.isFinite(v)) ? '-' : v.toFixed(dp);
  const signed = (v, dp) => (v === null || !Number.isFinite(v)) ? '-' : (v > 0 ? '+' : '') + v.toFixed(dp);
  const timeOf = r => parseDate(r.date).getTime();

  // ---------- toggle ----------
  function onAuth() {
    el('betaToggleWrap').style.display = isAdmin() ? '' : 'none';
    setEnabled(isAdmin() && storageGet(ENABLED_KEY) === '1', false);
  }

  function setEnabled(on, persist = true) {
    enabled = on;
    if (persist) storageSet(ENABLED_KEY, on ? '1' : null);
    el('betaToggle').checked = on;
    document.body.classList.toggle('beta-on', on);
    const active = document.querySelector('.tab.active');
    if (!on && active && active.classList.contains('beta-only')) {
      document.querySelector('.tab[data-tab="results"]').click();
    }
    // CV colours in the results table follow the per-analyte limits while beta is on
    if (resultsData.length) renderResultsTable();
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

  function onDataChanged() {
    if (!enabled) return;
    if (!el('tab-qcreview').classList.contains('hidden')) renderQCReview();
    if (!el('tab-lotcompare').classList.contains('hidden')) renderLotComparison();
  }

  function renderTab(name) {
    if (name === 'qcreview') renderQCReview();
    if (name === 'lotcompare') renderLotComparison();
  }

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

    const specs = getSpecs();
    const all = L.groupSeries(visibleRows(), timeOf).map(s => L.reviewSeries(s, specs));
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
      html += `<tr class="beta-row${r.rejections ? ' beta-clickable' : ''}" data-index="${i}">
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
    if (!r || !r.rejections) { detail.innerHTML = ''; return; }
    const dp = decimalsFor(r.parameter);
    const rejections = r.violations.filter(v => L.REJECTION_RULES.includes(v.rule));
    detail.innerHTML = `
      <div class="beta-detail-head">
        <b>${escapeHtml(r.parameter)} level ${escapeHtml(r.level)} · ${escapeHtml(r.instrument)}</b>
        <span class="beta-dim">${rejections.length} rule violation(s), shown at the result that completes each rule</span>
      </div>
      <table class="beta-table"><thead><tr>
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
      </tbody></table>`;
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
  el('betaQCReviewBody').addEventListener('click', e => {
    const row = e.target.closest('.beta-row');
    if (row) showQCDetail(Number(row.dataset.index));
  });
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

  window.iqcBeta = { onAuth, cvLimits, onDataChanged, renderTab, isEnabled: () => enabled };
  // The page may have finished its auth check before this script loaded
  if (typeof currentUser !== 'undefined' && currentUser) onAuth();
})();
