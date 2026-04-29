import { streamText } from 'ai';
import { requireAuth } from './lib/auth.js';

const INSTRUMENTS = ['AU/DxI-1', 'AU/DxI-2', 'AU/DxI-3', 'AU/DxI-4'];

function formatResultsForPrompt(resultsData, dateRange) {
  const lines = resultsData.map(row => {
    const parts = INSTRUMENTS.map(inst => {
      const s = row[inst];
      if (!s || s.count === 0) return null;
      return `  ${inst}: n=${s.count}, mean=${s.mean.toFixed(2)}, SD=${s.sd.toFixed(2)}, CV=${s.cv.toFixed(1)}%`;
    }).filter(Boolean);
    const c = row.combined;
    parts.push(`  Combined: n=${c.count}, mean=${c.mean.toFixed(2)}, SD=${c.sd.toFixed(2)}, CV=${c.cv.toFixed(1)}%`);
    return `${row.parameter} (Level ${row.level}):\n${parts.join('\n')}`;
  }).join('\n\n');

  const dateInfo = dateRange ? `Date range covered: ${dateRange}\n\n` : '';
  return dateInfo + lines;
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

  const dataSummary = formatResultsForPrompt(resultsData, dateRange);

  const userPrompt = `Please analyse the following IQC (Internal Quality Control) summary statistics from a clinical biochemistry laboratory and provide structured insights.

${dataSummary}

Please cover:
1. Overall QC performance summary
2. Analytes with high imprecision (CV% concerns — >5% is generally concerning in clinical chemistry, >10% warrants immediate review)
3. Between-instrument variation — flag analytes where instruments differ substantially in mean or CV
4. Analytes with low result counts (n<10) that may give unreliable statistics
5. Specific, actionable recommendations for the laboratory team`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);

  try {
    const result = streamText({
      model: 'anthropic/claude-opus-4-7',
      system: 'You are a clinical laboratory quality control specialist with expertise in IQC data interpretation for clinical biochemistry analysers. Provide clear, structured, actionable insights focused on analytical quality and patient safety. Use numbered sections and bullet points for clarity.',
      prompt: userPrompt,
      maxOutputTokens: 2048,
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
