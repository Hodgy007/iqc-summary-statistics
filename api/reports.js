import { neon } from '@neondatabase/serverless';
import { requireAuth } from './lib/auth.js';
import { logActivity } from './lib/activity.js';

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
      console.error('Reports list error:', err);
      res.status(500).json({ error: 'Failed to load reports' });
    }
  } else if (req.method === 'POST') {
    try {
      const { name, raw_data, results_data, raw_data_gz, results_data_gz, exclusions, filters } = req.body;
      if (!name) return res.status(400).json({ error: 'Name is required' });

      // If compressed data is provided, store in report_chunks table
      if (raw_data_gz || results_data_gz) {
        let rows;
        try {
          rows = await sql`
            INSERT INTO reports (name, user_id, raw_data, results_data, exclusions, filters)
            VALUES (${name}, ${user.id}, '[]'::jsonb, '[]'::jsonb, ${JSON.stringify(exclusions || [])}::jsonb, ${JSON.stringify(filters || {})}::jsonb)
            RETURNING id, name, created_at
          `;
        } catch (insertErr) {
          rows = await sql`
            INSERT INTO reports (name, raw_data, results_data, exclusions, filters)
            VALUES (${name}, '[]'::jsonb, '[]'::jsonb, ${JSON.stringify(exclusions || [])}::jsonb, ${JSON.stringify(filters || {})}::jsonb)
            RETURNING id, name, created_at
          `;
        }
        const reportId = rows[0].id;

        // Store compressed data as TEXT chunks (fast INSERT, no JSONB parsing)
        const chunkInserts = [];
        if (raw_data_gz) {
          chunkInserts.push(sql`
            INSERT INTO report_chunks (report_id, chunk_type, chunk_index, data)
            VALUES (${reportId}, 'raw_data', 0, ${raw_data_gz})
          `);
        }
        if (results_data_gz) {
          chunkInserts.push(sql`
            INSERT INTO report_chunks (report_id, chunk_type, chunk_index, data)
            VALUES (${reportId}, 'results_data', 0, ${results_data_gz})
          `);
        }
        await Promise.all(chunkInserts);

        logActivity(user.id, 'report_save', `Saved report: ${name}`);
        return res.status(201).json(rows[0]);
      }

      // Legacy uncompressed format
      let rows;
      try {
        rows = await sql`
          INSERT INTO reports (name, user_id, raw_data, results_data, exclusions, filters)
          VALUES (${name}, ${user.id}, ${JSON.stringify(raw_data || [])}::jsonb, ${JSON.stringify(results_data || [])}::jsonb, ${JSON.stringify(exclusions || [])}::jsonb, ${JSON.stringify(filters || {})}::jsonb)
          RETURNING id, name, created_at
        `;
      } catch (insertErr) {
        rows = await sql`
          INSERT INTO reports (name, raw_data, results_data, exclusions, filters)
          VALUES (${name}, ${JSON.stringify(raw_data || [])}::jsonb, ${JSON.stringify(results_data || [])}::jsonb, ${JSON.stringify(exclusions || [])}::jsonb, ${JSON.stringify(filters || {})}::jsonb)
          RETURNING id, name, created_at
        `;
      }
      logActivity(user.id, 'report_save', `Saved report: ${name}`);
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error('Report save error:', err.message || err);
      res.status(500).json({ error: 'Failed to save report', detail: err.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
