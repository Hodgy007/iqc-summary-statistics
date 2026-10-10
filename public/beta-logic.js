// Beta QC calculations: bias and z-scores against the export's Target/SD,
// Westgard multi-rule checks, sigma metrics, per-analyte quality specs and
// lot-to-lot comparison. Pure functions only (no DOM), loaded by the page as a
// classic script and by the Jest tests via require().
(function (root) {
  'use strict';

  // Settings an analyte gets when it has no entry of its own. TEa is blank by
  // default: allowable error must come from the lab's chosen specification
  // (EFLM, RCPA, CLIA...), so sigma is only shown once it has been entered.
  const DEFAULT_SPEC = { teaPct: null, cvWarnPct: 5, cvHighPct: 10, lotShiftPct: 5 };

  // Rules that reject a run; 1-2s is a warning only.
  const REJECTION_RULES = ['1-3s', '2-2s', 'R-4s', '4-1s', '10x'];

  function mean(values) {
    let sum = 0;
    for (const v of values) sum += v;
    return values.length ? sum / values.length : 0;
  }

  function stats(values) {
    const n = values.length;
    const m = mean(values);
    let ss = 0;
    for (const v of values) ss += (v - m) ** 2;
    const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
    return { n, mean: m, sd, cv: m !== 0 ? Math.abs(sd / m) * 100 : 0 };
  }

  // Most frequent Target/SD pair among points with a usable SD, plus how many
  // distinct pairs appear (more than one usually means a lot change).
  function modalTarget(points) {
    const pairs = new Map();
    for (const p of points) {
      if (!(p.sd > 0)) continue;
      const key = `${p.target}|${p.sd}`;
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
    if (pairs.size === 0) return null;
    const [key, count] = [...pairs.entries()].sort((a, b) => b[1] - a[1])[0];
    const [target, sd] = key.split('|').map(Number);
    return { target, sd, count, pairCount: pairs.size };
  }

  // Westgard multi-rule check over one control level on one instrument, in date
  // order. Each result is scored against its own row's Target/SD when present
  // (so a mid-period lot change is handled), otherwise against the fallback.
  // A violation is reported at the result that completes the rule. R-4s is
  // applied across consecutive results of the same level, since runs are not
  // identified in the export.
  function westgard(points, fallback) {
    const z = points.map(p => {
      const ref = p.sd > 0 ? { target: p.target, sd: p.sd } : fallback;
      return ref && ref.sd > 0 ? (p.value - ref.target) / ref.sd : null;
    });
    const violations = [];
    const add = (i, rule) => violations.push({ index: i, rule, z: z[i], point: points[i] });
    const sameSide = (from, to, limit) => {
      if (from < 0) return false;
      let above = true, below = true;
      for (let k = from; k <= to; k++) {
        if (z[k] === null) return false;
        if (!(z[k] > limit)) above = false;
        if (!(z[k] < -limit)) below = false;
      }
      return above || below;
    };

    for (let i = 0; i < z.length; i++) {
      if (z[i] === null) continue;
      const a = Math.abs(z[i]);
      if (a > 3) add(i, '1-3s');
      else if (a > 2) add(i, '1-2s');
      if (sameSide(i - 1, i, 2)) add(i, '2-2s');
      if (i > 0 && z[i - 1] !== null &&
          ((z[i] > 2 && z[i - 1] < -2) || (z[i] < -2 && z[i - 1] > 2))) add(i, 'R-4s');
      if (sameSide(i - 3, i, 1)) add(i, '4-1s');
      if (sameSide(i - 9, i, 0)) add(i, '10x');
    }
    return violations;
  }

  function countRules(violations) {
    const counts = {};
    for (const v of violations) counts[v.rule] = (counts[v.rule] || 0) + 1;
    return counts;
  }

  // Sigma = (TEa% - |bias%|) / CV%. Null when TEa is unset or CV is zero.
  function sigmaMetric(teaPct, biasPct, cvPct) {
    if (teaPct == null || !(teaPct > 0) || !(cvPct > 0) || biasPct == null) return null;
    return (teaPct - Math.abs(biasPct)) / cvPct;
  }

  // Merge an analyte's saved spec over the defaults (default row first, then
  // the analyte's own row). Blank values fall through to the next layer.
  function specFor(specs, analyte) {
    const out = { ...DEFAULT_SPEC };
    for (const layer of [specs && specs['*'], specs && specs[analyte]]) {
      if (!layer) continue;
      for (const key of Object.keys(DEFAULT_SPEC)) {
        const v = layer[key];
        if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) out[key] = Number(v);
      }
    }
    return out;
  }

  // Group rows into series keyed by analyte|level|instrument, each sorted by date.
  function groupSeries(rows, dateOf) {
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.parameter}|${r.level}|${r.instrument}`;
      if (!groups.has(key)) groups.set(key, { parameter: r.parameter, level: r.level, instrument: r.instrument, points: [] });
      groups.get(key).points.push(r);
    }
    // Work out each date once rather than inside the sort comparator
    for (const g of groups.values()) {
      g.points = g.points.map(p => [dateOf(p), p]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    }
    return [...groups.values()].sort((a, b) =>
      a.parameter.localeCompare(b.parameter) ||
      (parseInt(a.level, 10) - parseInt(b.level, 10)) ||
      a.instrument.localeCompare(b.instrument));
  }

  // One row of the QC Review table.
  function reviewSeries(series, specs) {
    const values = series.points.map(p => p.value);
    const s = stats(values);
    const ref = modalTarget(series.points);
    const spec = specFor(specs, series.parameter);
    const biasPct = ref && ref.target !== 0 ? (s.mean - ref.target) / ref.target * 100 : null;
    const zMean = ref ? (s.mean - ref.target) / ref.sd : null;
    const violations = westgard(series.points, ref);
    const counts = countRules(violations);
    const rejections = violations.filter(v => REJECTION_RULES.includes(v.rule)).length;
    return {
      parameter: series.parameter, level: series.level, instrument: series.instrument,
      n: s.n, mean: s.mean, sd: s.sd, cv: s.cv,
      target: ref ? ref.target : null, targetSD: ref ? ref.sd : null, targetPairs: ref ? ref.pairCount : 0,
      biasPct, zMean,
      teaPct: spec.teaPct, sigma: sigmaMetric(spec.teaPct, biasPct, s.cv),
      cvStatus: s.cv > spec.cvHighPct ? 'high' : s.cv > spec.cvWarnPct ? 'warn' : 'ok',
      violations, counts, rejections, warnings: counts['1-2s'] || 0,
    };
  }

  // Split a series at its most recent Target/SD change: B = results on the
  // current pair, A = results on the pair in use immediately before it.
  // Null when the series never changes target.
  function splitByTargetChange(points) {
    const keyed = points.filter(p => p.sd > 0).map(p => ({ p, key: `${p.target}|${p.sd}` }));
    if (!keyed.length) return null;
    const currentKey = keyed[keyed.length - 1].key;
    let previousKey = null;
    for (let i = keyed.length - 1; i >= 0; i--) {
      if (keyed[i].key !== currentKey) { previousKey = keyed[i].key; break; }
    }
    if (!previousKey) return null;
    return {
      a: keyed.filter(k => k.key === previousKey).map(k => k.p),
      b: keyed.filter(k => k.key === currentKey).map(k => k.p),
      aTarget: Number(previousKey.split('|')[0]),
      bTarget: Number(currentKey.split('|')[0]),
    };
  }

  // Compare two sets of results for one analyte/level/instrument.
  // Pass when both sides have at least minN results and the mean shift is
  // within the limit; 'insufficient' when either side is short of data.
  function compareLots(aPoints, bPoints, limitPct, minN) {
    const a = stats(aPoints.map(p => p.value));
    const b = stats(bPoints.map(p => p.value));
    const shiftPct = a.n && a.mean !== 0 && b.n ? (b.mean - a.mean) / a.mean * 100 : null;
    let result;
    if (a.n < minN || b.n < minN || shiftPct === null) result = 'insufficient';
    else result = Math.abs(shiftPct) <= limitPct ? 'pass' : 'fail';
    return { a, b, shiftPct, cvChange: a.n && b.n ? b.cv - a.cv : null, limitPct, result };
  }

  // Overview cell status for a reviewed series, most serious first.
  function seriesStatus(review) {
    if (!review) return 'none';
    if (review.rejections > 0) return 'reject';
    return review.cvStatus; // 'high' | 'warn' | 'ok'
  }

  // Westgard rules completed at each point of a date-ordered series, with the
  // most serious level: 'reject', 'warn' (1-2s only) or null.
  function pointFlags(points) {
    const flags = points.map(() => ({ rules: [], level: null }));
    for (const v of westgard(points, modalTarget(points))) {
      const f = flags[v.index];
      f.rules.push(v.rule);
      if (REJECTION_RULES.includes(v.rule)) f.level = 'reject';
      else if (!f.level) f.level = 'warn';
    }
    return flags;
  }

  const api = {
    DEFAULT_SPEC, REJECTION_RULES,
    stats, modalTarget, westgard, countRules, sigmaMetric, specFor,
    groupSeries, reviewSeries, splitByTargetChange, compareLots,
    seriesStatus, pointFlags,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.iqcBetaLogic = api;
})(typeof window !== 'undefined' ? window : this);
