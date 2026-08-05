import { neon } from '@neondatabase/serverless';

export async function logActivity(userId, action, detail = '') {
  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      INSERT INTO activity_log (user_id, action, detail)
      VALUES (${userId}, ${action}, ${detail})
    `;
  } catch (err) {
    // Don't let logging failures break the main flow
    console.error('Activity log write error:', err);
  }
}
