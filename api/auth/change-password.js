import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { requireAuth } from '../lib/auth.js';
import { logActivity } from '../lib/activity.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const sql = neon(process.env.DATABASE_URL);

  try {
    const rows = await sql`SELECT password_hash FROM users WHERE id = ${user.id}`;
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 10);
    await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${user.id}`;

    logActivity(user.id, 'password_change', 'Changed own password');
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
}
