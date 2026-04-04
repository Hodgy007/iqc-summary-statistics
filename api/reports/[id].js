import { neon } from '@neondatabase/serverless';
import { requireAuth } from '../lib/auth.js';
import { logActivity } from '../lib/activity.js';

export default async function handler(req, res) {
  const minPerm = req.method === 'GET' ? undefined : { permission: 'full_access' };
  const user = await requireAuth(req, res, minPerm);
  if (!user) return;

  const sql = neon(process.env.DATABASE_URL);
  const { id } = req.query;

  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT * FROM reports WHERE id = ${id}`;
      if (rows.length === 0) return res.status(404).json({ error: 'Report not found' });
      const report = rows[0];

      // Assemble chunked data if available
      try {
        const chunks = await sql`
          SELECT chunk_type, data FROM report_chunks
          WHERE report_id = ${id}
          ORDER BY chunk_type, chunk_index
        `;
        if (chunks.length > 0) {
          const rawChunks = chunks.filter(c => c.chunk_type === 'raw_data').flatMap(c => c.data);
          const resChunks = chunks.filter(c => c.chunk_type === 'results_data').flatMap(c => c.data);
          if (rawChunks.length > 0) report.raw_data = rawChunks;
          if (resChunks.length > 0) report.results_data = resChunks;
        }
      } catch {
        // report_chunks table may not exist yet - use inline data
      }

      logActivity(user.id, 'report_load', `Loaded report: ${report.name}`);
      res.status(200).json(report);
    } catch (err) {
      console.error('Report fetch error:', err);
      res.status(500).json({ error: 'Failed to load report' });
    }
  } else if (req.method === 'DELETE') {
    try {
      // Only allow owner or admin to delete
      let rows;
      try {
        rows = await sql`SELECT id, user_id FROM reports WHERE id = ${id}`;
      } catch {
        rows = await sql`SELECT id FROM reports WHERE id = ${id}`;
      }
      if (rows.length === 0) return res.status(404).json({ error: 'Report not found' });
      if (rows[0].user_id && rows[0].user_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: 'You can only delete your own reports' });
      }
      await sql`DELETE FROM reports WHERE id = ${id}`;
      logActivity(user.id, 'report_delete', `Deleted report ID: ${id}`);
      res.status(200).json({ success: true });
    } catch (err) {
      console.error('Report delete error:', err);
      res.status(500).json({ error: 'Failed to delete report' });
    }
  } else if (req.method === 'PATCH') {
    try {
      let rows;
      try {
        rows = await sql`SELECT user_id FROM reports WHERE id = ${id}`;
      } catch {
        rows = await sql`SELECT id FROM reports WHERE id = ${id}`;
      }
      if (rows.length === 0) return res.status(404).json({ error: 'Report not found' });
      if (rows[0].user_id && rows[0].user_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: 'You can only update your own reports' });
      }

      const { results_data_chunk, raw_data_chunk, chunk_index } = req.body;
      if (!results_data_chunk && !raw_data_chunk) {
        return res.status(400).json({ error: 'Chunk data required' });
      }

      const chunkType = raw_data_chunk ? 'raw_data' : 'results_data';
      const chunkData = raw_data_chunk || results_data_chunk;
      const idx = chunk_index || 0;

      await sql`
        INSERT INTO report_chunks (report_id, chunk_type, chunk_index, data)
        VALUES (${id}, ${chunkType}, ${idx}, ${JSON.stringify(chunkData)}::jsonb)
      `;

      res.status(200).json({ id, chunk_type: chunkType, chunk_index: idx });
    } catch (err) {
      console.error('Report chunk update error:', err);
      res.status(500).json({ error: 'Failed to append chunk', detail: err.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
