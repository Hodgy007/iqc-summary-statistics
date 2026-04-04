import { neon } from '@neondatabase/serverless';
import { requireAuth } from './lib/auth.js';

export default async function handler(req, res) {
  const user = await requireAuth(req, res, { role: 'admin' });
  if (!user) return;

  const sql = neon(process.env.DATABASE_URL);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        user_id INTEGER REFERENCES users(id),
        raw_data JSONB,
        results_data JSONB,
        exclusions JSONB DEFAULT '[]',
        filters JSONB DEFAULT '{}'
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'pending',
        permission TEXT NOT NULL DEFAULT 'view_only',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL,
        detail TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS report_chunks (
        id SERIAL PRIMARY KEY,
        report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        chunk_type TEXT NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL
      )
    `;
    // Migrate data column from JSONB to TEXT if needed
    await sql`
      DO $$ BEGIN
        ALTER TABLE report_chunks ALTER COLUMN data TYPE TEXT;
      EXCEPTION WHEN others THEN NULL;
      END $$
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_report_chunks_report_id ON report_chunks(report_id, chunk_type, chunk_index)`;
    // Add user_id column if it doesn't exist (for existing installations)
    await sql`
      DO $$ BEGIN
        ALTER TABLE reports ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
      EXCEPTION WHEN others THEN NULL;
      END $$
    `;
    res.status(200).json({ success: true, message: 'Database setup complete' });
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: 'Database setup failed' });
  }
}
