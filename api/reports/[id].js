import { neon } from '@neondatabase/serverless';
import { requireAuth } from '../lib/auth.js';

export default async function handler(req, res) {
  const minPerm = req.method === 'GET' ? undefined : { permission: 'full_access' };
  const user = await requireAuth(req, res, minPerm);
  if (!user) return;

  const sql = neon(process.env.DATABASE_URL);
  const { id } = req.query;

  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT * FROM reports WHERE id = ${id}`;
      if (rows.length === 0) return res.status(404).json({ error: 'Report not found' });
      res.status(200).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else if (req.method === 'DELETE') {
    try {
      await sql`DELETE FROM reports WHERE id = ${id}`;
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
