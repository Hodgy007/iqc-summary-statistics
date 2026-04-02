import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT id, name, created_at,
          jsonb_array_length(COALESCE(results_data, '[]'::jsonb)) as result_count
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
