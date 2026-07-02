import { requireAuth } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // allowPending so the frontend can show the "account pending" screen
  const user = await requireAuth(req, res, { allowPending: true });
  if (!user) return;

  res.status(200).json({ user: { id: user.id, email: user.email, role: user.role, permission: user.permission, status: user.status } });
}
