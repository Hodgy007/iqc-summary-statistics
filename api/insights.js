import { streamText } from 'ai';
import { requireAuth } from './lib/auth.js';

const INSTRUMENTS = ['AU/DxI-1', 'AU/DxI-2', 'AU/DxI-3', 'AU/DxI-4'];
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const MAX_OUTPUT_TOKENS = Number.parseInt(process.env.AI_INSIGHTS_MAX_TOKENS || '', 10) || DEFAULT_MAX_OUTPUT_TOKENS;

function formatNum(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '0.0';
}

function compactInstrumentStats(row) {
  return INSTRUMENTS
    .map(inst => ({ inst, stats: row[inst] }))
    .filter(item => item.stats && item.stats.count > 0);
}

function formatStats(stats) {
  return `n=${stats.count}, mean=${formatNum(stats.mean, 2)}, CV=${formatNum(stats.cv)}%`;
}

function buildInsightsBrief(resultsData, dateRange) {
  const priorityRows = [];
  const lowCountRows = [];
  const variationRows = [];

  for (const row of resultsData) {
    const combined = row.combined || { count: 0, mean: 0, cv: 0 };
    const instruments = compactInstrumentStats(row);
    const highestCv = instruments.reduce((max, item) =>
      item.stats.cv > max.stats.cv ? item : max,
      { inst: 'Combined', stats: combined }
    );

    if (combined.cv > 5 || highestCv.stats.cv > 5) {
      const severity = combined.cv > 10 || highestCv.stats.cv > 10 ? 'High' : 'Medium';
      priorityRows.push({
        priority: severity,
        analyte: row.parameter,
        level: row.level,
        combinedCv: combined.cv,
        maxCv: highestCv.stats.cv,
        evidence: `Combined ${formatStats(combined)}; highest ${highestCv.inst} ${formatStats(highestCv.stats)}`,
      });
    }

    if (combined.count > 0 && combined.count < 10) {
      lowCountRows.push({
        analyte: row.parameter,
        level: row.level,
        count: combined.count,
        evidence: `Combined count ${combined.count}`,
      });
    }

    for (const item of instruments) {
      if (item.stats.count > 0 && item.stats.count < 10) {
        lowCountRows.push({
          analyte: row.parameter,
          level: row.level,
          count: item.stats.count,
          evidence: `${item.inst} count ${item.stats.count}`,
        });
      }
    }

    if (instruments.length >= 2) {
      const means = instruments.map(item => item.stats.mean);
      const minMean = Math.min(...means);
      const maxMean = Math.max(...means);
      const avgMean = means.reduce((sum, value) => sum + value, 0) / means.length;
      const spreadPct = avgMean !== 0 ? Math.abs((maxMean - minMean) / avgMean) * 100 : 0;
      const cvSpread = Math.max(...instruments.map(item => item.stats.cv)) - Math.min(...instruments.map(item => item.stats.cv));

      if (spreadPct >= 5 || cvSpread >= 5) {
        const lowInst = instruments.find(item => item.stats.mean === minMean);
        const highInst = instruments.find(item => item.stats.mean === maxMean);
        variationRows.push({
          analyte: row.parameter,
          level: row.level,
          spreadPct,
          cvSpread,
          evidence: `${lowInst.inst} mean ${formatNum(minMean, 2)} to ${highInst.inst} mean ${formatNum(maxMean, 2)} (${formatNum(spreadPct)}% spread); CV spread ${formatNum(cvSpread)}%`,
        });
      }
    }
  }

  priorityRows.sort((a, b) => b.maxCv - a.maxCv || b.combinedCv - a.combinedCv);
  lowCountRows.sort((a, b) => a.count - b.count || a.analyte.localeCompare(b.analyte));
  variationRows.sort((a, b) => b.spreadPct - a.spreadPct || b.cvSpread - a.cvSpread);

  const priorityLines = priorityRows.slice(0, 12)
    .map(row => `- ${row.priority} | ${row.analyte} | Level ${row.level} | ${row.evidence}`)
    .join('\n') || '- Low | All reviewed | - | No CV concerns above thresholds in the submitted data';

  const lowCountLines = lowCountRows.slice(0, 10)
    .map(row => `- ${row.analyte} | Level ${row.level} | n=${row.count} | ${row.evidence}`)
    .join('\n') || '- None | - | n/a | No low-count statistics in the submitted data';

  const variationLines = variationRows.slice(0, 10)
    .map(row => `- ${row.analyte} | Level ${row.level} | ${row.evidence}`)
    .join('\n') || '- None | - | No substantial between-instrument variation detected';

  return `Dataset: ${resultsData.length} analyte/level rows${dateRange ? `; date range ${dateRange}` : ''}.

Candidate priority findings, already sorted by risk. Use only these rows unless the data clearly supports another concern:
${priorityLines}

Candidate low-count statistics, already sorted by smallest count:
${lowCountLines}

Candidate between-instrument variation, already sorted by largest spread:
${variationLines}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { resultsData, dateRange } = req.body;
  if (!resultsData || !Array.isArray(resultsData) || resultsData.length === 0) {
    return res.status(400).json({ error: 'resultsData required' });
  }

  const gatewayKey = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!gatewayKey) {
    return res.status(500).json({ error: 'AI insights not configured (missing AI_GATEWAY_API_KEY)' });
  }

  const dataSummary = buildInsightsBrief(resultsData, dateRange);

  const userPrompt = `Please analyse the following IQC (Internal Quality Control) summary statistics from a clinical biochemistry laboratory.

Return Markdown only, using this exact structure:

## Executive summary
One short paragraph, maximum 4 sentences.

## Priority findings
Create a Markdown table with exactly these columns:
| Priority | Analyte | Level | Evidence | Risk | Recommended action |

Rules for the Priority findings table:
- Include the highest-risk rows first.
- Use Priority values High, Medium, or Low.
- Keep each table cell concise.
- Include no more than 12 rows.
- If there are no material concerns, include one row saying Low | All reviewed | - | No major concern identified | Routine monitoring | Continue routine review.

## Low-count statistics
Create a Markdown table with exactly these columns:
| Analyte | Level | Count | Why it matters | Action |
Include no more than 10 rows.

## Instrument variation
Create a Markdown table with exactly these columns:
| Analyte | Level | Instruments affected | Evidence | Action |
Include no more than 10 rows.

## Action checklist
Use short bullet points only.

Do not use long prose blocks outside the executive summary. Do not include code fences.
Do not include a report title, period line, platforms line, horizontal rules, numbered headings, subsection headings, or appendix.
Stop immediately after the Action checklist.

${dataSummary}

Interpretation guide:
- CV% >5% is generally concerning in clinical chemistry.
- CV% >10% warrants immediate review.
- Low result count means n<10 and may give unreliable statistics.
- Flag analytes where instruments differ substantially in mean or CV.`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);

  try {
    const result = streamText({
      model: 'anthropic/claude-opus-4.7',
      system: 'You are a clinical laboratory quality control specialist with expertise in IQC data interpretation for clinical biochemistry analysers. Provide concise Markdown tables and actionable recommendations focused on analytical quality and patient safety.',
      prompt: userPrompt,
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });

    for await (const chunk of result.textStream) {
      res.write(chunk);
    }
  } catch (err) {
    console.error('Insights error:', err);
    res.write(`\n\n[Error generating insights: ${err.message}]`);
  }

  res.end();
}
