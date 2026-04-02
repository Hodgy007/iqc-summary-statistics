import { neon } from '@neondatabase/serverless';
import { requireAuth } from './lib/auth.js';

export default async function handler(req, res) {
  const minPerm = req.method === 'GET' ? undefined : { permission: 'full_access' };
  const user = await requireAuth(req, res, minPerm);
  if (!user) return;

  const sql = neon(process.env.DATABASE_URL);

  // Prevent caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT id, name, created_at,
          CASE
            WHEN jsonb_typeof(results_data) = 'array' THEN jsonb_array_length(results_data)
            ELSE 0
          END as result_count
        FROM reports
        ORDER BY created_at DESC
      `;
      res.status(200).json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else if (req.method === 'POST') {
    try {
      const { name, raw_data, results_data, exclusions, filters } = req.body;
      if (!name) return res.status(400).json({ error: 'Name is required' });

      const rows = await sql`
        INSERT INTO reports (name, raw_data, results_data, exclusions, filters)
        VALUES (${name}, ${JSON.stringify(raw_data)}, ${JSON.stringify(results_data)}, ${JSON.stringify(exclusions || [])}, ${JSON.stringify(filters || {})})
        RETURNING id, name, created_at
      `;
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
