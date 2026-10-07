// One-off: copy all data from one Neon database to another (e.g. to change region).
//   OLD_URL=... NEW_URL=... node scripts/migrate-neon.mjs
// Stop writes to the app first. Safe to re-run: it refuses to copy into non-empty tables.
import { neon } from '@neondatabase/serverless';

const { OLD_URL, NEW_URL } = process.env;
if (!OLD_URL || !NEW_URL) throw new Error('Set OLD_URL and NEW_URL');
const oldDb = neon(OLD_URL);
const newDb = neon(NEW_URL);

// Parents before children (FK order). Same schema as api/setup.js.
const TABLES = ['users', 'reports', 'activity_log', 'report_chunks', 'csv_files'];

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'pending',
    permission TEXT NOT NULL DEFAULT 'view_only', created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
    user_id INTEGER REFERENCES users(id), raw_data JSONB, results_data JSONB,
    exclusions JSONB DEFAULT '[]', filters JSONB DEFAULT '{}', compressed_data TEXT)`,
  `CREATE TABLE IF NOT EXISTS activity_log (
    id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
    detail TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS report_chunks (
    id SERIAL PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    chunk_type TEXT NOT NULL, chunk_index INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_report_chunks_report_id ON report_chunks(report_id, chunk_type, chunk_index)`,
  `CREATE TABLE IF NOT EXISTS csv_files (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, compressed_data TEXT NOT NULL,
    file_size INTEGER DEFAULT 0, user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW())`,
];

for (const stmt of DDL) await newDb.query(stmt);

// Fail loudly if the old DB has tables this script doesn't know about.
const found = (await oldDb.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`
)).map((r) => r.table_name);
const unknown = found.filter((t) => !TABLES.includes(t));
if (unknown.length) throw new Error(`Old DB has unexpected tables: ${unknown.join(', ')}`);

for (const t of TABLES) {
  const [{ n }] = await newDb.query(`SELECT count(*)::int n FROM ${t}`);
  if (n > 0) throw new Error(`${t} on the new DB is not empty (${n} rows); aborting`);
}

for (const t of TABLES) {
  const [{ rows }] = await oldDb.query(`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb) AS rows FROM ${t} x`);
  if (rows.length) {
    await newDb.query(
      `INSERT INTO ${t} SELECT * FROM jsonb_populate_recordset(NULL::${t}, $1::jsonb)`,
      [JSON.stringify(rows)]
    );
  }
  await newDb.query(
    `SELECT setval(pg_get_serial_sequence('${t}', 'id'), coalesce((SELECT max(id) FROM ${t}), 1), (SELECT count(*) > 0 FROM ${t}))`
  );
  console.log(`${t}: copied ${rows.length} rows`);
}

let ok = true;
for (const t of TABLES) {
  const [[a], [b]] = await Promise.all([
    oldDb.query(`SELECT count(*)::int n FROM ${t}`),
    newDb.query(`SELECT count(*)::int n FROM ${t}`),
  ]);
  const match = a.n === b.n;
  ok &&= match;
  console.log(`verify ${t}: old=${a.n} new=${b.n} ${match ? 'OK' : 'MISMATCH'}`);
}
process.exit(ok ? 0 : 1);
