const B = require('../public/beta-logic');

const pt = (value, target = 100, sd = 10, extra = {}) => ({ value, target, sd, ...extra });
const rules = violations => violations.map(v => `${v.index}:${v.rule}`);

describe('westgard', () => {
  test('in-control data has no violations', () => {
    const pts = [100, 105, 95, 108, 92, 101].map(v => pt(v));
    expect(B.westgard(pts)).toEqual([]);
  });

  test('1-2s warning and 1-3s rejection', () => {
    expect(rules(B.westgard([pt(125)]))).toEqual(['0:1-2s']);
    expect(rules(B.westgard([pt(131)]))).toEqual(['0:1-3s']);
    expect(rules(B.westgard([pt(69)]))).toEqual(['0:1-3s']);
  });

  test('2-2s needs two consecutive results beyond 2SD on the same side', () => {
    expect(rules(B.westgard([pt(121), pt(122)]))).toEqual(['0:1-2s', '1:1-2s', '1:2-2s']);
    expect(rules(B.westgard([pt(121), pt(79)]))).toContain('1:R-4s');
    expect(rules(B.westgard([pt(121), pt(79)]))).not.toContain('1:2-2s');
  });

  test('4-1s and 10x', () => {
    const four = [111, 112, 113, 114].map(v => pt(v));
    expect(rules(B.westgard(four))).toEqual(['3:4-1s']);
    const ten = Array.from({ length: 10 }, () => pt(101));
    expect(rules(B.westgard(ten))).toEqual(['9:10x']);
    const nine = Array.from({ length: 9 }, () => pt(101));
    expect(B.westgard(nine)).toEqual([]);
  });

  test('each result uses its own target, so a lot change is not a shift', () => {
    const pts = [...Array.from({ length: 6 }, () => pt(100, 100, 10)), ...Array.from({ length: 6 }, () => pt(150, 150, 10))];
    expect(B.westgard(pts)).toEqual([]);
  });

  test('rows without SD fall back to the supplied reference, or are skipped', () => {
    expect(rules(B.westgard([pt(131, 0, 0)], { target: 100, sd: 10 }))).toEqual(['0:1-3s']);
    expect(B.westgard([pt(131, 0, 0)])).toEqual([]);
  });
});

describe('modalTarget', () => {
  test('picks the most frequent pair and counts pairs', () => {
    expect(B.modalTarget([pt(1, 5, 1), pt(1, 5, 1), pt(1, 6, 1)])).toEqual({ target: 5, sd: 1, count: 2, pairCount: 2 });
  });
  test('null without usable SD', () => {
    expect(B.modalTarget([pt(1, 5, 0)])).toBeNull();
  });
});

describe('sigmaMetric', () => {
  test('(TEa - |bias|) / CV', () => {
    expect(B.sigmaMetric(10, -2, 2)).toBe(4);
  });
  test('null when TEa unset or CV zero', () => {
    expect(B.sigmaMetric(null, 1, 2)).toBeNull();
    expect(B.sigmaMetric(10, 1, 0)).toBeNull();
  });
});

describe('specFor', () => {
  test('defaults, then default row, then analyte row; blanks fall through', () => {
    const specs = { '*': { cvWarnPct: 4, teaPct: '' }, Na: { cvHighPct: 3, lotShiftPct: '' } };
    expect(B.specFor({}, 'Na')).toEqual(B.DEFAULT_SPEC);
    expect(B.specFor(specs, 'Na')).toEqual({ teaPct: null, cvWarnPct: 4, cvHighPct: 3, lotShiftPct: 5 });
    expect(B.specFor(specs, 'K').cvHighPct).toBe(10);
  });
});

describe('groupSeries and reviewSeries', () => {
  const row = (parameter, level, instrument, t, value, target = 10, sd = 1) =>
    ({ parameter, level, instrument, t, value, target, sd });

  test('groups by analyte/level/instrument and sorts by date', () => {
    const series = B.groupSeries([row('B', '1', 'X', 2, 1), row('A', '2', 'X', 1, 1), row('A', '1', 'X', 3, 2), row('A', '1', 'X', 1, 1)], r => r.t);
    expect(series.map(s => `${s.parameter}|${s.level}`)).toEqual(['A|1', 'A|2', 'B|1']);
    expect(series[0].points.map(p => p.t)).toEqual([1, 3]);
  });

  test('review computes bias, z, sigma and rejection counts', () => {
    const s = { parameter: 'A', level: '1', instrument: 'X', points: [row('A', '1', 'X', 1, 10.4), row('A', '1', 'X', 2, 10.6), row('A', '1', 'X', 3, 13.5)] };
    const r = B.reviewSeries(s, { A: { teaPct: 20 } });
    expect(r.target).toBe(10);
    expect(r.biasPct).toBeCloseTo(15, 5);
    expect(r.zMean).toBeCloseTo(1.5, 5);
    expect(r.counts['1-3s']).toBe(1);
    expect(r.rejections).toBe(1);
    expect(r.sigma).toBeCloseTo((20 - 15) / r.cv, 5);
  });

  test('no target means no bias or Westgard', () => {
    const s = { parameter: 'A', level: '1', instrument: 'X', points: [row('A', '1', 'X', 1, 10, 0, 0), row('A', '1', 'X', 2, 30, 0, 0)] };
    const r = B.reviewSeries(s, {});
    expect(r.target).toBeNull();
    expect(r.biasPct).toBeNull();
    expect(r.violations).toEqual([]);
  });
});

describe('lot comparison', () => {
  test('splitByTargetChange uses the latest change', () => {
    const pts = [pt(1, 10, 1), pt(1, 10, 1), pt(1, 11, 1), pt(1, 12, 1), pt(1, 12, 1)];
    const split = B.splitByTargetChange(pts);
    expect(split.aTarget).toBe(11);
    expect(split.bTarget).toBe(12);
    expect(split.a).toHaveLength(1);
    expect(split.b).toHaveLength(2);
    expect(B.splitByTargetChange([pt(1, 10, 1), pt(2, 10, 1)])).toBeNull();
  });

  test('compareLots pass, fail and insufficient', () => {
    const a = [100, 102, 98].map(v => pt(v));
    expect(B.compareLots(a, [104, 106, 105].map(v => pt(v)), 5, 3).result).toBe('pass');
    const fail = B.compareLots(a, [110, 111, 112].map(v => pt(v)), 5, 3);
    expect(fail.result).toBe('fail');
    expect(fail.shiftPct).toBeCloseTo(11, 5);
    expect(B.compareLots(a, [110].map(v => pt(v)), 5, 3).result).toBe('insufficient');
    expect(B.compareLots([], [110].map(v => pt(v)), 5, 1).result).toBe('insufficient');
  });
});

describe('seriesStatus', () => {
  test('rejections outrank CV status', () => {
    expect(B.seriesStatus({ rejections: 2, cvStatus: 'ok' })).toBe('reject');
    expect(B.seriesStatus({ rejections: 0, cvStatus: 'warn' })).toBe('warn');
    expect(B.seriesStatus(undefined)).toBe('none');
  });
});

describe('pointFlags', () => {
  test('marks each point with the rules it completes and the worst level', () => {
    const flags = B.pointFlags([pt(100), pt(125), pt(131), pt(100)]);
    expect(flags[0]).toEqual({ rules: [], level: null });
    expect(flags[1]).toEqual({ rules: ['1-2s'], level: 'warn' });
    expect(flags[2].rules).toEqual(['1-3s', '2-2s']);
    expect(flags[2].level).toBe('reject');
    expect(flags[3].level).toBeNull();
  });
});
