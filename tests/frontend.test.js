const fs = require('fs');
const path = require('path');
const {
  parseCSV,
  processData,
  buildScopedData,
  filterByProtocols,
  computeStats,
  buildResults,
  parseDate,
  escapeHtml,
  INSTRUMENTS_MAP,
  EXCLUDED_PROTOCOLS,
  LEVEL_OVERRIDE_PROTOCOLS,
} = require('./frontend-logic');

// =============================================
// parseCSV
// =============================================
describe('parseCSV', () => {
  test('parses a valid semicolon-delimited CSV row', () => {
    const csv = 'TestProto;AU5800 1 L;Glucose;1;01/03/2025 08:00;5.5;5.0;0.3;Accepted;OK;comment;user1;SAMPLE1';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      protocol: 'TestProto',
      instrument: 'AU5800 1 L',
      parameter: 'Glucose',
      level: '1',
      date: '01/03/2025 08:00',
      value: 5.5,
      target: 5.0,
      sd: 0.3,
      status: 'Accepted',
      message: 'OK',
      comment: 'comment',
      user: 'user1',
      sampleId: 'SAMPLE1',
    });
  });

  test('skips header row containing "protocol"', () => {
    const csv = 'Protocol;Instrument;Parameter;Level;Date;Value;Target;SD;Status\nProto1;AU5800 1 L;HbA1c;1;01/01/2025;10.5;10;0.5;Accepted';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].parameter).toBe('HbA1c');
  });

  test('skips rows with fewer than 9 fields', () => {
    const csv = 'Proto1;AU5800 1 L;Glucose;1;01/01/2025';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(0);
  });

  test('skips rows with non-numeric value', () => {
    const csv = 'Proto1;AU5800 1 L;Glucose;1;01/01/2025;NaN;5.0;0.3;Accepted';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(0);
  });

  test('handles empty input', () => {
    expect(parseCSV('')).toEqual([]);
  });

  test('parses multiple rows', () => {
    const csv = [
      'Proto1;AU5800 1 L;Glucose;1;01/01/2025;5.5;5.0;0.3;Accepted;;;user1;',
      'Proto1;AU5800 2 L;Glucose;1;01/01/2025;5.7;5.0;0.3;Accepted;;;user1;',
    ].join('\n');
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
  });

  test('strips C_ and I_ prefixes from parameter names', () => {
    const csv = [
      'Proto1;AU5800 1 L;C_CRP;1;01/01/2025;5.5;5.0;0.3;Accepted;;;user1;',
      'Proto1;AU5800 1 L;I_HBC;1;01/01/2025;5.5;5.0;0.3;Accepted;;;user1;',
      'Proto1;AU5800 1 L;Glucose;1;01/01/2025;5.5;5.0;0.3;Accepted;;;user1;',
    ].join('\n');
    const rows = parseCSV(csv);
    expect(rows[0].parameter).toBe('CRP');
    expect(rows[1].parameter).toBe('HBC');
    expect(rows[2].parameter).toBe('Glucose');
  });

  test('handles missing optional fields gracefully', () => {
    const csv = 'Proto1;AU5800 1 L;Glucose;1;01/01/2025;5.5;5.0;0.3;Accepted';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('');
    expect(rows[0].comment).toBe('');
    expect(rows[0].user).toBe('');
    expect(rows[0].sampleId).toBe('');
  });

  test('trims whitespace from fields', () => {
    const csv = ' Proto1 ; AU5800 1 L ; Glucose ; 1 ; 01/01/2025 ; 5.5 ; 5.0 ; 0.3 ; Accepted ';
    const rows = parseCSV(csv);
    expect(rows[0].protocol).toBe('Proto1');
    expect(rows[0].instrument).toBe('AU5800 1 L');
  });
});

// =============================================
// computeStats
// =============================================
describe('computeStats', () => {
  test('returns zeros for empty array', () => {
    expect(computeStats([])).toEqual({ mean: 0, sd: 0, cv: 0, count: 0 });
  });

  test('computes correct stats for single value', () => {
    const result = computeStats([10]);
    expect(result.mean).toBe(10);
    expect(result.sd).toBe(0);
    expect(result.cv).toBe(0);
    expect(result.count).toBe(1);
  });

  test('computes correct mean', () => {
    const result = computeStats([2, 4, 6, 8, 10]);
    expect(result.mean).toBe(6);
    expect(result.count).toBe(5);
  });

  test('computes sample SD (n-1 denominator)', () => {
    // Values: 2, 4, 6 => mean=4, variance=((2-4)^2+(4-4)^2+(6-4)^2)/(3-1) = 8/2 = 4, sd=2
    const result = computeStats([2, 4, 6]);
    expect(result.mean).toBe(4);
    expect(result.sd).toBe(2);
  });

  test('computes CV as absolute percentage', () => {
    const result = computeStats([10, 10, 10]);
    expect(result.cv).toBe(0);
  });

  test('computes CV correctly for varied data', () => {
    // Values: 100, 110 => mean=105, var=((100-105)^2+(110-105)^2)/1 = 50, sd=sqrt(50)~7.071
    // CV = (7.071/105)*100 = ~6.734%
    const result = computeStats([100, 110]);
    expect(result.cv).toBeCloseTo(6.734, 1);
  });

  test('handles negative mean with absolute CV', () => {
    // Even though values are negative, CV should be absolute
    const result = computeStats([-10, -20]);
    expect(result.cv).toBeGreaterThan(0);
  });

  test('handles all identical values', () => {
    const result = computeStats([5.5, 5.5, 5.5, 5.5]);
    expect(result.mean).toBe(5.5);
    expect(result.sd).toBe(0);
    expect(result.cv).toBe(0);
    expect(result.count).toBe(4);
  });
});

// =============================================
// processData
// =============================================
describe('processData', () => {
  const makeRow = (overrides = {}) => ({
    protocol: 'TestProto',
    instrument: 'AU5800 1 L',
    parameter: 'Glucose',
    level: '1',
    date: '01/01/2025',
    value: 5.5,
    target: 5.0,
    sd: 0.3,
    status: 'Accepted',
    message: '',
    comment: '',
    user: '',
    sampleId: '',
    ...overrides,
  });

  test('maps instrument names correctly', () => {
    const data = [makeRow({ instrument: 'AU5800 1 L' })];
    const result = processData(data);
    expect(result[0].instrument).toBe('AU/DxI-1');
  });

  test('maps all instrument names', () => {
    for (const [raw, mapped] of Object.entries(INSTRUMENTS_MAP)) {
      const result = processData([makeRow({ instrument: raw })]);
      expect(result[0].instrument).toBe(mapped);
    }
  });

  test('filters out excluded protocols', () => {
    const data = [makeRow({ protocol: 'AU 5800 1 L Patient Means' })];
    expect(processData(data)).toHaveLength(0);
  });

  test('filters out eval protocols', () => {
    const variants = [
      'Some Eval Protocol',
      'Daily Evaluation',
      'DXI 1 EVAL',
      'DxI 4.1 Evaluation',
      'eval lot 5',
    ];
    for (const protocol of variants) {
      const data = [makeRow({ protocol })];
      expect(processData(data)).toHaveLength(0);
    }
  });

  test('does not filter protocols that merely contain "eval" mid-word', () => {
    const data = [makeRow({ protocol: 'Devalue Test', instrument: 'AU5800 1 L' })];
    expect(processData(data)).toHaveLength(1);
  });

  test('filters out manually rejected rows', () => {
    const data = [makeRow({ status: 'Manually rejected' })];
    expect(processData(data)).toHaveLength(0);
  });

  test('filters out rerun requested rows', () => {
    const data = [makeRow({ status: 'Rerun requested' })];
    expect(processData(data)).toHaveLength(0);
  });

  test('keeps accepted rows', () => {
    const data = [makeRow({ status: 'Accepted' })];
    expect(processData(data)).toHaveLength(1);
  });

  test('overrides level for level override protocols', () => {
    const data = [makeRow({ protocol: 'LAC DXI 1 L', instrument: 'DXI 1 L', level: '2' })];
    const result = processData(data);
    expect(result[0].level).toBe('4');
  });

  test('overrides level to 4 for any protocol containing hsTnI (case-insensitive)', () => {
    const variants = [
      'DXI 1 hsTnI',
      'DXI 2 hsTnI',
      'DXI 3 hsTnI',
      'DXI 4 hsTnI',
      'DxI 4.1 hsTnI',
      'DxI 3.1 hsTnI',
      'DXI 3 M hsTnI',
      'DXI 4 M hsTnI',
    ];
    for (const protocol of variants) {
      const data = [makeRow({ protocol, instrument: 'DXI 1 L', level: '1' })];
      const result = processData(data);
      expect(result).toHaveLength(1);
      expect(result[0].level).toBe('4');
    }
  });

  test('hsTnI Eval rows are dropped when the eval filter is active', () => {
    // The test helper always excludes eval rows (no toggle), but the level-4
    // promotion happens first so live runs with the toggle off would keep
    // these rows at level 4.
    const variants = [
      'DxI 1 hsTnI Eval',
      'DxI 2 hsTnI Eval',
      'DxI 3 hsTnI Eval',
      'DxI 4 hsTnI Eval',
    ];
    for (const protocol of variants) {
      const data = [makeRow({ protocol, instrument: 'DXI 1 L', level: '1' })];
      expect(processData(data)).toHaveLength(0);
    }
  });

  test('does not override level for non-hsTnI protocols on the same instrument', () => {
    const data = [makeRow({ protocol: 'DxI 4.1 M', instrument: 'DXI 4 M', level: '1' })];
    const result = processData(data);
    expect(result[0].level).toBe('1');
  });

  test('overrides level for TPP sample IDs', () => {
    const data = [makeRow({ sampleId: 'TPP-001' })];
    const result = processData(data);
    expect(result[0].level).toBe('4');
  });

  test('overrides level for HBQC sample IDs', () => {
    const data = [makeRow({ sampleId: 'HBQC-001' })];
    const result = processData(data);
    expect(result[0].level).toBe('4');
  });

  test('filters out unknown instruments', () => {
    const data = [makeRow({ instrument: 'Unknown Machine' })];
    expect(processData(data)).toHaveLength(0);
  });

  test('processes mixed valid and invalid data', () => {
    const data = [
      makeRow({ instrument: 'AU5800 1 L', status: 'Accepted' }),
      makeRow({ instrument: 'AU5800 1 L', status: 'Manually rejected' }),
      makeRow({ protocol: 'AU 5800 1 L Patient Means' }),
      makeRow({ instrument: 'AU5800 2 L', status: 'Accepted' }),
    ];
    const result = processData(data);
    expect(result).toHaveLength(2);
  });
});

// =============================================
// buildResults
// =============================================
describe('buildResults', () => {
  const makeProcessedRow = (overrides = {}) => ({
    parameter: 'Glucose',
    level: '1',
    instrument: 'AU/DxI-1',
    value: 5.0,
    ...overrides,
  });

  test('groups by parameter and level', () => {
    const data = [
      makeProcessedRow({ parameter: 'Glucose', level: '1', value: 5 }),
      makeProcessedRow({ parameter: 'Glucose', level: '2', value: 10 }),
      makeProcessedRow({ parameter: 'HbA1c', level: '1', value: 7 }),
    ];
    const results = buildResults(data);
    expect(results).toHaveLength(3);
  });

  test('computes per-instrument stats', () => {
    const data = [
      makeProcessedRow({ instrument: 'AU/DxI-1', value: 5 }),
      makeProcessedRow({ instrument: 'AU/DxI-1', value: 7 }),
      makeProcessedRow({ instrument: 'AU/DxI-2', value: 6 }),
    ];
    const results = buildResults(data);
    expect(results[0]['AU/DxI-1'].count).toBe(2);
    expect(results[0]['AU/DxI-1'].mean).toBe(6);
    expect(results[0]['AU/DxI-2'].count).toBe(1);
    expect(results[0]['AU/DxI-2'].mean).toBe(6);
  });

  test('computes combined stats across instruments', () => {
    const data = [
      makeProcessedRow({ instrument: 'AU/DxI-1', value: 4 }),
      makeProcessedRow({ instrument: 'AU/DxI-2', value: 6 }),
    ];
    const results = buildResults(data);
    expect(results[0].combined.count).toBe(2);
    expect(results[0].combined.mean).toBe(5);
  });

  test('handles instruments with no data', () => {
    const data = [makeProcessedRow({ instrument: 'AU/DxI-1', value: 10 })];
    const results = buildResults(data);
    expect(results[0]['AU/DxI-3'].count).toBe(0);
    expect(results[0]['AU/DxI-4'].count).toBe(0);
  });

  test('sorts results by parameter then level', () => {
    const data = [
      makeProcessedRow({ parameter: 'Zinc', level: '2', value: 1 }),
      makeProcessedRow({ parameter: 'Albumin', level: '1', value: 2 }),
      makeProcessedRow({ parameter: 'Zinc', level: '1', value: 3 }),
    ];
    const results = buildResults(data);
    expect(results[0].parameter).toBe('Albumin');
    expect(results[1].parameter).toBe('Zinc');
    expect(results[1].level).toBe('1');
    expect(results[2].parameter).toBe('Zinc');
    expect(results[2].level).toBe('2');
  });

  test('returns empty array for empty data', () => {
    expect(buildResults([])).toEqual([]);
  });
});

// =============================================
// parseDate
// =============================================
describe('parseDate', () => {
  test('detects DD/MM/YYYY when day segment > 12', () => {
    const d = parseDate('15/03/2025');
    expect(d.getDate()).toBe(15);
    expect(d.getMonth()).toBe(2); // March = 2 (zero-indexed)
    expect(d.getFullYear()).toBe(2025);
  });

  test('detects MM/DD/YYYY when second segment > 12', () => {
    const d = parseDate('03/15/2025');
    expect(d.getDate()).toBe(15);
    expect(d.getMonth()).toBe(2);
    expect(d.getFullYear()).toBe(2025);
  });

  test('ambiguous slash dates fall back to US MM/DD/YYYY', () => {
    const d = parseDate('01/06/2025 14:30:00');
    expect(d.getDate()).toBe(6);
    expect(d.getMonth()).toBe(0); // January
    expect(d.getFullYear()).toBe(2025);
  });

  test('ambiguous dash dates fall back to UK DD-MM-YYYY', () => {
    const d = parseDate('01-06-2025');
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(5); // June
    expect(d.getFullYear()).toBe(2025);
  });

  test('parses ISO YYYY-MM-DD without misreading the year as the day', () => {
    const d = parseDate('2025-03-15');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(2); // March
    expect(d.getDate()).toBe(15);
  });

  test('parses ISO dates with slash separators too', () => {
    const d = parseDate('2025/03/15');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });

  test('returns epoch for null/empty input', () => {
    expect(parseDate(null).getTime()).toBe(new Date(0).getTime());
    expect(parseDate('').getTime()).toBe(new Date(0).getTime());
  });
});

// =============================================
// escapeHtml
// =============================================
describe('escapeHtml', () => {
  test('escapes angle brackets and ampersands', () => {
    expect(escapeHtml('<script>&')).toBe('&lt;script&gt;&amp;');
  });

  test('escapes single and double quotes (attribute safety)', () => {
    expect(escapeHtml(`O'Neil "QC"`)).toBe('O&#39;Neil &quot;QC&quot;');
  });

  test('returns empty string for null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('stringifies non-string input', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

// =============================================
// buildScopedData / filterByProtocols
// =============================================
describe('buildScopedData', () => {
  function row(over = {}) {
    return {
      protocol: 'TestProto', instrument: 'AU5800 1 L', parameter: 'Glucose',
      level: '1', date: '01/01/2025', value: 5.5, target: 5, sd: 0.3,
      status: 'Accepted', message: '', comment: '', user: '', sampleId: '',
      ...over,
    };
  }

  test('keeps rejected and rerun rows that processData drops', () => {
    const data = [
      row({ status: 'Accepted' }),
      row({ status: 'Manually rejected' }),
      row({ status: 'Rerun requested' }),
    ];
    expect(buildScopedData(data, true)).toHaveLength(3);
    expect(processData(data)).toHaveLength(1);
  });

  test('rejected rows survive so they can be counted in scope', () => {
    const data = [row({ status: 'Accepted' }), row({ status: 'Manually rejected' })];
    const rejected = buildScopedData(data, true).filter(r => r.status === 'Manually rejected');
    expect(rejected).toHaveLength(1);
    // The same count taken from processData would be zero, which is the bug this guards
    expect(processData(data).filter(r => r.status === 'Manually rejected')).toHaveLength(0);
  });

  test('still drops excluded protocols', () => {
    const data = [row({ protocol: 'ACCURUN1' }), row({ protocol: 'TestProto' })];
    const out = buildScopedData(data, true);
    expect(out).toHaveLength(1);
    expect(out[0].protocol).toBe('TestProto');
  });

  test('excludeEval flag controls evaluation protocols', () => {
    const data = [row({ protocol: 'Glucose Eval' }), row({ protocol: 'TestProto' })];
    expect(buildScopedData(data, true)).toHaveLength(1);
    expect(buildScopedData(data, false)).toHaveLength(2);
  });

  test('maps instrument names and drops unknown instruments', () => {
    const data = [row({ instrument: 'AU5800 1 L' }), row({ instrument: 'MysteryBox 9000' })];
    const out = buildScopedData(data, true);
    expect(out).toHaveLength(1);
    expect(out[0].instrument).toBe('AU/DxI-1');
  });

  test('applies level overrides before filtering', () => {
    const data = [row({ protocol: 'DXI 1 hsTnI', level: '1' })];
    expect(buildScopedData(data, true)[0].level).toBe('4');
  });

  test('processData equals buildScopedData minus rejected and rerun rows', () => {
    const data = [
      row({ status: 'Accepted' }),
      row({ status: 'Manually rejected' }),
      row({ status: 'Rerun requested' }),
      row({ protocol: 'ACCURUN1' }),
      row({ instrument: 'MysteryBox 9000' }),
    ];
    const expected = buildScopedData(data, true)
      .filter(r => r.status !== 'Manually rejected' && r.status !== 'Rerun requested');
    expect(processData(data)).toEqual(expected);
  });
});

describe('filterByProtocols', () => {
  const rows = [
    { protocol: 'Alpha', value: 1 },
    { protocol: 'Beta', value: 2 },
    { protocol: 'Gamma', value: 3 },
  ];

  test('an empty selection means all protocols', () => {
    expect(filterByProtocols(rows, new Set())).toEqual(rows);
  });

  test('a missing selection means all protocols', () => {
    expect(filterByProtocols(rows, undefined)).toEqual(rows);
    expect(filterByProtocols(rows, null)).toEqual(rows);
  });

  test('keeps only the selected protocol', () => {
    expect(filterByProtocols(rows, new Set(['Beta']))).toEqual([{ protocol: 'Beta', value: 2 }]);
  });

  test('keeps every selected protocol', () => {
    expect(filterByProtocols(rows, new Set(['Alpha', 'Gamma']))).toEqual([
      { protocol: 'Alpha', value: 1 },
      { protocol: 'Gamma', value: 3 },
    ]);
  });

  test('returns nothing when no selected protocol is present', () => {
    expect(filterByProtocols(rows, new Set(['Delta']))).toEqual([]);
  });
});

// =============================================
// Drift guard: test copy must match public/index.html
// =============================================
describe('frontend-logic stays in sync with index.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  function extractSet(name) {
    const m = html.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
    if (!m) throw new Error(`${name} not found in index.html`);
    return new Set([...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(x => x[1]));
  }

  test('EXCLUDED_PROTOCOLS matches', () => {
    expect(EXCLUDED_PROTOCOLS).toEqual(extractSet('EXCLUDED_PROTOCOLS'));
  });

  test('LEVEL_OVERRIDE_PROTOCOLS matches', () => {
    expect(LEVEL_OVERRIDE_PROTOCOLS).toEqual(extractSet('LEVEL_OVERRIDE_PROTOCOLS'));
  });

  test('INSTRUMENTS_MAP matches', () => {
    const m = html.match(/const INSTRUMENTS_MAP = \{([\s\S]*?)\};/);
    expect(m).not.toBeNull();
    const pairs = Object.fromEntries(
      [...m[1].matchAll(/'([^']+)':\s*'([^']+)'/g)].map(x => [x[1], x[2]])
    );
    expect(INSTRUMENTS_MAP).toEqual(pairs);
  });
});

// =============================================
// Integration: parseCSV -> processData -> buildResults
// =============================================
describe('end-to-end pipeline', () => {
  test('full CSV to results pipeline', () => {
    const csv = [
      'Protocol;Instrument;Parameter;Level;Date;Value;Target;SD;Status;Message;Comment;User;SampleId',
      'TestProto;AU5800 1 L;Glucose;1;01/01/2025;5.5;5.0;0.3;Accepted;OK;;user1;',
      'TestProto;AU5800 1 L;Glucose;1;02/01/2025;5.7;5.0;0.3;Accepted;OK;;user1;',
      'TestProto;AU5800 2 L;Glucose;1;01/01/2025;5.6;5.0;0.3;Accepted;OK;;user1;',
      'TestProto;AU5800 1 L;Glucose;1;03/01/2025;5.4;5.0;0.3;Manually rejected;Failed;;user1;',
    ].join('\n');

    const parsed = parseCSV(csv);
    expect(parsed).toHaveLength(4);

    const processed = processData(parsed);
    expect(processed).toHaveLength(3); // rejected row filtered

    const results = buildResults(processed);
    expect(results).toHaveLength(1); // one analyte+level group
    expect(results[0].parameter).toBe('Glucose');
    expect(results[0]['AU/DxI-1'].count).toBe(2);
    expect(results[0]['AU/DxI-2'].count).toBe(1);
    expect(results[0].combined.count).toBe(3);
  });
});
