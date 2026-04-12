import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { requireAuth } from '../lib/auth.js';
import { logActivity } from '../lib/activity.js';

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res, { role: 'admin' });
  if (!user) return;

  const sql = neon(process.env.DATABASE_URL);

  try {
    const { userId, newPassword } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const target = await sql`SELECT id, email FROM users WHERE id = ${userId}`;
    if (target.length === 0) return res.status(404).json({ error: 'User not found' });

    const hash = await bcrypt.hash(newPassword, 10);
    await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${userId}`;

    logActivity(user.id, 'password_reset', `Reset password for user: ${target[0].email}`);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
}
