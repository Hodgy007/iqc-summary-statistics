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
          SELECT chunk_type, chunk_index, data FROM report_chunks
          WHERE report_id = ${id}
          ORDER BY chunk_type, chunk_index
        `;
        if (chunks.length > 0) {
          // Send compressed chunks to client for decompression
          report._chunks = chunks.map(c => ({ type: c.chunk_type, index: c.chunk_index, data: c.data }));
          report.raw_data = report.raw_data || [];
          report.results_data = report.results_data || [];
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

      const { compressed, chunk_type, chunk_index, results_data_chunk, raw_data_chunk } = req.body;

      // New compressed format
      if (compressed && chunk_type) {
        await sql`
          INSERT INTO report_chunks (report_id, chunk_type, chunk_index, data)
          VALUES (${id}, ${chunk_type}, ${chunk_index || 0}, ${compressed})
        `;
        return res.status(200).json({ id, chunk_type, chunk_index });
      }

      // Legacy uncompressed format
      if (!results_data_chunk && !raw_data_chunk) {
        return res.status(400).json({ error: 'Chunk data required' });
      }
      const cType = raw_data_chunk ? 'raw_data' : 'results_data';
      const cData = raw_data_chunk || results_data_chunk;
      await sql`
        INSERT INTO report_chunks (report_id, chunk_type, chunk_index, data)
        VALUES (${id}, ${cType}, ${chunk_index || 0}, ${JSON.stringify(cData)})
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
