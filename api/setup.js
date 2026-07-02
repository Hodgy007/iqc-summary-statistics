import { neon } from '@neondatabase/serverless';
import { requireAuth } from './lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sql = neon(process.env.DATABASE_URL);

  // First-boot bootstrap: if the users table doesn't exist yet, nobody can
  // authenticate, so allow setup to run unauthenticated to create the schema.
  // Once users exists, setup requires an admin as before. Only a genuine
  // "relation does not exist" (Postgres 42P01) counts as first boot — any
  // other error (timeout, permission, connection blip) must NOT drop the
  // admin check, so it is surfaced as a 500 instead.
  let usersTableExists = true;
  try {
    await sql`SELECT 1 FROM users LIMIT 1`;
  } catch (err) {
    if (err && err.code === '42P01') {
      usersTableExists = false;
    } else {
      console.error('Setup probe error:', err);
      return res.status(500).json({ error: 'Database setup failed' });
    }
  }

  let user = null;
  if (usersTableExists) {
    user = await requireAuth(req, res, { role: 'admin' });
    if (!user) return;
  }

  try {
    // users must be created first: reports and activity_log reference it
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
    await sql`
      CREATE TABLE IF NOT EXISTS csv_files (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        compressed_data TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    // Add user_id column if it doesn't exist (for existing installations)
    await sql`
      DO $$ BEGIN
        ALTER TABLE reports ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
      EXCEPTION WHEN others THEN NULL;
      END $$
    `;
    // Add compressed_data column for gzipped report storage
    await sql`
      DO $$ BEGIN
        ALTER TABLE reports ADD COLUMN IF NOT EXISTS compressed_data TEXT;
      EXCEPTION WHEN others THEN NULL;
      END $$
    `;

    if (!user) {
      // First boot: schema created, no user to promote or reports to clean
      return res.status(200).json({ success: true, message: 'Database setup complete. Register the first account to become admin.' });
    }

    // Promote the calling user to admin with full_access
    await sql`
      UPDATE users SET role = 'admin', status = 'approved', permission = 'full_access'
      WHERE id = ${user.id}
    `;
    // Clean up broken/empty reports
    const deleted = await sql`
      DELETE FROM reports
      WHERE (raw_data = '[]'::jsonb OR raw_data IS NULL)
        AND (results_data = '[]'::jsonb OR results_data IS NULL)
        AND compressed_data IS NULL
      RETURNING id
    `;
    res.status(200).json({ success: true, message: 'Database setup complete. You are now admin.', deleted_reports: deleted.length });
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: 'Database setup failed' });
  }
}
