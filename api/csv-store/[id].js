import { neon } from '@neondatabase/serverless';
import { requireAuth } from '../lib/auth.js';
import { logActivity } from '../lib/activity.js';

export default async function handler(req, res) {
  const minPerm = req.method === 'GET' ? undefined : { permission: 'full_access' };
  const user = await requireAuth(req, res, minPerm);
  if (!user) return;

  const sql = neon(process.env.DATABASE_URL);
  const { id } = req.query;

  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT id, name, compressed_data, file_size, created_at FROM csv_files WHERE id = ${id}`;
      if (rows.length === 0) return res.status(404).json({ error: 'CSV file not found' });
      const file = rows[0];
      logActivity(user.id, 'csv_download', `Downloaded CSV: ${file.name}`);
      res.status(200).json(file);
    } catch (err) {
      console.error('CSV fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch CSV file' });
    }
  } else if (req.method === 'DELETE') {
    try {
      let rows;
      try {
        rows = await sql`SELECT id, name, user_id FROM csv_files WHERE id = ${id}`;
      } catch {
        rows = await sql`SELECT id, name FROM csv_files WHERE id = ${id}`;
      }
      if (rows.length === 0) return res.status(404).json({ error: 'CSV file not found' });
      if (rows[0].user_id && rows[0].user_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: 'You can only delete your own files' });
      }
      await sql`DELETE FROM csv_files WHERE id = ${id}`;
      logActivity(user.id, 'csv_delete', `Deleted CSV: ${rows[0].name}`);
      res.status(200).json({ success: true });
    } catch (err) {
      console.error('CSV delete error:', err);
      res.status(500).json({ error: 'Failed to delete CSV file' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
