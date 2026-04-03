import { requireAuth } from './lib/auth.js';
import { logActivity } from './lib/activity.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { action, detail } = req.body;
  if (!action) return res.status(400).json({ error: 'Action is required' });

  // Validate action is a known client-side action
  const allowedActions = ['data_process', 'export_pdf', 'export_xlsx', 'export_csv', 'data_clear'];
  if (!allowedActions.includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  await logActivity(user.id, action, String(detail || '').substring(0, 500));
  res.status(200).json({ success: true });
}
