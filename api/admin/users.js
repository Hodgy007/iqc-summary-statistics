import { neon } from '@neondatabase/serverless';
import { requireAuth } from '../lib/auth.js';

export default async function handler(req, res) {
  const user = await requireAuth(req, res, { role: 'admin' });
  if (!user) return;

  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT id, email, role, status, permission, created_at FROM users ORDER BY created_at DESC`;
      res.status(200).json(rows);
    } catch (err) {
      console.error('Admin users list error:', err);
      res.status(500).json({ error: 'Failed to load users' });
    }
  } else if (req.method === 'PUT') {
    try {
      const { userId, status, permission } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });

      // Prevent admin from modifying own account
      if (parseInt(userId) === user.id) {
        return res.status(400).json({ error: 'Cannot modify your own account' });
      }

      const target = await sql`SELECT role FROM users WHERE id = ${userId}`;
      if (target.length === 0) return res.status(404).json({ error: 'User not found' });

      const updates = {};
      if (status && ['approved', 'denied', 'pending'].includes(status)) updates.status = status;
      if (permission && ['view_only', 'full_access'].includes(permission)) updates.permission = permission;

      if (updates.status && updates.permission) {
        await sql`UPDATE users SET status = ${updates.status}, permission = ${updates.permission} WHERE id = ${userId}`;
      } else if (updates.status) {
        await sql`UPDATE users SET status = ${updates.status} WHERE id = ${userId}`;
      } else if (updates.permission) {
        await sql`UPDATE users SET permission = ${updates.permission} WHERE id = ${userId}`;
      }

      res.status(200).json({ success: true });
    } catch (err) {
      console.error('Admin user update error:', err);
      res.status(500).json({ error: 'Failed to update user' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
