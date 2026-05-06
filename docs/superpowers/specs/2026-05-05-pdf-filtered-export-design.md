# PDF Export — Filtered Report Option

**Date:** 2026-05-05
**Status:** Approved (pending review)

## Summary

Add a "filtered" option to the PDF export so users can choose between exporting the full dataset (current behaviour) or only the rows currently visible in the on-screen results table. Implemented via a modal dialog patterned after the existing Save Report dialog.

## Motivation

Today, clicking **Create Report (PDF)** always exports the full `resultsData` regardless of which filters the user has applied in the UI (`filterSearch`, `filterCV`, analyte multi-select, etc.). Users who want a PDF that matches what they're reviewing on screen have no way to produce one. The Save Report database flow already supports filtered/full saves; the PDF export should offer parity.

## Scope

### In scope

- New "Export PDF Report" modal triggered by the **Create Report (PDF)** button.
- Two scope options: `filtered` (default) and `all`.
- "Filtered" respects every filter that affects the on-screen results table:
  - Analyte multi-select (`selectedAnalytes`)
  - Search box (`filterSearch`)
  - CV% filter (`filterCV` — `high` / `warn`)
  - Protocol filter, date range, exclusions, and the exclude-eval toggle (these already shape `processedData` upstream, so no extra logic needed for them)
- Live preview count of analyte/level rows that will be included, updating when the user toggles between options.
- "Filters applied" annotation in the PDF when scope is `filtered`.
- Filename suffix `-filtered` when scope is `filtered`.
- Activity log detail includes the chosen scope.

### Out of scope

- XLSX and CSV exports — they keep their current behaviour. May be revisited later.
- Per-instrument or per-level filtering inside the PDF.
- Any change to the Save Report dialog or to the data processing pipeline.

## UI changes

### New modal: Export PDF Report

Inserted into [public/index.html](public/index.html) alongside the existing Save Report modal at [public/index.html:1387](public/index.html:1387). Same visual style (max-width 440px, radio cards, size-info box, Cancel + primary action footer).

Structure:

- **Header:** "Export PDF Report" + close button.
- **Radio group** (`name="exportScope"`):
  - `value="filtered"` (default, checked):
    - Title: "Current filtered view"
    - Description: "Includes only the analytes/rows currently visible in the results table (respects analyte selection, search, CV%, protocol, date range, and exclusions)"
  - `value="all"`:
    - Title: "Full dataset"
    - Description: "Includes all loaded data, ignoring current filters"
- **Preview line** (`#exportPdfPreview`) below the radios: e.g. `12 of 47 analyte/level rows will be included.` — recomputed on radio change and on modal open.
- **Footer:** Cancel button (`#exportModalCancel`) and Export PDF button (`#exportModalConfirm`).

### Trigger wiring

- `#btnReport` no longer calls `exportPDF()` directly. It calls a new `openExportPdfModal()` that:
  1. Computes `filteredCount` (length of the visible results set) and `totalCount` (`resultsData.length`).
  2. Updates the preview text.
  3. Opens the modal.
- The modal's confirm button reads the selected radio and calls `exportPDF(scope)`.
- Cancel and close buttons hide the modal without exporting.

## Behaviour changes to `exportPDF()`

Current signature: `exportPDF()` (no arguments).
New signature: `exportPDF(scope)` where `scope` is `'filtered'` or `'all'`.

### Helper: `getVisibleResults()`

Extract the in-place filter logic currently in `renderResultsTable()` at [public/index.html:2348](public/index.html:2348)–[public/index.html:2355](public/index.html:2355) into a reusable helper:

```js
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

`renderResultsTable()` is updated to call this helper so the two sites can't drift.

### `exportPDF(scope)` flow

1. **Determine result set:**
   - `scope === 'filtered'`: `results = getVisibleResults()`.
   - `scope === 'all'`: `results = resultsData`.
2. **Determine processed-data subset for summary stats:**
   - `scope === 'filtered'`: build `Set` of parameter names from `results`, then `processedSubset = processedData.filter(r => visibleParams.has(r.parameter))`.
   - `scope === 'all'`: `processedSubset = processedData`.
3. **Summary boxes:**
   - Total Records: `rawData.length` (unchanged — reflects what was uploaded, not what was filtered).
   - "X after filtering" subtext: `processedSubset.length`.
   - Parameters: `new Set(processedSubset.map(r => r.parameter)).size`.
   - "X analyte/level combos" subtext: `results.length`.
   - Rejected: `rawData.filter(r => r.status === 'Manually rejected').length` (unchanged).
   - Date Range: derived from `processedSubset` (so a filtered date range narrows the box).
4. **Filters-applied annotation (filtered scope only):** Below the summary boxes, before "Active Exclusions", render a single line summarising any active table-level filters. Skip the line when no such filters are active. Format example: `Filters applied: Search: "ca" • CV% > 10 • Analytes: 4 selected`. The protocol/date/exclusion filters are already represented in the existing summary boxes and "Active Exclusions" line, so they don't need duplicating here.
5. **Results table body:** built from `results` instead of `resultsData`.
6. **Filename:** `QCAudit-Report-${YYYY-MM-DD}${scope === 'filtered' ? '-filtered' : ''}.pdf`.
7. **Activity log:** `logUserActivity('export_pdf', `${results.length} analyte groups (${scope})`)`.

### Edge cases

- **Filtered set is empty:** PDF is still generated. Results table renders with zero body rows. Acceptable — matches the on-screen state.
- **No filters active and user picks "Filtered":** `getVisibleResults()` returns the full `resultsData`. PDF is identical to the "all" PDF except for the filename suffix. Acceptable — no special-casing needed.
- **`resultsData` empty (no data processed):** `#btnReport` is already disabled in this state, so the modal cannot open.

## Testing

Manual verification in browser:

1. Load a dataset, apply a search filter (`Glucose`), open Export PDF modal.
   - Preview shows `1 of N rows will be included` (or similar).
   - Filtered PDF table contains only Glucose rows, filename ends `-filtered.pdf`, "Filters applied" line shows the search term.
2. Same dataset, switch to "Full dataset" in the modal.
   - Preview updates to show `N of N rows`.
   - PDF contains all rows, no `-filtered` suffix, no "Filters applied" line.
3. Apply analyte multi-select + CV% filter together, export filtered.
   - PDF reflects intersection. "Filters applied" line lists both.
4. Cancel button closes the modal without generating a PDF.
5. Export with no data loaded — verify the button is disabled (no regression).

No automated tests are added in this change; the existing test suite does not exercise `exportPDF()`. If a PDF test rig is introduced later, the helper `getVisibleResults()` is the natural unit to test.

## Files affected

- [public/index.html](public/index.html) — only file touched. Changes:
  - New modal markup near the Save Report modal.
  - New `getVisibleResults()` helper.
  - Refactor `renderResultsTable()` to use the helper.
  - Modified `exportPDF()` to accept a scope argument.
  - New `openExportPdfModal()` and modal event handlers.
  - `#btnReport` click handler retargeted to `openExportPdfModal`.
