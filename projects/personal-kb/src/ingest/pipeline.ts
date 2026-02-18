import { DBContext } from '../db/client.js';
import { chunkText, simpleTokenCount } from '../utils/chunking.js';
import { embedText } from '../retrieval/embeddings.js';
import { extractFromUrl } from './extractors.js';

export async function ingestUrl(ctx: DBContext, url: string): Promise<number> {
  const { db, sqliteVecEnabled } = ctx;

  const job = db
    .prepare('INSERT INTO jobs (job_type, status, payload_json) VALUES (?, ?, ?)')
    .run('ingest', 'running', JSON.stringify({ url }));

  try {
    const extracted = await extractFromUrl(url);

    const sourceWeight = extracted.type === 'youtube' ? 0.9 : extracted.type === 'pdf' ? 1.1 : 1.0;

    const src = db
      .prepare(
        `INSERT INTO sources (type, url, canonical_url, title, author, published_at, raw_metadata_json, source_weight)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        extracted.type,
        url,
        url,
        extracted.title || null,
        extracted.author || null,
        extracted.publishedAt || null,
        JSON.stringify(extracted.metadata || {}),
        sourceWeight
      );

    const sourceId = Number(src.lastInsertRowid);
    const chunks = chunkText(extracted.text);

    const insertChunk = db.prepare(
      'INSERT INTO chunks (source_id, chunk_index, text, token_count, embedding_json) VALUES (?, ?, ?, ?, ?)'
    );

    const insertVec = db.prepare('INSERT OR REPLACE INTO chunk_vec (chunk_id, embedding) VALUES (?, ?)');

    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i];
      const emb = await embedText(text);
      const result = insertChunk.run(sourceId, i, text, simpleTokenCount(text), JSON.stringify(emb));
      if (sqliteVecEnabled) {
        try {
          insertVec.run(Number(result.lastInsertRowid), JSON.stringify(emb));
        } catch {
          // silently fallback to json-vector mode
        }
      }
    }

    db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('done', job.lastInsertRowid);
    return sourceId;
  } catch (error) {
    db.prepare('UPDATE jobs SET status = ?, error_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      'failed',
      error instanceof Error ? error.message : String(error),
      job.lastInsertRowid
    );
    throw error;
  }
}
