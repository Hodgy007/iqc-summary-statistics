// Extracted frontend logic for testing (mirrors public/index.html functions)

const INSTRUMENTS_MAP = {
  'AU5800 1 L': 'AU/DxI-1',
  'AU5800 2 L': 'AU/DxI-2',
  'AU3 680 M': 'AU/DxI-3',
  'AU4 680 M': 'AU/DxI-4',
  'DXI 1 L': 'AU/DxI-1',
  'DXI 2 L': 'AU/DxI-2',
  'DXI 3 M': 'AU/DxI-3',
  'DXI 4 M': 'AU/DxI-4',
};

const EXCLUDED_PROTOCOLS = new Set([
  'AU 5800 1 L Patient Means', 'AU 5800 2 L Patient Means',
  'AU3 680 M Patient Means', 'AU4 680 M Patient Means',
  'DxH L1 MCHFT Moving Average', 'DxH L2 MCHFT Moving Average',
  'DxH L3 MCHFT Moving Average', 'DxH1 ECHT Moving Average',
  'DxH2 ECHT Moving Average', 'DXI 1 L Patient Means',
  'DXI 2 L Patient Means', 'DXI 3 M Patient Means',
  'DXI 4 M Patient Means', 'DXI 1 L NEW LAC', 'DXI 2 L NEW LAC',
  'DXI 3 M NEW LAC', 'DXI 4 M NEW LAC', 'ACCURUN1', 'ACCURUN25',
  'ACCURUN52', 'HAVIgMqc', 'HBcAbQC', 'HBsAbQC', 'HBsAgQC',
  'HCVABV3QC', 'HIVCoQC', 'QBLUE', 'QBLUE-SYPH', 'QHEPA',
  'QHIV2', 'QHIVp24', 'RUBELLAIgGQC', 'SYPHQC', 'I_HCG',
  'H_MCH', 'H_MCHC', 'H_MCV', 'H_WBC',
]);

const LEVEL_OVERRIDE_PROTOCOLS = new Set([
  'LAC DXI 1 L', 'LAC DXI 2 L', 'LAC DXI 3 L', 'LAC DXI 4 L',
  'DXI 1 hsTnI', 'DXI 2 hsTnI', 'DXI 3 hsTnT', 'DXI 4 hsTnI',
  'AU3 680 M HBQC', 'AU4 680 M HBQC', 'AU 5800 1 L HBQC', 'AU 5800 2 L HBQC',
  'AU5800 1 L P', 'AU 5800 2 L P', 'AU3 680 M P', 'AU4 680 M P',
  'LAC DXI 4 M', 'LAC DXI 3 M',
]);

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const fields = lines[i].split(';').map(f => f.trim());
    if (i === 0 && fields[0].toLowerCase().includes('protocol')) continue;
    if (fields.length < 9) continue;
    const val = parseFloat(fields[5]);
    if (isNaN(val)) continue;
    rows.push({
      protocol: fields[0] || '',
      instrument: fields[1] || '',
      parameter: (fields[2] || '').replace(/^[CI]_/, ''),
      level: fields[3] || '',
      date: fields[4] || '',
      value: val,
      target: parseFloat(fields[6]) || 0,
      sd: parseFloat(fields[7]) || 0,
      status: fields[8] || '',
      message: fields[9] || '',
      comment: fields[10] || '',
      user: fields[11] || '',
      sampleId: fields[12] || '',
    });
  }
  return rows;
}

const KNOWN_INSTRUMENTS = new Set(['AU/DxI-1', 'AU/DxI-2', 'AU/DxI-3', 'AU/DxI-4']);

function applyLevelOverrides(data) {
  return data.map(row => {
    const protocol = row.protocol.trim();
    if (
      LEVEL_OVERRIDE_PROTOCOLS.has(protocol) ||
      protocol.toLowerCase().includes('hstni') ||
      (row.sampleId && row.sampleId.includes('TPP')) ||
      (row.sampleId && row.sampleId.includes('HBQC'))
    ) {
      return { ...row, level: '4' };
    }
    return row;
  });
}

function isProtocolExcluded(protocol, excludeEval) {
  if (EXCLUDED_PROTOCOLS.has(protocol)) return true;
  if (excludeEval && /\beval/i.test(protocol)) return true;
  return false;
}

function mapToKnownInstruments(rows) {
  return rows
    .map(row => ({ ...row, instrument: INSTRUMENTS_MAP[row.instrument] || row.instrument }))
    .filter(r => KNOWN_INSTRUMENTS.has(r.instrument));
}

// Level overrides + protocol exclusions + instrument mapping, with run status left
// untouched, so callers can still count rejected rows.
function buildScopedData(data, excludeEval) {
  return mapToKnownInstruments(
    applyLevelOverrides(data).filter(row => !isProtocolExcluded(row.protocol, excludeEval))
  );
}

// An empty selection means "all protocols", matching the analyte multi-select.
function filterByProtocols(rows, selected) {
  if (!selected || selected.size === 0) return rows;
  return rows.filter(r => selected.has(r.protocol));
}

function processData(data) {
  return buildScopedData(data, true)
    .filter(r => r.status !== 'Manually rejected' && r.status !== 'Rerun requested');
}

function computeStats(values) {
  if (!values.length) return { mean: 0, sd: 0, cv: 0, count: 0 };
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const sd = n > 1 ? Math.sqrt(variance) : 0;
  const cv = mean !== 0 ? (sd / mean) * 100 : 0;
  return { mean, sd, cv: Math.abs(cv), count: n };
}

function buildResults(data) {
  const groups = {};
  for (const row of data) {
    const key = `${row.parameter}|${row.level}`;
    if (!groups[key]) groups[key] = {};
    if (!groups[key][row.instrument]) groups[key][row.instrument] = [];
    groups[key][row.instrument].push(row.value);
  }

  const instruments = ['AU/DxI-1', 'AU/DxI-2', 'AU/DxI-3', 'AU/DxI-4'];
  const results = [];

  for (const [key, instData] of Object.entries(groups)) {
    const [param, level] = key.split('|');
    const row = { parameter: param, level };

    for (const inst of instruments) {
      const values = instData[inst] || [];
      row[inst] = computeStats(values);
    }

    const allValues = instruments.flatMap(inst => instData[inst] || []);
    row.combined = computeStats(allValues);

    results.push(row);
  }

  results.sort((a, b) => {
    const cmp = a.parameter.localeCompare(b.parameter);
    return cmp !== 0 ? cmp : parseInt(a.level) - parseInt(b.level);
  });

  return results;
}

// Returns [year, month0, day] from a date string part, auto-detecting DD-MM-YYYY vs MM/DD/YYYY.
// Detection: if first segment > 12 → DD-MM-YYYY; if second segment > 12 → MM/DD/YYYY;
// otherwise fall back to separator (dash = UK DD-MM-YYYY, slash = US MM/DD/YYYY).
function parseDateParts(datePart) {
  const sep = datePart.includes('/') ? '/' : '-';
  const p = datePart.split(sep);
  if (p.length !== 3) return null;
  const a = parseInt(p[0], 10), b = parseInt(p[1], 10), c = parseInt(p[2], 10);
  if (p[0].length === 4) return [a, b - 1, c]; // ISO YYYY-MM-DD
  if (a > 12) return [c, b - 1, a];          // DD-MM-YYYY
  if (b > 12) return [c, a - 1, b];          // MM/DD/YYYY
  return sep === '-' ? [c, b - 1, a] : [c, a - 1, b]; // ambiguous: use separator
}

function parseDate(dateStr) {
  if (!dateStr) return new Date(0);
  const parts = parseDateParts(dateStr.split(' ')[0]);
  if (parts) return new Date(...parts);
  return new Date(dateStr);
}

// Local calendar date as yyyy-mm-dd. toISOString() converts to UTC first, which
// moves a local-midnight date back a day during BST.
function toISODateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parse yyyy-mm-dd as local midnight. new Date('yyyy-mm-dd') is UTC midnight,
// which is 01:00 during BST and would drop rows from the first hour of the day.
function parseISODateLocal(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Earliest and latest of an array of Dates, or null when none are valid.
// A loop rather than Math.min(...arr): spreading 100k+ values overflows the stack.
function dateExtent(dates) {
  let min = Infinity, max = -Infinity;
  for (const d of dates) {
    const t = d.getTime();
    if (!(t > 0)) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return min === Infinity ? null : { min: new Date(min), max: new Date(max) };
}

// Highest CV% across the individual instruments and the combined column, so the
// CV% filter catches one imprecise instrument even when the combined CV looks fine.
function maxCV(row) {
  let max = 0;
  for (const key of ['AU/DxI-1', 'AU/DxI-2', 'AU/DxI-3', 'AU/DxI-4', 'combined']) {
    const s = row[key];
    if (s && s.count > 0 && s.cv > max) max = s.cv;
  }
  return max;
}

// Short-key row format for saved reports (gzip does the rest). Target, SD,
// message, comment and user are kept so a reloaded report has the same columns
// as a freshly processed file; reports saved before they were added load as 0/''.
function toSlimRow(r) {
  return {
    pr: r.protocol, in: r.instrument, pa: r.parameter,
    lv: r.level, dt: r.date, v: r.value, st: r.status, si: r.sampleId || '',
    tg: r.target || 0, sd: r.sd || 0, ms: r.message || '', cm: r.comment || '', us: r.user || ''
  };
}

// Inverse of toSlimRow. Assigns a sequential _id so per-point removal works on
// loaded reports (the slim format drops _id). Legacy full-key rows pass through.
function fromSlimRow(r, i) {
  if (r.pa === undefined) return { ...r, _id: i };
  return {
    _id: i,
    protocol: r.pr, instrument: r.in, parameter: r.pa,
    level: r.lv, date: r.dt, value: r.v, status: r.st, sampleId: r.si || '',
    target: r.tg || 0, sd: r.sd || 0, message: r.ms || '', comment: r.cm || '', user: r.us || ''
  };
}

// Mean and SD for the Levey-Jennings reference lines.
// 'observed' uses the plotted points themselves; 'target' uses the Target/SD
// columns from the instrument export, picking the most frequent pair when the
// range spans more than one (e.g. a lot change). Falls back to observed when
// the data carries no usable target (SD of 0, or a report saved before targets
// were stored).
function getLJReference(points, mode, instrumentCount) {
  const observed = computeStats(points.map(r => r.value));
  const pooled = instrumentCount > 1 ? ' pooled across the selected instruments' : '';
  const observedNote = `Lines show the mean and SD of the ${points.length} plotted results${pooled}.`;
  if (mode !== 'target') return { stats: observed, note: observedNote };

  const pairs = new Map();
  for (const r of points) {
    if (!(r.sd > 0)) continue;
    const key = `${r.target}|${r.sd}`;
    pairs.set(key, (pairs.get(key) || 0) + 1);
  }
  if (pairs.size === 0) {
    return { stats: observed, note: 'No target/SD in this data, so the lines show the observed mean and SD instead. ' + observedNote };
  }
  const [bestKey, bestCount] = [...pairs.entries()].sort((a, b) => b[1] - a[1])[0];
  const [target, sd] = bestKey.split('|').map(Number);
  const stats = { mean: target, sd, cv: target !== 0 ? Math.abs(sd / target) * 100 : 0, count: bestCount };
  const note = pairs.size > 1
    ? `Lines show target ${target} ± SD ${sd}, used by ${bestCount} of ${points.length} results; ${pairs.size} different target/SD pairs are in range (possible lot change).`
    : `Lines show target ${target} ± SD ${sd} from the instrument export.`;
  return { stats, note };
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(str) {
  if (str == null) return '';
  // Escapes quotes as well as &<> so values are safe inside HTML attributes
  return String(str).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

module.exports = {
  parseCSV,
  processData,
  buildScopedData,
  filterByProtocols,
  applyLevelOverrides,
  isProtocolExcluded,
  mapToKnownInstruments,
  computeStats,
  buildResults,
  parseDateParts,
  parseDate,
  escapeHtml,
  toISODateLocal,
  parseISODateLocal,
  dateExtent,
  maxCV,
  toSlimRow,
  fromSlimRow,
  getLJReference,
  INSTRUMENTS_MAP,
  EXCLUDED_PROTOCOLS,
  LEVEL_OVERRIDE_PROTOCOLS,
};
