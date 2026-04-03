import { neon } from '@neondatabase/serverless';
import { requireAuth } from '../lib/auth.js';

export default async function handler(req, res) {
  const user = await requireAuth(req, res, { role: 'admin' });
  if (!user) return;

  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const offset = parseInt(req.query.offset) || 0;

      const rows = await sql`
        SELECT a.id, a.action, a.detail, a.created_at, u.email
        FROM activity_log a
        LEFT JOIN users u ON a.user_id = u.id
        ORDER BY a.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const countResult = await sql`SELECT COUNT(*)::int as total FROM activity_log`;
      const total = countResult[0].total;

      res.status(200).json({ logs: rows, total });
    } catch (err) {
      console.error('Activity log fetch error:', err);
      res.status(500).json({ error: 'Failed to load activity log' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
