const fs = require('fs');
const path = require('path');
const {
  toISODateLocal,
  parseISODateLocal,
  dateExtent,
  maxCV,
  toSlimRow,
  fromSlimRow,
  getLJReference,
  parseDate,
} = require('./frontend-logic');

// tests/global-setup.js runs these in Europe/London time, so BST (UTC+1) is exercised.

describe('local date helpers (BST)', () => {
  test('suite runs in UK time', () => {
    expect(new Date(2026, 5, 15).getTimezoneOffset()).toBe(-60);
  });

  test('toISODateLocal keeps the local calendar day in summer', () => {
    const d = parseDate('15-06-2026 00:30:00');
    expect(d.toISOString().split('T')[0]).toBe('2026-06-14'); // the old, shifted behaviour
    expect(toISODateLocal(d)).toBe('2026-06-15');
  });

  test('toISODateLocal in winter', () => {
    expect(toISODateLocal(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  test('parseISODateLocal is local midnight, so early-morning rows pass a From filter', () => {
    const from = parseISODateLocal('2026-06-15');
    expect(from.getHours()).toBe(0);
    expect(parseDate('15-06-2026 00:30:00') >= from).toBe(true);
  });

  test('round trip', () => {
    expect(toISODateLocal(parseISODateLocal('2026-03-29'))).toBe('2026-03-29');
  });
});

describe('dateExtent', () => {
  test('handles more rows than Math.min(...spread) can', () => {
    const dates = Array.from({ length: 330000 }, (_, i) => new Date(2026, 0, 1 + (i % 90)));
    const ext = dateExtent(dates);
    expect(toISODateLocal(ext.min)).toBe('2026-01-01');
    expect(toISODateLocal(ext.max)).toBe('2026-03-31');
  });

  test('ignores invalid and epoch dates, null when none valid', () => {
    expect(dateExtent([new Date(0), new Date('nope')])).toBeNull();
    const ext = dateExtent([new Date(0), new Date(2026, 1, 2)]);
    expect(toISODateLocal(ext.min)).toBe('2026-02-02');
  });
});

describe('maxCV', () => {
  const empty = { mean: 0, sd: 0, cv: 0, count: 0 };
  test('catches one imprecise instrument when combined CV is low', () => {
    const row = {
      'AU/DxI-1': { mean: 10, sd: 1.2, cv: 12, count: 20 },
      'AU/DxI-2': empty, 'AU/DxI-3': empty, 'AU/DxI-4': empty,
      combined: { mean: 10, sd: 0.4, cv: 4, count: 80 },
    };
    expect(maxCV(row)).toBe(12);
  });

  test('ignores instruments with no data', () => {
    const row = {
      'AU/DxI-1': { mean: 0, sd: 0, cv: 50, count: 0 },
      'AU/DxI-2': empty, 'AU/DxI-3': empty, 'AU/DxI-4': empty,
      combined: { mean: 10, sd: 0.3, cv: 3, count: 10 },
    };
    expect(maxCV(row)).toBe(3);
  });
});

describe('slim report rows', () => {
  const row = {
    _id: 7, protocol: 'P', instrument: 'AU/DxI-1', parameter: 'PROL', level: '3',
    date: '07-04-2026 16:29:53', value: 1110.9, target: 1039.2, sd: 54.8,
    status: 'Accepted', message: 'm', comment: 'c', user: 'u', sampleId: 'NIA3',
  };

  test('round trip keeps target, SD, message, comment and user', () => {
    const back = fromSlimRow(JSON.parse(JSON.stringify(toSlimRow(row))), 0);
    expect(back).toEqual({ ...row, _id: 0 });
  });

  test('reports saved in the old slim format still load', () => {
    const old = { pr: 'P', in: 'AU/DxI-1', pa: 'PROL', lv: '3', dt: 'd', v: 1, st: 'Accepted', si: '' };
    expect(fromSlimRow(old, 4)).toMatchObject({ _id: 4, target: 0, sd: 0, message: '', comment: '', user: '' });
  });

  test('legacy full-key rows pass through with a fresh _id', () => {
    expect(fromSlimRow({ ...row, _id: 99 }, 2)._id).toBe(2);
  });
});

describe('getLJReference', () => {
  const pts = [
    { value: 10, target: 11, sd: 1 },
    { value: 12, target: 11, sd: 1 },
    { value: 14, target: 20, sd: 2 },
  ];

  test('observed mode uses the plotted values', () => {
    const ref = getLJReference(pts, 'observed', 1);
    expect(ref.stats.mean).toBe(12);
    expect(ref.note).not.toMatch(/pooled/);
  });

  test('observed mode says when instruments are pooled', () => {
    expect(getLJReference(pts, 'observed', 2).note).toMatch(/pooled/);
  });

  test('target mode uses the most frequent target/SD and flags a mix', () => {
    const ref = getLJReference(pts, 'target', 1);
    expect(ref.stats.mean).toBe(11);
    expect(ref.stats.sd).toBe(1);
    expect(ref.note).toMatch(/2 different target\/SD pairs/);
  });

  test('target mode falls back to observed without usable targets', () => {
    const ref = getLJReference([{ value: 5, target: 0, sd: 0 }, { value: 7, target: 0, sd: 0 }], 'target', 1);
    expect(ref.stats.mean).toBe(6);
    expect(ref.note).toMatch(/No target\/SD/);
  });
});

// The helpers above are copies; fail if index.html changes without them.
// Compares source text (fn.toString() would return Babel's transformed output).
describe('fixed helpers stay in sync with index.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const copy = fs.readFileSync(path.join(__dirname, 'frontend-logic.js'), 'utf8');
  const extract = (src, name) => {
    const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`));
    return m && m[0];
  };
  const names = ['toISODateLocal', 'parseISODateLocal', 'dateExtent', 'maxCV', 'toSlimRow', 'fromSlimRow', 'getLJReference'];
  for (const name of names) {
    test(`${name} matches`, () => {
      const fromHtml = extract(html, name);
      expect(fromHtml).not.toBeNull();
      expect(extract(copy, name)).toBe(fromHtml);
    });
  }
});
