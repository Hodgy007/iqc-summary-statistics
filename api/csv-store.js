import { neon } from '@neondatabase/serverless';
import { requireAuth } from './lib/auth.js';
import { logActivity } from './lib/activity.js';

export default async function handler(req, res) {
  const minPerm = req.method === 'GET' ? undefined : { permission: 'full_access' };
  const user = await requireAuth(req, res, minPerm);
  if (!user) return;

  const sql = neon(process.env.DATABASE_URL);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT id, name, file_size, created_at
        FROM csv_files
        ORDER BY created_at DESC
      `;
      res.status(200).json(rows);
    } catch (err) {
      console.error('CSV store list error:', err);
      res.status(500).json({ error: 'Failed to list CSV files' });
    }
  } else if (req.method === 'POST') {
    try {
      const { name, data_gz, file_size } = req.body;
      if (!name) return res.status(400).json({ error: 'File name is required' });
      if (!data_gz) return res.status(400).json({ error: 'File data is required' });

      let rows;
      try {
        rows = await sql`
          INSERT INTO csv_files (name, compressed_data, file_size, user_id)
          VALUES (${name}, ${data_gz}, ${file_size || 0}, ${user.id})
          RETURNING id, name, file_size, created_at
        `;
      } catch (insertErr) {
        rows = await sql`
          INSERT INTO csv_files (name, compressed_data, file_size)
          VALUES (${name}, ${data_gz}, ${file_size || 0})
          RETURNING id, name, file_size, created_at
        `;
      }
      logActivity(user.id, 'csv_upload', `Uploaded CSV: ${name}`);
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error('CSV store upload error:', err.message || err);
      res.status(500).json({ error: 'Failed to upload CSV file', detail: err.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
