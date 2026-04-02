import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        raw_data JSONB,
        results_data JSONB,
        exclusions JSONB DEFAULT '[]',
        filters JSONB DEFAULT '{}'
      )
    `;
    res.status(200).json({ success: true, message: 'Database setup complete' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
