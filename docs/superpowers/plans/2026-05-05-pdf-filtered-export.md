# PDF Filtered Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a modal dialog to the PDF export flow letting users choose between exporting the currently filtered view or the full dataset.

**Architecture:** All changes live in [public/index.html](public/index.html). A new `getVisibleResults()` helper centralises the table-level filter logic so `renderResultsTable()` and `exportPDF()` share it. A new modal mirrors the visual style and event-wiring pattern of the existing Save Report modal. `exportPDF()` becomes scope-aware and the **Create Report (PDF)** button opens the modal instead of exporting directly.

**Tech Stack:** Vanilla JS, jsPDF + jspdf-autotable. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-05-pdf-filtered-export-design.md](docs/superpowers/specs/2026-05-05-pdf-filtered-export-design.md)

**Notes for the implementer:**
- This codebase has no automated tests for `exportPDF()` or DOM interactions, so verification is manual via `npm run dev` (or `vercel dev`) and a browser. Each task ends with a manual check.
- Existing `tests/frontend.test.js` covers data-processing helpers only — do not add Jest tests for the modal or PDF rendering.
- Commit after every task to keep the change reviewable.

---

### Task 1: Extract `getVisibleResults()` helper

**Files:**
- Modify: `public/index.html` around line 2347 (`renderResultsTable`)

**Why:** The filter logic in `renderResultsTable()` will be reused by `exportPDF()`. Extracting it first keeps the two callers in sync and makes Task 3 a one-liner.

- [ ] **Step 1: Add the helper function above `renderResultsTable()`**

In [public/index.html](public/index.html), insert the following function immediately before `function renderResultsTable() {` at line 2347:

```js
// Returns resultsData with the on-screen table filters applied
// (analyte multi-select, parameter search, CV% filter). Reads filter
// state directly from the DOM so it stays in sync with what the user sees.
function getVisibleResults() {
  const search = document.getElementById('filterSearch').value.toLowerCase();
  const cvFilter = document.getElementById('filterCV').value;
  let data = resultsData;
  if (selectedAnalytes.size > 0) data = data.filter(r => selectedAnalytes.has(r.parameter));
  if (search) data = data.filter(r => r.parameter.toLowerCase().includes(search));
  if (cvFilter === 'high') data = data.filter(r => r.combined.cv > 10);
  if (cvFilter === 'warn') data = data.filter(r => r.combined.cv > 5);
  return data;
}
```

- [ ] **Step 2: Replace the inline filter block in `renderResultsTable()`**

Find these lines in `renderResultsTable()` (currently [public/index.html:2348](public/index.html:2348)–[public/index.html:2355](public/index.html:2355)):

```js
  const search = document.getElementById('filterSearch').value.toLowerCase();
  const cvFilter = document.getElementById('filterCV').value;

  let data = resultsData;
  if (selectedAnalytes.size > 0) data = data.filter(r => selectedAnalytes.has(r.parameter));
  if (search) data = data.filter(r => r.parameter.toLowerCase().includes(search));
  if (cvFilter === 'high') data = data.filter(r => r.combined.cv > 10);
  if (cvFilter === 'warn') data = data.filter(r => r.combined.cv > 5);
```

Replace with:

```js
  const data = getVisibleResults();
```

- [ ] **Step 3: Manual verification**

Start the dev server (`vercel dev` or open `public/index.html` directly in a browser if you're not testing API features). Load a CSV. Then:

1. Type a search term in the analyte search box — confirm the table filters to matching rows (no regression).
2. Toggle the CV% filter to "High (>10%)" — confirm only high-CV rows remain.
3. Select a subset of analytes from the multi-select — confirm only those rows remain.
4. Clear all filters — confirm the full table returns.

If any of these break, the helper isn't being called correctly — re-check Step 2.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "Extract getVisibleResults() helper from renderResultsTable"
```

---

### Task 2: Add the Export PDF modal markup

**Files:**
- Modify: `public/index.html` around line 1419 (immediately after the closing `</div>` of the Save Report modal)

**Why:** The modal HTML must exist before any JavaScript references it. Doing this as a standalone task keeps the diff small and visually inspectable.

- [ ] **Step 1: Insert the modal HTML**

Locate the end of the Save Report modal — the line `</div>` at [public/index.html:1419](public/index.html:1419) that closes `<div class="modal-overlay" id="saveModalOverlay">`. Insert the following block on the next line, before the `<!-- AI Insights Modal -->` comment:

```html
<!-- Export PDF Dialog -->
<div class="modal-overlay" id="exportPdfModalOverlay">
  <div class="modal" style="max-width:440px">
    <div class="modal-header">
      <h3>Export PDF Report</h3>
      <button class="modal-close" id="exportPdfModalClose">&#10005;</button>
    </div>
    <div class="modal-body" style="padding:20px">
      <div style="margin-bottom:6px;font-size:13px;color:var(--text-dim)">What to export</div>
      <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;cursor:pointer;margin-bottom:8px;font-size:13px">
        <input type="radio" name="exportScope" value="filtered" checked style="accent-color:var(--accent)">
        <div>
          <div style="font-weight:600;color:var(--text)">Current filtered view</div>
          <div style="color:var(--text-dim);font-size:12px;margin-top:2px">Includes only the analytes/rows currently visible in the results table (respects analyte selection, search, CV%, protocol, date range, and exclusions)</div>
        </div>
      </label>
      <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:13px">
        <input type="radio" name="exportScope" value="all" style="accent-color:var(--accent)">
        <div>
          <div style="font-weight:600;color:var(--text)">Full dataset</div>
          <div style="color:var(--text-dim);font-size:12px;margin-top:2px">Includes all loaded data, ignoring current filters</div>
        </div>
      </label>
      <div id="exportPdfPreview" style="margin-top:12px;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--text-dim);line-height:1.6"></div>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="btn" id="exportPdfModalCancel" style="flex:1">Cancel</button>
        <button class="btn btn-primary" id="exportPdfModalConfirm" style="flex:2">Export PDF</button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Manual verification**

Open the page in a browser. The modal should NOT be visible (no `active` class). To confirm the markup is correct, open DevTools console and run:

```js
document.getElementById('exportPdfModalOverlay').classList.add('active');
```

The modal should appear, styled identically to the Save Report modal. Then run:

```js
document.getElementById('exportPdfModalOverlay').classList.remove('active');
```

It should disappear.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "Add Export PDF modal markup"
```

---

### Task 3: Make `exportPDF()` scope-aware

**Files:**
- Modify: `public/index.html` around lines 2750–2878 (`exportPDF` function)

**Why:** This is the behavioural core. The function now accepts a scope, computes filtered/all data sets, draws a "Filters applied" line when scope is filtered, and adjusts the filename and activity-log detail.

- [ ] **Step 1: Replace the entire `exportPDF` function**

Find the existing `function exportPDF() {` at [public/index.html:2750](public/index.html:2750) and replace the whole function (down to its closing `}` at line 2878) with:

```js
function exportPDF(scope = 'all') {
  // Determine which results and processed-data subset to render
  const results = scope === 'filtered' ? getVisibleResults() : resultsData;
  let processedSubset;
  if (scope === 'filtered') {
    const visibleParams = new Set(results.map(r => r.parameter));
    processedSubset = processedData.filter(r => visibleParams.has(r.parameter));
  } else {
    processedSubset = processedData;
  }

  // Build a human-readable summary of active table-level filters (filtered scope only)
  const activeFilterParts = [];
  if (scope === 'filtered') {
    const search = document.getElementById('filterSearch').value.trim();
    const cvFilter = document.getElementById('filterCV').value;
    if (selectedAnalytes.size > 0) activeFilterParts.push(`Analytes: ${selectedAnalytes.size} selected`);
    if (search) activeFilterParts.push(`Search: "${search}"`);
    if (cvFilter === 'high') activeFilterParts.push('CV% > 10');
    if (cvFilter === 'warn') activeFilterParts.push('CV% > 5');
  }

  logUserActivity('export_pdf', `${results.length} analyte groups (${scope})`);
  try {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const instruments = ['AU/DxI-1', 'AU/DxI-2', 'AU/DxI-3', 'AU/DxI-4'];
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // --- Page 1: Title + Summary Stats ---
  doc.setFillColor(30, 41, 59);
  doc.rect(0, 0, pageW, 35, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('QC Audit Report', 14, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${today}`, 14, 28);

  const parameterCount = new Set(processedSubset.map(r => r.parameter)).size;
  const rejectedCount = rawData.filter(r => r.status === 'Manually rejected').length;
  const datedRows = processedSubset.map(r => ({ str: r.date, t: parseDate(r.date).getTime() })).filter(d => d.t > 0);
  const minDate = datedRows.length ? formatDate(datedRows.reduce((m, d) => d.t < m.t ? d : m).str) : 'N/A';
  const maxDate = datedRows.length ? formatDate(datedRows.reduce((m, d) => d.t > m.t ? d : m).str) : 'N/A';

  // Summary boxes
  doc.setTextColor(0, 0, 0);
  const boxY = 45;
  const boxW = 60;
  const boxGap = 8;
  const summaryData = [
    { label: 'Total Records', value: rawData.length.toLocaleString(), sub: `${processedSubset.length} after filtering` },
    { label: 'Parameters', value: parameterCount.toString(), sub: `${results.length} analyte/level combos` },
    { label: 'Rejected', value: rejectedCount.toString(), sub: 'manually rejected' },
    { label: 'Date Range', value: minDate, sub: `to ${maxDate}` },
  ];

  summaryData.forEach((s, i) => {
    const x = 14 + i * (boxW + boxGap);
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(x, boxY, boxW, 28, 2, 2, 'F');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(s.label.toUpperCase(), x + 4, boxY + 7);
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.text(s.value, x + 4, boxY + 18);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(s.sub, x + 4, boxY + 24);
  });

  // Filters-applied line (filtered scope only, when there is something to show).
  // Sits between the summary boxes and the existing exclusions line; downstream
  // content shifts down by extraTopY when the filters line is drawn.
  let extraTopY = 0;
  if (activeFilterParts.length > 0) {
    doc.setFontSize(9);
    doc.setTextColor(59, 130, 246);
    doc.text('Filters applied: ' + activeFilterParts.join('  •  '), 14, boxY + 36);
    extraTopY = 6;
  }

  // Exclusions note (unchanged behaviour: same vertical slot as before, shifted only
  // when a filters line precedes it)
  if (exclusions.length > 0) {
    doc.setFontSize(9);
    doc.setTextColor(239, 68, 68);
    doc.text('Active Exclusions: ' + exclusions.map(e => `${e.analyte}/${e.instrument}`).join(', '), 14, boxY + 38 + extraTopY);
  }

  // --- Results Table ---
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('Results Summary', 14, boxY + 48 + extraTopY);

  const tableHead = [
    [
      { content: 'Analyte', rowSpan: 2 },
      { content: 'Lvl', rowSpan: 2 },
      { content: 'AU/DxI-1', colSpan: 4, styles: { halign: 'center', fillColor: [59, 130, 246] } },
      { content: 'AU/DxI-2', colSpan: 4, styles: { halign: 'center', fillColor: [139, 92, 246] } },
      { content: 'AU/DxI-3', colSpan: 4, styles: { halign: 'center', fillColor: [6, 182, 212] } },
      { content: 'AU/DxI-4', colSpan: 4, styles: { halign: 'center', fillColor: [245, 158, 11] } },
      { content: 'Combined', colSpan: 4, styles: { halign: 'center', fillColor: [34, 197, 94] } },
    ],
    ['Mean','SD','CV%','n','Mean','SD','CV%','n','Mean','SD','CV%','n','Mean','SD','CV%','n','Mean','SD','CV%','n']
  ];

  const tableBody = results.map(row => {
    const r = [row.parameter, row.level];
    const dp = /^(ca|mg|po4|calcium|magnesium|phosphate)$/i.test(row.parameter) ? 3 : 2;
    for (const inst of instruments) {
      const s = row[inst];
      if (s && s.count > 0) {
        r.push(s.mean.toFixed(dp), s.sd.toFixed(dp), s.cv.toFixed(2), s.count);
      } else {
        r.push('-', '-', '-', '-');
      }
    }
    const c = row.combined;
    if (c && c.count > 0) {
      r.push(c.mean.toFixed(dp), c.sd.toFixed(dp), c.cv.toFixed(2), c.count);
    } else {
      r.push('-', '-', '-', '-');
    }
    return r;
  });

  doc.autoTable({
    head: tableHead,
    body: tableBody,
    startY: boxY + 52 + extraTopY,
    theme: 'grid',
    styles: { fontSize: 5.5, cellPadding: 1.2, halign: 'center', lineColor: [200, 200, 200], lineWidth: 0.1 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 5.5, fontStyle: 'bold' },
    columnStyles: { 0: { halign: 'left', cellWidth: 18 }, 1: { cellWidth: 7 } },
    alternateRowStyles: { fillColor: [240, 245, 255] },
    margin: { left: 6, right: 6 },
    didDrawPage: function(data) {
      // Footer on each page
      doc.setFontSize(7);
      doc.setTextColor(150);
      doc.text(`QC Audit Report - ${today}`, 14, pageH - 5);
      doc.text(`Page ${doc.internal.getNumberOfPages()}`, pageW - 25, pageH - 5);
    }
  });


  const dateStr = new Date().toISOString().split('T')[0];
  const suffix = scope === 'filtered' ? '-filtered' : '';
  doc.save(`QCAudit-Report-${dateStr}${suffix}.pdf`);
  } catch(err) {
    console.error('PDF export error:', err);
    alert('Error generating PDF: ' + err.message);
  }
}
```

Key things this rewrite changes (review against the original to confirm nothing else moved):

- New `scope` parameter, defaulting to `'all'` so any future caller without an argument behaves like the old function.
- `processedData` references in the summary stat block become `processedSubset`.
- New `activeFilterParts` block computed up front.
- New "Filters applied" line drawn between the summary boxes and "Active Exclusions". `extraTopY` is set to `6` only when this line is drawn, then reused as a single offset for the exclusions line, the "Results Summary" heading, and the table `startY`. The original layout (no filters line, with or without exclusions) is byte-for-byte unchanged.
- "Results Summary" heading and `autoTable.startY` use the same `extraTopY` offset.
- `doc.save(...)` filename gets the `-filtered` suffix.
- `logUserActivity` detail string includes the scope.

- [ ] **Step 2: Quick smoke test from the console**

The modal isn't wired up yet (Task 4), but you can verify the function works by calling it directly. Load the app, import a CSV, then in DevTools console:

```js
exportPDF('all');
```

A PDF should download with the original layout. Then:

```js
exportPDF('filtered');
```

Without filters set this should produce essentially the same content, but the filename should now end `-filtered.pdf`.

Now apply some filters via the UI (search, CV%, analytes), and run `exportPDF('filtered')` again — the PDF should contain only the filtered rows, summary boxes should reflect the filtered counts, and a blue "Filters applied: …" line should appear above any exclusions note.

If the layout looks broken (e.g. table overlapping the filters line), check that `extraTopY` is being added consistently to all three later positions (`boxY + 38 + extraTopY` for exclusions, `boxY + 48 + extraTopY` for the heading, `boxY + 52 + extraTopY` for `startY`).

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "Make exportPDF scope-aware with filtered/all options"
```

---

### Task 4: Wire up the modal trigger and event handlers

**Files:**
- Modify: `public/index.html` around line 3633 (`btnReport` click handler) and the save-modal handler block around line 3669

**Why:** Final step — replace the direct `exportPDF` call on the report button with one that opens the modal, and add the modal's own event handlers (open/close/confirm) following the same pattern as the Save Report modal.

- [ ] **Step 1: Retarget the `btnReport` click handler**

Find this line at [public/index.html:3633](public/index.html:3633):

```js
document.getElementById('btnReport').addEventListener('click', exportPDF);
```

Replace it with:

```js
document.getElementById('btnReport').addEventListener('click', openExportPdfModal);
```

- [ ] **Step 2: Add the modal helper and event handlers**

Insert the following block immediately after the existing Save Report modal handler block (after the `saveModalConfirm` click handler that ends around [public/index.html:3759](public/index.html:3759) — find the `});` that closes the `async () => { ... }` save handler, then add a new section). For predictability, put this directly above the `// =============================================` comment that precedes the next major section, or at the end of the SAVE / LOAD REPORTS block:

```js
// =============================================
// EXPORT PDF — dialog
// =============================================
const exportPdfModalOverlay = document.getElementById('exportPdfModalOverlay');

function updateExportPdfPreview() {
  const scope = document.querySelector('input[name="exportScope"]:checked').value;
  const total = resultsData.length;
  const visible = scope === 'filtered' ? getVisibleResults().length : total;
  const preview = document.getElementById('exportPdfPreview');
  if (scope === 'filtered') {
    preview.textContent = `${visible.toLocaleString()} of ${total.toLocaleString()} analyte/level rows will be included.`;
  } else {
    preview.textContent = `All ${total.toLocaleString()} analyte/level rows will be included.`;
  }
}

function openExportPdfModal() {
  // Default to filtered each time the modal opens (mirrors Save Report behaviour)
  document.querySelector('input[name="exportScope"][value="filtered"]').checked = true;
  updateExportPdfPreview();
  exportPdfModalOverlay.classList.add('active');
}

document.querySelectorAll('input[name="exportScope"]').forEach(r =>
  r.addEventListener('change', updateExportPdfPreview)
);
document.getElementById('exportPdfModalClose').addEventListener('click', () => exportPdfModalOverlay.classList.remove('active'));
document.getElementById('exportPdfModalCancel').addEventListener('click', () => exportPdfModalOverlay.classList.remove('active'));
exportPdfModalOverlay.addEventListener('click', e => { if (e.target === exportPdfModalOverlay) exportPdfModalOverlay.classList.remove('active'); });

document.getElementById('exportPdfModalConfirm').addEventListener('click', () => {
  const scope = document.querySelector('input[name="exportScope"]:checked').value;
  exportPdfModalOverlay.classList.remove('active');
  exportPDF(scope);
});
```

- [ ] **Step 3: Manual verification — golden path**

Reload the app. Import a CSV. Apply at least one filter (e.g. search "Glucose"). Click **Create Report (PDF)**.

Expected:
1. The Export PDF modal appears.
2. "Current filtered view" is selected by default.
3. The preview line reads something like `5 of 47 analyte/level rows will be included.` (numbers will vary).
4. Toggling to "Full dataset" updates the preview to `All 47 analyte/level rows will be included.`
5. Click **Export PDF** with "filtered" selected → a PDF named `QCAudit-Report-YYYY-MM-DD-filtered.pdf` downloads, with only Glucose rows in the table and a blue "Filters applied: Search: \"Glucose\"" line above the results table.
6. Click **Create Report (PDF)** again, switch to "Full dataset", click **Export PDF** → a PDF named `QCAudit-Report-YYYY-MM-DD.pdf` (no `-filtered`) downloads, containing all rows, with no "Filters applied" line.

- [ ] **Step 4: Manual verification — edge cases**

1. **Cancel:** Click **Create Report (PDF)**, then **Cancel**. Modal closes, no PDF downloads.
2. **Backdrop click:** Click **Create Report (PDF)**, click outside the modal box (on the dim overlay). Modal closes, no PDF downloads.
3. **Close button (✕):** Same — modal closes, no PDF.
4. **No filters active:** Clear all filters. Open modal — preview should read identical numbers for "filtered" and "full". Both export options should produce the same content; the only difference is the `-filtered` filename suffix on the filtered export.
5. **Empty filtered set:** Set a search term that matches nothing (e.g. `zzzzz`). Open modal — preview reads `0 of N rows will be included.` Confirm export still produces a PDF (with an empty results table and the search term in the "Filters applied" line).
6. **Combined filters:** Apply search + analyte selection + CV% filter together. Filtered PDF reflects the intersection; the "Filters applied" line lists all three (e.g. `Filters applied: Analytes: 4 selected • Search: "ca" • CV% > 10`).
7. **Activity log:** As an admin, open Settings → Activity Log. The most recent `Exported PDF` entry should show e.g. `5 analyte groups (filtered)` or `47 analyte groups (all)`.
8. **Disabled state:** Reset all data (Reset button). Confirm `#btnReport` is disabled and clicking it does nothing — the modal must not open with no data loaded.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "Wire up Export PDF modal and trigger from Create Report button"
```

---

### Task 5: Final regression sweep

**Files:** None (verification only)

**Why:** This change touches a hot path that admins use for audit reporting. A short structured sweep catches anything the per-task checks missed.

- [ ] **Step 1: Run the existing test suite**

```bash
npm test
```

Expected: all tests pass. None of them exercise `exportPDF` or the modal, so a failure here would mean an accidental syntax error or unrelated regression. If anything fails, investigate before continuing.

- [ ] **Step 2: Existing-feature smoke test**

Reload the app fresh. Import a CSV and quickly verify:

1. Results table renders correctly.
2. Save Report modal still works (open, toggle filtered/all, save with a fake name — cancel before confirming if you don't want to actually save).
3. XLSX export still works (downloads file).
4. CSV export still works (downloads file).
5. Levey-Jennings charts still render.
6. Reset button clears state and re-disables the report button.

These have no logic dependency on our changes, but a stray syntax error or duplicated `id` attribute could break them — quick visual check is cheap insurance.

- [ ] **Step 3: Cross-browser check (optional but recommended)**

Open the same flow in a second browser (Chrome + Firefox, or Chrome + Edge). PDF generation, modal styling, and `accent-color` CSS should all behave identically. If you only have one browser available, skip this.

- [ ] **Step 4: No commit needed**

If everything passes, the work is complete. If something fails, fix it in a focused commit referencing the specific issue.

---

## Summary of files changed

- [public/index.html](public/index.html) — only file modified across all tasks. Five logical changes:
  1. New `getVisibleResults()` helper.
  2. `renderResultsTable()` uses the helper.
  3. New Export PDF modal markup.
  4. `exportPDF()` becomes scope-aware.
  5. New modal event handlers; `#btnReport` opens the modal.

No new dependencies. No schema or API changes. No automated tests added (existing suite still passes).
