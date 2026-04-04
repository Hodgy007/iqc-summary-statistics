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
      const rows = await sql`SELECT * FROM reports WHERE id = ${id}`;
      if (rows.length === 0) return res.status(404).json({ error: 'Report not found' });
      logActivity(user.id, 'report_load', `Loaded report: ${rows[0].name}`);
      res.status(200).json(rows[0]);
    } catch (err) {
      console.error('Report fetch error:', err);
      res.status(500).json({ error: 'Failed to load report' });
    }
  } else if (req.method === 'DELETE') {
    try {
      // Only allow owner or admin to delete
      let rows;
      try {
        rows = await sql`SELECT id, user_id FROM reports WHERE id = ${id}`;
      } catch {
        rows = await sql`SELECT id FROM reports WHERE id = ${id}`;
      }
      if (rows.length === 0) return res.status(404).json({ error: 'Report not found' });
      if (rows[0].user_id && rows[0].user_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: 'You can only delete your own reports' });
      }
      await sql`DELETE FROM reports WHERE id = ${id}`;
      logActivity(user.id, 'report_delete', `Deleted report ID: ${id}`);
      res.status(200).json({ success: true });
    } catch (err) {
      console.error('Report delete error:', err);
      res.status(500).json({ error: 'Failed to delete report' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
