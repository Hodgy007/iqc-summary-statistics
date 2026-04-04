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

function processData(data) {
  let filtered = data.filter(row => {
    if (EXCLUDED_PROTOCOLS.has(row.protocol)) return false;
    if (row.protocol.toLowerCase().includes('eval')) return false;
    return true;
  });

  filtered = filtered.filter(r => r.status !== 'Manually rejected' && r.status !== 'Rerun requested');

  filtered = filtered.map(row => {
    const mapped = INSTRUMENTS_MAP[row.instrument];
    return { ...row, instrument: mapped || row.instrument };
  });

  filtered = filtered.map(row => {
    if (LEVEL_OVERRIDE_PROTOCOLS.has(row.protocol.trim()) || (row.sampleId && row.sampleId.includes('TPP')) || (row.sampleId && row.sampleId.includes('HBQC'))) {
      return { ...row, level: '4' };
    }
    return row;
  });

  const knownInstruments = new Set(['AU/DxI-1', 'AU/DxI-2', 'AU/DxI-3', 'AU/DxI-4']);
  filtered = filtered.filter(r => knownInstruments.has(r.instrument));

  return filtered;
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

function parseDate(dateStr) {
  if (!dateStr) return new Date(0);
  const parts = dateStr.split(' ')[0].split('/');
  if (parts.length === 3) {
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }
  return new Date(dateStr);
}

module.exports = {
  parseCSV,
  processData,
  computeStats,
  buildResults,
  parseDate,
  INSTRUMENTS_MAP,
  EXCLUDED_PROTOCOLS,
  LEVEL_OVERRIDE_PROTOCOLS,
};
